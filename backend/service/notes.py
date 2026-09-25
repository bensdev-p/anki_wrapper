"""Editing a note's fields and tags (as Anki's editor saves them).

Only fields she actually changed are written, so unchanged HTML is never
re-serialised. Note types are never modified: a schema change would force a
one-way sync and discard this device's unsynced reviews.
"""

from __future__ import annotations

import os
import re

from anki.collection import Collection
from anki.consts import MODEL_CLOZE
from anki.notes import NoteFieldsCheckResult

from .decks import deck_name, deck_names
from .errors import NotFound
from .types import AddDefaults, AddNoteResult, NoteField, NoteForEdit, NotetypeInfo


def note_for_edit(col: Collection, note_id: int) -> NoteForEdit:
    try:
        note = col.get_note(note_id)  # type: ignore[arg-type]
    except Exception as err:
        raise NotFound(f"note {note_id} not found") from err
    nt = note.note_type()
    assert nt
    return NoteForEdit(
        note_id=note.id,
        notetype=nt["name"],
        is_cloze=nt["type"] == MODEL_CLOZE,
        fields=[NoteField(name=name, html=value) for name, value in note.items()],
        tags=list(note.tags),
        css=nt["css"],
    )


def update_note(
    col: Collection, note_id: int, fields: dict[str, str], tags: list[str] | None = None
) -> NoteForEdit:
    """Write changed fields (by name) and optionally tags. One undoable "Update Note"."""
    note = col.get_note(note_id)  # type: ignore[arg-type]
    names = set(note.keys())
    unknown = set(fields) - names
    if unknown:
        raise ValueError(f"unknown field(s): {', '.join(sorted(unknown))}")
    for name, value in fields.items():
        note[name] = value
    _check(note)
    if tags is not None:
        note.tags = [t for t in (tag.strip() for tag in tags) if t]
    col.update_note(note)
    return note_for_edit(col, note_id)


_CLOZE_ORD = re.compile(r"\{\{c(\d+)::")


def _check(note) -> None:  # type: ignore[no-untyped-def]
    """Refuse edits that would blank out cards (Anki's editor warns about these)."""
    state = note.fields_check()
    if state == NoteFieldsCheckResult.EMPTY:
        raise ValueError("The first field can’t be empty.")
    if state == NoteFieldsCheckResult.MISSING_CLOZE:
        raise ValueError("A cloze note needs at least one cloze deletion, like {{c1::…}}.")
    nt = note.note_type()
    if nt and nt["type"] == MODEL_CLOZE:
        present = {int(n) for value in note.fields for n in _CLOZE_ORD.findall(value)}
        existing = {card.ord + 1 for card in note.cards()}
        missing = sorted(existing - present)
        if missing:
            names = ", ".join(f"c{n}" for n in missing)
            raise ValueError(f"Removing {names} would leave its card blank. Keep the cloze, or suspend the card instead.")


# Adding notes (as Anki's Add window does)
##########################################################################

# What may be pasted or dropped into a field.
MEDIA_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".heic",
    ".mp3", ".m4a", ".ogg", ".oga", ".wav", ".mp4", ".webm",
}
MAX_MEDIA_BYTES = 50 * 1024 * 1024


def add_defaults(col: Collection, deck_id: int | None = None) -> AddDefaults:
    """Note types, decks, and which of each to start with (Anki's own defaults)."""
    defaults = col.defaults_for_adding(current_review_card=None)
    notetypes = []
    for entry in col.models.all_names_and_ids():
        nt = col.models.get(entry.id)  # type: ignore[arg-type]
        if nt:
            notetypes.append(
                NotetypeInfo(
                    id=entry.id,
                    name=entry.name,
                    fields=[f["name"] for f in nt["flds"]],
                    is_cloze=nt["type"] == MODEL_CLOZE,
                )
            )
    decks = [d for d in deck_names(col) if not d.filtered]
    start_deck = deck_id if deck_id and any(d.id == deck_id for d in decks) else defaults.deck_id
    return AddDefaults(notetypes=notetypes, decks=decks, notetype_id=defaults.notetype_id, deck_id=start_deck)


def add_note(
    col: Collection, notetype_id: int, deck_id: int, fields: dict[str, str], tags: list[str] | None = None
) -> AddNoteResult:
    """Add one note (one undoable "Add Note"). Duplicates are allowed, as in Anki, but reported."""
    nt = col.models.get(notetype_id)  # type: ignore[arg-type]
    if not nt:
        raise NotFound(f"note type {notetype_id} not found")
    deck_name(col, deck_id)
    if col.decks.is_filtered(deck_id):  # type: ignore[arg-type]
        raise ValueError("Cards can’t be added to a filtered deck. Pick a normal deck.")
    note = col.new_note(nt)
    unknown = set(fields) - set(note.keys())
    if unknown:
        raise ValueError(f"unknown field(s): {', '.join(sorted(unknown))}")
    for name, value in fields.items():
        note[name] = value
    note.tags = [t for t in (tag.strip() for tag in tags or []) if t]

    state = note.fields_check()
    if state == NoteFieldsCheckResult.EMPTY:
        raise ValueError("The first field is empty.")
    if state == NoteFieldsCheckResult.MISSING_CLOZE:
        raise ValueError("Add a cloze deletion, like {{c1::answer}}.")
    if state == NoteFieldsCheckResult.NOTETYPE_NOT_CLOZE:
        raise ValueError("Cloze deletions only work with a Cloze note type. Pick Cloze above.")
    try:
        col.add_note(note, deck_id)  # type: ignore[arg-type]
    except Exception as err:  # e.g. the fields would make every card blank
        raise ValueError(str(err) or "Anki couldn’t make any cards from this note.") from err
    return AddNoteResult(
        note_id=note.id, cards=len(note.card_ids()), duplicate=state == NoteFieldsCheckResult.DUPLICATE
    )


def add_media(col: Collection, filename: str, data: bytes) -> str:
    """Save a pasted/dropped file into the media folder; returns the name to use in the field."""
    name = os.path.basename(filename.replace("\\", "/")).strip() or "pasted"
    if os.path.splitext(name)[1].lower() not in MEDIA_EXTENSIONS:
        raise ValueError("Only images, audio and video can be added to a card.")
    if len(data) > MAX_MEDIA_BYTES:
        raise ValueError("That file is too large (50 MB at most).")
    return col.media.write_data(name, data)
