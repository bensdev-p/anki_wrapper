#!/usr/bin/env python3
"""Build a realistic, synthetic dev collection at data/dev/collection.anki2.

Contents:
  * nested decks ("Step 1::Cardio::Pharm", ...)
  * stock Basic notes and a custom cloze notetype with its own CSS, night-mode
    rules and hint-button JavaScript
  * SVG images and a WAV clip in the media folder
  * FSRS enabled, and simulated review history so the new, learning and
    review counts are all non-zero today

Usage:
  python scripts/make_sample_collection.py            # refuses to overwrite
  python scripts/make_sample_collection.py --force    # rebuild from scratch
"""

from __future__ import annotations

import argparse
import io
import math
import random
import shutil
import struct
import sys
import time
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from anki.collection import Collection  # noqa: E402
from anki.consts import MODEL_CLOZE  # noqa: E402

import sample_content as content  # noqa: E402
from safety import DEV_COLLECTION, assert_safe_path  # noqa: E402

MED_CLOZE = "Med Cloze (sample)"


def build(path: Path, seed: int = 7) -> None:
    """Create a fresh sample collection at `path` (its folder must not exist)."""
    path = assert_safe_path(path)
    path.parent.mkdir(parents=True)
    rng = random.Random(seed)
    col = Collection(str(path))
    try:
        col.set_config("fsrs", True)
        _write_media(col)
        _style_basic(col)
        med_cloze = _add_med_cloze_notetype(col)
        _add_notes(col, med_cloze)
        _simulate_history(col, rng)
        col.decks.set_current(col.decks.id_for_name("Step 1"))  # type: ignore[arg-type]
    finally:
        col.close()


# Media
##########################################################################


def _write_media(col: Collection) -> None:
    for name, data in {
        "ecg_afib.svg": _ecg_svg().encode(),
        "nephron.svg": NEPHRON_SVG.encode(),
        "gram_stain_clusters.svg": _gram_stain_svg().encode(),
        "heart_diagram.svg": HEART_SVG.encode(),
        "s3_gallop.wav": _gallop_wav(),
    }.items():
        col.media.write_data(name, data)


def _ecg_svg() -> str:
    rng = random.Random(3)
    pts, x = [], 0.0
    while x < 600:
        # fibrillatory baseline between irregular QRS complexes
        gap = rng.uniform(45, 110)
        end = x + gap
        while x < end:
            pts.append((x, 60 + 3 * math.sin(x * 0.9) + rng.uniform(-2, 2)))
            x += 3
        pts += [(x, 64), (x + 3, 20), (x + 6, 82), (x + 9, 60)]
        x += 12
    path = " ".join(f"{px:.1f},{py:.1f}" for px, py in pts)
    grid = "".join(
        f'<line x1="{i}" y1="0" x2="{i}" y2="120" stroke="#f3c4c4" stroke-width="{1 if i % 50 else 1.6}"/>'
        for i in range(0, 601, 10)
    ) + "".join(
        f'<line x1="0" y1="{j}" x2="600" y2="{j}" stroke="#f3c4c4" stroke-width="{1 if j % 50 else 1.6}"/>'
        for j in range(0, 121, 10)
    )
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 120" width="600" height="120">'
        f'<rect width="600" height="120" fill="#fff7f7"/>{grid}'
        f'<polyline points="{path}" fill="none" stroke="#222" stroke-width="1.8" stroke-linejoin="round"/>'
        "</svg>"
    )


def _gram_stain_svg() -> str:
    rng = random.Random(5)
    cells = []
    for _ in range(9):
        cx, cy = rng.uniform(40, 360), rng.uniform(40, 220)
        for _ in range(rng.randint(6, 14)):
            r = rng.uniform(0, 26)
            a = rng.uniform(0, 2 * math.pi)
            cells.append(
                f'<circle cx="{cx + r * math.cos(a):.1f}" cy="{cy + r * math.sin(a):.1f}" r="7" '
                'fill="#5b2a86" fill-opacity=".85" stroke="#3b1760" stroke-width="1"/>'
            )
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260" width="400" height="260">'
        '<defs><radialGradient id="f"><stop offset="0" stop-color="#fdf2f8"/>'
        '<stop offset="1" stop-color="#f5d0e0"/></radialGradient></defs>'
        '<circle cx="200" cy="130" r="128" fill="url(#f)"/>' + "".join(cells) + "</svg>"
    )


