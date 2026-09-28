"""Smarter quiz options in the app: turning it on downloads and indexes; quizzes use it."""

from __future__ import annotations

import asyncio
import hashlib
import shutil
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import service
from api.host import CollectionHost
from api.smart_quiz import SmartQuiz
from safety import DATA_DIR
from semantic.models import ModelFile, ModelSpec
from test_semantic import GROUPS, _Response, make_model


@pytest.fixture
def workdir() -> Iterator[Path]:
    path = DATA_DIR / ".pytest" / f"smart-{uuid.uuid4().hex}"
    path.mkdir(parents=True)
    yield path
    shutil.rmtree(path, ignore_errors=True)


def _published_model(workdir: Path) -> tuple[ModelSpec, dict[str, bytes]]:
    """The tiny test model, as if published: pinned files with checksums."""
    src = make_model(workdir / "published")
    files = {name: (src / name).read_bytes() for name in ("tokenizer.json", "model.safetensors")}
    spec = ModelSpec(
        id="tiny",
        name="Tiny test model",
        kind="static",
        files=tuple(
            ModelFile(n, f"https://example.invalid/{n}", hashlib.sha256(d).hexdigest(), len(d)) for n, d in files.items()
        ),
        license="test",
        source="tests",
    )
    return spec, files


async def _settle(smart: SmartQuiz) -> None:
    for _ in range(400):
        if smart._task is None or smart._task.done():
            return
        await asyncio.sleep(0.02)
    raise AssertionError("background work didn't finish")


def test_turning_on_downloads_indexes_and_improves_options(col_path: Path, workdir: Path) -> None:
    spec, files = _published_model(workdir)
    fetched: list[str] = []

    def fetch(url: str) -> _Response:
        fetched.append(url)
        return _Response(files[url.rsplit("/", 1)[1]])

    async def scenario() -> None:
        host = CollectionHost(col_path)
        host.open()
        try:
            smart = SmartQuiz(host, workdir / "models", workdir / "smart-quiz.json", spec=spec, fetch=fetch)
            assert smart.status().available and not smart.status().enabled and smart.neighbours() is None

            def add(col, front: str, back: str) -> int:  # type: ignore[no-untyped-def]
                note = col.new_note(col.models.by_name("Basic"))
                note["Front"], note["Back"] = front, back
                col.add_note(note, col.decks.id("Step 1"))
                return note.id

            loop = await host.run(lambda col: add(col, "Loop diuretic?", "Furosemide"))
            for back in ["Bumetanide", "Torsemide", "Vancomycin", "Doxycycline", "Bleeding time"]:
                await host.run(lambda col, b=back: add(col, f"Q ({b})", b))

            await smart.set_enabled(True)
            assert smart.status().phase == "downloading"  # straight away, not "off"
            await _settle(smart)
            status = smart.status()
            assert status.phase == "ready" and status.downloaded and status.answers > 10, status
            assert len(fetched) == 2
            assert (col_path.parent / "quiz-index" / "tiny" / "index.json").exists()  # next to the collection

            neighbours = smart.neighbours()
            assert neighbours is not None
            card = await host.run(lambda col: col.get_note(loop).cards()[0].id)
            q = await host.run(
                lambda col: service.quiz.build_quiz(col, None, None, 1, card_ids=[card], seed=1, neighbours=neighbours)
            )
            wrong = set(q.questions[0].choices) - {"Furosemide"}
            assert len(wrong) == 3 and all(w.split()[0].lower() in GROUPS[0] for w in wrong), wrong

            # A new card's answer is picked up by the next refresh (after a sync or a quiz).
            await host.run(lambda col: add(col, "Thiazide?", "Hydrochlorothiazide"))
            before = smart.status().answers
            smart.refresh(force=True)
            await _settle(smart)
            assert smart.status().answers == before + 1

            # Restarting reuses the download and the saved index.
            again = SmartQuiz(host, workdir / "models", workdir / "smart-quiz.json", spec=spec, fetch=fetch)
            assert again.enabled
            await again.start()
            await _settle(again)
            assert again.status().phase == "ready" and again.status().answers == before + 1 and len(fetched) == 2

            await again.remove()
            status = again.status()
            assert not status.enabled and not status.downloaded and status.phase == "off"
            assert not (workdir / "models" / "tiny").exists() and not (col_path.parent / "quiz-index" / "tiny").exists()
            assert again.neighbours() is None
        finally:
            host.close()

    asyncio.run(scenario())


def test_a_bad_download_is_an_error_not_a_crash(col_path: Path, workdir: Path) -> None:
    spec, _ = _published_model(workdir)

    async def scenario() -> None:
        host = CollectionHost(col_path)
        host.open()
        try:
            smart = SmartQuiz(host, workdir / "models", workdir / "s.json", spec=spec, fetch=lambda url: _Response(b"tampered"))
            await smart.set_enabled(True)
            await _settle(smart)
            status = smart.status()
            assert status.phase == "error" and "checksum" in (status.error or "") and not status.downloaded
            assert smart.neighbours() is None
        finally:
            host.close()

    asyncio.run(scenario())


def test_api_without_a_listed_model(col_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("COLLECTION_PATH", str(col_path))
    from api.main import app

    with TestClient(app) as client:
        status = client.get("/api/smart-quiz").json()
        assert status["available"] is False and status["enabled"] is False
        assert client.put("/api/smart-quiz", json={"enabled": True}).status_code == 409
        # Quizzes work as before.
        assert client.post("/api/quiz", json={"count": 3, "cards": "all"}).status_code == 200
