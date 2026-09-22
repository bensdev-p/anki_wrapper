"""Thin HTTP layer over the service module.

Run (single worker; the collection must only be opened once):
  uvicorn api.main:app --app-dir backend --host 127.0.0.1 --port 8000
"""

from __future__ import annotations

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
from safety import DEV_COLLECTION, REPO_ROOT, resolve_collection_path
from service.types import (
    AnswerResult,
    DeckNode,
    SearchResult,
    StudyState,
    UndoResult,
)

from .host import CollectionHost

# SVG and some audio types aren't in every system's mime table.
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("audio/mpeg", ".mp3")
mimetypes.add_type("audio/ogg", ".ogg")
mimetypes.add_type("audio/wav", ".wav")
mimetypes.add_type("image/webp", ".webp")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    host = CollectionHost(resolve_collection_path())
    host.open()
    app.state.host = host
    try:
        yield
    finally:
        host.close()


app = FastAPI(title="Anki study client API", lifespan=lifespan)


def _host(request: Request) -> CollectionHost:
    return request.app.state.host


@app.exception_handler(service.ServiceError)
async def _service_error(_: Request, exc: service.ServiceError) -> JSONResponse:
    status = 404 if isinstance(exc, service.NotFound) else 409
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


@app.get("/api/info")
async def info(request: Request) -> Info:
    host = _host(request)
    count = await host.run(lambda col: col.card_count())
    return Info(
        collection=host.path.parent.name,
        is_sample=host.path == DEV_COLLECTION.resolve(),
        card_count=count,
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


@app.get("/api/search")
async def search(
    request: Request,
    q: str = Query(..., min_length=1, max_length=500),
    limit: int = Query(50, ge=1, le=200),
) -> SearchResult:
    return await _host(request).run(lambda col: service.search_cards(col, q, limit))


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