NEPHRON_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 260" width="420" height="260" font-family="Helvetica, Arial, sans-serif" font-size="12">
<rect width="420" height="260" fill="#f7fafc"/>
<circle cx="60" cy="60" r="30" fill="#fde68a" stroke="#b45309" stroke-width="2"/>
<text x="60" y="108" text-anchor="middle" fill="#334155">Glomerulus</text>
<path d="M90 60 C 140 40, 160 90, 200 60 S 240 40, 250 80" fill="none" stroke="#2563eb" stroke-width="10" stroke-linecap="round"/>
<text x="170" y="30" text-anchor="middle" fill="#1e3a8a">PCT (~65% Na⁺)</text>
<path d="M250 80 L 250 220 Q 270 245 290 220 L 290 110" fill="none" stroke="#059669" stroke-width="8" stroke-linecap="round"/>
<text x="232" y="160" text-anchor="end" fill="#065f46">Loop of Henle</text>
<path d="M290 110 C 320 80, 340 120, 370 90" fill="none" stroke="#9333ea" stroke-width="8" stroke-linecap="round"/>
<text x="340" y="70" text-anchor="middle" fill="#6b21a8">DCT</text>
<path d="M370 90 L 370 240" fill="none" stroke="#dc2626" stroke-width="10" stroke-linecap="round"/>
<text x="382" y="200" fill="#991b1b">CD</text>
</svg>"""

HEART_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 260" width="300" height="260" font-family="Helvetica, Arial, sans-serif" font-size="12">
<rect width="300" height="260" fill="#fff"/>
<path d="M150 235 C 60 180, 20 120, 45 70 C 70 25, 130 30, 150 75 C 170 30, 230 25, 255 70 C 280 120, 240 180, 150 235 Z" fill="#fecaca" stroke="#b91c1c" stroke-width="3"/>
<path d="M150 80 L 150 225" stroke="#b91c1c" stroke-width="2" stroke-dasharray="4 4"/>
<path d="M95 95 C 110 140, 120 170, 140 205" fill="none" stroke="#7f1d1d" stroke-width="3"/>
<path d="M205 95 C 190 140, 180 170, 160 205" fill="none" stroke="#7f1d1d" stroke-width="3"/>
<text x="95" y="150" text-anchor="middle" fill="#7f1d1d">RV</text>
<text x="205" y="150" text-anchor="middle" fill="#7f1d1d">LV</text>
<text x="150" y="20" text-anchor="middle" fill="#334155">Coronary arteries fill in diastole</text>
</svg>"""


