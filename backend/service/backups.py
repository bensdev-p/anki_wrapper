"""Anki's own .colpkg backups: list them, make one now, restore one.

Backups are written by Anki (`create_backup`) into the backups folder next to
the collection: before every sync, every 30 minutes of use and on quit.

Restoring works like Anki desktop's "Revert to backup": the whole collection
is replaced, so the next sync has to be one-way (the user picks upload or
download). A fresh backup of the current state is always taken first.
"""

from __future__ import annotations

from pathlib import Path

from anki.collection import Collection
from anki.media import media_paths_from_col_path

from .types import BackupInfo


def list_backups(folder: Path) -> list[BackupInfo]:
    if not folder.is_dir():
        return []
    out = []
    for path in folder.glob("*.colpkg"):
        st = path.stat()
        out.append(BackupInfo(name=path.name, created=st.st_mtime, size=st.st_size))
    return sorted(out, key=lambda b: b.created, reverse=True)


def backup_now(col: Collection, folder: Path) -> bool:
    """True if a backup was written (False: nothing changed since the last one)."""
    folder.mkdir(parents=True, exist_ok=True)
    return col.create_backup(backup_folder=str(folder), force=True, wait_for_completion=True)


def restore_backup(col: Collection, folder: Path, name: str) -> None:
    """Replace the collection with a backup (as Anki desktop's "Revert to backup")."""
    path = (folder / name).resolve()
    if path.parent != folder.resolve() or path.suffix != ".colpkg" or not path.is_file():
        raise ValueError("That backup doesn’t exist.")
    # Keep the current state too, so a restore can itself be undone.
    backup_now(col, folder)
    col_path = col.path
    media_folder, media_db = media_paths_from_col_path(col_path)
    # As aqt does: close the collection, let the backend swap it, open it again.
    col.close()
    try:
        col._backend.import_collection_package(
            col_path=col_path, backup_path=str(path), media_folder=media_folder, media_db=media_db
        )
    finally:
        col.reopen()
