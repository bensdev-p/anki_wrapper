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
    type_answer: bool
    """The card has a [[type:...]] box; the answer side has a slot for the comparison."""


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
    was_answer: bool


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


# Statistics
##########################################################################


@dataclass
class TodayStats:
    answered: int
    seconds: int
    correct: int
    learn: int
    review: int
    relearn: int
    mature_correct: int
    mature_answered: int


@dataclass
class DayReviews:
    day: int
    """Days relative to today (0 = today, -1 = yesterday), using Anki's rollover hour."""
    learn: int
    relearn: int
    young: int
    mature: int
    filtered: int
    seconds: int


@dataclass
class DueDay:
    day: int
    """Days from today (0 = due today)."""
    count: int


@dataclass
class CardCountStats:
    new: int
    learning: int
    """Learning + relearning."""
    young: int
    mature: int
    suspended: int
    buried: int


@dataclass
class RetentionCounts:
    """Anki's "true retention": pass/fail on review cards (young < 21 days interval)."""

    young_passed: int
    young_failed: int
    mature_passed: int
    mature_failed: int


@dataclass
class StatsSummary:
    deck_id: int | None
    """None = whole collection."""
    deck_name: str | None
    days: int
    """History window the reviews list covers."""
    fsrs: bool
    today: TodayStats
    reviews: list[DayReviews]
    """Days with at least one review in the window, ascending."""
    forecast: list[DueDay]
    """Future due counts per day, ascending (today first)."""
    overdue: int
    daily_load: int
    """Anki's estimate of average reviews per day going forward."""
    cards: CardCountStats
    retention: dict[str, RetentionCounts]
    """Keys: today, yesterday, week, month, year, all_time."""
    average_retrievability: float | None
    """FSRS average probability of recall (0-1), when FSRS is on."""


# Sync
##########################################################################


@dataclass
class SyncCredentials:
    """AnkiWeb sync key (never the password). Revoked by changing the password."""

    username: str
    hkey: str
    endpoint: str
    """"" = AnkiWeb; otherwise a self-hosted sync server URL."""


SyncRequired = Literal["none", "full_download", "full_sync", "server_empty"]


@dataclass
class SyncResult:
    required: SyncRequired
    server_message: str
    new_endpoint: str | None
    server_media_usn: int
    host_number: int


@dataclass
class MediaSyncState:
    active: bool
    summary: str
    error: str | None


# Card actions, card info, note editing
##########################################################################


@dataclass
class RevlogEntry:
    time: int
    """Unix seconds."""
    kind: Literal["learning", "review", "relearning", "filtered", "manual", "rescheduled"]
    button: int
    """1-4 (0 for manual/rescheduled entries)."""
    interval_secs: int
    """Interval after this review, in seconds (negative Anki values are converted)."""
    ease: int
    """Ease factor in permille (0 with FSRS)."""
    taken_secs: float
    stability_days: float | None
    difficulty: float | None


@dataclass
class CardInfo:
    card_id: int
    note_id: int
    deck: str
    notetype: str
    card_type: str
    added: int
    first_review: int | None
    latest_review: int | None
    due: str | None
    """Human-readable due date, or None for new/suspended cards."""
    interval_days: int
    ease: int | None
    reviews: int
    lapses: int
    average_secs: float
    total_secs: float
    fsrs: bool
    stability_days: float | None
    difficulty: float | None
    """FSRS difficulty, 1 (easy) to 10 (hard)."""
    retrievability: float | None
    desired_retention: float | None
    preset: str
    tags: list[str]
    revlog: list[RevlogEntry]


@dataclass
class NoteField:
    name: str
    html: str


@dataclass
class NoteForEdit:
    note_id: int
    notetype: str
    is_cloze: bool
    fields: list[NoteField]
    tags: list[str]
    css: str
    """The note type's CSS, so the editor can show fields as they look on cards."""


# Browser
##########################################################################


@dataclass
class BrowseRow:
    card_id: int
    note_id: int
    text: str
    """Sort field as plain text (cloze markup removed)."""
    deck: str
    template: str
    state: Literal["new", "learning", "review", "relearning", "suspended", "buried"]
    due: str | None
    interval_days: int
    ease: int | None
    """Ease factor in permille (SM-2 only)."""
    difficulty: float | None
    """FSRS difficulty as 0–1 (Anki shows it as a percentage)."""
    reviews: int
    lapses: int
    flag: int
    marked: bool
    tags: list[str]


@dataclass
class BrowsePage:
    query: str
    sort: str
    reverse: bool
    total: int
    offset: int
    rows: list[BrowseRow]
    fsrs: bool


# Deck management & deck options
##########################################################################


@dataclass
class DeckName:
    id: int
    name: str
    """Full name, e.g. "Step 1::Cardio"."""
    filtered: bool


@dataclass
class DeletedDeck:
    name: str
    cards: int
    """Cards that were deleted with the deck (and its subdecks)."""
    undo_label: str
    """Pass to `undo_step` to undo exactly this deletion."""


@dataclass
class DeckOptionsConfig:
    """The deck options Rounds edits (Anki's DeckConfig.Config, minus the exotic ones).

    Steps are in minutes, intervals in days, multipliers as Anki stores them
    (e.g. starting ease 2.5). Enum-like fields hold Anki's enum numbers.
    """

    new_per_day: int
    reviews_per_day: int
    learn_steps: list[float]
    relearn_steps: list[float]
    graduating_interval_good: int
    graduating_interval_easy: int
    new_card_insert_order: int
    leech_threshold: int
    leech_action: int
    minimum_lapse_interval: int
    maximum_review_interval: int
    initial_ease: float
    easy_multiplier: float
    hard_multiplier: float
    lapse_multiplier: float
    interval_multiplier: float
    desired_retention: float
    new_card_gather_priority: int
    new_card_sort_order: int
    new_mix: int
    interday_learning_mix: int
    review_order: int
    bury_new: bool
    bury_reviews: bool
    bury_interday_learning: bool
    show_timer: bool
    cap_answer_time_to_secs: int
    disable_autoplay: bool


@dataclass
class DeckPreset:
    id: int
    name: str
    use_count: int
    """Decks using this preset (editing it changes all of them)."""


@dataclass
class DeckOptions:
    deck_id: int
    deck_name: str
    preset_id: int
    presets: list[DeckPreset]
    config: DeckOptionsConfig
    fsrs: bool
    """FSRS is on for the whole collection."""
    has_children: bool


# Adding notes
##########################################################################


@dataclass
class NotetypeInfo:
    id: int
    name: str
    fields: list[str]
    is_cloze: bool


@dataclass
class AddDefaults:
    notetypes: list[NotetypeInfo]
    decks: list[DeckName]
    notetype_id: int
    deck_id: int


@dataclass
class AddNoteResult:
    note_id: int
    cards: int
    duplicate: bool
    """The first field matches another note of this type (added anyway, as in Anki)."""
