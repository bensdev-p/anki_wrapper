"""Smarter quiz options: the on-device embedding engine, download checks and the answer index.

The real models are downloaded on users' computers; these tests use a tiny
hand-made "static" model whose word vectors put diuretics together, antibiotics
together and lab tests together.
"""

from __future__ import annotations

import hashlib
import shutil
import uuid
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import pytest
from anki.collection import Collection
from tokenizers import Tokenizer, models, normalizers, pre_tokenizers

from safety import DATA_DIR
from semantic import download as dl
from semantic import safetensors
from semantic.embedders import StaticEmbedder
from semantic.index import AnswerIndex, IndexNeighbours
from semantic.models import ModelFile, ModelSpec
from service import quiz

GROUPS = {
    0: ["furosemide", "bumetanide", "torsemide", "hydrochlorothiazide", "spironolactone", "diuretic", "loop"],
    1: ["vancomycin", "doxycycline", "penicillin", "antibiotic"],
    2: ["bleeding", "time", "d-dimer", "platelet", "count", "lab"],
}


@pytest.fixture
def workdir() -> Iterator[Path]:
    path = DATA_DIR / ".pytest" / f"semantic-{uuid.uuid4().hex}"
    path.mkdir(parents=True)
    yield path
    shutil.rmtree(path, ignore_errors=True)


def make_model(folder: Path) -> Path:
    """A Model2Vec-style model: tokenizer.json + model.safetensors."""
    folder.mkdir(parents=True, exist_ok=True)
    vocab = {"[UNK]": 0}
    rows = [np.zeros(16)]
    for group, words in GROUPS.items():
        for w in words:
            # Each word: its group's direction plus a little of its own (so no two are identical).
            v = np.zeros(16)
            v[group] = 1.0
            v[3 + len(vocab) % 13] = 0.35
            vocab[w] = len(vocab)
            rows.append(v)
    tok = Tokenizer(models.WordLevel(vocab=vocab, unk_token="[UNK]"))
    tok.normalizer = normalizers.Lowercase()
    tok.pre_tokenizer = pre_tokenizers.Whitespace()
    tok.save(str(folder / "tokenizer.json"))
    safetensors.save(folder / "model.safetensors", {"embeddings": np.asarray(rows, dtype=np.float32)})
    return folder


def test_safetensors_round_trip(workdir: Path) -> None:
    a = np.arange(12, dtype=np.float32).reshape(3, 4)
    b = np.array([1, 2, 3], dtype=np.int64)
    safetensors.save(workdir / "t.safetensors", {"a": a, "b": b})
    back = safetensors.load(workdir / "t.safetensors")
    assert np.array_equal(back["a"], a) and np.array_equal(back["b"], b)
    (workdir / "bad.safetensors").write_bytes(b"\xff" * 16)
    with pytest.raises(ValueError):
        safetensors.load(workdir / "bad.safetensors")


def test_static_embedder_puts_similar_answers_together(workdir: Path) -> None:
    emb = StaticEmbedder(make_model(workdir / "m"))
    v = emb.embed(["Furosemide", "Bumetanide", "Vancomycin", "Bleeding time", "", "zzz unknown"])
    assert v.shape == (6, 16) and v.dtype == np.float32
    assert np.allclose(np.linalg.norm(v[:4], axis=1), 1, atol=1e-5)
    assert v[0] @ v[1] > 0.8 > v[0] @ v[2]
    assert not v[4].any() and not v[5].any()  # nothing known: a zero vector, never an error


def _spec(files: dict[str, bytes]) -> ModelSpec:
    return ModelSpec(
        id="tiny",
        name="Tiny",
        kind="static",
        files=tuple(
            ModelFile(name, f"https://example.invalid/{name}", hashlib.sha256(data).hexdigest(), len(data))
            for name, data in files.items()
        ),
        license="test",
        source="test",
    )


class _Response:
    def __init__(self, data: bytes) -> None:
        self.data = data

    def raise_for_status(self) -> None:
        pass

    def iter_content(self, n: int) -> Iterator[bytes]:
        for i in range(0, len(self.data), 7):
            yield self.data[i : i + 7]


