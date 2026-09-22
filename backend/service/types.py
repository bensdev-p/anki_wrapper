"""Plain data returned by the service layer.

Dataclasses only: no FastAPI or pydantic here, so the service module can be
reused unchanged inside an Anki desktop add-on.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

QueueKind = Literal["new", "learning", "review"]


@dataclass
class Counts:
    new: int
    learning: int
    review: int


@dataclass
class DeckNode:
    id: int
    name: str
    """Leaf name, e.g. "Pharm"."""
    full_name: str
    """Full path, e.g. "Step 1::Cardio::Pharm"."""
    level: int
    collapsed: bool
    filtered: bool
    counts: Counts
    total_cards: int
    children: list[DeckNode] = field(default_factory=list)


@dataclass
class AudioRef:
    """One [sound:...] reference in rendered card HTML."""

    side: Literal["q", "a"]
    index: int
    filename: str


@dataclass
class RenderedCard:
    question_html: str
    answer_html: str
    css: str
    body_class: str
    """Anki's reviewer body classes, without the night-mode ones (see render.py)."""
    audio: list[AudioRef]
    autoplay: bool


@dataclass
class StudyCard:
    card_id: int
    note_id: int
    deck_id: int
    deck_name: str
    notetype_name: str
    queue: QueueKind
    button_labels: list[str]
    """Next-interval labels for Again/Hard/Good/Easy, from the scheduler."""
    counts: Counts
    """Remaining counts, including this card."""
    rendered: RenderedCard
    flag: int
    marked: bool


@dataclass
class StudyState:
    deck_id: int
    deck_name: str
    counts: Counts
    card: StudyCard | None
    """None when the deck is finished for today."""
    can_undo: bool
    undo_label: str | None


@dataclass
class AnswerResult:
    card_id: int
    rating: int
    due_before: int
    due_after: int
    leech: bool


@dataclass
class UndoResult:
    undone: str
    """Localized name of the undone action, e.g. "Answer Card"."""


@dataclass
class SearchHit:
    card_id: int
    note_id: int
    deck_id: int
    deck_name: str
    preview: str


@dataclass
class SearchResult:
    query: str
    total: int
    hits: list[SearchHit]
