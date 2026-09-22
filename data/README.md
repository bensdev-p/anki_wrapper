# data/

All collections live here and are **never committed** (see `.gitignore`).

- `dev/`  — synthetic sample collection built by `scripts/make_sample_collection.py`
- `demo/` — a *copy* imported from a `.colpkg` export by `scripts/import_colpkg.py`

The backend refuses to open a collection outside this directory.
