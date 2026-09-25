"""Where collections may live, and the guard that keeps real ones out of reach.

Anki desktop's profile folders are never opened or modified by this project.
Every collection this code opens sits inside one data folder:

* on the Pi / in development: the repo's ``data/`` directory (the synthetic
  dev collection, a *copy* imported from a .colpkg, and ``data/synced/``);
* in the desktop app: the app's own folder, set by the launcher through
  ``$ROUNDS_DATA_DIR`` (e.g. ``~/Library/Application Support/Rounds``). It is
  separate from Anki desktop's folder, so the two apps never open the same file.

Only ``<data>/synced/collection.anki2`` may ever sync.
"""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def _data_dir() -> Path:
    raw = os.environ.get("ROUNDS_DATA_DIR")
    return Path(raw).expanduser().resolve() if raw else REPO_ROOT / "data"


DATA_DIR = _data_dir()
DEV_COLLECTION = DATA_DIR / "dev" / "collection.anki2"
DEMO_DIR = DATA_DIR / "demo"
_DEFAULT_SYNCED_DIR = DATA_DIR / "synced"

# Folder names used by Anki desktop / AnkiDroid profiles on each OS.
_PROFILE_MARKERS = {"anki2", "ankidroid"}


def desktop_mode() -> bool:
    """Running as the desktop app ($ROUNDS_DESKTOP=1, set by the launcher).

    The desktop app is someone's main Anki device, so (unlike the Pi) it may
    upload its copy to AnkiWeb when Anki requires a one-way sync, after the
    user confirms and a backup is taken.
    """
    return os.environ.get("ROUNDS_DESKTOP") == "1"


class UnsafeCollectionPath(RuntimeError):
    pass


def resolve_collection_path() -> Path:
    """Collection path from $COLLECTION_PATH.

    Defaults to the synced collection in the desktop app, else the dev sample.
    """
    raw = os.environ.get("COLLECTION_PATH")
    if raw:
        path = Path(raw).expanduser()
    else:
        path = synced_dir() / "collection.anki2" if desktop_mode() else DEV_COLLECTION
    if not path.is_absolute():
        path = REPO_ROOT / path
    return assert_safe_path(path)


def synced_dir() -> Path:
    """Folder of the one collection allowed to sync ($SYNCED_DIR, for tests)."""
    raw = os.environ.get("SYNCED_DIR")
    return assert_safe_path(Path(raw) if raw else _DEFAULT_SYNCED_DIR)


def is_sync_collection(path: Path) -> bool:
    """True only for <data>/synced/collection.anki2: sample and demo copies never sync."""
    return path.resolve() == synced_dir() / "collection.anki2"


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
            f"{resolved} is outside {DATA_DIR}. Collections must live in the data folder."
        )
    return resolved
