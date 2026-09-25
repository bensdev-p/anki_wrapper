"""Thin HTTP layer over the service module.

Run (single worker; the collection must only be opened once):
  uvicorn api.main:app --app-dir backend --host 127.0.0.1 --port 8000
"""

from __future__ import annotations

import asyncio
import io
import ipaddress
import mimetypes
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

import service
from version import __version__
from service.stats import MAX_DAYS as STATS_MAX_DAYS
from safety import DEV_COLLECTION, REPO_ROOT, desktop_mode, is_sync_collection, resolve_collection_path, synced_dir
from service.types import (
    AddDefaults,
    AddNoteResult,
    AnswerResult,
    BackupInfo,
    CustomStudyInfo,
    DeckName,
    DeckOptions,
    DeletedDeck,
    FilteredDeckForm,
    FilteredDeckSpec,
    BrowsePage,
    CardInfo,
    NoteForEdit,
    RenderedCard,
    DeckNode,
    SearchResult,
    StatsSummary,
    StudyState,
    UndoResult,
)

from .host import CollectionHost
from .importer import ImportManager, ImportStatus
from .updates import UpdateChecker, UpdateInfo
from .sharing import COOKIE, COOKIE_MAX_AGE, PairingLocked, Sharing, SharingStatus
from .sync_manager import AuthFailed, SyncManager, SyncStatus

# SVG and some audio types aren't in every system's mime table.
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("audio/mpeg", ".mp3")
mimetypes.add_type("audio/ogg", ".ogg")
mimetypes.add_type("audio/wav", ".wav")
mimetypes.add_type("image/webp", ".webp")


# Anki desktop takes a backup every 30 minutes of use and on close; so does the
# server, for any real collection (the synthetic sample doesn't need them).
BACKUP_EVERY_SECS = 30 * 60


def _backup(host: CollectionHost, force: bool):  # type: ignore[no-untyped-def]
    folder = host.path.parent / "backups"
    folder.mkdir(exist_ok=True)
    # force=False lets Anki apply its own interval and skip unchanged collections.
    return lambda col: col.create_backup(backup_folder=str(folder), force=force, wait_for_completion=True)


async def _periodic_backups(host: CollectionHost) -> None:
    while True:
        await asyncio.sleep(BACKUP_EVERY_SECS)
        try:
            await host.run(_backup(host, force=False))
        except Exception as err:  # never let a failed backup take the server down
            print(f"backup failed: {err}")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    path = resolve_collection_path()
    host = CollectionHost(path, create=desktop_mode() and is_sync_collection(path))
    host.open()
    app.state.host = host
    app.state.sync = SyncManager(host)
    app.state.importer = ImportManager(host)
    app.state.updates = UpdateChecker()
    # Phones on the home network: a desktop-app feature (the Pi is on the network anyway).
    app.state.sharing = Sharing(synced_dir().parent, app) if desktop_mode() else None  # the app's data folder
    if app.state.sharing:
        await app.state.sharing.start()
    backups = None if host.path == DEV_COLLECTION.resolve() else asyncio.create_task(_periodic_backups(host))
    try:
        yield
    finally:
        if app.state.sharing:
            await app.state.sharing.stop()
        if backups:
            backups.cancel()
        await app.state.sync.wait()
        await app.state.importer.wait()
        if backups:
            try:
                await host.run(_backup(host, force=False))
            except Exception as err:
                print(f"backup on shutdown failed: {err}")
        host.close()


app = FastAPI(title="Anki study client API", lifespan=lifespan)


def _host(request: Request) -> CollectionHost:
    return request.app.state.host


# Starlette's TestClient reports its client as "testclient".
_LOOPBACK = {"127.0.0.1", "::1", "localhost", "testclient"}


def _is_local(request: Request) -> bool:
    """The request comes from this computer (the desktop window), not the network.

    Behind the Vite dev proxy every request arrives from localhost, so a
    forwarded address (X-Forwarded-For) is checked too. The header can only
    make a request count as *less* local, never more.
    """
    if request.client is None or request.client.host not in _LOOPBACK:
        return False
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return all(part.strip() in _LOOPBACK for part in forwarded.split(","))
    return True


