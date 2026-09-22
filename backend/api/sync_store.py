"""Where this device keeps its AnkiWeb sync key.

Only the sync key (``hkey``) is stored, never the password, in
``data/synced/sync.json`` with owner-only permissions (0600). ``data/`` is
git-ignored. The key is created by ``scripts/sync_setup.py`` on the Pi itself,
so the password never travels over the home network.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path

from service.types import SyncCredentials

FILENAME = "sync.json"


@dataclass
class SyncState:
    creds: SyncCredentials
    host_number: int = 0
    last_synced_at: float | None = None


def load(folder: Path) -> SyncState | None:
    path = folder / FILENAME
    if not path.exists():
        return None
    raw = json.loads(path.read_text())
    return SyncState(
        creds=SyncCredentials(**raw["creds"]),
        host_number=raw.get("host_number", 0),
        last_synced_at=raw.get("last_synced_at"),
    )


def save(folder: Path, state: SyncState) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / FILENAME
    tmp = path.with_suffix(".tmp")
    # Create with 0600 from the start so the key is never world-readable.
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(asdict(state), f, indent=2)
    os.replace(tmp, path)


def delete(folder: Path) -> None:
    (folder / FILENAME).unlink(missing_ok=True)
