#!/usr/bin/env python3
"""Time the service layer on a synthetic 100k-card collection.

Builds a throwaway collection in data/.bench/ (deleted afterwards), so it
never touches the dev or demo collections. Run on the Pi to see real numbers:

  .venv/bin/python scripts/benchmark.py [--cards 100000]
"""

from __future__ import annotations

import argparse
import random
import shutil
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from anki.collection import AddNoteRequest, Collection  # noqa: E402

import service  # noqa: E402
from safety import DATA_DIR, assert_safe_path  # noqa: E402


def bench(name: str, fn, runs: int = 7) -> None:  # type: ignore[no-untyped-def]
    times = []
    for _ in range(runs):
        t = time.perf_counter()
        fn()
        times.append((time.perf_counter() - t) * 1000)
    print(f"  {name:<28} median {statistics.median(times):7.1f} ms   max {max(times):7.1f} ms")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cards", type=int, default=100_000)
    args = ap.parse_args()

    root = assert_safe_path(DATA_DIR / ".bench")
    shutil.rmtree(root, ignore_errors=True)
    root.mkdir(parents=True)
    col = Collection(str(root / "collection.anki2"))
    try:
        rng = random.Random(1)
        basic = col.models.by_name("Basic")
        decks = [
            col.decks.id(f"Big::Step {s}::{system}::Lecture {n}")
            for s in (1, 2)
            for system in ("Cardio", "Renal", "Micro", "Pharm", "Neuro", "Heme", "GI", "Pulm")
            for n in range(1, 7)
        ]
        t = time.perf_counter()
        requests = []
        for i in range(args.cards):
            note = col.new_note(basic)  # type: ignore[arg-type]
            note["Front"] = f"Question {i}: " + "lorem ipsum dolor " * 4
            note["Back"] = f"Answer {i}"
            requests.append(AddNoteRequest(note=note, deck_id=rng.choice(decks)))
        col.add_notes(requests)
        cids = list(col.find_cards("deck:*"))
        rng.shuffle(cids)
        col.sched.set_due_date(cids[: int(len(cids) * 0.7)], "1-400")
        col.sched.set_due_date(cids[:1500], "0")
        # A year of review history (~250k log rows) so stats has real work to do.
        now_ms = int(time.time() * 1000)
        col.db.executemany(
            "insert or ignore into revlog (id, cid, usn, ease, ivl, lastIvl, factor, time, type) values (?,?,?,?,?,?,?,?,?)",
            (
                (now_ms - rng.randint(1, 365 * 86_400_000), rng.choice(cids), -1,
                 rng.choice([1, 3, 3, 3, 3, 4]), rng.randint(1, 200), rng.randint(1, 100), 0, rng.randint(2000, 20000), 1)
                for i in range(250_000)
            ),
        )
        print(f"Built {col.card_count()} cards in {time.perf_counter() - t:.1f}s\n")

        top = col.decks.id_for_name("Big")
        bench("deck tree with counts", lambda: service.deck_tree(col))
        bench("open deck + first card", lambda: service.select_deck(col, top))  # type: ignore[arg-type]

        def answer_and_next() -> None:
            state = service.study_state(col)
            assert state.card
            service.answer_card(col, state.card.card_id, 3, 3000)
            service.study_state(col)

        bench("answer + next card", answer_and_next, runs=15)
        bench("undo + card again", lambda: (service.undo(col), service.study_state(col)))
        bench("search (first 50 hits)", lambda: service.search_cards(col, "lorem"))
        bench("browse: search + sort by due", lambda: service.browser.search_ids(col, "deck:*", "cardDue"))
        ids = service.browser.search_ids(col, "deck:*", "cardDue")
        bench("browse: one page of rows", lambda: service.browser.rows(col, ids[50_000:50_100]))
        bench("stats, 3 months (default)", lambda: service.stats(col, days=90))
        bench("stats, 1 year", lambda: service.stats(col, days=365))
    finally:
        col.close()
        shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    main()