def _require_local(request: Request) -> None:
    if not _is_local(request):
        raise HTTPException(403, "Do this on the computer running Rounds.")


def _host_allowed(host: str) -> bool:
    """IP addresses, localhost and Bonjour (.local) names only.

    The desktop app runs on someone's everyday computer. Refusing other host
    names stops DNS-rebinding tricks, where a web page on some other site
    points its own name at 127.0.0.1 to read this server's responses.
    """
    name = host.rsplit(":", 1)[0].strip("[]").lower() if not host.startswith("[") else host[1:].split("]")[0]
    if name in ("localhost", "testserver") or name.endswith(".local"):
        return True
    try:
        ipaddress.ip_address(name)
        return True
    except ValueError:
        return False


def _same_origin(request: Request) -> bool:
    """A state-changing request must come from this app's own pages, not another site."""
    origin = request.headers.get("origin")
    if not origin or origin == "null":
        return origin is None
    return origin.split("://", 1)[-1].rstrip("/") == request.headers.get("host", "")


# Paths a phone may use before pairing: the pairing call, and media by token.
_UNPAIRED_OK = ("/api/pair", "/api/m/")


@app.middleware("http")
async def _guard(request: Request, call_next):  # type: ignore[no-untyped-def]
    sharing: Sharing | None = getattr(request.app.state, "sharing", None)
    path = request.url.path
    if sharing is not None and not _host_allowed(request.headers.get("host", "")):
        return JSONResponse({"error": "BadHost", "detail": "Open Rounds by its IP address or .local name."}, 403)
    if request.method not in ("GET", "HEAD", "OPTIONS") and not _same_origin(request):
        return JSONResponse({"error": "CrossOrigin", "detail": "Requests from other websites aren’t allowed."}, 403)
    if (
        sharing is not None
        and path.startswith("/api/")
        and not path.startswith(_UNPAIRED_OK)
        and not _is_local(request)
        and not sharing.device_ok(request.cookies.get(COOKIE))
    ):
        return JSONResponse({"error": "PairingRequired", "detail": "Enter the code shown on your computer."}, 401)
    return await call_next(request)


@app.exception_handler(service.ServiceError)
async def _service_error(_: Request, exc: service.ServiceError) -> JSONResponse:
    status = 404 if isinstance(exc, service.NotFound) else 422 if isinstance(exc, service.browser.InvalidSearch) else 409
    return JSONResponse({"error": type(exc).__name__, "detail": str(exc)}, status_code=status)


