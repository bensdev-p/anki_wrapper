from __future__ import annotations

import os
from pathlib import Path

from anki.collection import Collection

import import_colpkg


def test_colpkg_round_trip(col_path: Path) -> None:
    """Export the sample collection, import it as a demo copy, compare."""
    col = Collection(str(col_path))
    cards, notes = col.card_count(), col.note_count()
    colpkg = col_path.parent.parent / (col_path.parent.name + ".colpkg")
    col.export_collection_package(str(colpkg), include_media=True, legacy=False)
    col.close()
    pkg_mtime = os.stat(colpkg).st_mtime_ns

    dest = col_path.parent.parent / (col_path.parent.name + "-demo")
    imported = import_colpkg.import_colpkg(colpkg, dest)

    demo = Collection(str(imported))
    try:
        assert (demo.card_count(), demo.note_count()) == (cards, notes)
        assert (Path(demo.media.dir()) / "ecg_afib.svg").exists()
    finally:
        demo.close()
    assert os.stat(colpkg).st_mtime_ns == pkg_mtime  # source left untouched
