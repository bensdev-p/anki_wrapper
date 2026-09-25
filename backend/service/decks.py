"""Deck tree with due counts, straight from Anki's scheduler."""

from __future__ import annotations

from anki.collection import Collection
from anki.decks import DeckTreeNode

from .errors import NotFound
from .types import Counts, DeckName, DeckNode, DeletedDeck


def deck_tree(col: Collection) -> list[DeckNode]:
    """Top-level decks with nested children and new/learning/review counts.

    Uses `sched.deck_due_tree()`, which counts in the Rust core with the same
    daily limits Anki desktop shows, without loading any cards into Python.
    """
    root = col.sched.deck_due_tree()
    return [_convert(child, parent_path="") for child in root.children]


def _convert(node: DeckTreeNode, parent_path: str) -> DeckNode:
    full_name = f"{parent_path}::{node.name}" if parent_path else node.name
    return DeckNode(
        id=node.deck_id,
        name=node.name,
        full_name=full_name,
        level=node.level,
        collapsed=node.collapsed,
        filtered=node.filtered,
        counts=Counts(
            new=node.new_count, learning=node.learn_count, review=node.review_count
        ),
        total_cards=node.total_including_children,
        children=[_convert(c, full_name) for c in node.children],
    )


def deck_name(col: Collection, deck_id: int) -> str:
    name = col.decks.name_if_exists(deck_id)  # type: ignore[arg-type]
    if name is None:
        raise NotFound(f"deck {deck_id} not found")
    return name


# Creating, renaming and deleting decks (Anki's own operations, all undoable)
##########################################################################

DEFAULT_DECK_ID = 1


def deck_names(col: Collection) -> list[DeckName]:
    """Every deck by full name (sorted as Anki sorts them)."""
    return [
        DeckName(id=d.id, name=d.name, filtered=col.decks.is_filtered(d.id))  # type: ignore[arg-type]
        for d in col.decks.all_names_and_ids(skip_empty_default=False, include_filtered=True)
    ]


def _clean_name(name: str) -> str:
    """Tidy "Step 1 :: Cardio " into "Step 1::Cardio"; "::" nests decks."""
    parts = [p.strip() for p in name.split("::")]
    if not all(parts):
        raise ValueError("Deck names can’t be empty (check for a stray “::”).")
    return "::".join(parts)


def create_deck(col: Collection, name: str) -> DeckName:
    name = _clean_name(name)
    if col.decks.id_for_name(name):
        raise ValueError(f"There’s already a deck called “{name}”.")
    deck_id = col.decks.add_normal_deck_with_name(name).id
    return DeckName(id=deck_id, name=col.decks.name(deck_id), filtered=False)  # type: ignore[arg-type]


def rename_deck(col: Collection, deck_id: int, name: str) -> DeckName:
    """Rename or move a deck (a new "Parent::" prefix moves it). Subdecks follow."""
    deck_name(col, deck_id)
    name = _clean_name(name)
    existing = col.decks.id_for_name(name)
    if existing and existing != deck_id:
        raise ValueError(f"There’s already a deck called “{name}”.")
    try:
        col.decks.rename(deck_id, name)  # type: ignore[arg-type]
    except Exception as err:  # e.g. moving a deck into its own subdeck
        raise ValueError(str(err) or "That name can’t be used.") from err
    return DeckName(id=deck_id, name=col.decks.name(deck_id), filtered=col.decks.is_filtered(deck_id))  # type: ignore[arg-type]


def delete_deck(col: Collection, deck_id: int) -> DeletedDeck:
    """Delete a deck, its subdecks and their cards (undoable, as in Anki desktop)."""
    name = deck_name(col, deck_id)
    if deck_id == DEFAULT_DECK_ID:
        raise ValueError("The Default deck can’t be deleted. It hides itself when it’s empty.")
    out = col.decks.remove([deck_id])  # type: ignore[list-item]
    return DeletedDeck(name=name, cards=out.count, undo_label=col.undo_status().undo)


def deck_card_count(col: Collection, deck_id: int) -> int:
    """Cards in a deck and its subdecks (ids only; nothing is loaded)."""
    deck_name(col, deck_id)
    return len(col.decks.cids(deck_id, children=True))  # type: ignore[arg-type]
