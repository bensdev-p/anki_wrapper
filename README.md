# Lacuna

A modern study client that runs on **Anki's real engine**. Your cards, review
history and FSRS scheduling behave exactly as they do in Anki desktop.
The goal is Quizlet-level polish with Anki-level power.

> Working name. It's set in one place: `frontend/src/components/Logo.tsx`.

- **Backend:** Python + FastAPI on the official headless [`anki`](https://pypi.org/project/anki/)
  package (Anki's Rust core), pinned to `anki==26.9.2`.
- **Frontend:** React + TypeScript + Vite. Works in Safari on macOS and iPhone.
- **License:** AGPL-3.0, the same license as `anki`.

## Milestone 1 features

- Deck list: nested tree with New / Learn / Due counts from Anki's scheduler. Collapse
  and filter it (press `/`), and click a deck to study.
- Review screen: Anki's v3 scheduler flow, with the scheduler's real next intervals on
  the four buttons. `Space` flips, `1`–`4` answer, `⌘Z`/`Ctrl+Z` undoes. Tap the card
  to flip on the phone. Includes a progress bar, session stats and a summary screen.
- Card rendering: card HTML and the note type's CSS load in a sandboxed iframe, so
  deck JavaScript (hint buttons etc.) runs. Media is served from the collection's media
  folder, and dark themes apply Anki's `nightMode night_mode` body classes.
- Themes: Light, Dark, Parchment (warm sepia), Dusk (warm dark) and High Contrast.
  The default follows the system light/dark setting, and your choice is remembered.
- Command palette: `⌘K` / `Ctrl+K` to jump to a deck, switch theme or start studying.

## Milestone 2: statistics

- **Stats** tab (or `⌘K` → "Open statistics"), filtered by deck and period (1 month /
  3 months / 1 year). One filter row scopes everything below it.
- Tiles: studied today, streak, true retention (young/mature), due tomorrow, and FSRS
  "recall right now" (average retrievability).
- Charts: a review-activity calendar heatmap, reviews per day stacked by maturity,
  upcoming reviews and card maturity. Each chart has hover/keyboard tooltips and a
  table view.
- All numbers come from Anki's own stats engine (the `graphs` backend call that
  Anki desktop's Statistics screen uses). Results are cached until the collection
  changes.

## Safety first

Her real collection is never opened or modified by this project:

- The backend opens only `$COLLECTION_PATH`, which defaults to the synthetic
  dev collection. It **refuses any path outside `data/`**, and any path inside an Anki
  profile folder (`Anki2`, `AnkiDroid`).
- To use her real cards, export a `.colpkg` from Anki and import it as a **copy** (see
  below). The export file is only read.
- No AnkiWeb sync and no credentials, anywhere.
- `data/` is git-ignored, so collections are never committed.

## Setup on the Raspberry Pi 5

Target: 64-bit Raspberry Pi OS (Bookworm or newer). You need glibc ≥ 2.35
(Bookworm ships 2.36), Python ≥ 3.10 and Node ≥ 20.19 (an LTS release).

```bash
# 1. Check the platform
uname -m                 # aarch64
ldd --version | head -1  # glibc 2.36 or newer
python3 --version        # 3.10+

# 2. System packages (Debian's own nodejs is too old for Vite; use NodeSource LTS)
sudo apt update
sudo apt install -y python3-venv git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version           # v22.x

# 3. Get the code
git clone <this repo> lacuna && cd lacuna

# 4. Backend
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt

# 5. Frontend
(cd frontend && npm ci)

# 6. Build the sample collection (data/dev/)
.venv/bin/python scripts/make_sample_collection.py
```

## Run it

```bash
./scripts/dev.sh
```

This starts the API on `127.0.0.1:8000` and the Vite dev server on port `5173`
(bound to the LAN). Then open, from the Mac or iPhone on the same Wi-Fi:

```
http://<pi-hostname>.local:5173      e.g. http://raspberrypi.local:5173
```

(or `http://<pi-ip>:5173`; `hostname -I` on the Pi prints the IP).

To run them separately:

```bash
./scripts/run_backend.sh                   # API, localhost only
cd frontend && npm run dev                 # UI on the LAN (vite --host via config)
```

Vite proxies `/api` to the backend, so the phone only ever talks to port 5173.

### Faster on the phone: built frontend

The dev server is fine for development. For a snappier demo, build once and let
the API serve the UI:

```bash
(cd frontend && npm run build)
HOST=0.0.0.0 ./scripts/run_backend.sh      # UI + API on http://<pi>.local:8000
```

### Add to Home Screen (iPhone)

In Safari, tap **Share → Add to Home Screen** to get a full-screen app icon.

## The sample collection

`scripts/make_sample_collection.py` builds `data/dev/collection.anki2` with:

- nested decks (`Step 1::Cardio::Pharm`, `Step 1::Renal::Physiology`, `Step 2 CK::Pediatrics`, …)
- stock **Basic** notes and a custom **cloze** note type ("Med Cloze (sample)")
  with its own CSS, night-mode rules and hint-button JavaScript
- media: SVG figures (ECG strip, nephron, gram stain) and a WAV heart-sound clip
- **FSRS** enabled, plus simulated review history, so today's **new, learning and
  review counts are all non-zero**

Rebuild it at any time (e.g. after studying through it):

```bash
.venv/bin/python scripts/make_sample_collection.py --force
```

## Using a copy of her collection

1. In **Anki desktop**: *File → Export…* → format **Anki Collection Package
   (.colpkg)**, tick **Include media** → Export. This doesn't change her collection.
2. Copy the `.colpkg` to the Pi (AirDrop to the Mac, then `scp`).
3. Import it into `data/demo/`:

   ```bash
   .venv/bin/python scripts/import_colpkg.py ~/collection-2026-09-22.colpkg
   ```

4. Run against the copy:

   ```bash
   COLLECTION_PATH=data/demo/collection.anki2 ./scripts/dev.sh
   ```

Reviews done in the demo only change the copy. Re-importing replaces the copy
(`--force`).

> AnkiHub/AnKing note: this only reads the exported collection. AnkiHub add-on
> features that need the add-on itself (note updates, sync) aren't involved.

## Tests and checks

```bash
.venv/bin/pytest                            # service, API, safety and import tests
.venv/bin/python scripts/benchmark.py       # timings on a synthetic 100k-card collection
(cd frontend && npm run build && npm run lint)
```

The tests build a fresh sample collection under `data/.pytest/` and check:
answering a card changes its due date, undo reverts it exactly, the counts update,
stale answers are rejected, and rendering handles audio, CSS and scripts.

Benchmark on the dev container (x86_64), 100k cards / 250k reviews: deck tree ≈ 24 ms,
answer + next card ≈ 1.5 ms, undo ≈ 1 ms, stats ≈ 0.27 s (3 months) / 0.57 s (1 year).
Run it on the Pi for real numbers.

## Architecture

```
backend/
  service/        pure functions over anki.collection.Collection (no FastAPI)
    decks.py      deck tree with counts (sched.deck_due_tree)
    review.py     v3 flow: get_queued_cards → describe_next_states → answer_card; undo
    render.py     render_output + media escaping + play buttons (as aqt does)
    search.py     Anki search syntax → light previews
    stats.py      Anki's graphs engine → dashboard data
  api/
    host.py       owns the single open Collection; all access on one thread
    main.py       thin FastAPI routes + /api/media + optional built UI
  safety.py       where collections may live (data/ only)
  tests/
frontend/src/
  backend/        AnkiBackend interface + HttpBackend (swappable, e.g. add-on bridge)
  components/card CardFrame + iframe runtime (Anki reviewer semantics)
  themes/         token-based themes + provider
  components/charts  SVG charts (columns, heatmap, maturity bar) on theme tokens
  screens/        DeckList, Study, Stats
scripts/          sample collection, .colpkg import, run scripts, benchmark
```

The service module never imports FastAPI, so it can be reused unchanged in an
Anki desktop add-on with `mw.col`. The frontend only talks to the `AnkiBackend`
interface, so an add-on bridge would be a second implementation of it.

**Concurrency:** Anki's `Collection` isn't thread-safe. The API runs one uvicorn
worker, and every collection call goes through a single dedicated thread, which
serializes them. Media files are served without touching the collection.

**Card isolation:** cards render in `<iframe sandbox="allow-scripts">` with a CSP
that blocks network access. Deck JavaScript runs, but it can't reach the app, its
storage or the API. Audio plays from the parent page, because that's where the
user's tap happened, which Safari's autoplay rules require.
