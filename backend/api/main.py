"""Thin HTTP layer over the service module.

Run (single worker; the collection must only be opened once):
  uvicorn api.main:app --app-dir backend --host 127.0.0.1 --port 8000
"""

from __future__ import annotations

import asyncio
import mimetypes
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

import service
from service.stats import MAX_DAYS as STATS_MAX_DAYS
from safety import DEV_COLLECTION, REPO_ROOT, resolve_collection_path
from service.types import (
    AnswerResult,
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
from .sync_manager import SyncManager, SyncStatus

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
    host = CollectionHost(resolve_collection_path())
    host.open()
    app.state.host = host
    app.state.sync = SyncManager(host)
    backups = None if host.path == DEV_COLLECTION.resolve() else asyncio.create_task(_periodic_backups(host))
    try:
        yield
    finally:
        if backups:
            backups.cancel()
        await app.state.sync.wait()
        if backups:
            try:
                await host.run(_backup(host, force=False))
            except Exception as err:
                print(f"backup on shutdown failed: {err}")
        host.close()


app = FastAPI(title="Anki study client API", lifespan=lifespan)


def _host(request: Request) -> CollectionHost:
    return request.app.state.host


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


@app.get("/api/info")
async def info(request: Request) -> Info:
    host = _host(request)
    count = await host.run(lambda col: col.card_count())
    return Info(
        collection=host.path.parent.name,
        is_sample=host.path == DEV_COLLECTION.resolve(),
        card_count=count,
        sync_enabled=request.app.state.sync.enabled,
    )


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
    return await request.app.state.sync.status()


@app.post("/api/sync")
async def sync_start(request: Request) -> SyncStatus:
    """Start a normal two-way sync in the background; poll GET /api/sync."""
    manager: SyncManager = request.app.state.sync
    if not manager.enabled:
        raise HTTPException(409, "Sync isn't set up for this collection.")
    manager.start_sync()
    return await manager.status()


@app.post("/api/sync/full-download")
async def sync_full_download(request: Request) -> SyncStatus:
    """Replace this device's copy with AnkiWeb's, when Anki requires a one-way sync.

    There is intentionally no full-upload endpoint: this app never overwrites
    the AnkiWeb collection wholesale.
    """
    manager: SyncManager = request.app.state.sync
    try:
        manager.start_full_download()
    except PermissionError as err:
        raise HTTPException(409, str(err)) from err
    return await manager.status()


@app.get("/api/media/{filename:path}")
async def media(request: Request, filename: str) -> FileResponse:
    """Files from the collection's media folder, so card HTML can reference them.

    Doesn't touch the collection, so it runs outside the collection thread.
    """
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

_DIST = REPO_ROOT / "frontend" / "dist"


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
