"""Owns the one open Collection and serializes every access to it.

anki's Collection is not thread-safe. All work runs on a single dedicated
thread (a one-worker executor), which both serializes calls and keeps the
collection on one thread, without blocking the asyncio event loop.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import TypeVar

from anki.collection import Collection

from safety import assert_safe_path

T = TypeVar("T")


class CollectionHost:
    def __init__(self, path: Path) -> None:
        self.path = assert_safe_path(path)
        if not self.path.exists():
            raise FileNotFoundError(
                f"{self.path} does not exist. Build the dev collection with "
                "`python scripts/make_sample_collection.py`, or import a .colpkg "
                "with `python scripts/import_colpkg.py`."
            )
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="anki-col")
        self._col: Collection | None = None
        self.media_dir: Path | None = None

    def open(self) -> None:
        def _open() -> None:
            self._col = Collection(str(self.path))
            self.media_dir = Path(self._col.media.dir()).resolve()

        self._executor.submit(_open).result()

    def close(self) -> None:
        def _close() -> None:
            if self._col is not None:
                self._col.close()
                self._col = None

        self._executor.submit(_close).result()
        self._executor.shutdown(wait=True)

    async def run(self, fn: Callable[[Collection], T]) -> T:
        """Run `fn(col)` on the collection thread and await its result."""

        def call() -> T:
            if self._col is None:
                raise RuntimeError("collection is not open")
            return fn(self._col)

        return await asyncio.get_running_loop().run_in_executor(self._executor, call)

    def unlocked(self, fn: Callable[[Collection], T]) -> T | None:
        """Call `fn(col)` on the *current* thread, bypassing the collection thread.

        Only for Anki's progress polling (`latest_progress`), which aqt also
        calls from its UI thread while a sync runs in the background. Never
        use it for anything that reads or writes collection data.
        """
        col = self._col
        return fn(col) if col is not None else None
