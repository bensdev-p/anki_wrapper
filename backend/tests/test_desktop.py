"""The desktop launcher's choices that protect her data."""

from __future__ import annotations

import importlib.util
import socket
import sys
from pathlib import Path

import pytest

from safety import UnsafeCollectionPath, assert_safe_path

LAUNCHER = Path(__file__).resolve().parents[2] / "desktop" / "rounds_desktop.py"


def _launcher():
    spec = importlib.util.spec_from_file_location("rounds_desktop", LAUNCHER)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


# (Windows is %APPDATA%\\Rounds; pathlib can't fake Windows paths on other systems.)
@pytest.mark.parametrize("platform", ["darwin", "linux"])
def test_data_folder_is_never_ankis(platform: str, monkeypatch: pytest.MonkeyPatch) -> None:
    rounds = _launcher()
    monkeypatch.delenv("ROUNDS_DATA_DIR", raising=False)
    monkeypatch.setattr(sys, "platform", platform)
    folder = rounds.data_dir()
    assert "anki2" not in {p.lower() for p in folder.parts}
    assert folder.name.lower() == "rounds"


def test_anki_profile_is_rejected_even_as_data_folder(tmp_path: Path) -> None:
    with pytest.raises(UnsafeCollectionPath):
        assert_safe_path(tmp_path / "Anki2" / "User 1" / "collection.anki2")


def test_port_is_reused_after_a_restart() -> None:
    rounds = _launcher()
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        assert not rounds.port_free(port)  # in use right now
    assert rounds.port_free(port)
