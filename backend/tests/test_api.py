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


def _deck_id(client: TestClient, full_name: str) -> int:
    def walk(nodes):
        for n in nodes:
            if n["full_name"] == full_name:
                return n["id"]
            if (found := walk(n["children"])) is not None:
                return found
        return None

    return walk(client.get("/api/decks").json())


def test_study_answer_undo_round_trip(client: TestClient) -> None:
    did = _deck_id(client, "Step 1")
    state = client.post(f"/api/study/deck/{did}").json()
    card = state["card"]
    assert len(card["button_labels"]) == 4
    assert state["can_undo"] is False

    r = client.post("/api/study/answer", json={"card_id": card["card_id"], "rating": 3, "ms_taken": 3000})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["result"]["due_after"] != body["result"]["due_before"]
    assert body["state"]["can_undo"] is True

    # Answering the same card again is stale.
    r = client.post("/api/study/answer", json={"card_id": card["card_id"], "rating": 3, "ms_taken": 3000})
    assert r.status_code == 409

    r = client.post("/api/study/undo")
    assert r.status_code == 200
    assert r.json()["state"]["card"]["card_id"] == card["card_id"]
    assert r.json()["state"]["counts"] == state["counts"]
    assert client.post("/api/study/undo").status_code == 409


def test_validation_and_not_found(client: TestClient) -> None:
    assert client.post("/api/study/deck/424242").status_code == 404
    r = client.post("/api/study/answer", json={"card_id": 1, "rating": 7, "ms_taken": 0})
    assert r.status_code == 422


def test_media(client: TestClient) -> None:
    r = client.get("/api/media/ecg_afib.svg")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("image/svg+xml")
    assert client.get("/api/media/nope.png").status_code == 404
    assert client.get("/api/media/..%2Fcollection.anki2").status_code == 404
    assert client.get("/api/media/../collection.anki2").status_code == 404


def test_info_and_search(client: TestClient) -> None:
    info = client.get("/api/info").json()
    assert info["card_count"] > 0
    r = client.get("/api/search", params={"q": "digoxin"})
    assert r.json()["total"] >= 2


def test_stats_endpoint(client: TestClient) -> None:
    body = client.get("/api/stats").json()
    assert body["deck_id"] is None and body["cards"]["new"] >= 0
    did = _deck_id(client, "Step 1::Cardio")
    assert client.get("/api/stats", params={"deck_id": did}).json()["deck_name"] == "Step 1::Cardio"
    assert client.get("/api/stats", params={"deck_id": 424242}).status_code == 404


def test_stats_cache_invalidates_after_answer(client: TestClient) -> None:
    did = _deck_id(client, "Step 1")
    before = client.get("/api/stats", params={"days": 30}).json()
    assert client.get("/api/stats", params={"days": 30}).json() == before  # cached
    card = client.post(f"/api/study/deck/{did}").json()["card"]
    client.post("/api/study/answer", json={"card_id": card["card_id"], "rating": 3, "ms_taken": 1000})
    after = client.get("/api/stats", params={"days": 30}).json()
    assert after["today"]["answered"] == before["today"]["answered"] + 1
    assert client.get("/api/stats", params={"days": 9999}).status_code == 422
