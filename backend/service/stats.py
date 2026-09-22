"""Study statistics from Anki's own stats engine.

One call to the backend `graphs` RPC (what Anki desktop's Statistics screen
uses) computes everything in the Rust core over the review log, so nothing
is loaded card-by-card into Python.
"""

from __future__ import annotations

from anki.collection import Collection, SearchNode

from .decks import deck_name
from .types import (
    CardCountStats,
    DayReviews,
    DueDay,
    RetentionCounts,
    StatsSummary,
    TodayStats,
)

# Anki's graphs cost grows with the history window (~0.2 s for a month vs
# ~0.6 s for a year at 100k cards / 250k reviews on x86), so the caller picks
# the window instead of always computing a year.
MAX_DAYS = 3650

_RETENTION_PERIODS = ("today", "yesterday", "week", "month", "year", "all_time")


def stats(col: Collection, deck_id: int | None = None, days: int = 90) -> StatsSummary:
    """Stats for one deck (including subdecks) or the whole collection.

    `days` is the review-history window (heatmap, reviews chart); forecast,
    card counts and retention periods are independent of it.
    """
    if not 1 <= days <= MAX_DAYS:
        raise ValueError(f"days must be between 1 and {MAX_DAYS}")
    if deck_id is None:
        search, name = "deck:*", None
    else:
        name = deck_name(col, deck_id)  # raises NotFound
        search = col.build_search_string(SearchNode(deck=name))

    g = col._backend.graphs(search=search, days=days)

    reviews = [
        DayReviews(
            day=day,
            learn=r.learn,
            relearn=r.relearn,
            young=r.young,
            mature=r.mature,
            filtered=r.filtered,
            seconds=_total(g.reviews.time.get(day)) // 1000,
        )
        for day, r in sorted(g.reviews.count.items())
        if day > -days
    ]

    due = g.future_due.future_due
    overdue = sum(n for day, n in due.items() if day < 0)
    forecast = [DueDay(day=day, count=n) for day, n in sorted(due.items()) if day >= 0]

    cc = g.card_counts.including_inactive
    t = g.today
    retention = {
        period: RetentionCounts(
            young_passed=r.young_passed,
            young_failed=r.young_failed,
            mature_passed=r.mature_passed,
            mature_failed=r.mature_failed,
        )
        for period in _RETENTION_PERIODS
        for r in [getattr(g.true_retention, period)]
    }

    return StatsSummary(
        deck_id=deck_id,
        days=days,
        deck_name=name,
        fsrs=g.fsrs,
        today=TodayStats(
            answered=t.answer_count,
            seconds=t.answer_millis // 1000,
            correct=t.correct_count,
            learn=t.learn_count,
            review=t.review_count,
            relearn=t.relearn_count,
            mature_correct=t.mature_correct,
            mature_answered=t.mature_count,
        ),
        reviews=reviews,
        forecast=forecast,
        overdue=overdue,
        daily_load=g.future_due.daily_load,
        cards=CardCountStats(
            new=cc.newCards,  # (proto field is camelCase)
            learning=cc.learn + cc.relearn,
            young=cc.young,
            mature=cc.mature,
            suspended=cc.suspended,
            buried=cc.buried,
        ),
        retention=retention,
        average_retrievability=(
            g.retrievability.average / 100 if g.fsrs and g.retrievability.retrievability else None
        ),
    )


def _total(r) -> int:  # type: ignore[no-untyped-def]
    if r is None:
        return 0
    return r.learn + r.relearn + r.young + r.mature + r.filtered
