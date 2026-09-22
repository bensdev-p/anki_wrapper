"""Card browser: Anki's search and sorting, one page of rows at a time.

Searching and sorting are done by Anki's core (`find_cards` with a browser
column), exactly like the desktop browser. Rows are built here from a single
SQL query per page instead of `browser_row_for_id`, because that API renders
her saved browser column setup, and changing those settings would sync to her
desktop and rearrange its browser.
"""

from __future__ import annotations

import html
import json
import re
import time
from datetime import date, timedelta

from anki.collection import Collection
from anki.consts import MODEL_CLOZE

from .errors import ServiceError
from .types import BrowseRow

# Browser column keys we allow sorting by (all sort cards in Anki's core).
SORT_COLUMNS = (
    "noteFld",
    "deck",
    "cardDue",
    "cardIvl",
    "cardEase",
    "difficulty",
    "cardReps",
    "cardLapses",
    "noteCrt",
    "cardMod",
)

MAX_PAGE = 200


class InvalidSearch(ServiceError):
    pass


def search_ids(col: Collection, query: str, sort: str = "noteFld", reverse: bool = False) -> list[int]:
    """All matching card ids in display order (ids only: cheap at 100k)."""
    if sort not in SORT_COLUMNS:
        raise ValueError(f"can't sort by {sort!r}")
    column = col.get_browser_column(sort)
    try:
        return list(col.find_cards(query or "deck:*", order=column, reverse=reverse))  # type: ignore[arg-type]
    except Exception as err:  # Anki's SearchError carries a readable message
        raise InvalidSearch(re.sub("[\u2066-\u2069]", "", str(err))) from err


def rows(col: Collection, card_ids: list[int]) -> list[BrowseRow]:
    """Display rows for up to MAX_PAGE cards, in the order given."""
    card_ids = card_ids[:MAX_PAGE]
    if not card_ids:
        return []
    found = col.db.all(
        "select c.id, c.nid, c.did, c.odid, c.ord, c.type, c.queue, c.due, c.odue, c.ivl, "
        "c.factor, c.reps, c.lapses, c.flags, c.data, n.sfld, n.tags, n.mid "
        "from cards c join notes n on n.id = c.nid "
        f"where c.id in ({','.join(str(int(i)) for i in card_ids)})"
    )
    by_id = {r[0]: r for r in found}
    today = col.sched.today
    today_date = date.today()
    fsrs = bool(col.get_config("fsrs", False))
    deck_names: dict[int, str] = {}
    templates: dict[tuple[int, int], str] = {}
    out: list[BrowseRow] = []
    for cid in card_ids:
        r = by_id.get(cid)
        if r is None:
            continue  # deleted since the search ran
        _, nid, did, odid, ord_, ctype, queue, due, odue, ivl, factor, reps, lapses, flags, data, sfld, tags, mid = r
        if did not in deck_names:
            deck_names[did] = col.decks.name(did)
        if (mid, ord_) not in templates:
            templates[(mid, ord_)] = _template_name(col, mid, ord_)
        difficulty = None
        if fsrs and data:
            try:
                d = json.loads(data).get("d")
                difficulty = round((d - 1) / 9, 3) if d else None
            except ValueError:
                pass
        tag_list = tags.split()
        out.append(
            BrowseRow(
                card_id=cid,
                note_id=nid,
                text=_preview(sfld),
                deck=deck_names[did],
                template=templates[(mid, ord_)],
                state=_state(queue, ctype),
                due=_due(queue, ctype, odue if odid and odue else due, today, today_date),
                interval_days=ivl if ctype == 2 else 0,
                ease=factor if (ctype == 2 and not fsrs) else None,
                difficulty=difficulty,
                reviews=reps,
                lapses=lapses,
                flag=flags & 0b111,
                marked="marked" in (t.lower() for t in tag_list),
                tags=tag_list,
            )
        )
    return out


