# Rounds

A calm, modern study app for **Anki** users, built on Anki's real engine. Your
cards, reviews and FSRS scheduling behave exactly as they do in Anki, and it
syncs with AnkiWeb, so Anki on your other devices (AnkiMobile, AnkiDroid, Anki
desktop) stays in step. Made for medical students with big decks like AnKing.

- Study, add and edit cards, browse, stats, deck options, custom study,
  filtered decks, shared-deck import, backups
- AnKing First Aid / Sketchy / Pathoma buttons work, as on AnkiMobile
- Use it on your phone over your home Wi-Fi, from the cards on your computer
- Free and open source (AGPL-3.0, like Anki). Not made by or affiliated with the Anki team.

## Get Rounds

Download the latest version from the
[**Releases page**](https://github.com/bensdev-p/anki_wrapper/releases/latest):

| Your computer | Download |
|---|---|
| Mac with Apple silicon (M1 or newer) | `Rounds-…-macOS-AppleSilicon.dmg` |
| Older Intel Mac | `Rounds-…-macOS-Intel.dmg` |
| Windows 10 or 11 | `Rounds-…-Windows-Setup.exe` |
| Linux | `Rounds-…-Linux-x86_64.tar.gz` |

Not sure which Mac? Apple menu → **About This Mac** → look at **Chip**.

**Mac:** open the `.dmg` and drag **Rounds** into **Applications**. The first time
you open it, macOS may say it can't check Rounds for malware (the app isn't
signed with a paid Apple developer account yet). Open **System Settings →
Privacy & Security**, scroll down and click **Open Anyway**. You only do this once.

**Windows:** run the installer. If SmartScreen says "Windows protected your PC",
click **More info → Run anyway**. No administrator password is needed.

**Linux:** extract the archive and double-click `Rounds` inside the folder.

### First time

1. Open Rounds and click **Sign in to AnkiWeb**. Use the same account as Anki
   on your phone or other computer. Your password goes straight to AnkiWeb and
   isn't saved.
2. Click **Download from AnkiWeb**. Your decks appear; images (First Aid,
   Sketchy…) keep downloading in the background, which can take a while for
   big decks.
3. Study. Rounds syncs when you open it, when you come back to it, and after a
   study session, like Anki.

No AnkiWeb account? Rounds works on its own too: create decks and add cards, or
**Import a deck file (.apkg)**.

### On your phone

In Rounds, open **Settings → Use on your phone** and switch it on. Scan the QR
code with your phone's camera (same Wi-Fi), and you're in. On an iPhone,
**Share → Add to Home Screen** makes it feel like an app. Keep Rounds open on
your computer while you study. If your computer asks whether Rounds may accept
incoming connections, choose **Allow**.

### Good to know

- **AnkiHub / AnKing updates:** Rounds can't run Anki add-ons. Keep Anki desktop
  for pulling AnkiHub updates now and then: update in Anki, sync, then sync
  Rounds. Everything else can happen in Rounds.
- **Note types** (adding fields or templates) are edited in Anki desktop.
  Changing them forces a one-way sync, so Rounds leaves them alone.
