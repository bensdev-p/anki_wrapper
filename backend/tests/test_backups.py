"""Backups (list, back up now, restore) and the update check."""

from __future__ import annotations

import shutil
import time
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api import updates


@pytest.fixture
def desktop(col_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    folder = col_path.parent.parent / uuid.uuid4().hex / "synced"
    folder.mkdir(parents=True)
    shutil.copy(col_path, folder / "collection.anki2")
    shutil.copytree(col_path.parent / "collection.media", folder / "collection.media")
    monkeypatch.setenv("ROUNDS_DESKTOP", "1")
    monkeypatch.setenv("SYNCED_DIR", str(folder))
    monkeypatch.setenv("COLLECTION_PATH", str(folder / "collection.anki2"))
    from api.main import app

    with TestClient(app) as client:
        yield client


def test_backup_and_restore(desktop: TestClient) -> None:
    client = desktop
    assert client.get("/api/backups").json() == []
    assert client.post("/api/backups").json()["created"] is True
    backups = client.get("/api/backups").json()
    assert len(backups) == 1 and backups[0]["size"] > 0
    cards = client.get("/api/info").json()["card_count"]

    cardio = next(d["id"] for d in client.get("/api/deck-names").json() if d["name"] == "Step 1::Cardio")
    client.delete(f"/api/decks/{cardio}")
    assert client.get("/api/info").json()["card_count"] < cards

    # Phones can't restore; bad names are refused.
    phone = TestClient(client.app, client=("192.168.1.20", 5000))
    assert phone.post("/api/backups/restore", json={"name": backups[0]["name"]}).status_code in (401, 403)
    assert client.post("/api/backups/restore", json={"name": "../collection.anki2"}).status_code == 422
    assert client.post("/api/backups/restore", json={"name": "nope.colpkg"}).status_code == 422

    time.sleep(1.1)  # backups are named by the second
    assert client.post("/api/backups/restore", json={"name": backups[0]["name"]}).status_code == 200
    assert client.get("/api/info").json()["card_count"] == cards
    assert client.get("/api/decks").json()  # usable after the swap
    # The state before the restore was kept as a backup too.
    assert len(client.get("/api/backups").json()) == 2


def test_restore_is_desktop_only(col_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("COLLECTION_PATH", str(col_path))
    from api.main import app

    with TestClient(app) as client:
        client.post("/api/backups")
        name = client.get("/api/backups").json()[0]["name"]
        assert client.post("/api/backups/restore", json={"name": name}).status_code == 409


def test_update_check(desktop: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    checker = desktop.app.state.updates  # type: ignore[attr-defined]
    monkeypatch.setattr(checker, "_fetch", lambda: ("99.0.0", "https://github.com/x/y/releases/tag/v99.0.0"))
    info = desktop.get("/api/update").json()
    assert info["available"] is True and info["latest"] == "99.0.0" and info["url"].startswith("https://")

    fresh = updates.UpdateChecker()
    monkeypatch.setattr(fresh, "_fetch", lambda: None)  # offline / private repo
    desktop.app.state.updates = fresh  # type: ignore[attr-defined]
    assert desktop.get("/api/update").json()["available"] is False