@app.exception_handler(ValueError)
async def _value_error(_: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse({"error": "ValueError", "detail": str(exc)}, status_code=422)


# Endpoints
##########################################################################


@dataclass
class Info:
    collection: str
    is_sample: bool
    card_count: int
    sync_enabled: bool
    desktop: bool
    """Running as the desktop app (rather than the Pi server)."""
    media_path: str
    """Where card media is served for this client (a token path for paired phones)."""
    remote: bool
    """This client is another device (a paired phone), not the computer running Rounds."""
    version: str


@app.get("/api/info")
async def info(request: Request) -> Info:
    host = _host(request)
    count = await host.run(lambda col: col.card_count())
    return Info(
        collection=host.path.parent.name,
        is_sample=host.path == DEV_COLLECTION.resolve(),
        card_count=count,
        sync_enabled=request.app.state.sync.enabled,
        desktop=desktop_mode(),
        media_path=_media_path(request),
        remote=not _is_local(request),
        version=__version__,
    )


def _media_path(request: Request) -> str:
    sharing: Sharing | None = request.app.state.sharing
    if sharing is not None and not _is_local(request):
        return f"/api/m/{sharing.state.media_token}/"
    return "/api/media/"


@app.get("/api/decks")
async def decks(request: Request) -> list[DeckNode]:
    return await _host(request).run(service.deck_tree)


@app.get("/api/study")
async def study_state(request: Request) -> StudyState:
    return await _host(request).run(service.study_state)


@app.post("/api/study/deck/{deck_id}")
async def select_deck(request: Request, deck_id: int) -> StudyState:
    return await _host(request).run(lambda col: service.select_deck(col, deck_id))


class AnswerRequest(BaseModel):
    card_id: int
    rating: int = Field(ge=1, le=4)
    ms_taken: int = Field(ge=0)


@dataclass
class AnswerResponse:
    result: AnswerResult
    state: StudyState
    """The next card, so answering costs a single round trip."""


@app.post("/api/study/answer")
async def answer(request: Request, body: AnswerRequest) -> AnswerResponse:
    def op(col):  # type: ignore[no-untyped-def]
        result = service.answer_card(col, body.card_id, body.rating, body.ms_taken)
        return AnswerResponse(result=result, state=service.study_state(col))

    return await _host(request).run(op)


@dataclass
class UndoResponse:
    result: UndoResult
    state: StudyState


@app.post("/api/study/undo")
async def undo(request: Request) -> UndoResponse:
    def op(col):  # type: ignore[no-untyped-def]
        result = service.undo(col)
        return UndoResponse(result=result, state=service.study_state(col))

    return await _host(request).run(op)


# Card actions (flag, mark, suspend, bury) and card details
##########################################################################


class FlagRequest(BaseModel):
    flag: int = Field(ge=0, le=7)


@dataclass
class FlagResponse:
    flag: int


@app.post("/api/cards/{card_id}/flag")
async def flag_card(request: Request, card_id: int, body: FlagRequest) -> FlagResponse:
    """Set a flag; setting the card's current flag again clears it (as desktop)."""
    return FlagResponse(await _host(request).run(lambda col: service.set_flag(col, card_id, body.flag)))


@dataclass
class MarkResponse:
    marked: bool


@app.post("/api/notes/{note_id}/mark")
async def mark_note(request: Request, note_id: int) -> MarkResponse:
    return MarkResponse(await _host(request).run(lambda col: service.toggle_mark(col, note_id)))


class CardActionRequest(BaseModel):
    card_id: int
    whole_note: bool = False


@app.post("/api/study/suspend")
async def suspend(request: Request, body: CardActionRequest) -> StudyState:
    return await _host(request).run(lambda col: service.suspend(col, body.card_id, body.whole_note))


@app.post("/api/study/bury")
async def bury(request: Request, body: CardActionRequest) -> StudyState:
    return await _host(request).run(lambda col: service.bury(col, body.card_id, body.whole_note))


class CompareRequest(BaseModel):
    typed: str = Field(max_length=10_000)


@dataclass
class CompareResponse:
    html: str


@app.post("/api/cards/{card_id}/compare")
async def compare(request: Request, card_id: int, body: CompareRequest) -> CompareResponse:
    """Typed-answer comparison HTML (Anki's compare_answer)."""
    return CompareResponse(await _host(request).run(lambda col: service.compare_answer(col, card_id, body.typed)))


@app.get("/api/cards/{card_id}/info")
async def card_info(request: Request, card_id: int) -> CardInfo:
    return await _host(request).run(lambda col: service.card_info(col, card_id))


@app.get("/api/cards/{card_id}/render")
async def render_card(request: Request, card_id: int) -> RenderedCard:
    return await _host(request).run(lambda col: service.rerender(col, card_id))


@app.get("/api/notes/{note_id}")
async def get_note(request: Request, note_id: int) -> NoteForEdit:
    return await _host(request).run(lambda col: service.note_for_edit(col, note_id))


class NoteUpdate(BaseModel):
    fields: dict[str, str] = Field(default_factory=dict)
    """Only the fields that changed."""
    tags: list[str] | None = None


@app.put("/api/notes/{note_id}")
async def put_note(request: Request, note_id: int, body: NoteUpdate) -> NoteForEdit:
    return await _host(request).run(lambda col: service.update_note(col, note_id, body.fields, body.tags))


# Decks: create, rename, delete, options
##########################################################################


@app.get("/api/deck-names")
async def deck_names(request: Request) -> list[DeckName]:
    return await _host(request).run(service.deck_names)


class DeckNameBody(BaseModel):
    name: str = Field(min_length=1, max_length=500)


@app.post("/api/decks")
async def create_deck(request: Request, body: DeckNameBody) -> DeckName:
    return await _host(request).run(lambda col: service.create_deck(col, body.name))


@app.patch("/api/decks/{deck_id}")
async def rename_deck(request: Request, deck_id: int, body: DeckNameBody) -> DeckName:
    return await _host(request).run(lambda col: service.rename_deck(col, deck_id, body.name))


@dataclass
class CardCount:
    cards: int


@app.get("/api/decks/{deck_id}/card-count")
async def deck_card_count(request: Request, deck_id: int) -> CardCount:
    return CardCount(await _host(request).run(lambda col: service.deck_card_count(col, deck_id)))


@app.delete("/api/decks/{deck_id}")
async def delete_deck(request: Request, deck_id: int) -> DeletedDeck:
    return await _host(request).run(lambda col: service.delete_deck(col, deck_id))


class UndoStep(BaseModel):
    label: str = Field(min_length=1, max_length=200)


@app.post("/api/undo-step")
async def undo_step(request: Request, body: UndoStep) -> UndoResult:
    """Undo one specific step (an "Undo" button in a notice), only if it's still the last one."""
    return await _host(request).run(lambda col: service.undo_step(col, body.label))


@app.get("/api/decks/{deck_id}/options")
async def get_deck_options(request: Request, deck_id: int) -> DeckOptions:
    return await _host(request).run(lambda col: service.deck_options.deck_options(col, deck_id))


class DeckOptionsUpdate(BaseModel):
    preset_id: int
    changes: dict[str, bool | int | float | list[float]] = Field(default_factory=dict)
    rename_preset: str | None = Field(None, max_length=200)
    new_preset_name: str | None = Field(None, max_length=200)
    fsrs: bool | None = None
    apply_to_children: bool = False


@app.put("/api/decks/{deck_id}/options")
async def put_deck_options(request: Request, deck_id: int, body: DeckOptionsUpdate) -> DeckOptions:
    return await _host(request).run(
        lambda col: service.deck_options.update_deck_options(
            col,
            deck_id,
            preset_id=body.preset_id,
            changes=body.changes,
            rename_preset=body.rename_preset,
            new_preset_name=body.new_preset_name,
            fsrs=body.fsrs,
            apply_to_children=body.apply_to_children,
        )
    )


# Custom study, filtered decks, importing
##########################################################################


@app.get("/api/decks/{deck_id}/custom-study")
async def custom_study_info(request: Request, deck_id: int) -> CustomStudyInfo:
    return await _host(request).run(lambda col: service.study_tools.custom_study_info(col, deck_id))


class CustomStudyBody(BaseModel):
    kind: str = Field(pattern="^(new|review|forgot|ahead|preview|cram)$")
    amount: int = Field(ge=1, le=9999)
    cram_kind: str = Field("all", pattern="^(due|new|review|all)$")
    tags_include: list[str] = Field(default_factory=list)
    tags_exclude: list[str] = Field(default_factory=list)


@dataclass
class DeckRef:
    deck_id: int


@app.post("/api/decks/{deck_id}/custom-study")
async def custom_study(request: Request, deck_id: int, body: CustomStudyBody) -> DeckRef:
    """Returns the deck to study next (the Custom Study Session, or this deck)."""
    return DeckRef(
        await _host(request).run(
            lambda col: service.study_tools.custom_study(
                col, deck_id, body.kind, body.amount, body.cram_kind, body.tags_include, body.tags_exclude  # type: ignore[arg-type]
            )
        )
    )


@app.get("/api/filtered/{deck_id}")
async def get_filtered(request: Request, deck_id: int, search: str | None = Query(None, max_length=2000)) -> FilteredDeckForm:
    """A filtered deck to edit; deck_id 0 gives Anki's defaults for a new one."""
    return await _host(request).run(lambda col: service.study_tools.filtered_deck(col, deck_id, search))


class FilteredBody(BaseModel):
    id: int = 0
    name: str = Field(min_length=1, max_length=500)
    search: str = Field(min_length=1, max_length=2000)
    limit: int = Field(ge=1, le=99999)
    order: int = Field(ge=0, le=50)
    reschedule: bool = True
    search2: str | None = Field(None, max_length=2000)
    limit2: int = Field(0, ge=0, le=99999)
    order2: int = Field(0, ge=0, le=50)


@app.put("/api/filtered")
async def save_filtered(request: Request, body: FilteredBody) -> DeckRef:
    spec = FilteredDeckSpec(**body.model_dump())
    return DeckRef(await _host(request).run(lambda col: service.study_tools.save_filtered_deck(col, spec)))


@app.post("/api/filtered/{deck_id}/rebuild")
async def rebuild_filtered(request: Request, deck_id: int) -> CardCount:
    return CardCount(await _host(request).run(lambda col: service.study_tools.rebuild_filtered_deck(col, deck_id)))


@app.post("/api/filtered/{deck_id}/empty")
async def empty_filtered(request: Request, deck_id: int) -> CardCount:
    await _host(request).run(lambda col: service.study_tools.empty_filtered_deck(col, deck_id))
    return CardCount(0)


@app.get("/api/import")
async def import_status(request: Request) -> ImportStatus:
    return request.app.state.importer.status()


@app.post("/api/import")
async def import_start(request: Request, name: str = Query(..., min_length=1, max_length=300)) -> ImportStatus:
    """Upload a .apkg (raw body) and import it in the background; poll GET /api/import."""
    importer: ImportManager = request.app.state.importer
    try:
        await importer.receive_and_start(request, name)
    except PermissionError as err:
        raise HTTPException(409, str(err)) from err
    return importer.status()


# Backups and updates
##########################################################################


def _backup_folder(request: Request) -> Path:
    return _host(request).path.parent / "backups"


@app.get("/api/backups")
async def backups(request: Request) -> list[BackupInfo]:
    return service.backups.list_backups(_backup_folder(request))


@dataclass
class BackupResult:
    created: bool
    """False when nothing changed since the last backup."""


@app.post("/api/backups")
async def backup_now(request: Request) -> BackupResult:
    folder = _backup_folder(request)
    return BackupResult(await _host(request).run(lambda col: service.backups.backup_now(col, folder)))


class RestoreBody(BaseModel):
    name: str = Field(min_length=1, max_length=200)


@app.post("/api/backups/restore")
async def restore_backup(request: Request, body: RestoreBody) -> BackupResult:
    """Replace the collection with a backup (desktop app, on the computer itself).

    Like Anki desktop's "Revert to backup", the next sync then asks whether to
    upload this copy or download AnkiWeb's. The Pi can't restore: it never
    uploads, so a restore there would just be replaced by AnkiWeb's copy.
    """
    _require_local(request)
    if not desktop_mode():
        raise HTTPException(409, "Restoring backups is done in the desktop app.")
    manager: SyncManager = request.app.state.sync
    if manager.phase != "idle":
        raise HTTPException(409, "Wait for the sync to finish.")
    folder = _backup_folder(request)
    await _host(request).run(lambda col: service.backups.restore_backup(col, folder, body.name))
    _stats_cache.clear()
    _browse_cache.clear()
    return BackupResult(True)


@app.get("/api/update")
async def update_check(request: Request) -> UpdateInfo:
    """Is a newer desktop app out? (Only asked by the desktop app.)"""
    return await request.app.state.updates.info()


# Adding notes
##########################################################################


@app.get("/api/add")
async def add_defaults(request: Request, deck_id: int | None = Query(None)) -> AddDefaults:
    return await _host(request).run(lambda col: service.add_defaults(col, deck_id))


class NewNote(BaseModel):
    notetype_id: int
    deck_id: int
    fields: dict[str, str]
    tags: list[str] = Field(default_factory=list)


@app.post("/api/notes")
async def add_note(request: Request, body: NewNote) -> AddNoteResult:
    return await _host(request).run(lambda col: service.add_note(col, body.notetype_id, body.deck_id, body.fields, body.tags))


@dataclass
class AddedMedia:
    filename: str


@app.post("/api/media")
async def upload_media(request: Request, name: str = Query(..., min_length=1, max_length=200)) -> AddedMedia:
    """A file pasted or dropped into a field (raw body). Returns the name to reference."""
    data = await request.body()
    return AddedMedia(await _host(request).run(lambda col: service.add_media(col, name, data)))


# Browser
##########################################################################

# Matching ids for the last search, so scrolling through 100k results only
# fetches rows. Keyed on col.mod: any change to the collection invalidates it.
_browse_cache: dict[tuple, list[int]] = {}


def _browse_ids(col, query: str, sort: str, reverse: bool) -> list[int]:  # type: ignore[no-untyped-def]
    key = (query, sort, reverse, col.mod)
    if (hit := _browse_cache.get(key)) is None:
        hit = service.browser.search_ids(col, query, sort, reverse)
        _browse_cache.clear()
        _browse_cache[key] = hit
    return hit


@app.get("/api/browse")
async def browse(
    request: Request,
    q: str = Query("", max_length=2000),
    sort: str = Query("noteFld"),
    reverse: bool = Query(False),
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=service.browser.MAX_PAGE),
) -> BrowsePage:
    def op(col):  # type: ignore[no-untyped-def]
        ids = _browse_ids(col, q, sort, reverse)
        return BrowsePage(
            query=q,
            sort=sort,
            reverse=reverse,
            total=len(ids),
            offset=offset,
            rows=service.browser.rows(col, ids[offset : offset + limit]),
            fsrs=bool(col.get_config("fsrs", False)),
        )

    return await _host(request).run(op)


