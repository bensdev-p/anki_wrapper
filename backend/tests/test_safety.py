from pathlib import Path

import pytest

from safety import DATA_DIR, UnsafeCollectionPath, assert_safe_path, resolve_collection_path


@pytest.mark.parametrize(
    "path",
    [
        Path.home() / ".local/share/Anki2/User 1/collection.anki2",
        Path.home() / "Library/Application Support/Anki2/User 1/collection.anki2",
        DATA_DIR / "Anki2" / "collection.anki2",
        Path("/tmp/collection.anki2"),
        DATA_DIR / ".." / "collection.anki2",
    ],
)
def test_rejects_unsafe_paths(path: Path) -> None:
    with pytest.raises(UnsafeCollectionPath):
        assert_safe_path(path)


def test_accepts_data_dir() -> None:
    assert assert_safe_path(DATA_DIR / "demo" / "collection.anki2")


def test_env_var_is_checked(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("COLLECTION_PATH", str(Path.home() / ".local/share/Anki2/User 1/collection.anki2"))
    with pytest.raises(UnsafeCollectionPath):
        resolve_collection_path()
