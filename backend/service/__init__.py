"""Anki study service: pure functions over an `anki.collection.Collection`.

No web-framework imports belong in this package. Callers own the collection
and are responsible for serializing access to it (Collection is not
thread-safe). In the web app that's api.host.CollectionHost; in a future
desktop add-on it would be `mw.col` on the main thread.
"""

from .decks import create_deck, deck_card_count, deck_name, deck_names, deck_tree, delete_deck, rename_deck
from .errors import NotFound, NothingToUndo, ServiceError, StaleCard
from .render import render_card
from .notes import add_defaults, add_media, add_note, note_for_edit, update_note
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
from . import browser, deck_options, sync

__all__ = [
    "add_defaults",
    "add_media",
    "add_note",
    "create_deck",
    "deck_card_count",
    "deck_names",
    "deck_options",
    "delete_deck",
    "rename_deck",
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
