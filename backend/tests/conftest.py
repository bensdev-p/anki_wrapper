from __future__ import annotations

import shutil
import sys
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from anki.collection import Collection

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND.parent / "scripts"))

import make_sample_collection  # noqa: E402
from safety import DATA_DIR  # noqa: E402

TEST_ROOT = DATA_DIR / ".pytest"


@pytest.fixture(scope="session")
def sample_template() -> Iterator[Path]:
    """Build the sample collection once per test session."""
    root = TEST_ROOT / uuid.uuid4().hex
    path = root / "template" / "collection.anki2"
    make_sample_collection.build(path)
    yield path.parent
    shutil.rmtree(root, ignore_errors=True)
    if TEST_ROOT.exists() and not any(TEST_ROOT.iterdir()):
        TEST_ROOT.rmdir()


@pytest.fixture
def col_path(sample_template: Path) -> Path:
    """A fresh copy of the sample collection for one test."""
    dest = sample_template.parent / uuid.uuid4().hex
    shutil.copytree(sample_template, dest)
    return dest / "collection.anki2"


@pytest.fixture
def col(col_path: Path) -> Iterator[Collection]:
    c = Collection(str(col_path))
    yield c
    c.close()
