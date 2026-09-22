"""Deck tree with due counts, straight from Anki's scheduler."""

from __future__ import annotations

from anki.collection import Collection
from anki.decks import DeckTreeNode

from .errors import NotFound
from .types import Counts, DeckNode


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
