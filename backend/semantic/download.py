"""Downloading a model's files, each checked against its pinned SHA-256."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
from collections.abc import Callable
from pathlib import Path

from .models import ModelSpec

CHUNK = 1024 * 1024
MARKER = "verified.json"


class DownloadCancelled(Exception):
    pass


def model_folder(models_dir: Path, spec: ModelSpec) -> Path:
    return models_dir / spec.id


def is_downloaded(models_dir: Path, spec: ModelSpec) -> bool:
    """All files present, with the sizes they had when their checksums were verified."""
    folder = model_folder(models_dir, spec)
    try:
        verified = json.loads((folder / MARKER).read_text())
    except (OSError, ValueError):
        return False
    for f in spec.files:
        path = folder / f.name
        if verified.get(f.name) != f.sha256 or not path.is_file() or path.stat().st_size != f.size:
            return False
    return True


def download(
    models_dir: Path,
    spec: ModelSpec,
    on_progress: Callable[[int, int], None] | None = None,
    cancelled: Callable[[], bool] | None = None,
    fetch: Callable[[str], object] | None = None,
) -> Path:
    """Fetch every file of `spec` into <models_dir>/<id>/; raises on a checksum mismatch.

    `fetch(url)` returns a response with `iter_content(n)` and `raise_for_status()`
    (requests); tests pass their own.
    """
    folder = model_folder(models_dir, spec)
    if is_downloaded(models_dir, spec):
        return folder
    folder.mkdir(parents=True, exist_ok=True)
    total = spec.size
    done = 0
    verified: dict[str, str] = {}
    for f in spec.files:
        if not f.url.startswith("https://"):
            raise ValueError(f"refusing a non-https download: {f.url}")
        target = folder / f.name
        if target.is_file() and target.stat().st_size == f.size and _sha256(target) == f.sha256:
            done += f.size
            verified[f.name] = f.sha256
            continue
        part = target.with_name(target.name + ".part")
        digest = hashlib.sha256()
        response = (fetch or _fetch)(f.url)
        response.raise_for_status()  # type: ignore[attr-defined]
        with open(part, "wb") as out:
            for chunk in response.iter_content(CHUNK):  # type: ignore[attr-defined]
                if cancelled and cancelled():
                    out.close()
                    part.unlink(missing_ok=True)
                    raise DownloadCancelled()
                out.write(chunk)
                digest.update(chunk)
                done += len(chunk)
                if on_progress:
                    on_progress(min(done, total), total)
        if digest.hexdigest() != f.sha256 or part.stat().st_size != f.size:
            part.unlink(missing_ok=True)
            raise ValueError(f"{f.name} didn't match its expected checksum; not using it.")
        os.replace(part, target)
        verified[f.name] = f.sha256
    (folder / MARKER).write_text(json.dumps(verified, indent=2))
    return folder


def remove(models_dir: Path, spec: ModelSpec) -> None:
    shutil.rmtree(model_folder(models_dir, spec), ignore_errors=True)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _fetch(url: str) -> object:
    import requests  # comes with the anki package; uses the system proxy settings and certifi

    return requests.get(url, stream=True, timeout=30, headers={"User-Agent": "Rounds"})
