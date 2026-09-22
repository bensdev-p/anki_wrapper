"""Card search using Anki's own search syntax (same as the desktop browser)."""

from __future__ import annotations

import html
import re

from anki.collection import Collection

from .types import SearchHit, SearchResult

_MAX_LIMIT = 200


def search_cards(col: Collection, query: str, limit: int = 50) -> SearchResult:
    """Find cards matching `query` and return light previews of the first `limit`.

    find_cards() returns ids only (cheap even at 100k cards); previews are then
    fetched for just the page being shown, in one SQL query.
    """
    limit = max(1, min(limit, _MAX_LIMIT))
    ids = col.find_cards(query, order=True)
    page = list(ids[:limit])
    hits: list[SearchHit] = []
    if page:
        rows = col.db.all(
            "select c.id, c.nid, c.did, n.sfld from cards c join notes n on n.id = c.nid "
            f"where c.id in ({','.join(str(int(i)) for i in page)})"
        )
        by_id = {row[0]: row for row in rows}
        for cid in page:
            cid_, nid, did, sfld = by_id[cid]
            hits.append(
                SearchHit(
                    card_id=cid_,
                    note_id=nid,
                    deck_id=did,
                    deck_name=col.decks.name(did),
                    preview=_preview(str(sfld)),
                )
            )
    return SearchResult(query=query, total=len(ids), hits=hits)


def _preview(text: str) -> str:
    text = html.unescape(re.sub(r"<[^>]+>", " ", text))
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\{\{c\d+::(.*?)(::[^}]*)?\}\}", r"\1", text)
    return text[:160]
