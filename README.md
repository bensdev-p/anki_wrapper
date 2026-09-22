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
- AnKing resources: First Aid, Sketchy, Pathoma and other hint buttons open as they do
  in AnkiMobile. The iframe acts like AnkiMobile (`html.mobile`), so the tag-based
  "First Aid Links" / "Boards and Beyond Links" buttons show too. Links open in a new
  tab. Deck scripts get working `sessionStorage`/`localStorage` shims (for
  anki-persistence), and `pycmd("ans")` / `pycmd("ease3")` work. When a resource
  image isn't on this device yet, a notice says so (usually because media is still
  syncing).
- Themes: Light, Dark, Parchment (warm sepia), Dusk (warm dark) and High Contrast.
  The default follows the system light/dark setting, and your choice is remembered.
- Command palette: `⌘K` / `Ctrl+K` to jump to a deck, switch theme or start studying.

## Review tools (Anki's reviewer shortcuts)

| Action | Key | Notes |
|---|---|---|
| Flag red … purple | `Ctrl+1` … `Ctrl+7` | Same flag again clears it |
| Mark / unmark note | `*` | Adds or removes the `marked` tag |
| Edit note | `E` | Sandboxed rich editor with an HTML source toggle per field |
| Card info | `I` | Dates, intervals, FSRS stability, difficulty and retrievability, full history |
| Replay audio | `R` | |
| Bury card / note | `-` / `=` | |
| Suspend card / note | `@` / `!` | |
| Undo | `⌘Z` / `Ctrl+Z` | Covers all of the above, plus answers |

Everything is also in the **⋯** menu, for the phone. Type-in-the-answer cards
(`[[type:Field]]`, including cloze) are graded with Anki's own comparison.

The note editor saves only the fields she changed, never touches note types
(which would force a one-way sync), and refuses edits that would blank a card
(an empty first field, or removing a cloze a card depends on).

## Card browser

**Browse** tab (or `⌘K` → "Browse cards"):
- Search with Anki's own syntax (`tag:#AK_Step1_v12::#B&B`, `prop:ivl>30`,
  `deck:"Step 1::Cardio" is:due`…), plus quick filters (Due, New, Learning,
  Suspended, Flagged, Marked, Leeches) and a deck picker.
- Sort by clicking a column (card, deck, due, interval, difficulty/ease, reviews,
  lapses). Anki does the sorting, exactly as in the desktop browser.
- Scrolling stays smooth at 100k results: only the visible rows are drawn and
  fetched. At 100k cards, search + sort ≈ 45 ms and a page of rows ≈ 3 ms (x86).
- Select with click, ⌘/Ctrl-click and Shift-click, or **Select all** (`⌘A`). Bulk
  actions: suspend, unsuspend, flag, add/remove tags, set due date. Changes to
  more than 50 cards ask first, and everything can be undone with `⌘Z`.
- A preview pane shows the card with its note type's styling, with Edit and Info.
- On the phone: a list with a **Select** mode, and tap to preview.

Her saved desktop browser column setup is never changed: it syncs, so changing it
would rearrange the browser on her Mac.

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

### Run it permanently (recommended on the Pi)

```bash
./scripts/install_pi.sh             # her synced collection (after sync_setup.py)
./scripts/install_pi.sh --sample    # or the sample collection, to try it out
```

This builds the app and installs a `lacuna` systemd service that starts at boot,
restarts if it crashes, and serves everything on port **8000**:

```
http://<pi-hostname>.local:8000
```

- Update: `git pull && ./scripts/install_pi.sh`
- Logs: `journalctl -u lacuna -f`
- Stop / start: `sudo systemctl stop lacuna` / `sudo systemctl start lacuna`

The service backs up the collection every 30 minutes of use and when it stops,
using Anki's own backups (kept in `backups/` next to the collection, rotated by
Anki's backup settings).

### Add to Home Screen (iPhone)

In Safari, open the address above, then tap **Share → Add to Home Screen**. It
opens full-screen with its own icon, like an app. If the Pi drops off the Wi-Fi,
the app shows "Reconnecting…", and an answer she taps meanwhile is sent once
the Pi is back. It's never counted twice, because the server rejects a duplicate.

> Offline caching (a service worker) needs HTTPS, which a plain home-network
> address doesn't have. The app needs the Pi to study anyway, since that's
> where Anki runs.

## The sample collection

`scripts/make_sample_collection.py` builds `data/dev/collection.anki2` with:

- nested decks (`Step 1::Cardio::Pharm`, `Step 1::Renal::Physiology`, `Step 2 CK::Pediatrics`, …)
- stock **Basic** notes and a custom **cloze** note type ("Med Cloze (sample)")
  with its own CSS, night-mode rules and hint-button JavaScript, including
  First Aid / Sketchy resource fields on the Cardio Pharm and Bacteria cards
- media: SVG figures (ECG strip, nephron, gram stain, stand-in FA/Sketchy pages) and
  a WAV heart-sound clip
- **FSRS** enabled, plus simulated review history, so today's **new, learning and
  review counts are all non-zero**

Rebuild it at any time (e.g. after studying through it):

```bash
.venv/bin/python scripts/make_sample_collection.py --force
```

## Syncing with AnkiWeb (her real collection)

The Pi can join her MacBook and iMac as **one more Anki device**. It keeps its own
collection in `data/synced/` and syncs reviews both ways through AnkiWeb, just
like Anki desktop.

One-time setup, **on the Pi** (stop the app first):

```bash
.venv/bin/python scripts/sync_setup.py
```

It asks for her AnkiWeb email and password, downloads the collection (a few
minutes for a big AnKing collection) and then the media. Then run:

```bash
./scripts/dev.sh --synced
```

The app then syncs when it opens, after each study session, when she comes back
to it after 10+ minutes, and whenever she taps **Sync**.

**Safety design**
- The password is typed on the Pi and never stored. Only AnkiWeb's sync key is
  kept, in `data/synced/sync.json` (owner-only permissions). Changing her
  AnkiWeb password revokes it, and `sync_setup.py --logout` forgets it.
- **This app never uploads a whole collection to AnkiWeb**, so it can't
  overwrite her cards. If Anki reports changes it can't merge (e.g. a note type
  edited on the Mac without syncing), the only option offered is replacing
  *this device's* copy with AnkiWeb's. AnkiWeb and her other devices are never
  replaced.
- A backup (`data/synced/backups/`, Anki's own `.colpkg` format) is taken before
  syncing, and always before a download.
- Only `data/synced/` can sync. The sample and imported demo copies never do.

As with any Anki device, she should sync the Mac or iMac before and after
studying there, which she already does.

## Using a copy of her collection (no sync)

1. In **Anki desktop**: *File → Export…* → format **Anki Collection Package
   (.colpkg)**, tick **Include media** → Export. This doesn't change her collection.
2. Copy the `.colpkg` to the Pi (AirDrop to the Mac, then `scp`).
3. Import it into `data/demo/` (re-importing with `--force` keeps the previous
   copy as `data/demo-previous-<date>` until you delete it):

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
that blocks network access (the one exception is `connect-src https://en.wikipedia.org`,
used by the AnKing word-lookup popups). Deck JavaScript runs, but it can't reach the app, its
storage or the API. Audio plays from the parent page, because that's where the
user's tap happened, which Safari's autoplay rules require.
