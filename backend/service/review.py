"""Study flow on Anki's v3 scheduler.

get_queued_cards() → show the card with describe_next_states() labels →
answer_card() with the states the scheduler handed out. No scheduling logic
lives here; FSRS / SM-2 and all deck options are applied by Anki's core.
"""

from __future__ import annotations

from anki.collection import Collection
from anki.scheduler.v3 import CardAnswer, QueuedCards
from anki.utils import int_time

from . import render
from .decks import deck_name
from .errors import NothingToUndo, StaleCard
from .types import (
    AnswerResult,
    CardInfo,
    Counts,
    RenderedCard,
    RevlogEntry,
    StudyCard,
    StudyState,
    UndoResult,
)

# Anki wraps interval text in Unicode directional isolates (U+2068/U+2069) for
# RTL languages; they're invisible noise in our LTR button labels.
_BIDI = str.maketrans("", "", "\u2066\u2067\u2068\u2069")


def _strip_bidi(text: str) -> str:
    return text.translate(_BIDI)


_QUEUE_NAMES = {
    QueuedCards.NEW: "new",
    QueuedCards.LEARNING: "learning",
    QueuedCards.REVIEW: "review",
}

RATINGS = {
    1: CardAnswer.AGAIN,
    2: CardAnswer.HARD,
    3: CardAnswer.GOOD,
    4: CardAnswer.EASY,
}

# A card left on screen over lunch shouldn't log an hour of study time.
_MAX_MS_TAKEN = 60 * 60 * 1000


def select_deck(col: Collection, deck_id: int) -> StudyState:
    """Make `deck_id` the current deck (what Anki studies) and return its state."""
    deck_name(col, deck_id)  # raises NotFound
    # set_current() records an undoable "Select Deck" step, so skip it when
    # nothing changes.
    if col.decks.get_current_id() != deck_id:
        col.decks.set_current(deck_id)  # type: ignore[arg-type]
    return study_state(col)


def study_state(col: Collection) -> StudyState:
    """The current deck, remaining counts and the card at the front of the queue."""
    queued = col.sched.get_queued_cards(fetch_limit=1)
    counts = Counts(
        new=queued.new_count,
        learning=queued.learning_count,
        review=queued.review_count,
    )
    deck_id = col.decks.get_current_id()
    can_undo = _last_step_is_answer(col)
    return StudyState(
        deck_id=deck_id,
        deck_name=col.decks.name(deck_id),
        counts=counts,
        card=_study_card(col, queued.cards[0], counts) if queued.cards else None,
        can_undo=can_undo,
        undo_label=col.undo_status().undo if can_undo else None,
    )


def _undoable_steps(col: Collection) -> set[str]:
    """Undo names of the actions the study screen performs (localized by Anki)."""
    tr = col.tr
    return {
        tr.actions_answer_card(),
        tr.actions_set_flag(),
        tr.actions_update_tag(),  # mark
        tr.actions_remove_tag(),  # unmark
        tr.studying_suspend(),
        tr.studying_bury(),
        tr.actions_update_note(),
        # browser bulk actions
        tr.actions_unbury_unsuspend(),
        tr.actions_set_due_date(),
    }


def _last_step_is_answer(col: Collection) -> bool:
    """True when the last undoable step is one the study screen made.

    Other steps (like the "Select Deck" recorded when a deck opens) are left
    alone, so Ctrl+Z never does something she didn't do on this screen.
    """
    return col.undo_status().undo in _undoable_steps(col)


def _study_card(
    col: Collection, queued: QueuedCards.QueuedCard, counts: Counts
) -> StudyCard:
    card = col.get_card(queued.card.id)  # type: ignore[arg-type]
    note = card.note()
    return StudyCard(
        card_id=card.id,
        note_id=card.nid,
        deck_id=card.did,
        deck_name=col.decks.name(card.did),
        notetype_name=note.note_type()["name"],  # type: ignore[index]
        queue=_QUEUE_NAMES[queued.queue],  # type: ignore[arg-type]
        button_labels=[
            _strip_bidi(label)
            for label in col.sched.describe_next_states(queued.states)
        ],
        counts=counts,
        rendered=render.render_card(col, card),
        flag=card.user_flag(),
        marked=note.has_tag("marked"),
    )


def answer_card(
    col: Collection, card_id: int, rating: int, ms_taken: int
) -> AnswerResult:
    """Answer the card at the front of the queue.

    `card_id` must match the front card, so a double-tap or a second device
    can't answer the wrong card with stale scheduling states.
    """
    if rating not in RATINGS:
        raise ValueError(f"rating must be 1-4, got {rating}")
    queued = col.sched.get_queued_cards(fetch_limit=1)
    if not queued.cards or queued.cards[0].card.id != card_id:
        raise StaleCard(f"card {card_id} is not at the front of the queue")
    top = queued.cards[0]
    states = top.states
    new_state = {
        CardAnswer.AGAIN: states.again,
        CardAnswer.HARD: states.hard,
        CardAnswer.GOOD: states.good,
        CardAnswer.EASY: states.easy,
    }[RATINGS[rating]]

    # Same fields sched.build_answer() fills in; built directly because the
    # timer runs on the client rather than on an anki.cards.Card instance.
    col.sched.answer_card(
        CardAnswer(
            card_id=card_id,
            current_state=states.current,
            new_state=new_state,
            rating=RATINGS[rating],
            answered_at_millis=int_time(1000),
            milliseconds_taken=max(0, min(ms_taken, _MAX_MS_TAKEN)),
        )
    )
    after = col.get_card(card_id)  # type: ignore[arg-type]
    return AnswerResult(
        card_id=card_id,
        rating=rating,
        due_before=top.card.due,
        due_after=after.due,
        leech=col.sched.state_is_leech(new_state),
    )


