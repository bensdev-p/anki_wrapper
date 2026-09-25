"""Importing a shared deck (.apkg) uploaded from the app, in the background.

The file is streamed to disk next to the collection (never held in memory:
decks with media can be gigabytes), imported on the collection thread, then
deleted. The UI polls `status()` for progress, as for sync.
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from starlette.requests import Request

import service
from service.types import ImportSummary

from .host import CollectionHost

MAX_BYTES = 8 * 1024**3  # 8 GB: AnKing-sized decks with media fit


@dataclass
class ImportStatus:
    phase: Literal["idle", "importing"]
    filename: str | None
    progress: str | None
    result: ImportSummary | None
    error: str | None


class ImportManager:
    def __init__(self, host: CollectionHost) -> None:
        self.host = host
        self.folder = host.path.parent / "imports"
        self.phase: Literal["idle", "importing"] = "idle"
        self.filename: str | None = None
        self.result: ImportSummary | None = None
        self.error: str | None = None
        self._task: asyncio.Task | None = None

    def status(self) -> ImportStatus:
        progress = self.host.unlocked(service.study_tools.import_progress) if self.phase == "importing" else None
        return ImportStatus(self.phase, self.filename, progress, self.result, self.error)

    async def receive_and_start(self, request: Request, filename: str) -> None:
        if self.phase != "idle":
            raise PermissionError("Another import is still running.")
        if not filename.lower().endswith(".apkg"):
            if filename.lower().endswith(".colpkg"):
                raise ValueError(
                    "A .colpkg is a whole collection backup, and importing it would replace everything. "
                    "Rounds imports shared decks (.apkg); sign in to AnkiWeb to bring over your collection."
                )
            raise ValueError("Pick an Anki deck file (.apkg).")
        self.folder.mkdir(parents=True, exist_ok=True)
        path = self.folder / f"{uuid.uuid4().hex}.apkg"
        size = 0
        try:
            with open(path, "wb") as f:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise ValueError("That file is too large.")
                    f.write(chunk)
        except BaseException:
            path.unlink(missing_ok=True)
            raise
        if size == 0:
            path.unlink(missing_ok=True)
            raise ValueError("The file was empty.")
        self.phase = "importing"
        self.filename = filename
        self.result = None
        self.error = None
        self._task = asyncio.create_task(self._run(path))

    async def wait(self) -> None:
        if self._task:
            await self._task

    async def _run(self, path: Path) -> None:
        try:
            self.result = await self.host.run(lambda col: service.study_tools.import_package(col, str(path)))
        except Exception as err:  # reported to the UI
            self.error = str(err) or type(err).__name__
        finally:
            path.unlink(missing_ok=True)
            self.phase = "idle"
