# CLAUDE.md

A modern study client on Anki's real engine (`anki` PyPI package). The user
studies medicine with a 100k+ card AnKing collection. **Her data matters more
than any feature.**

## Hard safety rules

- **Never open or modify a real user collection.** Collections are opened only
  through `backend/safety.py` (`resolve_collection_path` / `assert_safe_path`),
  which allows paths inside `data/` and rejects Anki profile folders
  (`Anki2`, `AnkiDroid`). Don't bypass or loosen this guard.
- Her real cards reach the app either as an AnkiWeb-synced device collection
  (`data/synced/`, see below) or as a **copy** of a `.colpkg` export
  (`scripts/import_colpkg.py` → `data/demo/`; the `.colpkg` is only read).
- **AnkiWeb sync is allowed only as below** (added at the user's request; she
  syncs a MacBook and an iMac through AnkiWeb, and this device joins them):
  - Only `data/synced/collection.anki2` may sync (`safety.is_sync_collection`).
    The sample and demo copies never sync.
  - **Never full-upload.** `service/sync.py` has no upload path, and a test
    enforces that. When Anki needs a one-way sync, the only option is
    downloading AnkiWeb's copy to this device. Uploading is left to Anki desktop.
  - Back up (Anki's `create_backup`) before every sync, and force a backup
    before a full download.
  - Store only the sync key (`hkey`), in `data/synced/sync.json` with 0600
    permissions. Never store a password. Sign-in happens on the Pi via
    `scripts/sync_setup.py`, so the password never crosses the network.
  - Develop and test against Anki's local sync server
    (`python -m anki.syncserver`), never real AnkiWeb.
  - No operation may call `col.mod_schema()` or change note types. A schema
    change forces a one-way sync, which would discard this device's unsynced
    reviews.
- Never commit anything under `data/`, or any `.anki2`, `.colpkg` or `.apkg` file.
- Tests and experiments use their own collections under `data/` (e.g.
  `data/.pytest/`), never `data/dev` or `data/demo` in place.

## Architecture rules

- `backend/service/`: pure functions taking an `anki.collection.Collection`.
  **No FastAPI or pydantic imports.** Returns dataclasses from `service/types.py`.
  It must stay reusable inside an Anki desktop add-on (`mw.col`).
- `backend/api/`: thin FastAPI layer. All collection access goes through
  `CollectionHost.run()`, which runs on one dedicated thread (Collection isn't
  thread-safe). Run uvicorn with **one worker only**.
- Use Anki's own APIs, never a reimplementation: v3 scheduler
  (`sched.get_queued_cards`, `describe_next_states`, `answer_card`),
  `sched.deck_due_tree`, `card.render_output`, `col.undo`. Before using an Anki
  method, check its source in `.venv/lib/python3*/site-packages/anki/`. For
  desktop behavior, check `aqt` (e.g. `pip download aqt==<same version> --no-deps`).
- Performance: never load all cards or notes into Python. Use Anki's counts and
  queries (`find_cards` returns ids only). Target: instant deck list and next card
  at 100k cards on a Pi 5 (`scripts/benchmark.py`).
- Frontend talks only to the `AnkiBackend` interface
  (`frontend/src/backend/AnkiBackend.ts`). Wire types in `backend/types.ts`
  mirror `service/types.py` (snake_case). Update both together.
- Card HTML renders only inside `CardFrame` (sandboxed iframe, `allow-scripts`,
  no `allow-same-origin`, CSP `connect-src 'none'`). The iframe runtime mirrors
  Anki's reviewer (persistent document, scripts re-run, `onUpdateHook`/`onShownHook`,
  `nightMode night_mode` classes in dark themes). Keep it compatible with deck JS.

## Frontend conventions

- Colors come only from theme tokens (`var(--token)`) in `src/themes/themes.ts`.
  Every theme defines every token. Spacing, type and motion tokens are in
  `src/styles/base.css`. No hard-coded colors in components (the card iframe's
  Anki compatibility CSS is the exception).
- Chart colors are theme tokens too (`chart-1`, `mat-1..4`, `heat-0..4`,
  `chart-other`, `chart-grid`, `chart-axis`). They were checked with the dataviz
  palette validator against each theme's surface. Card maturity is ordinal, so it
  uses one hue from light to dark, flipped in dark themes. Re-validate if you change
  a surface or add a theme. Every chart needs a table view and keyboard-reachable
  tooltips, and never a dual y-axis.
- Keep layout shift at zero: fixed-height footers, skeletons with final dimensions.
- Motion: subtle and quick (120–320 ms), and respect `prefers-reduced-motion`.
- Must work in Safari on macOS and iOS: `100dvh`, safe-area insets, inputs
  ≥ 16px on phones, no hover-only affordances.

## Commands

```bash
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
(cd frontend && npm ci)
.venv/bin/python scripts/make_sample_collection.py [--force]
./scripts/dev.sh [--synced]                   # API :8000 (localhost) + Vite :5173 (LAN)
.venv/bin/python scripts/sync_setup.py        # sign this device in to AnkiWeb (on the Pi)
./scripts/install_pi.sh [--demo|--sample]     # systemd service on the Pi, port 8000
.venv/bin/pytest                              # backend tests
(cd frontend && npx tsc -b && npm run lint)   # frontend checks
.venv/bin/python scripts/benchmark.py         # 100k-card timings
```

## Working agreements

- Commit at each working step.
- Ask before architectural decisions not covered here or in README.md.
- Pin Python dependencies exactly in `backend/requirements.txt`.
- License is AGPL-3.0 (same as `anki`). Keep new dependencies compatible.
