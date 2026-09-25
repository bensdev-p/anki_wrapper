"""Custom study, filtered decks and importing .apkg files (through the API)."""

from __future__ import annotations

import time
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from anki.collection import Collection, DeckIdLimit, ExportAnkiPackageOptions
from fastapi.testclient import TestClient


@pytest.fixture
def client(col_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("COLLECTION_PATH", str(col_path))
    from api.main import app

    with TestClient(app) as c:
        yield c


def _deck_id(client: TestClient, name: str) -> int:
    return next(d["id"] for d in client.get("/api/deck-names").json() if d["name"] == name)


def _schema(client: TestClient) -> int:
    host = client.app.state.host  # type: ignore[attr-defined]
    return host._executor.submit(lambda: host._col.db.scalar("select scm from col")).result()


def test_custom_study(client: TestClient) -> None:
    step1 = _deck_id(client, "Step 1")
    info = client.get(f"/api/decks/{step1}/custom-study").json()
    assert info["deck_name"] == "Step 1" and "cardio" in info["tags"]

    session = client.post(f"/api/decks/{step1}/custom-study", json={"kind": "cram", "amount": 15, "cram_kind": "all"}).json()
    names = {d["id"]: d for d in client.get("/api/deck-names").json()}
    assert names[session["deck_id"]]["filtered"] is True
    state = client.post(f"/api/study/deck/{session['deck_id']}").json()
    assert state["card"] is not None  # there's something to study

    # Raising today's new limit keeps you on the same deck.
    cardio = _deck_id(client, "Step 1::Cardio")
    assert client.post(f"/api/decks/{cardio}/custom-study", json={"kind": "new", "amount": 5}).json()["deck_id"] == cardio
    assert client.post(f"/api/decks/{cardio}/custom-study", json={"kind": "nope", "amount": 5}).status_code == 422


def test_filtered_deck_lifecycle(client: TestClient) -> None:
    scm = _schema(client)
    form = client.get("/api/filtered/0", params={"search": 'deck:"Step 1::Cardio"'}).json()
    assert form["deck"]["id"] == 0 and form["order_labels"]
    spec = {**form["deck"], "name": "Cardio cram", "limit": 50}
    made = client.put("/api/filtered", json=spec).json()["deck_id"]
    assert client.get(f"/api/decks/{made}/card-count").json()["cards"] > 0

    assert client.post(f"/api/filtered/{made}/empty").status_code == 200
    assert client.get(f"/api/decks/{made}/card-count").json()["cards"] == 0
    assert client.post(f"/api/filtered/{made}/rebuild").json()["cards"] > 0

    edit = client.get(f"/api/filtered/{made}").json()["deck"]
    assert edit["name"] == "Cardio cram" and "Cardio" in edit["search"]
    renamed = client.put("/api/filtered", json={**edit, "name": "Cardio sprint", "limit": 5}).json()["deck_id"]
    assert renamed == made
    assert client.get(f"/api/decks/{made}/card-count").json()["cards"] == 5

    assert client.put("/api/filtered", json={**spec, "search": "deck:(("}).status_code == 422
    normal = _deck_id(client, "Step 1::Renal")
    assert client.post(f"/api/filtered/{normal}/rebuild").status_code == 422
    assert _schema(client) == scm


def _export_apkg(col_path: Path, deck: str) -> tuple[bytes, int]:
    col = Collection(str(col_path))
    try:
        out = col_path.parent / "export.apkg"
        deck_id = col.decks.id_for_name(deck)
        col.export_anki_package(
            out_path=str(out),
            options=ExportAnkiPackageOptions(with_scheduling=False, with_media=True, with_deck_configs=False, legacy=False),
            limit=DeckIdLimit(deck_id),
        )
        notes = len({col.get_card(c).nid for c in col.decks.cids(deck_id, children=True)})
        return out.read_bytes(), notes
    finally:
        col.close()


def _wait_import(client: TestClient) -> dict:
    for _ in range(200):
        status = client.get("/api/import").json()
        if status["phase"] == "idle":
            return status
        time.sleep(0.05)
    raise AssertionError("import did not finish")


def test_import_apkg_into_new_desktop_collection(col_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    data, notes = _export_apkg(col_path, "Step 1::Cardio")
    folder = col_path.parent.parent / uuid.uuid4().hex / "synced"
    monkeypatch.setenv("ROUNDS_DESKTOP", "1")
    monkeypatch.setenv("SYNCED_DIR", str(folder))
    monkeypatch.setenv("COLLECTION_PATH", str(folder / "collection.anki2"))
    from api.main import app

    with TestClient(app) as client:
        scm = _schema(client)
        assert client.post("/api/import", params={"name": "backup.colpkg"}, content=b"x").status_code == 422
        assert client.post("/api/import", params={"name": "notes.txt"}, content=b"x").status_code == 422

        started = client.post("/api/import", params={"name": "Cardio.apkg"}, content=data).json()
        assert started["phase"] == "importing" and started["filename"] == "Cardio.apkg"
        status = _wait_import(client)
        assert status["error"] is None and status["result"]["new"] == notes
        assert client.get("/api/info").json()["card_count"] > 0
        assert any(d["name"].endswith("Cardio") for d in client.get("/api/deck-names").json())
        assert (folder / "collection.media" / "ecg_afib.svg").exists()  # media came along
        assert not list((folder / "imports").iterdir())  # upload cleaned up

        # Importing again finds the same notes.
        client.post("/api/import", params={"name": "Cardio.apkg"}, content=data)
        again = _wait_import(client)["result"]
        assert again["new"] == 0 and again["duplicate"] + again["updated"] == notes
        assert _schema(client) == scm  # no one-way sync needed

        bad = client.post("/api/import", params={"name": "broken.apkg"}, content=b"not a zip").json()
        assert bad["phase"] == "importing"
        assert _wait_import(client)["error"]