def _gallop_wav() -> bytes:
    """A short lub-dub-dub (S1, S2, S3) pattern, twice."""
    rate = 16000
    samples: list[float] = []

    def thump(freq: float, ms: int, amp: float) -> None:
        n = rate * ms // 1000
        for i in range(n):
            env = math.sin(math.pi * i / n)
            samples.append(amp * env * math.sin(2 * math.pi * freq * i / rate))

    def silence(ms: int) -> None:
        samples.extend([0.0] * (rate * ms // 1000))

    for _ in range(2):
        thump(55, 110, 0.9)
        silence(220)
        thump(70, 90, 0.8)
        silence(120)
        thump(40, 90, 0.5)
        silence(450)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"".join(struct.pack("<h", int(s * 32000)) for s in samples))
    return buf.getvalue()


# Notetypes and notes
##########################################################################


def _style_basic(col: Collection) -> None:
    basic = col.models.by_name("Basic")
    assert basic
    basic["css"] += content.BASIC_CSS_ADDITION
    col.models.update_dict(basic)


def _add_med_cloze_notetype(col: Collection) -> dict:
    mm = col.models
    m = mm.new(MED_CLOZE)
    m["type"] = MODEL_CLOZE
    for name in ("Text", "Extra", "Source"):
        mm.add_field(m, mm.new_field(name))
    t = mm.new_template("Cloze")
    t["qfmt"] = content.MED_CLOZE_FRONT
    t["afmt"] = content.MED_CLOZE_BACK
    mm.add_template(m, t)
    m["css"] = content.MED_CLOZE_CSS
    mm.add_dict(m)
    added = mm.by_name(MED_CLOZE)
    assert added
    return added


def _add_notes(col: Collection, med_cloze: dict) -> None:
    basic = col.models.by_name("Basic")
    for deck, front, back in content.BASIC:
        did = col.decks.id(deck)
        note = col.new_note(basic)  # type: ignore[arg-type]
        note["Front"], note["Back"] = front, back
        note.tags = [deck.split("::")[1].lower(), "sample"]
        col.add_note(note, did)  # type: ignore[arg-type]
    for i, (deck, text, extra) in enumerate(content.CLOZE):
        did = col.decks.id(deck)
        note = col.new_note(med_cloze)  # type: ignore[arg-type]
        note["Text"], note["Extra"] = text, extra
        if i % 3 == 0:
            note["Source"] = "Sample lecture notes, week " + str(1 + i % 8)
        note.tags = [deck.split("::")[1].lower(), "sample", "cloze"]
        col.add_note(note, did)  # type: ignore[arg-type]


# Review history
##########################################################################

DAY_MS = 86_400_000


def _simulate_history(col: Collection, rng: random.Random) -> None:
    """Answer cards through the real scheduler, then backdate the history.

    Roughly: 55% become review cards (some due today, some overdue, the rest
    later), 12% sit in learning, the remainder stay new.
    """
    cids = list(col.find_cards("deck:*"))
    rng.shuffle(cids)
    n = len(cids)
    review = cids[: int(n * 0.55)]
    learning = cids[int(n * 0.55) : int(n * 0.67)]

    for cid in review:
        _answer(col, rng, cid, 4)  # Easy: graduate straight to review
        for _ in range(rng.randint(0, 3)):  # a few more successful reviews
            _answer(col, rng, cid, rng.choice([3, 3, 3, 2, 4]))

    due_today = review[: len(review) // 3]
    overdue = review[len(review) // 3 : len(review) // 2]
    later = review[len(review) // 2 :]
    col.sched.set_due_date(due_today, "0")
    col.sched.set_due_date(overdue, "0")
    col.sched.set_due_date(later, "1-30")
    # set_due_date can't go into the past; shift overdue cards back directly.
    for cid in overdue:
        col.db.execute("update cards set due = due - ? where id = ?", rng.randint(1, 6), cid)

    for i, cid in enumerate(learning):
        # Again → first learning step; Good → second step
        _answer(col, rng, cid, 1 if i % 2 == 0 else 3)

    # Spread history over the last ~6 months so it looks lived-in.
    # Each card's log entries keep their order; ids stay unique.
    for cid in review:
        offset = rng.randint(20, 180) * DAY_MS + rng.randint(0, DAY_MS)
        col.db.execute("update revlog set id = id - ? where cid = ?", offset, cid)

    # That history happened "in the past", so it shouldn't use up today's
    # new/review limits. Reset every deck's studied-today counters.
    for deck in col.decks.all():
        for key in ("newToday", "revToday", "lrnToday", "timeToday"):
            deck[key] = [col.sched.today, 0]
        col.decks.save(deck)



def _answer(col: Collection, rng: random.Random, cid: int, ease: int) -> None:
    card = col.get_card(cid)  # type: ignore[arg-type]
    card.timer_started = time.time() - rng.uniform(3, 18)  # plausible answer time
    col.sched.answerCard(card, ease)  # type: ignore[arg-type]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=DEV_COLLECTION, help="collection path (inside data/)")
    ap.add_argument("--force", action="store_true", help="delete and rebuild an existing dev collection")
    args = ap.parse_args()
    out = assert_safe_path(args.out)
    if out.parent.exists():
        if not args.force:
            sys.exit(f"{out.parent} already exists; pass --force to rebuild it.")
        shutil.rmtree(out.parent)
    build(out)
    col = Collection(str(out))
    try:
        q = col.sched.get_queued_cards()
        print(f"Built {out}")
        print(f"  notes: {col.note_count()}  cards: {col.card_count()}")
        print(f"  due now in 'Step 1': new={q.new_count} learning={q.learning_count} review={q.review_count}")
    finally:
        col.close()


if __name__ == "__main__":
    main()