class BrowseSelection(BaseModel):
    """Either explicit card ids, or every card matching a search ("select all")."""

    card_ids: list[int] | None = None
    query: str | None = None
    sort: str = "noteFld"
    reverse: bool = False


class BrowseAction(BaseModel):
    selection: BrowseSelection
    action: str = Field(pattern="^(suspend|unsuspend|flag|add_tags|remove_tags|set_due)$")
    value: str | int | None = None


@dataclass
class BrowseActionResult:
    count: int


@app.post("/api/browse/action")
async def browse_action(request: Request, body: BrowseAction) -> BrowseActionResult:
    def op(col):  # type: ignore[no-untyped-def]
        sel = body.selection
        if sel.card_ids is not None:
            ids = sel.card_ids
        elif sel.query is not None:
            ids = _browse_ids(col, sel.query, sel.sort, sel.reverse)
        else:
            raise ValueError("nothing selected")
        b = service.browser
        match body.action:
            case "suspend":
                n = b.suspend(col, ids)
            case "unsuspend":
                n = b.unsuspend(col, ids)
            case "flag":
                n = b.set_flag(col, ids, int(body.value or 0))
            case "add_tags":
                n = b.add_tags(col, ids, str(body.value or ""))
            case "remove_tags":
                n = b.remove_tags(col, ids, str(body.value or ""))
            case _:
                n = b.set_due_date(col, ids, str(body.value or ""))
        return BrowseActionResult(n)

    return await _host(request).run(op)


