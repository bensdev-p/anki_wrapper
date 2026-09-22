"""Where collections may live, and the guard that keeps real ones out of reach.

Her real collection must never be opened or modified by this project. Every
collection this code opens has to sit inside the repo's ``data/`` directory:
either the synthetic dev collection or a *copy* imported from a .colpkg.
"""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
DEV_COLLECTION = DATA_DIR / "dev" / "collection.anki2"
DEMO_DIR = DATA_DIR / "demo"

# Folder names used by Anki desktop / AnkiDroid profiles on each OS.
_PROFILE_MARKERS = {"anki2", "ankidroid"}


class UnsafeCollectionPath(RuntimeError):
    pass


def resolve_collection_path() -> Path:
    """Collection path from $COLLECTION_PATH, defaulting to the dev collection."""
    raw = os.environ.get("COLLECTION_PATH")
    path = Path(raw).expanduser() if raw else DEV_COLLECTION
    if not path.is_absolute():
        path = REPO_ROOT / path
    return assert_safe_path(path)


def assert_safe_path(path: Path) -> Path:
    """Raise unless `path` is inside data/ and not inside an Anki profile folder."""
    resolved = path.resolve()
    parts = {p.lower() for p in resolved.parts}
    if parts & _PROFILE_MARKERS:
        raise UnsafeCollectionPath(
            f"{resolved} looks like a live Anki profile. Export a .colpkg and "
            "use scripts/import_colpkg.py to work on a copy instead."
        )
    if not resolved.is_relative_to(DATA_DIR.resolve()):
        raise UnsafeCollectionPath(
            f"{resolved} is outside {DATA_DIR}. Collections must live under data/."
        )
    return resolved
