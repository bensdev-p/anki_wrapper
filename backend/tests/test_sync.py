"""Sync, against Anki's own sync server running locally. Never AnkiWeb."""

from __future__ import annotations

import inspect
import os
import shutil
import socket
import subprocess
import sys
import time
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from anki.collection import Collection
from fastapi.testclient import TestClient

import service
from api import sync_store
from service.types import SyncCredentials

from conftest import TEST_ROOT


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def server() -> Iterator[str]:
    """A fresh local Anki sync server (user test / pass) per test."""
    base = TEST_ROOT / f"syncserver-{uuid.uuid4().hex}"
    base.mkdir(parents=True)
    port = _free_port()
    env = {**os.environ, "SYNC_USER1": "test:pass", "SYNC_BASE": str(base), "SYNC_HOST": "127.0.0.1", "SYNC_PORT": str(port)}
    proc = subprocess.Popen([sys.executable, "-m", "anki.syncserver"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.time() + 10
    while time.time() < deadline:
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", port)) == 0:
                break
        time.sleep(0.1)
    yield f"http://127.0.0.1:{port}/"
    proc.terminate()
    proc.wait(5)
    shutil.rmtree(base, ignore_errors=True)


def _seed_server(col_path: Path, endpoint: str) -> SyncCredentials:
    """Test-only setup: put the sample collection on the server (as Anki desktop would)."""
    col = Collection(str(col_path))
    creds = service.sync.login(col, "test", "pass", endpoint)
    out = col.sync_collection(service.sync._auth(creds), sync_media=True)
    col.close_for_full_sync()
    col.full_upload_or_download(auth=service.sync._auth(creds), server_usn=out.server_media_usn, upload=True)
    col.reopen(after_full_sync=True)
    _wait_media(col)  # the media upload runs in the background after the full sync
    col.close()
    return creds


def _wait_media(col: Collection) -> None:
    time.sleep(0.3)  # let the backend start the background media sync
    deadline = time.time() + 15
    while service.sync.media_state(col).active and time.time() < deadline:
        time.sleep(0.2)


def _new_device(root: Path) -> Collection:
    (root / "synced").mkdir(parents=True)
    return Collection(str(root / "synced" / "collection.anki2"))


def test_new_device_downloads_then_syncs_both_ways(col_path: Path, server: str) -> None:
    creds = _seed_server(col_path, server)
    device = _new_device(col_path.parent.parent / uuid.uuid4().hex)
    backups = Path(device.path).parent / "backups"

    first = service.sync.sync(device, creds, backups)
    assert first.required == "full_download"
    assert device.card_count() == 0  # nothing happens without an explicit download

    service.sync.full_download(device, creds, first.server_media_usn, backups)
    assert device.card_count() == 87
    assert list(backups.glob("*.colpkg"))  # backed up before replacing
    _wait_media(device)
    assert (Path(device.media.dir()) / "ecg_afib.svg").exists()

    # Study on the Pi, sync; the "Mac" (original) receives the review.
    state = service.select_deck(device, device.decks.id_for_name("Step 1"))
    cid = state.card.card_id
    service.answer_card(device, cid, 3, 2000)
    assert service.sync.sync(device, creds, backups).required == "none"

    mac = Collection(str(col_path))
    before = mac.db.scalar("select count() from revlog where cid = ?", cid)
    assert service.sync.sync(mac, creds, backups).required == "none"
    assert mac.db.scalar("select count() from revlog where cid = ?", cid) == before + 1

    # ...and a review on the "Mac" comes back to the Pi.
    other = next(c.card.id for c in mac.sched.get_queued_cards(fetch_limit=5).cards if c.card.id != cid)
    card = mac.get_card(other)
    card.start_timer()
    mac.sched.answerCard(card, 4)
    service.sync.sync(mac, creds, backups)
    mac.close()
    service.sync.sync(device, creds, backups)
    assert device.db.scalar("select count() from revlog where cid = ?", other) >= 1
    device.close()


def test_empty_server_is_never_uploaded_to(col_path: Path, server: str) -> None:
    col = Collection(str(col_path))
    creds = service.sync.login(col, "test", "pass", server)
    result = service.sync.sync(col, creds, col_path.parent / "backups")
    assert result.required == "server_empty"
    # Nothing was uploaded: asking again gives the same answer...
    assert service.sync.sync(col, creds, col_path.parent / "backups").required == "server_empty"
    col.close()
    # ...and a brand-new device finds nothing to download.
    fresh = _new_device(col_path.parent.parent / uuid.uuid4().hex)
    assert service.sync.sync(fresh, creds, Path(fresh.path).parent / "backups").required == "none"
    assert fresh.card_count() == 0
    fresh.close()


def test_conflict_is_resolved_only_by_download(col_path: Path, server: str) -> None:
    creds = _seed_server(col_path, server)
    device = _new_device(col_path.parent.parent / uuid.uuid4().hex)
    backups = Path(device.path).parent / "backups"
    service.sync.full_download(device, creds, service.sync.sync(device, creds, backups).server_media_usn, backups)
    state = service.select_deck(device, device.decks.id_for_name("Step 1"))
    service.answer_card(device, state.card.card_id, 3, 1000)
    assert service.sync.sync(device, creds, backups).required == "none"
    cards_before = device.card_count()

    # A note type edit marks the schema changed *and* modifies the collection,
    # which forces a one-way sync; simulate both.
    device.mod_schema(check=False)
    device.set_config("lacunaTest", 1)
    result = service.sync.sync(device, creds, backups)
    assert result.required == "full_sync"
    service.sync.full_download(device, creds, result.server_media_usn, backups)
    assert device.card_count() == cards_before
    assert service.sync.sync(device, creds, backups).required == "none"
    device.close()


def test_sync_module_has_no_upload_path() -> None:
    source = inspect.getsource(service.sync)
    assert "upload=True" not in source
    assert not any("upload" in name for name in dir(service.sync) if not name.startswith("_") and name != "full_download")


# API
##########################################################################


@pytest.fixture
def synced_app(col_path: Path, server: str, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """The app opened on a data/synced-style collection that's signed in to the local server."""
    creds = _seed_server(col_path, server)
    root = col_path.parent.parent / uuid.uuid4().hex
    device = _new_device(root)
    device.close()
    folder = root / "synced"
    sync_store.save(folder, sync_store.SyncState(creds=creds))
    assert oct(os.stat(folder / "sync.json").st_mode & 0o777) == "0o600"
    monkeypatch.setenv("SYNCED_DIR", str(folder))
    monkeypatch.setenv("COLLECTION_PATH", str(folder / "collection.anki2"))
    from api.main import app

    with TestClient(app) as client:
        yield client


def _settle(client: TestClient) -> dict:
    for _ in range(200):
        status = client.get("/api/sync").json()
        if status["phase"] == "idle":
            return status
        time.sleep(0.05)
    raise AssertionError("sync did not finish")


def test_api_first_sync_then_download(synced_app: TestClient) -> None:
    client = synced_app
    assert client.get("/api/info").json()["sync_enabled"] is True
    assert client.post("/api/sync/full-download").status_code == 409  # not needed (yet)

    client.post("/api/sync")
    status = _settle(client)
    assert status["needs"] == "full_download" and status["error"] is None
    assert client.get("/api/info").json()["card_count"] == 0

    client.post("/api/sync/full-download")
    status = _settle(client)
    assert status["needs"] is None and status["last_synced_at"]
    assert client.get("/api/info").json()["card_count"] == 87
    assert client.get("/api/decks").json()  # collection usable after reopen


def test_api_sync_disabled_for_sample_collection(client: TestClient) -> None:
    assert client.get("/api/info").json()["sync_enabled"] is False
    assert client.post("/api/sync").status_code == 409
    assert client.post("/api/sync/full-download").status_code == 409


@pytest.fixture
def client(col_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("COLLECTION_PATH", str(col_path))
    from api.main import app

    with TestClient(app) as c:
        yield c
