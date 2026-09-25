"""Deck management, deck options and adding notes (through the API)."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(col_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("COLLECTION_PATH", str(col_path))
    from api.main import app

    with TestClient(app) as c:
        yield c


def _schema(client: TestClient) -> int:
    host = client.app.state.host  # type: ignore[attr-defined]
    return host._executor.submit(lambda: host._col.db.scalar("select scm from col")).result()


def _deck_id(client: TestClient, name: str) -> int:
    return next(d["id"] for d in client.get("/api/deck-names").json() if d["name"] == name)


# Decks
##########################################################################


def test_create_rename_delete_deck(client: TestClient) -> None:
    made = client.post("/api/decks", json={"name": " Step 1 :: Immuno "}).json()
    assert made["name"] == "Step 1::Immuno"
    assert client.post("/api/decks", json={"name": "Step 1::Immuno"}).status_code == 422
    assert client.post("/api/decks", json={"name": "Step 1::::X"}).status_code == 422

    moved = client.patch(f"/api/decks/{made['id']}", json={"name": "Step 2 CK::Immuno"}).json()
    assert moved["name"] == "Step 2 CK::Immuno"
    assert client.patch(f"/api/decks/{made['id']}", json={"name": "Step 1"}).status_code == 422

    cardio = _deck_id(client, "Step 1::Cardio")
    count = client.get(f"/api/decks/{cardio}/card-count").json()["cards"]
    assert count > 0
    before = client.get("/api/info").json()["card_count"]
    deleted = client.delete(f"/api/decks/{cardio}").json()
    assert deleted["name"] == "Step 1::Cardio" and deleted["cards"] == count
    assert client.get("/api/info").json()["card_count"] == before - count
    assert client.delete("/api/decks/1").status_code == 422  # Default

    # Undo brings the deck and its cards back...
    assert client.post("/api/undo-step", json={"label": deleted["undo_label"]}).status_code == 200
    assert client.get("/api/info").json()["card_count"] == before
    # ...but only while the deletion is still the last change.
    again = client.delete(f"/api/decks/{cardio}").json()
    client.post("/api/decks", json={"name": "Something else"})
    assert client.post("/api/undo-step", json={"label": again["undo_label"]}).status_code == 409


# Deck options
##########################################################################


def test_deck_options_round_trip_without_schema_change(client: TestClient) -> None:
    deck = _deck_id(client, "Step 1::Renal")
    scm = _schema(client)
    opts = client.get(f"/api/decks/{deck}/options").json()
    assert opts["deck_name"] == "Step 1::Renal" and opts["presets"]

    saved = client.put(
        f"/api/decks/{deck}/options",
        json={"preset_id": opts["preset_id"], "changes": {"new_per_day": 42, "learn_steps": [1, 10, 1440], "bury_new": True}},
    ).json()
    assert saved["config"]["new_per_day"] == 42
    assert saved["config"]["learn_steps"] == [1, 10, 1440]
    assert saved["config"]["bury_new"] is True

    # A new preset just for this deck; the old one is kept (never deleted).
    fresh = client.put(
        f"/api/decks/{deck}/options",
        json={"preset_id": opts["preset_id"], "changes": {"new_per_day": 7}, "new_preset_name": "Renal only"},
    ).json()
    names = {p["name"]: p for p in fresh["presets"]}
    assert "Renal only" in names and names["Renal only"]["use_count"] == 1
    assert fresh["preset_id"] == names["Renal only"]["id"] and fresh["config"]["new_per_day"] == 7
    assert len(fresh["presets"]) == len(opts["presets"]) + 1
    other = _deck_id(client, "Step 1::Neuro")
    assert client.get(f"/api/decks/{other}/options").json()["config"]["new_per_day"] == 42  # untouched

    assert _schema(client) == scm  # no one-way sync needed


def test_deck_options_reject_bad_values(client: TestClient) -> None:
    deck = _deck_id(client, "Step 1::Renal")
    preset = client.get(f"/api/decks/{deck}/options").json()["preset_id"]
    for changes in ({"new_per_day": -1}, {"desired_retention": 1.5}, {"learn_steps": []}, {"review_order": 999}, {"nope": 1}):
        r = client.put(f"/api/decks/{deck}/options", json={"preset_id": preset, "changes": changes})
        assert r.status_code == 422, changes


# Adding notes
##########################################################################


def test_add_basic_and_cloze_notes(client: TestClient) -> None:
    d = client.get("/api/add").json()
    basic = next(n for n in d["notetypes"] if n["name"] == "Basic")
    cloze = next(n for n in d["notetypes"] if n["is_cloze"])
    deck = _deck_id(client, "Step 1::Renal")
    before = client.get("/api/info").json()["card_count"]

    r = client.post(
        "/api/notes",
        json={"notetype_id": basic["id"], "deck_id": deck, "fields": {"Front": "Loop diuretic?", "Back": "Furosemide"}, "tags": ["renal"]},
    ).json()
    assert r["cards"] == 1 and r["duplicate"] is False
    again = client.post(
        "/api/notes", json={"notetype_id": basic["id"], "deck_id": deck, "fields": {"Front": "Loop diuretic?", "Back": "x"}}
    ).json()
    assert again["duplicate"] is True  # allowed, but reported (as in Anki)

    text_field = cloze["fields"][0]
    c = client.post(
        "/api/notes",
        json={"notetype_id": cloze["id"], "deck_id": deck, "fields": {text_field: "{{c1::ACE}} inhibitors cause {{c2::cough}}"}},
    ).json()
    assert c["cards"] == 2
    assert client.get("/api/info").json()["card_count"] == before + 4


def test_add_note_rejects_what_anki_rejects(client: TestClient) -> None:
    d = client.get("/api/add").json()
    basic = next(n for n in d["notetypes"] if n["name"] == "Basic")
    cloze = next(n for n in d["notetypes"] if n["is_cloze"])
    deck = d["deck_id"]
    empty = client.post("/api/notes", json={"notetype_id": basic["id"], "deck_id": deck, "fields": {"Front": "", "Back": "x"}})
    assert empty.status_code == 422
    no_cloze = client.post("/api/notes", json={"notetype_id": cloze["id"], "deck_id": deck, "fields": {cloze["fields"][0]: "plain"}})
    assert no_cloze.status_code == 422
    unknown = client.post("/api/notes", json={"notetype_id": basic["id"], "deck_id": deck, "fields": {"Nope": "x"}})
    assert unknown.status_code == 422


def test_media_upload(client: TestClient) -> None:
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 64
    first = client.post("/api/media", params={"name": "slide.png"}, content=png).json()["filename"]
    assert first == "slide.png"
    assert client.get(f"/api/media/{first}").content == png
    # Same name, different content: Anki picks a new name rather than overwrite.
    second = client.post("/api/media", params={"name": "slide.png"}, content=png + b"1").json()["filename"]
    assert second != "slide.png"
    assert client.post("/api/media", params={"name": "evil.html"}, content=b"<script>").status_code == 422
    assert client.post("/api/media", params={"name": "../../x.png"}, content=png).json()["filename"] == "x.png"
