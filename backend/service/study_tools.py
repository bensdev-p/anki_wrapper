"""Custom study, filtered decks and importing .apkg files (Anki's own operations).

Custom study goes through `sched.custom_study`, as Anki desktop's Custom
Study window does; filtered decks through `get_or_create_filtered_deck` /
`add_or_update_filtered_deck`, like its filtered deck dialog.

Imports never update existing note types: that could change the collection
schema, which forces a one-way sync.
"""

from __future__ import annotations

from typing import Literal

from anki.collection import Collection, ImportAnkiPackageOptions, ImportAnkiPackageRequest
from anki.import_export_pb2 import ImportAnkiPackageUpdateCondition
from anki.scheduler_pb2 import CustomStudyRequest

from .decks import deck_name
from .types import CustomStudyInfo, FilteredDeckForm, FilteredDeckSpec, ImportSummary

CustomStudyKind = Literal["new", "review", "forgot", "ahead", "preview", "cram"]
CramKind = Literal["due", "new", "review", "all"]
_CRAM = {
    "due": CustomStudyRequest.Cram.CRAM_KIND_DUE,
    "new": CustomStudyRequest.Cram.CRAM_KIND_NEW,
    "review": CustomStudyRequest.Cram.CRAM_KIND_REVIEW,
    "all": CustomStudyRequest.Cram.CRAM_KIND_ALL,
}


# Custom study
##########################################################################


def custom_study_info(col: Collection, deck_id: int) -> CustomStudyInfo:
    name = deck_name(col, deck_id)
    d = col.sched.custom_study_defaults(deck_id)  # type: ignore[arg-type]
    return CustomStudyInfo(
        deck_id=deck_id,
        deck_name=name,
        available_new=d.available_new,
        available_review=d.available_review,
        available_new_in_children=d.available_new_in_children,
        available_review_in_children=d.available_review_in_children,
        extend_new=d.extend_new,
        extend_review=d.extend_review,
        tags=[t.name for t in d.tags],
    )


def custom_study(
    col: Collection,
    deck_id: int,
    kind: CustomStudyKind,
    amount: int,
    cram_kind: CramKind = "all",
    tags_include: list[str] | None = None,
    tags_exclude: list[str] | None = None,
) -> int:
    """Run one custom study option; returns the deck to study next.

    "new"/"review" raise today's limit on this deck; the others build (or
    rebuild) Anki's "Custom Study Session" filtered deck and select it.
    """
    deck_name(col, deck_id)
    if not 1 <= amount <= 9999:
        raise ValueError("Pick a number between 1 and 9999.")
    request = CustomStudyRequest(deck_id=deck_id)
    if kind == "new":
        request.new_limit_delta = amount
    elif kind == "review":
        request.review_limit_delta = amount
    elif kind == "forgot":
        request.forgot_days = amount
    elif kind == "ahead":
        request.review_ahead_days = amount
    elif kind == "preview":
        request.preview_days = amount
    elif kind == "cram":
        request.cram.card_limit = amount
        request.cram.kind = _CRAM[cram_kind]
        request.cram.tags_to_include.extend(tags_include or [])
        request.cram.tags_to_exclude.extend(tags_exclude or [])
    else:
        raise ValueError(f"unknown custom study option: {kind}")
    try:
        col.sched.custom_study(request)
    except Exception as err:  # e.g. "no cards matched"
        raise ValueError(str(err) or "No cards matched.") from err
    return deck_id if kind in ("new", "review") else col.decks.get_current_id()


# Filtered decks
##########################################################################