# Bulk actions (each one undoable operation, as in the desktop browser)
##########################################################################


def suspend(col: Collection, card_ids: list[int]) -> int:
    return col.sched.suspend_cards(card_ids).count  # type: ignore[arg-type]


def unsuspend(col: Collection, card_ids: list[int]) -> int:
    col.sched.unsuspend_cards(card_ids)  # type: ignore[arg-type]
    return len(card_ids)


def set_flag(col: Collection, card_ids: list[int], flag: int) -> int:
    if not 0 <= flag <= 7:
        raise ValueError("flag must be 0-7")
    return col.set_user_flag_for_cards(flag, card_ids).count  # type: ignore[arg-type]


def add_tags(col: Collection, card_ids: list[int], tags: str) -> int:
    nids = _note_ids(col, card_ids)
    return col.tags.bulk_add(nids, _clean_tags(tags)).count  # type: ignore[arg-type]


def remove_tags(col: Collection, card_ids: list[int], tags: str) -> int:
    nids = _note_ids(col, card_ids)
    return col.tags.bulk_remove(nids, _clean_tags(tags)).count  # type: ignore[arg-type]


def set_due_date(col: Collection, card_ids: list[int], days: str) -> int:
    """Anki's Set Due Date: "0" today, "1-7" a random day in range, "!" also sets the interval."""
    if not re.fullmatch(r"\d+(-\d+)?!?", days.strip()):
        raise ValueError('Use a number of days like "0", "3" or "1-7" (add "!" to also set the interval).')
    col.sched.set_due_date(card_ids, days.strip())  # type: ignore[arg-type]
    return len(card_ids)


# Helpers
##########################################################################


def _note_ids(col: Collection, card_ids: list[int]) -> list[int]:
    if not card_ids:
        return []
    return col.db.list(f"select distinct nid from cards where id in ({','.join(str(int(i)) for i in card_ids)})")


def _clean_tags(tags: str) -> str:
    cleaned = " ".join(t for t in tags.split() if t)
    if not cleaned:
        raise ValueError("Enter at least one tag.")
    return cleaned


def _template_name(col: Collection, mid: int, ord_: int) -> str:
    nt = col.models.get(mid)  # type: ignore[arg-type]
    if not nt:
        return ""
    if nt["type"] == MODEL_CLOZE:
        return f"Cloze {ord_ + 1}"
    tmpls = nt["tmpls"]
    return tmpls[ord_]["name"] if ord_ < len(tmpls) else ""


def _state(queue: int, ctype: int) -> str:
    if queue == -1:
        return "suspended"
    if queue in (-2, -3):
        return "buried"
    return {0: "new", 1: "learning", 2: "review", 3: "relearning"}.get(ctype, "new")


def _due(queue: int, ctype: int, due: int, today: int, today_date: date) -> str | None:
    """Short due text: "Today", "Tomorrow", "Mar 14", "New #12"."""
    if ctype == 0:
        return f"New #{due}"
    if queue == 1 or (queue in (-1, -2, -3) and due > 1_000_000_000):
        # intraday learning: `due` is a timestamp
        when = time.localtime(due)
        return "Today" if time.strftime("%Y%m%d", when) == time.strftime("%Y%m%d") else time.strftime("%b %d", when)
    days = due - today
    if days == 0:
        return "Today"
    if days == 1:
        return "Tomorrow"
    if days == -1:
        return "Yesterday"
    d = today_date + timedelta(days=days)
    fmt = "%b %d" if d.year == today_date.year else "%b %d, %Y"
    return d.strftime(fmt).replace(" 0", " ")


def _preview(sfld: str) -> str:
    text = html.unescape(re.sub(r"<[^>]+>", " ", str(sfld)))
    text = re.sub(r"\{\{c\d+::(.*?)(::[^}]*)?\}\}", r"\1", text)
    return re.sub(r"\s+", " ", text).strip()[:200]