def test_download_checks_every_file(workdir: Path) -> None:
    files = {"tokenizer.json": b'{"a": 1}' * 20, "model.safetensors": b"\x01\x02" * 50}
    spec = _spec(files)
    seen = []
    folder = dl.download(workdir, spec, on_progress=lambda d, t: seen.append((d, t)), fetch=lambda url: _Response(files[url.rsplit("/", 1)[1]]))
    assert dl.is_downloaded(workdir, spec)
    assert (folder / "model.safetensors").read_bytes() == files["model.safetensors"]
    assert seen[-1] == (spec.size, spec.size)

    # A tampered or broken download is never used.
    dl.remove(workdir, spec)
    with pytest.raises(ValueError, match="checksum"):
        dl.download(workdir, spec, fetch=lambda url: _Response(b"not the file"))
    assert not dl.is_downloaded(workdir, spec)
    assert not any(p.name.endswith((".json", ".safetensors")) and p.name != "verified.json" and p.stat().st_size for p in (workdir / "tiny").iterdir() if p.name == "model.safetensors")

    # Cancelling leaves nothing half-written.
    with pytest.raises(dl.DownloadCancelled):
        dl.download(workdir, spec, cancelled=lambda: True, fetch=lambda url: _Response(files[url.rsplit("/", 1)[1]]))
    assert not list((workdir / "tiny").glob("*.part"))

    with pytest.raises(ValueError, match="https"):
        dl.download(workdir, ModelSpec("x", "x", "static", (ModelFile("f", "http://example.invalid/f", "0", 1),), "", ""), fetch=lambda url: _Response(b"x"))


def test_answer_index_updates_and_lookups(workdir: Path) -> None:
    emb = StaticEmbedder(make_model(workdir / "m"))
    index = AnswerIndex(workdir / "idx", "tiny", emb.dims)
    index.update(
        {
            1: (10, ["Furosemide"]),
            2: (10, ["Bumetanide", "Torsemide"]),
            3: (10, ["Vancomycin"]),
            4: (10, ["Bleeding time"]),
            5: (10, ["Hydrochlorothiazide"]),
            6: (10, ["furosemide"]),  # the same answer on another note
        },
        [],
        emb.embed,
    )
    assert index.size == 6
    [hits] = index.nearest([("Loop diuretic", "Which loop diuretic?")], 4, emb.embed)
    assert {t for t, _ in hits[:3]} <= {"Furosemide", "Bumetanide", "Torsemide", "Hydrochlorothiazide"}
    assert [s for _, s in hits] == sorted((s for _, s in hits), reverse=True)

    # Only notes that changed are re-read; removed notes' answers disappear.
    assert index.changed_notes({1: 10, 2: 11, 3: 10, 4: 10, 5: 10, 6: 10}) == ([2], [])
    assert index.changed_notes({1: 10}) == ([], [2, 3, 4, 5, 6])
    index.update({2: (11, ["Torsemide"])}, [3], emb.embed)
    hits = [t for t, _ in index.nearest([("Furosemide", "")], 10, emb.embed)[0]]
    assert "Bumetanide" not in hits and "Vancomycin" not in hits
    assert "Furosemide" not in hits and "furosemide" not in hits  # the answer itself isn't a wrong option

    index.save()
    again = AnswerIndex.load(workdir / "idx", "tiny", emb.dims)
    assert again.size == index.size and again.notes == index.notes
    def texts(ix: AnswerIndex) -> list[str]:
        return [t for t, _ in ix.nearest([("Furosemide", "")], 10, emb.embed)[0]]

    assert texts(again) == texts(index)  # vectors are saved at half precision: same ranking
    # Another model's index isn't reused.
    assert AnswerIndex.load(workdir / "idx", "other", emb.dims).size == 0


def test_quiz_uses_the_index_for_options(col: Collection, workdir: Path) -> None:
    def add(front: str, back: str) -> int:
        note = col.new_note(col.models.by_name("Basic"))  # type: ignore[arg-type]
        note["Front"], note["Back"] = front, back
        col.add_note(note, col.decks.id("Step 1"))  # type: ignore[arg-type]
        return note.id

    loop = add("Loop diuretic that causes ototoxicity?", "Furosemide")
    for back in ["Bumetanide", "Torsemide", "Hydrochlorothiazide", "Spironolactone"]:
        add(f"Diuretic? ({back})", back)
    for back in ["Vancomycin", "Doxycycline", "Bleeding time", "Platelet count"]:
        add(f"Other? ({back})", back)

    emb = StaticEmbedder(make_model(workdir / "m"))
    index = AnswerIndex(workdir / "idx", "tiny", emb.dims)
    mods = quiz.note_mod_times(col)
    stale, removed = index.changed_notes(mods)
    assert len(stale) == len(mods) and removed == []
    index.update(quiz.note_answers(col, stale), removed, emb.embed)

    card = col.get_note(loop).cards()[0].id
    for seed in range(5):
        q = quiz.build_quiz(col, None, None, 1, card_ids=[card], seed=seed, neighbours=IndexNeighbours(index, emb.embed)).questions[0]
        wrong = set(q.choices) - {"Furosemide"}
        # All diuretics (the sample deck has "Spironolactone (also eplerenone)" too).
        assert len(wrong) == 3 and all(w.split()[0].lower() in GROUPS[0] for w in wrong), wrong
