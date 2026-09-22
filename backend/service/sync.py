"""AnkiWeb sync, following Anki desktop's own flow (aqt/sync.py).

Safety policy (her AnkiWeb collection is the source of truth for all devices):

* Normal syncs merge changes both ways, exactly as Anki desktop does.
* **This module can never full-upload.** There is deliberately no function
  that asks Anki for a full *upload*, so this device can
  never overwrite her AnkiWeb collection wholesale. When Anki says a one-way
  sync is needed, the only resolution offered is downloading AnkiWeb's copy.
* A backup (Anki's own .colpkg backups) is taken before every sync, and always
  before a full download.
"""

from __future__ import annotations

import re
from pathlib import Path

from anki.collection import Collection
from anki.sync_pb2 import SyncAuth, SyncCollectionResponse

from .types import MediaSyncState, SyncCredentials, SyncResult

_REQUIRED = {
    SyncCollectionResponse.NO_CHANGES: "none",
    SyncCollectionResponse.NORMAL_SYNC: "none",
    # AnkiWeb has data and this device doesn't: normal for a new device.
    SyncCollectionResponse.FULL_DOWNLOAD: "full_download",
    # Both sides changed in ways that can't be merged. We only ever offer download.
    SyncCollectionResponse.FULL_SYNC: "full_sync",
    # AnkiWeb is empty. Uploading is Anki desktop's job, never ours.
    SyncCollectionResponse.FULL_UPLOAD: "server_empty",
}


def _auth(creds: SyncCredentials) -> SyncAuth:
    return SyncAuth(hkey=creds.hkey, endpoint=creds.endpoint or None)


def login(col: Collection, username: str, password: str, endpoint: str | None = None) -> SyncCredentials:
    """Exchange AnkiWeb credentials for a sync key. The password is not kept."""
    auth = col.sync_login(username=username, password=password, endpoint=endpoint)
    return SyncCredentials(username=username, hkey=auth.hkey, endpoint=auth.endpoint or endpoint or "")


def sync(col: Collection, creds: SyncCredentials, backup_dir: Path) -> SyncResult:
    """Normal two-way sync (plus media, in the background). Never uploads wholesale.

    If Anki reports that a one-way sync is required, nothing is changed and
    the result says what's needed; see `full_download()`.
    """
    _backup(col, backup_dir, force=False)
    out = col.sync_collection(_auth(creds), sync_media=True)
    # Scheduler settings can arrive with a sync (as aqt does after syncing).
    col._load_scheduler()
    return SyncResult(
        required=_REQUIRED[out.required],  # type: ignore[arg-type]
        server_message=out.server_message,
        new_endpoint=out.new_endpoint or None,
        server_media_usn=out.server_media_usn,
        host_number=out.host_number,
    )


def full_download(col: Collection, creds: SyncCredentials, server_media_usn: int | None, backup_dir: Path) -> None:
    """Replace this device's collection with AnkiWeb's (as aqt.sync.full_download).

    Only this device's copy is replaced; AnkiWeb and her other devices are
    untouched. A backup of the local copy is written first.
    """
    _backup(col, backup_dir, force=True)
    col.close_for_full_sync()
    try:
        col.full_upload_or_download(auth=_auth(creds), server_usn=server_media_usn, upload=False)
    finally:
        # Reopen even on failure: the backend keeps the old file if the download failed.
        col.reopen(after_full_sync=True)


def media_state(col: Collection) -> MediaSyncState:
    """Background media sync progress (started automatically by `sync`)."""
    try:
        st = col.media_sync_status()
    except Exception as err:  # the backend reports media sync failures here
        return MediaSyncState(active=False, summary="", error=str(err))
    p = st.progress
    return MediaSyncState(
        active=st.active,
        summary=" · ".join(_clean(x) for x in (p.checked, p.added, p.removed) if x),
        error=None,
    )


def full_sync_progress(col: Collection) -> tuple[int, int] | None:
    """(transferred, total) bytes of a running full download, if any.

    Safe to call from another thread while `full_download` runs (aqt polls it
    the same way from its UI timer).
    """
    progress = col._backend.latest_progress()
    if not progress.HasField("full_sync"):
        return None
    return progress.full_sync.transferred, progress.full_sync.total


def abort(col: Collection) -> None:
    col.abort_sync()


def _backup(col: Collection, backup_dir: Path, force: bool) -> None:
    backup_dir.mkdir(parents=True, exist_ok=True)
    # force=False respects Anki's backup interval (default 30 min), like desktop.
    col.create_backup(backup_folder=str(backup_dir), force=force, wait_for_completion=True)


def _clean(text: str) -> str:
    return re.sub("[⁦-⁩]", "", text)