def undo(col: Collection) -> UndoResult:
    """Undo the last answer. The card returns to the front of the queue.

    Only answers are undone from the study screen; other steps (like the
    "Select Deck" recorded when a deck is opened) are left alone.
    """
    if not _last_step_is_answer(col):
        raise NothingToUndo("nothing to undo")
    out = col.undo()
    return UndoResult(undone=out.operation, was_answer=out.operation == col.tr.actions_answer_card())


# Card actions (same operations and undo entries as Anki desktop's reviewer)
##########################################################################


def set_flag(col: Collection, card_id: int, flag: int) -> int:
    """Set flag 1-7 (Anki's colours), or clear it when it's already set. Returns the new flag."""
    if not 0 <= flag <= 7:
        raise ValueError("flag must be 0-7")
    card = col.get_card(card_id)  # type: ignore[arg-type]
    new = 0 if card.user_flag() == flag else flag
    col.set_user_flag_for_cards(new, [card.id])
    return new


def toggle_mark(col: Collection, note_id: int) -> bool:
    """Toggle the "marked" tag, as the reviewer's Mark Note does. Returns marked."""
    note = col.get_note(note_id)  # type: ignore[arg-type]
    if note.has_tag("marked"):
        col.tags.bulk_remove([note.id], "marked")
        return False
    col.tags.bulk_add([note.id], "marked")
    return True


def suspend(col: Collection, card_id: int, whole_note: bool = False) -> StudyState:
    card = col.get_card(card_id)  # type: ignore[arg-type]
    if whole_note:
        col.sched.suspend_notes([card.nid])
    else:
        col.sched.suspend_cards([card.id])
    return study_state(col)


def bury(col: Collection, card_id: int, whole_note: bool = False) -> StudyState:
    card = col.get_card(card_id)  # type: ignore[arg-type]
    if whole_note:
        col.sched.bury_notes([card.nid])
    else:
        col.sched.bury_cards([card.id], manual=True)
    return study_state(col)


def compare_answer(col: Collection, card_id: int, typed: str) -> str:
    return render.compare_typed_answer(col, col.get_card(card_id), typed)  # type: ignore[arg-type]


def rerender(col: Collection, card_id: int) -> RenderedCard:
    """Fresh HTML for a card (after its note was edited)."""
    return render.render_card(col, col.get_card(card_id))  # type: ignore[arg-type]


# Card info (as Anki's Card Info window)
##########################################################################

_KINDS = ["learning", "review", "relearning", "filtered", "manual", "rescheduled"]


def card_info(col: Collection, card_id: int) -> CardInfo:
    s = col.card_stats_data(card_id)  # type: ignore[arg-type]
    fsrs = s.HasField("memory_state")
    note = col.get_note(s.note_id)  # type: ignore[arg-type]
    return CardInfo(
        card_id=s.card_id,
        note_id=s.note_id,
        deck=s.deck,
        notetype=s.notetype,
        card_type=s.card_type,
        added=s.added,
        first_review=s.first_review if s.HasField("first_review") else None,
        latest_review=s.latest_review if s.HasField("latest_review") else None,
        due=_due_label(col, s),
        interval_days=s.interval,
        ease=s.ease or None,
        reviews=s.reviews,
        lapses=s.lapses,
        average_secs=round(s.average_secs, 1),
        total_secs=round(s.total_secs, 1),
        fsrs=fsrs,
        stability_days=round(s.memory_state.stability, 2) if fsrs else None,
        difficulty=round(s.memory_state.difficulty, 2) if fsrs else None,
        retrievability=round(s.fsrs_retrievability, 4) if s.HasField("fsrs_retrievability") else None,
        desired_retention=round(s.desired_retention, 3) if s.HasField("desired_retention") else None,
        preset=s.preset,
        tags=list(note.tags),
        revlog=[
            RevlogEntry(
                time=e.time,
                kind=_KINDS[e.review_kind] if e.review_kind < len(_KINDS) else "manual",  # type: ignore[arg-type]
                button=e.button_chosen,
                interval_secs=e.interval,
                ease=e.ease,
                taken_secs=round(e.taken_secs, 1),
                stability_days=round(e.memory_state.stability, 2) if e.HasField("memory_state") else None,
                difficulty=round(e.memory_state.difficulty, 2) if e.HasField("memory_state") else None,
            )
            for e in s.revlog
        ],
    )


def _due_label(col: Collection, s) -> str | None:  # type: ignore[no-untyped-def]
    if s.HasField("due_date"):
        from datetime import date

        return date.fromtimestamp(s.due_date).isoformat()
    if s.HasField("due_position"):
        return f"New #{s.due_position}"
    return None