@app.get("/api/search")
async def search(
    request: Request,
    q: str = Query(..., min_length=1, max_length=500),
    limit: int = Query(50, ge=1, le=200),
) -> SearchResult:
    return await _host(request).run(lambda col: service.search_cards(col, q, limit))


@app.get("/api/stats")
async def stats(
    request: Request,
    deck_id: int | None = Query(None),
    days: int = Query(90, ge=1, le=STATS_MAX_DAYS),
) -> StatsSummary:
    """Collection-wide stats, or one deck including its subdecks.

    Computing stats takes Anki a noticeable moment on big collections, so the
    last few results are cached. The key includes the collection's modification
    time, which changes on every answer/undo, so a cached result is never stale.
    """
    host = _host(request)

    def op(col):  # type: ignore[no-untyped-def]
        key = (deck_id, days, col.mod, col.sched.today)
        if (hit := _stats_cache.get(key)) is not None:
            return hit
        result = service.stats(col, deck_id, days)
        _stats_cache.clear()  # anything older is stale anyway
        _stats_cache[key] = result
        return result

    return await host.run(op)


# Only touched from the collection thread.
_stats_cache: dict[tuple, StatsSummary] = {}


@app.get("/api/sync")
async def sync_status(request: Request) -> SyncStatus:
    return await request.app.state.sync.status(_is_local(request))


