"""Embedding models Rounds can download, pinned by URL revision and SHA-256.

Entries are added after comparing candidates on real AnKing cards
(`scripts/quiz_compare.py` prints ready-to-paste entries, with the pinned
Hugging Face revision, checksums, sizes and license). Only models listed here
can be downloaded, and only files whose checksum matches are used.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


@dataclass(frozen=True)
class ModelFile:
    name: str
    """Saved as <models folder>/<model id>/<name>."""
    url: str
    sha256: str
    size: int


@dataclass(frozen=True)
class ModelSpec:
    id: str
    name: str
    """Shown in Settings."""
    kind: Literal["static", "onnx"]
    files: tuple[ModelFile, ...]
    license: str
    source: str
    """Where it comes from (shown in Settings)."""
    pooling: Literal["mean", "cls"] = "mean"
    """ONNX models: how token vectors become one vector."""
    max_tokens: int = 64
    notes: str = ""
    extra: dict[str, str] = field(default_factory=dict)

    @property
    def size(self) -> int:
        return sum(f.size for f in self.files)


# Filled in from the comparison on real cards (see the module docstring).
MODELS: dict[str, ModelSpec] = {}

DEFAULT_MODEL: str | None = None
"""The model the Settings switch downloads; None hides the switch."""


def default_spec() -> ModelSpec | None:
    return MODELS.get(DEFAULT_MODEL) if DEFAULT_MODEL else None
