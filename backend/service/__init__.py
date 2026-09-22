"""Anki study service: pure functions over an `anki.collection.Collection`.

No web-framework imports belong in this package. Callers own the collection
and are responsible for serializing access to it (Collection is not
thread-safe). In the web app that's api.host.CollectionHost; in a future
desktop add-on it would be `mw.col` on the main thread.
"""

from .decks import deck_name, deck_tree
from .errors import NotFound, NothingToUndo, ServiceError, StaleCard
from .render import render_card
from .notes import note_for_edit, update_note
from .review import (
    answer_card,
    bury,
    card_info,
    compare_answer,
    rerender,
    select_deck,
    set_flag,
    study_state,
    suspend,
    toggle_mark,
    undo,
)
from .search import search_cards
from .stats import stats
from . import browser, sync

__all__ = [
    "NotFound",
    "NothingToUndo",
    "ServiceError",
    "StaleCard",
    "answer_card",
    "bury",
    "card_info",
    "compare_answer",
    "note_for_edit",
    "rerender",
    "set_flag",
    "suspend",
    "toggle_mark",
    "update_note",
    "deck_name",
    "deck_tree",
    "render_card",
    "search_cards",
    "select_deck",
    "stats",
    "sync",
    "browser",
    "study_state",
    "undo",
]