@app.post("/api/sync")
async def sync_start(request: Request) -> SyncStatus:
    """Start a normal two-way sync in the background; poll GET /api/sync."""
    manager: SyncManager = request.app.state.sync
    if not manager.enabled:
        raise HTTPException(409, "Sync isn't set up for this collection.")
    manager.start_sync()
    return await manager.status(_is_local(request))


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=320)
    password: str = Field(min_length=1, max_length=1000)
    endpoint: str | None = Field(None, max_length=500)
    """A self-hosted sync server; omitted for AnkiWeb."""


@app.post("/api/sync/login")
async def sync_login(request: Request, body: LoginRequest) -> SyncStatus:
    """Sign in to AnkiWeb. Only the sync key is saved, never the password.

    Only from this computer, so the password never crosses the network.
    """
    _require_local(request)
    manager: SyncManager = request.app.state.sync
    try:
        # $ROUNDS_SYNC_ENDPOINT: a self-hosted sync server instead of AnkiWeb
        # (also how development and tests use Anki's local sync server).
        endpoint = body.endpoint or os.environ.get("ROUNDS_SYNC_ENDPOINT") or None
        await manager.login(body.username.strip(), body.password, endpoint)
    except AuthFailed as err:
        raise HTTPException(401, str(err)) from err
    except PermissionError as err:
        raise HTTPException(409, str(err)) from err
    return await manager.status(True)