def filtered_deck(col: Collection, deck_id: int = 0, search: str | None = None) -> FilteredDeckForm:
    """A filtered deck to edit, or (deck_id=0) Anki's defaults for a new one."""
    if deck_id:
        deck_name(col, deck_id)
        if not col.decks.is_filtered(deck_id):  # type: ignore[arg-type]
            raise ValueError("That isn’t a filtered deck.")
    d = col.sched.get_or_create_filtered_deck(deck_id)  # type: ignore[arg-type]
    terms = d.config.search_terms
    if search is not None and not deck_id and terms:
        terms[0].search = search
    first = terms[0]
    # A new deck starts with one filter, as in Anki desktop's dialog (Anki's
    # defaults include a second one the dialog leaves switched off).
    second = terms[1] if len(terms) > 1 and deck_id else None
    return FilteredDeckForm(
        deck=FilteredDeckSpec(
            id=d.id,
            name=d.name,
            search=first.search,
            limit=first.limit,
            order=first.order,
            reschedule=d.config.reschedule,
            search2=second.search if second else None,
            limit2=second.limit if second else 0,
            order2=second.order if second else 0,
        ),
        order_labels=list(col.sched.filtered_deck_order_labels()),
    )


def save_filtered_deck(col: Collection, spec: FilteredDeckSpec) -> int:
    """Create or update a filtered deck and (re)build it; returns its id."""
    name = spec.name.strip()
    if not name:
        raise ValueError("Give the filtered deck a name.")
    if not spec.search.strip():
        raise ValueError("Enter a search, e.g. deck:\"Step 1\" is:due.")
    if not 1 <= spec.limit <= 99999:
        raise ValueError("The card limit must be between 1 and 99999.")
    d = col.sched.get_or_create_filtered_deck(spec.id)  # type: ignore[arg-type]
    d.name = name
    d.config.reschedule = spec.reschedule
    del d.config.search_terms[:]
    first = d.config.search_terms.add()
    first.search, first.limit, first.order = spec.search.strip(), spec.limit, spec.order
    if spec.search2 and spec.search2.strip():
        second = d.config.search_terms.add()
        second.search, second.limit, second.order = spec.search2.strip(), max(1, spec.limit2), spec.order2
    try:
        return col.sched.add_or_update_filtered_deck(d).id
    except Exception as err:  # invalid search, or nothing matched
        raise ValueError(str(err) or "No cards matched that search.") from err


def rebuild_filtered_deck(col: Collection, deck_id: int) -> int:
    """Pull matching cards in again; returns how many are in the deck."""
    _require_filtered(col, deck_id)
    return col.sched.rebuild_filtered_deck(deck_id).count  # type: ignore[arg-type]


def empty_filtered_deck(col: Collection, deck_id: int) -> None:
    """Send the cards back to their own decks (the filtered deck stays)."""
    _require_filtered(col, deck_id)
    col.sched.empty_filtered_deck(deck_id)  # type: ignore[arg-type]


def _require_filtered(col: Collection, deck_id: int) -> None:
    deck_name(col, deck_id)
    if not col.decks.is_filtered(deck_id):  # type: ignore[arg-type]
        raise ValueError("That isn’t a filtered deck.")


# Importing
##########################################################################


def import_package(col: Collection, path: str) -> ImportSummary:
    """Import a shared deck (.apkg) like Anki's import screen, minus note type updates.

    New notes are added, existing ones updated when the file's copy is newer.
    Note types already in the collection are never changed (a changed note
    type can force a one-way sync); if the file's differs, Anki keeps both.
    """
    options = ImportAnkiPackageOptions(
        merge_notetypes=False,
        update_notes=ImportAnkiPackageUpdateCondition.IMPORT_ANKI_PACKAGE_UPDATE_CONDITION_IF_NEWER,
        update_notetypes=ImportAnkiPackageUpdateCondition.IMPORT_ANKI_PACKAGE_UPDATE_CONDITION_NEVER,
        with_scheduling=False,
        with_deck_configs=False,
    )
    try:
        out = col.import_anki_package(ImportAnkiPackageRequest(package_path=path, options=options))
    except Exception as err:
        raise ValueError(f"Anki couldn’t import that file: {err}") from err
    log = out.log
    return ImportSummary(
        new=len(log.new),
        updated=len(log.updated),
        duplicate=len(log.duplicate),
        conflicting=len(log.conflicting),
        skipped=len(log.missing_notetype) + len(log.missing_deck) + len(log.empty_first_field),
        found=log.found_notes,
    )


def import_progress(col: Collection) -> str | None:
    """What a running import is doing (safe to call from another thread, as aqt does)."""
    progress = col._backend.latest_progress()
    return progress.importing if progress.HasField("importing") else None
