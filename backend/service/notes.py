"""Editing a note's fields and tags (as Anki's editor saves them).

Only fields she actually changed are written, so unchanged HTML is never
re-serialised. Note types are never modified: a schema change would force a
one-way sync and discard this device's unsynced reviews.
"""

from __future__ import annotations

import re

from anki.collection import Collection
from anki.consts import MODEL_CLOZE
from anki.notes import NoteFieldsCheckResult

from .errors import NotFound
from .types import NoteField, NoteForEdit


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
