"""Using the desktop app from a phone on the home network."""

from __future__ import annotations

import json
import os
import shutil
import socket
import uuid
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from api import sharing as sharing_mod

PHONE = ("192.168.1.20", 5000)


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def desktop(col_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple[TestClient, Path]]:
    """The desktop app on a copy of the sample collection, sharing configured on a free port."""
    root = col_path.parent.parent / uuid.uuid4().hex
    folder = root / "synced"
    folder.mkdir(parents=True)
    shutil.copy(col_path, folder / "collection.anki2")
    shutil.copytree(col_path.parent / "collection.media", folder / "collection.media")
    (root / "sharing.json").write_text(json.dumps({"port": _free_port()}))
    monkeypatch.setenv("ROUNDS_DESKTOP", "1")
    monkeypatch.setenv("SYNCED_DIR", str(folder))
    monkeypatch.setenv("COLLECTION_PATH", str(folder / "collection.anki2"))
    from api.main import app

    with TestClient(app) as client:
        yield client, root


def _phone(client: TestClient) -> TestClient:
    # No `with`: the app is already running (a second lifespan would reopen the collection).
    return TestClient(client.app, client=PHONE)


def test_phone_must_pair_first(desktop: tuple[TestClient, Path]) -> None:
    client, root = desktop
    phone = _phone(client)
    assert phone.get("/api/decks").status_code == 401
    assert phone.get("/api/decks").json()["error"] == "PairingRequired"
    assert phone.get("/api/sharing").status_code == 401  # and never sees the code

    code = client.get("/api/sharing").json()["code"]
    wrong = f"{(int(code) + 1) % 1_000_000:06d}"
    assert phone.post("/api/pair", json={"code": wrong}).status_code == 401
    ok = phone.post("/api/pair", json={"code": code})
    assert ok.status_code == 200 and sharing_mod.COOKIE in ok.cookies
    assert phone.get("/api/decks").status_code == 200
    assert phone.get("/api/sharing").status_code == 403  # settings stay on the computer

    saved = json.loads((root / "sharing.json").read_text())
    token = ok.cookies[sharing_mod.COOKIE]
    assert token not in json.dumps(saved)  # only a hash is kept
    assert oct(os.stat(root / "sharing.json").st_mode & 0o777) == "0o600"


def test_wrong_codes_lock_pairing_for_a_minute(desktop: tuple[TestClient, Path]) -> None:
    client, _ = desktop
    phone = _phone(client)
    code = client.get("/api/sharing").json()["code"]
    wrong = f"{(int(code) + 1) % 1_000_000:06d}"
    for _ in range(sharing_mod.MAX_FAILURES):
        assert phone.post("/api/pair", json={"code": wrong}).status_code == 401
    # Even the right code is refused while locked.
    assert phone.post("/api/pair", json={"code": code}).status_code == 429


def test_phone_gets_media_by_token_only(desktop: tuple[TestClient, Path]) -> None:
    client, _ = desktop
    phone = _phone(client)
    phone.post("/api/pair", json={"code": client.get("/api/sharing").json()["code"]})

    assert client.get("/api/info").json()["media_path"] == "/api/media/"
    info = phone.get("/api/info").json()
    assert info["remote"] is True and info["media_path"].startswith("/api/m/")
    # The card frame can't send cookies, so the token path works without one...
    anon = _phone(client)
    assert anon.get(info["media_path"] + "ecg_afib.svg").status_code == 200
    assert anon.get("/api/m/wrong-token/ecg_afib.svg").status_code == 404
    assert anon.get("/api/media/ecg_afib.svg").status_code == 401


def test_new_code_signs_phones_out(desktop: tuple[TestClient, Path]) -> None:
    client, _ = desktop
    phone = _phone(client)
    phone.post("/api/pair", json={"code": client.get("/api/sharing").json()["code"]})
    old_media = phone.get("/api/info").json()["media_path"]
    assert client.post("/api/sharing/new-code").json()["devices"] == 0
    assert phone.get("/api/decks").status_code == 401
    assert _phone(client).get(old_media + "ecg_afib.svg").status_code == 404


def test_other_websites_are_refused(desktop: tuple[TestClient, Path]) -> None:
    client, _ = desktop
    # A page on another site posting to the local server (CSRF).
    evil = client.post("/api/study/undo", headers={"Origin": "https://evil.example"})
    assert evil.status_code == 403
    # DNS rebinding: another site's name pointed at 127.0.0.1.
    assert client.get("/api/decks", headers={"Host": "evil.example:8765"}).status_code == 403
    # This app's own pages are fine.
    assert client.get("/api/decks", headers={"Host": "127.0.0.1:8765"}).status_code == 200
    assert client.get("/api/decks", headers={"Host": "bens-macbook.local:8766"}).status_code == 200
    ok = client.post("/api/study/undo", headers={"Origin": "http://testserver", "Host": "testserver"})
    assert ok.status_code != 403


def test_sharing_switch_opens_and_closes_the_network_listener(desktop: tuple[TestClient, Path]) -> None:
    client, _ = desktop
    status = client.post("/api/sharing", json={"enabled": True}).json()
    assert status["enabled"] and status["running"] and status["error"] is None
    port = status["port"]
    lan = next((u for u in status["urls"] if u.split("//")[1][0].isdigit()), None)
    if lan:
        # A request over the real network is not "this computer": it must pair.
        r = httpx.get(f"{lan}api/decks", timeout=5)
        assert r.status_code == 401
        assert httpx.get(lan, timeout=5).status_code in (200, 404)  # the app itself (404 without a UI build)
        qr = client.get("/api/sharing/qr.svg", params={"url": lan})
        assert qr.status_code == 200 and qr.text.startswith("<svg")

    assert client.post("/api/sharing", json={"enabled": False}).json()["running"] is False
    with pytest.raises(httpx.ConnectError):
        httpx.get(f"http://127.0.0.1:{port}/api/info", timeout=2)


def test_sharing_is_desktop_only(col_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("COLLECTION_PATH", str(col_path))
    from api.main import app

    with TestClient(app) as client:
        assert client.get("/api/sharing").status_code == 409
        # The Pi keeps serving its home network without pairing, as before.
        assert TestClient(app, client=PHONE).get("/api/decks").status_code == 200


def test_busy_port_moves_to_the_next_one(desktop: tuple[TestClient, Path]) -> None:
    client, root = desktop
    port = client.get("/api/sharing").json()["port"]
    with socket.socket() as blocker:
        blocker.bind(("0.0.0.0", port))
        blocker.listen()
        status = client.post("/api/sharing", json={"enabled": True}).json()
        assert status["running"] and status["port"] != port and status["error"] is None
        assert client.get("/api/decks").status_code == 200  # the app itself is fine
    client.post("/api/sharing", json={"enabled": False})
    assert json.loads((root / "sharing.json").read_text())["port"] == status["port"]
