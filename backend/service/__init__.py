"""Anki study service: pure functions over an `anki.collection.Collection`.

No web-framework imports belong in this package. Callers own the collection
and are responsible for serializing access to it (Collection is not
thread-safe). In the web app that's api.host.CollectionHost; in a future
desktop add-on it would be `mw.col` on the main thread.
"""

from .decks import deck_name, deck_tree
from .errors import NotFound, NothingToUndo, ServiceError, StaleCard
from .render import render_card
from .review import answer_card, select_deck, study_state, undo
from .search import search_cards
from .stats import stats
from . import sync

__all__ = [
    "NotFound",
    "NothingToUndo",
    "ServiceError",
    "StaleCard",
    "answer_card",
    "deck_name",
    "deck_tree",
    "render_card",
    "search_cards",
    "select_deck",
    "stats",
    "sync",
    "study_state",
    "undo",
]
