"""Turning short texts into unit vectors, on this computer."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Protocol

import numpy as np
from tokenizers import Tokenizer

from . import safetensors
from .models import ModelSpec

BATCH = 64


class Embedder(Protocol):
    dims: int

    def embed(self, texts: list[str]) -> np.ndarray:
        """(len(texts), dims) float32, each row of length 1 (or 0 for empty text)."""
        ...


def normalize(vectors: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    return (vectors / np.where(norms == 0, 1, norms)).astype(np.float32)


def _unk_id(tokenizer: Tokenizer) -> int | None:
    for token in ("[UNK]", "<unk>", "[unk]"):
        tid = tokenizer.token_to_id(token)
        if tid is not None:
            return tid
    return None


class StaticEmbedder:
    """Model2Vec-style: a token → vector table; a text is the (weighted) mean of its tokens."""

    def __init__(self, folder: Path) -> None:
        self.tokenizer = Tokenizer.from_file(str(folder / "tokenizer.json"))
        self.tokenizer.no_padding()
        self.tokenizer.no_truncation()
        tensors = safetensors.load(folder / "model.safetensors")
        table = tensors.get("embeddings")
        if table is None:
            table = next(t for t in tensors.values() if t.ndim == 2)
        self.table = np.asarray(table, dtype=np.float32)
        weights = tensors.get("weights")
        mapping = tensors.get("mapping")
        self.weights = np.asarray(weights, dtype=np.float32).reshape(-1) if weights is not None else None
        self.mapping = np.asarray(mapping, dtype=np.int64).reshape(-1) if mapping is not None else None
        self.unk = _unk_id(self.tokenizer)
        self.dims = int(self.table.shape[1])
        config = folder / "config.json"
        self.max_tokens = 512
        if config.exists():
            try:
                self.max_tokens = int(json.loads(config.read_text()).get("seq_length", 512))
            except (ValueError, TypeError):
                pass

    def embed(self, texts: list[str]) -> np.ndarray:
        out = np.zeros((len(texts), self.dims), dtype=np.float32)
        for i, enc in enumerate(self.tokenizer.encode_batch(texts, add_special_tokens=False)):
            ids = np.asarray(enc.ids[: self.max_tokens], dtype=np.int64)
            if self.unk is not None:
                ids = ids[ids != self.unk]
            if not len(ids):
                continue
            weights = self.weights[ids] if self.weights is not None else None
            rows = self.mapping[ids] if self.mapping is not None else ids
            vecs = self.table[rows]
            out[i] = (vecs * weights[:, None]).mean(axis=0) if weights is not None else vecs.mean(axis=0)
        return normalize(out)


class OnnxEmbedder:
    """A small transformer (sentence-transformers style) run with ONNX Runtime."""

    def __init__(self, folder: Path, pooling: str = "mean", max_tokens: int = 64) -> None:
        import onnxruntime as ort  # optional dependency: only needed for this kind of model

        opts = ort.SessionOptions()
        opts.intra_op_num_threads = max(1, (os.cpu_count() or 2) // 2)  # leave the computer usable
        self.session = ort.InferenceSession(str(folder / "model.onnx"), opts, providers=["CPUExecutionProvider"])
        self.inputs = {i.name for i in self.session.get_inputs()}
        self.tokenizer = Tokenizer.from_file(str(folder / "tokenizer.json"))
        self.tokenizer.enable_truncation(max_length=max_tokens)
        pad = self.tokenizer.token_to_id("[PAD]")
        self.tokenizer.enable_padding(pad_id=pad if pad is not None else 0, pad_token="[PAD]" if pad is not None else "<pad>")
        self.pooling = pooling
        self.dims = int(self.embed(["x"]).shape[1])

    def embed(self, texts: list[str]) -> np.ndarray:
        chunks = []
        for start in range(0, len(texts), BATCH):
            batch = self.tokenizer.encode_batch(texts[start : start + BATCH])
            ids = np.asarray([e.ids for e in batch], dtype=np.int64)
            mask = np.asarray([e.attention_mask for e in batch], dtype=np.int64)
            feeds = {"input_ids": ids, "attention_mask": mask}
            if "token_type_ids" in self.inputs:
                feeds["token_type_ids"] = np.zeros_like(ids)
            out = self.session.run(None, {k: v for k, v in feeds.items() if k in self.inputs})[0]
            if out.ndim == 3:
                if self.pooling == "cls":
                    out = out[:, 0]
                else:
                    m = mask[:, :, None].astype(np.float32)
                    out = (out * m).sum(axis=1) / np.maximum(m.sum(axis=1), 1)
            chunks.append(np.asarray(out, dtype=np.float32))
        if not chunks:
            return np.zeros((0, getattr(self, "dims", 0)), dtype=np.float32)
        return normalize(np.concatenate(chunks))


def load_embedder(spec: ModelSpec, folder: Path) -> Embedder:
    if spec.kind == "static":
        return StaticEmbedder(folder)
    return OnnxEmbedder(folder, spec.pooling, spec.max_tokens)
