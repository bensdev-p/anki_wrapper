#!/usr/bin/env python3
"""Import a .colpkg export into data/demo/ so the app runs on a *copy*.

How to get the .colpkg (in Anki desktop): File → Export… → "Anki Collection
Package (.colpkg)", tick "Include media". Anki doesn't modify the live
collection when exporting. Copy the file to the Pi, then:

  python scripts/import_colpkg.py ~/Downloads/collection.colpkg
  COLLECTION_PATH=data/demo/collection.anki2 <start the backend>

The .colpkg is only read. The destination must be inside data/, and an
existing demo collection is replaced only with --force.
"""

from __future__ import annotations

import argparse
import shutil
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from anki._backend import RustBackend  # noqa: E402
from anki.collection import Collection  # noqa: E402

from safety import DEMO_DIR, assert_safe_path  # noqa: E402


def import_colpkg(colpkg: Path, dest_dir: Path) -> Path:
    """Unpack `colpkg` into a fresh `dest_dir`. Returns the collection path."""
    dest_dir = assert_safe_path(dest_dir)
    if dest_dir.exists():
        raise FileExistsError(dest_dir)
    col_path = dest_dir / "collection.anki2"

    # Work on a private copy of the package so the original file is never
    # touched, and unpack into a staging folder that's renamed only on success.
    with tempfile.TemporaryDirectory(dir=dest_dir.parent) as tmp:
        tmp_path = Path(tmp)
        pkg_copy = tmp_path / "import.colpkg"
        shutil.copyfile(colpkg, pkg_copy)
        staging = tmp_path / "staging"
        staging.mkdir()
        # Same backend call Anki desktop uses for File → Import of a .colpkg
        # (aqt.import_export.importing.import_collection_package_op).
        RustBackend().import_collection_package(
            col_path=str(staging / "collection.anki2"),
            backup_path=str(pkg_copy),
            media_folder=str(staging / "collection.media"),
            media_db=str(staging / "collection.media.db2"),
        )
        staging.rename(dest_dir)
    return col_path


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("colpkg", type=Path, help="path to a .colpkg export")
    ap.add_argument("--dest", type=Path, default=DEMO_DIR, help="destination folder inside data/ (default: data/demo)")
    ap.add_argument("--force", action="store_true", help="replace an existing demo collection")
    args = ap.parse_args()

    colpkg = args.colpkg.expanduser().resolve()
    if not colpkg.is_file():
        sys.exit(f"{colpkg} not found")
    if colpkg.suffix != ".colpkg":
        sys.exit("expected a .colpkg file (File → Export → Anki Collection Package)")
    dest = assert_safe_path(args.dest if args.dest.is_absolute() else Path.cwd() / args.dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        if not args.force:
            sys.exit(f"{dest} already exists; pass --force to replace it.")
        # Keep the old copy (it may hold reviews done in the app) until the new one is in place.
        kept = dest.with_name(f"{dest.name}-previous-{time.strftime('%Y%m%d-%H%M%S')}")
        dest.rename(kept)
        print(f"Moved the old copy to {kept} (delete it once you're happy).")

    print(f"Importing {colpkg} → {dest} (this can take a minute for large collections)…")
    col_path = import_colpkg(colpkg, dest)
    col = Collection(str(col_path))
    try:
        media = sum(1 for _ in Path(col.media.dir()).iterdir())
        print(f"Done: {col.card_count()} cards, {col.note_count()} notes, {media} media files.")
    finally:
        col.close()
    print("\nStart the backend on this copy with:")
    print(f"  COLLECTION_PATH={col_path} ./scripts/run_backend.sh")


if __name__ == "__main__":
    main()