- **Backups:** Rounds (Anki's engine) saves a backup before every sync, every
  30 minutes of studying and when you quit. See **Settings → Backups** to back
  up now or restore one.
- **Updates:** Rounds tells you when a new version is out; download it from the
  Releases page and install it over the old one. Your cards are kept.
- **Where your data lives:** `~/Library/Application Support/Rounds` (Mac),
  `%APPDATA%\Rounds` (Windows), `~/.local/share/rounds` (Linux). Rounds never
  opens Anki desktop's own files.
- **Keyboard:** `Space` show answer, `1`–`4` answer, `⌘Z`/`Ctrl+Z` undo,
  `A` add a card, `⌘K`/`Ctrl+K` jump anywhere.

---

The rest of this page is for developers. Rounds can also run as a small home
server (e.g. on a Raspberry Pi 5), which is how it's developed and tested away
from a laptop; the steps below cover that setup.

- **Backend:** Python + FastAPI on the official headless [`anki`](https://pypi.org/project/anki/)
  package (Anki's Rust core), pinned to `anki==26.9.2`.
- **Frontend:** React + TypeScript + Vite. Works in Safari on macOS and iPhone.
- **Desktop app:** the same server in a native window (pywebview), packaged
  with PyInstaller (`desktop/`).
- **License:** AGPL-3.0, the same license as `anki`.

## Features

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

- Decks: create, rename or move (`Parent::Child`), delete (with Undo), and a
  ⋯ menu on each deck. Deck options with Anki's presets, daily limits, steps,
  display order, FSRS and burying.
- Add cards (`A`): note type, deck, tags; paste or drop images; `⌘⇧C` for cloze.
- Custom study (Anki's six options), filtered decks (also from any browser
  search: "Study these"), and importing shared decks (`.apkg`).
- Settings: AnkiWeb account, use on your phone, import, backups, updates.

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

## Statistics

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

Your data matters more than any feature:

- Rounds opens only its own collection: the desktop app's data folder, or the
  repo's `data/` folder on the Pi. It **refuses Anki profile folders** (`Anki2`,
  `AnkiDroid`), so it never touches Anki desktop's files.
- Only the sync key is stored (never the password), readable by your user only.
- Nothing forces a one-way sync behind your back: note types are never changed,
  deck-option presets are never deleted, imports never modify note types. When
  Anki does need a one-way sync, you choose the direction (the Pi can only
  download).
- Anki's own backups before every sync and regularly while you study.
- Phones on the home network must pair with a code; requests from other
  websites are refused.
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
git clone <this repo> rounds && cd rounds

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

### Run it permanently (server setup)

```bash
./scripts/install_pi.sh             # the synced collection (after sync_setup.py)
./scripts/install_pi.sh --sample    # or the sample collection, to try it out
```

This builds the app and installs a `rounds` systemd service that starts at boot,
restarts if it crashes, and serves everything on port **8000**:

```
http://<pi-hostname>.local:8000
```

- Update: `git pull && ./scripts/install_pi.sh`
- Logs: `journalctl -u rounds -f`
- Stop / start: `sudo systemctl stop rounds` / `sudo systemctl start rounds`

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

## Syncing with AnkiWeb (server setup)

A Rounds server (e.g. a development Pi) can join an AnkiWeb account as **one
more Anki device**. It keeps its own collection in `data/synced/` and syncs
reviews both ways through AnkiWeb, just like Anki desktop. For development, use
a test account or Anki's local sync server rather than a real study collection.

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

## Desktop app (development and releases)

```bash
.venv/bin/pip install -r desktop/requirements.txt
./scripts/desktop.sh                       # native window, real app data folder
ROUNDS_DATA_DIR=data/.desk ./scripts/desktop.sh --browser   # throwaway folder, in the browser
(cd frontend && npm run build) && .venv/bin/pyinstaller desktop/rounds.spec   # build the app
```

The launcher (`desktop/rounds_desktop.py`) runs the same server on
`127.0.0.1` with `ROUNDS_DESKTOP=1` and the app's own data folder, and shows it
in a native window. In the desktop app, and only there:

- sign-in to AnkiWeb happens in the app (only from the computer itself);
- when Anki needs a one-way sync, "Upload this computer's copy" is offered
  (with a confirmation and a backup); the Pi still never uploads;
- **Use on your phone** starts a second listener on the home network; phones
  pair with a 6-digit code;
- backups can be restored.

To test sync without AnkiWeb, run Anki's local sync server and point Rounds at
it: `SYNC_USER1=test:pass python -m anki.syncserver` and
`ROUNDS_SYNC_ENDPOINT=http://127.0.0.1:8080/`.

**Releasing:** set the version in `backend/version.py`, commit, then tag and
push (`git tag v0.2.0 && git push origin v0.2.0`). The **Desktop app**
workflow builds the Mac, Windows and Linux downloads and creates a draft
release; check it and press **Publish**. (Actions → Desktop app → Run workflow
builds without releasing.) Signing and notarizing the Mac app needs an Apple
Developer account; until then users see the "Open Anyway" step above.

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
