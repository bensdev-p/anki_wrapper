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
from .types import AnswerResult, Counts, StudyCard, StudyState, UndoResult

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


def _last_step_is_answer(col: Collection) -> bool:
    return col.undo_status().undo == col.tr.actions_answer_card()


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
        raise NothingToUndo("no answer to undo")
    out = col.undo()
    return UndoResult(undone=out.operation)