@app.post("/api/sync/logout")
async def sync_logout(request: Request) -> SyncStatus:
    """Forget the saved sync key. The collection on this computer stays."""
    _require_local(request)
    manager: SyncManager = request.app.state.sync
    try:
        manager.logout()
    except PermissionError as err:
        raise HTTPException(409, str(err)) from err
    return await manager.status(True)


@app.post("/api/sync/full-download")
async def sync_full_download(request: Request) -> SyncStatus:
    """Replace this device's copy with AnkiWeb's, when Anki requires a one-way sync."""
    manager: SyncManager = request.app.state.sync
    try:
        manager.start_full_download()
    except PermissionError as err:
        raise HTTPException(409, str(err)) from err
    return await manager.status(_is_local(request))


@app.post("/api/sync/full-upload")
async def sync_full_upload(request: Request) -> SyncStatus:
    """Replace AnkiWeb's copy with this device's, when Anki requires a one-way sync.

    Desktop app only, from this computer only, after the user confirmed it.
    The Pi never uploads.
    """
    _require_local(request)
    manager: SyncManager = request.app.state.sync
    try:
        manager.start_full_upload()
    except PermissionError as err:
        raise HTTPException(409, str(err)) from err
    return await manager.status(True)


# Using Rounds on a phone (desktop app)
##########################################################################


def _sharing(request: Request) -> Sharing:
    sharing: Sharing | None = request.app.state.sharing
    if sharing is None:
        raise HTTPException(409, "Sharing is a desktop app feature.")
    return sharing


@app.get("/api/sharing")
async def sharing_status(request: Request) -> SharingStatus:
    _require_local(request)
    return _sharing(request).status()


