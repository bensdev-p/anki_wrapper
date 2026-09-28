"""The answer index: every card's short answer, as a vector, for "similar answers" lookups.

Unique answer texts are stored once, with how many cards use each; notes are
tracked by their modification time so an update only re-reads notes that
changed since. Kept in <collection folder>/quiz-index/<model id>/ (never in
the collection).
"""

from __future__ import annotations

import json
import os
import threading
from collections.abc import Callable
from pathlib import Path

import numpy as np

VERSION = 1
QUESTION_WEIGHT = 0.3
"""How much the question's own wording counts, next to the answer's, when ranking options."""
SAME_ANSWER = 0.97
"""Similarity above which an answer is the same thing reworded (not a wrong option)."""

Embed = Callable[[list[str]], np.ndarray]


def text_key(text: str) -> str:
    return " ".join(text.lower().split())


class AnswerIndex:
    def __init__(self, folder: Path, model_id: str, dims: int) -> None:
        self.folder = folder
        self.model_id = model_id
        self.dims = dims
        self._lock = threading.Lock()
        self.texts: list[str] = []
        self.keys: dict[str, int] = {}
        self.counts: list[int] = []
        self.notes: dict[int, tuple[int, list[int]]] = {}
        """note id → (note mod time, rows of its cards' answers)"""
        self._vecs = np.zeros((0, dims), dtype=np.float32)

    # Loading and saving
    ######################################################################

    @classmethod
    def load(cls, folder: Path, model_id: str, dims: int) -> AnswerIndex:
        """The saved index, or an empty one if there's none (or it's for another model)."""
        index = cls(folder, model_id, dims)
        try:
            meta = json.loads((folder / "index.json").read_text())
            if meta.get("version") != VERSION or meta.get("model") != model_id or meta.get("dims") != dims:
                return index
            vecs = np.load(folder / "vectors.npy").astype(np.float32)
            if vecs.shape != (len(meta["texts"]), dims):
                return index
        except (OSError, ValueError, KeyError):
            return index
        index.texts = list(meta["texts"])
        index.counts = list(meta["counts"])
        index.keys = {text_key(t): i for i, t in enumerate(index.texts)}
        index.notes = {int(n): (int(mod), list(rows)) for n, (mod, rows) in meta["notes"].items()}
        index._vecs = vecs
        return index

    def save(self) -> None:
        with self._lock:
            self._compact()
            self.folder.mkdir(parents=True, exist_ok=True)
            n = len(self.texts)
            meta = {
                "version": VERSION,
                "model": self.model_id,
                "dims": self.dims,
                "texts": self.texts,
                "counts": self.counts,
                "notes": {str(k): [mod, rows] for k, (mod, rows) in self.notes.items()},
            }
            vec_tmp = self.folder / "vectors.tmp.npy"
            np.save(vec_tmp, self._vecs[:n].astype(np.float16))  # half the disk space; plenty precise
            meta_tmp = self.folder / "index.tmp.json"
            meta_tmp.write_text(json.dumps(meta))
            os.replace(vec_tmp, self.folder / "vectors.npy")
            os.replace(meta_tmp, self.folder / "index.json")

    # Updating
    ######################################################################

    @property
    def size(self) -> int:
        """Distinct answers in use."""
        return sum(1 for c in self.counts if c > 0)

    def changed_notes(self, current: dict[int, int]) -> tuple[list[int], list[int]]:
        """Given every note's modification time: notes to (re)read, and notes that are gone."""
        stale = [nid for nid, mod in current.items() if self.notes.get(nid, (None,))[0] != mod]
        removed = [nid for nid in self.notes if nid not in current]
        return stale, removed

    def update(self, answers: dict[int, tuple[int, list[str]]], removed: list[int], embed: Embed) -> None:
        """Record notes' answers (note id → (mod time, answers)) and forget removed notes."""
        new_texts: list[str] = []
        new_keys: dict[str, int] = {}
        for _, texts in answers.values():
            for t in texts:
                k = text_key(t)
                if k and k not in self.keys and k not in new_keys:
                    new_keys[k] = len(new_texts)
                    new_texts.append(t)
        vectors = embed(new_texts) if new_texts else np.zeros((0, self.dims), dtype=np.float32)
        with self._lock:
            base = len(self.texts)
            self._append(vectors)
            self.texts.extend(new_texts)
            self.counts.extend([0] * len(new_texts))
            for k, i in new_keys.items():
                self.keys[k] = base + i
            for nid in [*removed, *answers.keys()]:
                for row in self.notes.pop(nid, (0, []))[1]:
                    self.counts[row] -= 1
            for nid, (mod, texts) in answers.items():
                rows = [self.keys[text_key(t)] for t in texts if text_key(t)]
                for row in rows:
                    self.counts[row] += 1
                self.notes[nid] = (mod, rows)

    def _append(self, vectors: np.ndarray) -> None:
        n = len(self.texts)
        need = n + len(vectors)
        if need > len(self._vecs):
            grown = np.zeros((max(need, 2 * len(self._vecs), 1024), self.dims), dtype=np.float32)
            grown[:n] = self._vecs[:n]
            self._vecs = grown
        self._vecs[n:need] = vectors

    def _compact(self) -> None:
        """Drop answers no card uses any more (when enough have piled up)."""
        dead = [i for i, c in enumerate(self.counts) if c <= 0]
        if not dead or len(dead) < 0.2 * len(self.counts):
            self._vecs = self._vecs[: len(self.texts)]
            return
        keep = [i for i, c in enumerate(self.counts) if c > 0]
        remap = {old: new for new, old in enumerate(keep)}
        self._vecs = self._vecs[keep]
        self.texts = [self.texts[i] for i in keep]
        self.counts = [self.counts[i] for i in keep]
        self.keys = {text_key(t): i for i, t in enumerate(self.texts)}
        self.notes = {nid: (mod, [remap[r] for r in rows if r in remap]) for nid, (mod, rows) in self.notes.items()}

    # Looking up
    ######################################################################

    def nearest(self, items: list[tuple[str, str]], limit: int, embed: Embed) -> list[list[tuple[str, float]]]:
        """For each (answer, question): answers in use that are most like it, with scores, best first."""
        if not items:
            return []
        with self._lock:
            n = len(self.texts)
            vecs = self._vecs[:n]
            alive = np.asarray(self.counts, dtype=np.int64) > 0
            texts = self.texts
        if n == 0:
            return [[] for _ in items]
        answers = embed([a for a, _ in items])
        questions = embed([q for _, q in items])
        like_answer = vecs @ answers.T  # (n, items)
        score = like_answer + QUESTION_WEIGHT * (vecs @ questions.T)
        score[~alive] = -np.inf
        score[like_answer > SAME_ANSWER] = -np.inf
        # No similarity at all (e.g. the model knows none of the words): no basis to rank on;
        # the quiz falls back to related cards instead.
        score[like_answer <= 0] = -np.inf
        k = min(limit, n)
        out = []
        for j in range(len(items)):
            col = score[:, j]
            top = np.argpartition(-col, k - 1)[:k]
            top = top[np.argsort(-col[top])]
            out.append([(texts[i], float(col[i])) for i in top if np.isfinite(col[i])])
        return out


class IndexNeighbours:
    """service.quiz.AnswerNeighbours backed by an AnswerIndex and an embedder."""

    def __init__(self, index: AnswerIndex, embed: Embed) -> None:
        self.index = index
        self.embed = embed

    def nearest(self, items: list[tuple[str, str]], limit: int) -> list[list[tuple[str, float]]]:
        return self.index.nearest(items, limit, self.embed)
