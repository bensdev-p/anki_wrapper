"""Runs AnkiWeb syncs for the web app, in the background.

A sync can take a while (a first full download of a big collection takes
minutes), so HTTP requests only *start* one; the UI polls `status()`. The
work itself runs on the collection thread via CollectionHost, like
everything else that touches the collection.

Who may do what:

* Anyone who can open the app may run a normal sync, or download AnkiWeb's
  copy when Anki requires a one-way sync.
* Signing in and out, and uploading this device's copy over AnkiWeb's, happen
  only from this computer itself (`local=True`), never from a phone on the
  home network, so the AnkiWeb password never crosses the network.
* Uploading is possible only in the desktop app (`allow_upload`). The Pi
  never uploads.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Literal

from anki.errors import NetworkError, SyncError, SyncErrorKind

import service
from safety import desktop_mode, is_sync_collection, synced_dir
from service.types import MediaSyncState

from . import sync_store
from .host import CollectionHost

Phase = Literal["idle", "syncing", "downloading", "uploading"]
Needs = Literal["full_download", "full_sync", "server_empty"]


@dataclass
class SyncStatus:
    enabled: bool
    """This collection syncs (it's <data>/synced/) and a sync key is saved."""
    username: str | None
    phase: Phase
    needs: Needs | None
    """A decision only the user can make; see full_download() / full_upload()."""
    error: str | None
    server_message: str | None
    last_synced_at: float | None
    media_active: bool
    media_summary: str
    transferred_bytes: int | None
    total_bytes: int | None
    can_sign_in: bool
    """This client may sign in or out (the collection can sync, and it's this computer)."""
    can_upload: bool
    """This client may replace AnkiWeb's copy when Anki requires a one-way sync."""


class AuthFailed(Exception):
    pass


class SyncManager:
    def __init__(self, host: CollectionHost, allow_upload: bool | None = None) -> None:
        self.host = host
        self.folder = synced_dir()
        self.backup_dir = self.folder / "backups"
        self.allowed = is_sync_collection(host.path)
        self.allow_upload = self.allowed and (desktop_mode() if allow_upload is None else allow_upload)
        self.state = sync_store.load(self.folder) if self.allowed else None
        self.phase: Phase = "idle"
        self.needs: Needs | None = None
        self.error: str | None = None
        self.server_message: str | None = None
        self._media_usn: int | None = None
        self._media = MediaSyncState(active=False, summary="", error=None)
        self._task: asyncio.Task | None = None

    @property
    def enabled(self) -> bool:
        return self.allowed and self.state is not None

    async def status(self, local: bool = False) -> SyncStatus:
        progress = None
        if self.phase in ("downloading", "uploading"):
            progress = self.host.unlocked(service.sync.full_sync_progress)
        elif self.enabled and self.phase == "idle":
            self._media = await self.host.run(service.sync.media_state)
        return SyncStatus(
            enabled=self.enabled,
            username=self.state.creds.username if self.state else None,
            phase=self.phase,
            needs=self.needs,
            error=self.error or self._media.error,
            server_message=self.server_message,
            last_synced_at=self.state.last_synced_at if self.state else None,
            media_active=self._media.active,
            media_summary=self._media.summary,
            transferred_bytes=progress[0] if progress else None,
            total_bytes=progress[1] if progress else None,
            can_sign_in=self.allowed and local,
            can_upload=self.allow_upload and local,
        )

    async def login(self, username: str, password: str, endpoint: str | None = None) -> None:
        """Exchange the password for a sync key and save only the key."""
        if not self.allowed:
            raise PermissionError("This collection doesn’t sync.")
        if self.phase != "idle":
            raise PermissionError("Wait for the current sync to finish.")
        try:
            creds = await self.host.run(lambda col: service.sync.login(col, username, password, endpoint))
        except SyncError as err:
            if err.kind == SyncErrorKind.AUTH:
                raise AuthFailed("AnkiWeb didn’t accept that email and password.") from err
            raise AuthFailed(_friendly(err)) from err
        except NetworkError as err:
            raise AuthFailed(_friendly(err)) from err
        self.state = sync_store.SyncState(creds=creds)
        sync_store.save(self.folder, self.state)
        self.needs = None
        self.error = None
        self.server_message = None

    def logout(self) -> None:
        if self.phase != "idle":
            raise PermissionError("Wait for the current sync to finish.")
        sync_store.delete(self.folder)
        self.state = None
        self.needs = None
        self.error = None

    def start_sync(self) -> None:
        """Start a normal two-way sync unless one is already running."""
        if not self.enabled or self.phase != "idle":
            return
        self.phase = "syncing"
        self.error = None
        self._task = asyncio.create_task(self._sync())

    def start_full_download(self) -> None:
        """Replace this device's copy with AnkiWeb's. Only after Anki asked for it."""
        if not self.enabled or self.phase != "idle" or self.needs not in ("full_download", "full_sync"):
            raise PermissionError("A full download is only possible when AnkiWeb requires one.")
        self.phase = "downloading"
        self.error = None
        self._task = asyncio.create_task(self._full(upload=False))

    def start_full_upload(self) -> None:
        """Replace AnkiWeb's copy with this device's. Desktop app only, after Anki asked for it."""
        if not self.allow_upload:
            raise PermissionError("This device never uploads its collection to AnkiWeb.")
        if not self.enabled or self.phase != "idle" or self.needs not in ("full_sync", "server_empty"):
            raise PermissionError("An upload is only possible when AnkiWeb requires a one-way sync.")
        self.phase = "uploading"
        self.error = None
        self._task = asyncio.create_task(self._full(upload=True))

    async def wait(self) -> None:
        """Wait for the running sync (tests, shutdown)."""
        if self._task:
            await self._task

    async def _sync(self) -> None:
        assert self.state
        creds = self.state.creds
        try:
            result = await self.host.run(lambda col: service.sync.sync(col, creds, self.backup_dir))
            if result.new_endpoint:
                creds.endpoint = result.new_endpoint
            self.state.host_number = result.host_number
            self.server_message = result.server_message or None
            self._media_usn = result.server_media_usn
            if result.required == "none":
                self.needs = None
                self.state.last_synced_at = time.time()
            else:
                self.needs = result.required
            sync_store.save(self.folder, self.state)
        except Exception as err:  # reported to the UI; the collection is unchanged
            self.error = _friendly(err)
        finally:
            self.phase = "idle"

    async def _full(self, upload: bool) -> None:
        assert self.state
        creds, usn = self.state.creds, self._media_usn
        fn = service.sync.full_upload if upload else service.sync.full_download
        try:
            await self.host.run(lambda col: fn(col, creds, usn, self.backup_dir))
            self.needs = None
            self.state.last_synced_at = time.time()
            sync_store.save(self.folder, self.state)
        except Exception as err:
            self.error = _friendly(err)
        finally:
            self.phase = "idle"


def _friendly(err: Exception) -> str:
    if isinstance(err, SyncError) and err.kind == SyncErrorKind.AUTH:
        if desktop_mode():
            return "AnkiWeb didn’t accept the saved sign-in. Sign out and sign in again from the Sync menu."
        return "AnkiWeb didn’t accept the saved sign-in. Run scripts/sync_setup.py on the Pi to sign in again."
    if isinstance(err, NetworkError):
        return "Couldn’t reach AnkiWeb. Check the internet connection and try again."
    return str(err) or type(err).__name__