class SharingUpdate(BaseModel):
    enabled: bool


@app.post("/api/sharing")
async def sharing_update(request: Request, body: SharingUpdate) -> SharingStatus:
    _require_local(request)
    sharing = _sharing(request)
    await sharing.set_enabled(body.enabled)
    return sharing.status()


@app.post("/api/sharing/new-code")
async def sharing_new_code(request: Request) -> SharingStatus:
    """New code; every paired device has to pair again."""
    _require_local(request)
    sharing = _sharing(request)
    sharing.new_code()
    return sharing.status()


@app.get("/api/sharing/qr.svg")
async def sharing_qr(request: Request, url: str = Query(..., max_length=300)) -> Response:
    """QR code that opens `url` on the phone and pairs it (the code rides in the #fragment)."""
    import segno

    _require_local(request)
    sharing = _sharing(request)
    if url not in sharing.status().urls:
        raise HTTPException(422, "Unknown address.")
    qr = segno.make(f"{url}#pair={sharing.state.code}", error="m")
    out = io.BytesIO()
    # A standalone SVG (with its namespace), so it works as an <img>.
    qr.save(out, kind="svg", scale=6, border=2, dark="#000", light="#fff", xmldecl=False)
    return Response(out.getvalue(), media_type="image/svg+xml", headers={"Cache-Control": "no-store"})


class PairRequest(BaseModel):
    code: str = Field(min_length=1, max_length=12)


@dataclass
class PairResult:
    paired: bool


@app.post("/api/pair")
async def pair(request: Request, body: PairRequest) -> JSONResponse:
    """Pair this phone with the code shown on the computer; remembered with a cookie."""
    sharing = _sharing(request)
    try:
        token = sharing.pair(body.code)
    except PairingLocked as err:
        raise HTTPException(429, str(err)) from err
    except PermissionError as err:
        raise HTTPException(401, str(err)) from err
    response = JSONResponse({"paired": True})
    response.set_cookie(COOKIE, token, max_age=COOKIE_MAX_AGE, httponly=True, samesite="lax", path="/")
    return response


@app.get("/api/m/{token}/{filename:path}")
async def media_by_token(request: Request, token: str, filename: str) -> FileResponse:
    """Media for paired phones: the sandboxed card frame can't send cookies."""
    sharing: Sharing | None = request.app.state.sharing
    if sharing is None or not sharing.media_ok(token):
        raise HTTPException(status_code=404)
    return _media_file(request, filename)


@app.get("/api/media/{filename:path}")
async def media(request: Request, filename: str) -> FileResponse:
    """Files from the collection's media folder, so card HTML can reference them.

    Doesn't touch the collection, so it runs outside the collection thread.
    Paired phones use /api/m/<token>/ instead (the guard refuses them here).
    """
    return _media_file(request, filename)


def _media_file(request: Request, filename: str) -> FileResponse:
    media_dir = _host(request).media_dir
    assert media_dir is not None
    path = (media_dir / filename).resolve()
    if not path.is_relative_to(media_dir) or not path.is_file():
        raise HTTPException(status_code=404)
    return FileResponse(
        path,
        media_type=mimetypes.guess_type(path.name)[0] or "application/octet-stream",
        headers={"Cache-Control": "private, max-age=3600"},
    )


# Built frontend (optional). In development the Vite dev server serves the UI
# and proxies /api here; after `npm run build` this server can serve both.
##########################################################################

# The desktop app bundles the built UI elsewhere and says where.
_DIST = Path(os.environ.get("ROUNDS_FRONTEND_DIST") or REPO_ROOT / "frontend" / "dist")


class _SpaStaticFiles(StaticFiles):
    """Serves index.html for unknown paths so client-side routes survive reloads."""

    async def get_response(self, path, scope):  # type: ignore[no-untyped-def]
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404 and not path.startswith("api"):
                return await super().get_response("index.html", scope)
            raise


if _DIST.is_dir():
    app.mount("/", _SpaStaticFiles(directory=_DIST, html=True), name="frontend")
