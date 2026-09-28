"""Smarter quiz options: download the embedding model once, keep the answer index current.

Off by default. Turning it on downloads the model listed in
`semantic.models` (checked against its pinned SHA-256), then indexes every
card's short answer in the background, a small chunk of notes at a time so
studying stays responsive. After that only notes that changed are re-read:
after each sync, and when a quiz is made if the last check was a while ago.

Nothing leaves this computer. The index lives next to the collection
(<collection folder>/quiz-index/), never inside it.
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal

import service

from .host import CollectionHost

if TYPE_CHECKING:
    from semantic.index import AnswerIndex, IndexNeighbours
    from semantic.models import ModelSpec

log = logging.getLogger("rounds.smart_quiz")

Phase = Literal["off", "downloading", "indexing", "ready", "error"]
CHUNK_NOTES = 100
"""Notes read per turn on the collection thread (~50 ms), so reviews never wait long."""
SAVE_EVERY = 50
"""Chunks between saves while indexing (a restart resumes from there)."""
REFRESH_AFTER_SECS = 120


@dataclass
class SmartQuizStatus:
    available: bool
    """A model is listed for download (otherwise the Settings switch is hidden)."""
    enabled: bool
    phase: Phase
    progress: float | None
    """0–1 while downloading or indexing."""
    detail: str | None
    error: str | None
    model_name: str | None
    model_size: int | None
    """Download size in bytes."""
    model_license: str | None
    model_source: str | None
    downloaded: bool
    answers: int
    """Distinct answers indexed."""


class SmartQuiz:
    def __init__(
        self,
        host: CollectionHost,
        models_dir: Path,
        settings_path: Path,
        spec: ModelSpec | None | Literal["default"] = "default",
        fetch: Callable[[str], Any] | None = None,
    ) -> None:
        if spec == "default":
            from semantic.models import default_spec

            spec = default_spec()
        self.host = host
        self.models_dir = models_dir
        self.settings_path = settings_path
        self.spec: ModelSpec | None = spec  # type: ignore[assignment]
        self.fetch = fetch
        self.enabled = self._load_enabled()
        self.phase: Phase = "off"
        self.progress: float | None = None
        self.detail: str | None = None
        self.error: str | None = None
        self._index: AnswerIndex | None = None
        self._embed: Callable | None = None
        self._task: asyncio.Task | None = None
        self._cancel = False
        self._refreshed_at = 0.0

    # Settings
    ######################################################################

    def _load_enabled(self) -> bool:
        try:
            return bool(json.loads(self.settings_path.read_text()).get("enabled"))
        except (OSError, ValueError, AttributeError):
            return False

    def _save_enabled(self) -> None:
        self.settings_path.parent.mkdir(parents=True, exist_ok=True)
        self.settings_path.write_text(json.dumps({"enabled": self.enabled}))

    @property
    def index_dir(self) -> Path:
        assert self.spec
        return self.host.path.parent / "quiz-index" / self.spec.id

    def status(self) -> SmartQuizStatus:
        spec = self.spec
        downloaded = False
        if spec:
            from semantic.download import is_downloaded

            downloaded = is_downloaded(self.models_dir, spec)
        return SmartQuizStatus(
            available=spec is not None,
            enabled=self.enabled and spec is not None,
            phase=self.phase,
            progress=self.progress,
            detail=self.detail,
            error=self.error,
            model_name=spec.name if spec else None,
            model_size=spec.size if spec else None,
            model_license=spec.license if spec else None,
            model_source=spec.source if spec else None,
            downloaded=downloaded,
            answers=self._index.size if self._index else 0,
        )

    # Turning it on and off
    ######################################################################

    async def start(self) -> None:
        """At startup: pick up where it left off if it's on."""
        if self.enabled and self.spec:
            self._starting()
            self._run(self._prepare())

    def _starting(self) -> None:
        """Report the first step right away (the answer to "turn on" shouldn't still say "off")."""
        from semantic.download import is_downloaded

        assert self.spec
        downloading = not is_downloaded(self.models_dir, self.spec)
        self.phase = "downloading" if downloading else "indexing"
        self.progress = 0.0 if downloading else None
        self.detail = None if downloading else "Loading…"

    async def set_enabled(self, on: bool) -> None:
        if on and not self.spec:
            raise ValueError("Smarter quiz options aren't available in this version.")
        self.enabled = on
        self._save_enabled()
        if on:
            self.error = None
            if self._task is None or self._task.done():
                self._starting()
                self._run(self._prepare())
        else:
            await self.stop()
            self.phase, self.progress, self.detail = "off", None, None
            self._index = None
            self._embed = None

    async def remove(self) -> None:
        """Turn off and delete the downloaded model and this collection's index."""
        await self.set_enabled(False)
        if self.spec:
            from semantic.download import remove

            remove(self.models_dir, self.spec)
            shutil.rmtree(self.index_dir, ignore_errors=True)

    async def stop(self) -> None:
        self._cancel = True
        if self._task and not self._task.done():
            try:
                await asyncio.wait_for(self._task, timeout=30)
            except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
                self._task.cancel()
        self._task = None
        self._cancel = False

    def refresh(self, force: bool = False) -> None:
        """Re-read notes that changed (after a sync; when a quiz is made)."""
        if self.phase != "ready" or (self._task and not self._task.done()):
            return
        if force or time.monotonic() - self._refreshed_at > REFRESH_AFTER_SECS:
            self._run(self._safe_update())

    def neighbours(self) -> IndexNeighbours | None:
        if not self.enabled or self._index is None or self._embed is None or self._index.size == 0:
            return None
        from semantic.index import IndexNeighbours

        return IndexNeighbours(self._index, self._embed)

    # Background work
    ######################################################################

    def _run(self, coro: Any) -> None:
        self._cancel = False
        self._task = asyncio.create_task(coro)

    async def _prepare(self) -> None:
        from semantic import download
        from semantic.embedders import load_embedder
        from semantic.index import AnswerIndex

        spec = self.spec
        assert spec
        try:
            if not download.is_downloaded(self.models_dir, spec):
                self.phase, self.progress, self.detail = "downloading", 0.0, None

                def on_progress(done: int, total: int) -> None:
                    self.progress = done / total if total else None

                await asyncio.to_thread(
                    download.download, self.models_dir, spec, on_progress, lambda: self._cancel, self.fetch
                )
            self.phase, self.progress, self.detail = "indexing", None, "Loading…"
            folder = download.model_folder(self.models_dir, spec)
            embedder = await asyncio.to_thread(load_embedder, spec, folder)
            self._embed = embedder.embed
            self._index = await asyncio.to_thread(AnswerIndex.load, self.index_dir, spec.id, embedder.dims)
            if self._index.size:
                self.phase = "ready"  # usable now; catch up in the background
            await self._update_index()
        except download.DownloadCancelled:
            pass
        except Exception as err:
            log.exception("smarter quiz options failed")
            self.phase, self.progress, self.detail = "error", None, None
            self.error = f"Couldn’t set up smarter quiz options: {err}"

    async def _safe_update(self) -> None:
        try:
            await self._update_index()
        except Exception:
            log.exception("updating the quiz index failed")  # keep using the index as it was
            self.phase, self.progress, self.detail = "ready", None, None

    async def _update_index(self) -> None:
        index, embed = self._index, self._embed
        assert index is not None and embed is not None
        started = time.monotonic()
        mods = await self.host.run(service.quiz.note_mod_times)
        stale, removed = index.changed_notes(mods)
        first_build = index.size == 0
        if first_build:
            self.phase = "indexing"
        if removed and not stale:
            await asyncio.to_thread(index.update, {}, removed, embed)
        chunks = [stale[i : i + CHUNK_NOTES] for i in range(0, len(stale), CHUNK_NOTES)]
        for n, chunk in enumerate(chunks):
            if self._cancel:
                break
            answers = await self.host.run(lambda col, chunk=chunk: service.quiz.note_answers(col, chunk))
            await asyncio.to_thread(index.update, answers, removed if n == 0 else [], embed)
            if first_build:
                self.progress = (n + 1) / len(chunks)
                self.detail = f"{min((n + 1) * CHUNK_NOTES, len(stale)):,} of {len(stale):,} notes"
            if (n + 1) % SAVE_EVERY == 0:
                await asyncio.to_thread(index.save)
        if stale or removed:
            await asyncio.to_thread(index.save)
            log.info("quiz index: %d notes re-read, %d removed, %d answers, %.1fs", len(stale), len(removed), index.size, time.monotonic() - started)
        self._refreshed_at = time.monotonic()
        if not self._cancel:
            self.phase, self.progress, self.detail = "ready", None, None
