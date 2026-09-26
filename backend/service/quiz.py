"""Practice quizzes built from the user's own cards.

A quiz is read-only: it renders cards and reads their notes, and never
answers, reschedules or edits anything, so it can't affect reviews or sync.

Each question is a card's front (rendered as Anki would, shown in the
sandboxed card frame) and a short answer:

* cloze cards: the text of that card's cloze (`col.extract_cloze_for_typing`,
  as Anki's type-the-answer uses);
* other cards: the `[[type:Field]]` field if the card has one, else the first
  field the answer side shows that the front doesn't (Back on Basic).

Wrong options for multiple choice are other cards' answers, from the most
closely related cards first: the card's most specific tag (AnKing tags are
deep, e.g. …::B&B::Glycolysis), then its parent tags, the quiz's own cards,
and finally the card's deck.
"""

from __future__ import annotations

import random
import re
from typing import Literal

from anki.cards import Card
from anki.collection import Collection, SearchNode, StripHtmlMode

from .decks import deck_name
from .render import render_card
from .types import QuizQuestion, QuizSet, TagMatch

QuizCards = Literal["mixed", "weak", "all"]

MAX_QUESTIONS = 50
MAX_ANSWER_CHARS = 90
CHOICES = 4
_CANDIDATES_PER_GROUP = 30

_FIELD_REF = re.compile(r"\{\{([^#/^!{}][^{}]*)\}\}")
_SOUND = re.compile(r"\[sound:[^\]]*\]")
_SPACE = re.compile(r"\s+")


# Picking a source
##########################################################################


def find_tags(col: Collection, query: str, limit: int = 40) -> list[TagMatch]:
    """Tags containing every word of `query` (e.g. "cardio pharm"), shallowest first."""
    words = [w for w in query.lower().split() if w]
    if not words:
        return []
    hits = [t for t in col.tags.all() if all(w in t.lower() for w in words)]
    hits.sort(key=lambda t: (t.count("::"), len(t), t.lower()))
    return [TagMatch(tag=t, label=_tag_label(t)) for t in hits[:limit]]


def _tag_label(tag: str) -> str:
    """The last two levels, readable: "#AK_Step1_v12::#B&B::05_Glycolysis" → "#B&B › Glycolysis"."""
    parts = [re.sub(r"^\d+[_ ]", "", p).replace("_", " ") for p in tag.split("::")]
    return " › ".join(parts[-2:])


def source_search(col: Collection, deck_id: int | None, tag: str | None) -> str:
    nodes: list[SearchNode | str] = []
    if deck_id:
        nodes.append(SearchNode(deck=deck_name(col, deck_id)))
    if tag:
        nodes.append(SearchNode(tag=tag))
    return col.build_search_string(*nodes) if nodes else "deck:*"


def _cards_search(base: str, cards: QuizCards) -> str:
    if cards == "all":
        return f"({base}) -is:suspended"
    if cards == "weak":
        # Cards she has forgotten at least once, or finds hard (low ease).
        return f"({base}) -is:suspended -is:new (prop:lapses>0 OR prop:ease<2.2)"
    return f"({base}) -is:suspended -is:new"


# Building a quiz
##########################################################################


def build_quiz(
    col: Collection,
    deck_id: int | None,
    tag: str | None,
    count: int,
    cards: QuizCards = "mixed",
    card_ids: list[int] | None = None,
    seed: int | None = None,
) -> QuizSet:
    """Up to `count` questions from the chosen deck and/or tag (or exactly `card_ids`, to retry misses)."""
    rng = random.Random(seed)
    count = max(1, min(count, MAX_QUESTIONS))
    base = source_search(col, deck_id, tag)
    if card_ids:
        pool = list(dict.fromkeys(card_ids))[:MAX_QUESTIONS]
        available = len(pool)
    else:
        if cards == "weak":
            # Most-forgotten first; sample among the weakest few times the quiz size.
            ids = list(col.find_cards(_cards_search(base, cards), order="c.lapses desc, c.factor asc"))[: count * 4]
        else:
            ids = list(col.find_cards(_cards_search(base, cards)))
        available = len(ids)
        pool = rng.sample(ids, min(len(ids), count * 20))

    answers = _AnswerCache(col)
    picked: list[tuple[Card, str]] = []
    for cid in pool:
        if len(picked) >= count:
            break
        card = col.get_card(cid)  # type: ignore[arg-type]
        answer = answers.get(card)
        if answer is not None:
            picked.append((card, answer))

    groups = _leaf_tag_groups(col, [_leaf_tag(card) for card, _ in picked])
    questions: list[QuizQuestion] = []
    for card, answer in picked:
        prompt = card_prompt(col, card)
        wrong = _distractors(col, card, answer, answers, rng, groups, base_pool=pool, prompt=prompt)
        choices = [answer, *wrong]
        rng.shuffle(choices)
        questions.append(
            QuizQuestion(
                card_id=card.id,
                note_id=card.nid,
                deck_name=deck_name(col, card.did),
                answer=answer,
                prompt=prompt,
                choices=choices if wrong else [],
                correct=choices.index(answer) if wrong else -1,
                rendered=render_card(col, card, type_box=False),
            )
        )
    return QuizSet(search=base, available=available, questions=questions)


class _AnswerCache:
    def __init__(self, col: Collection) -> None:
        self.col = col
        self._by_card: dict[int, str | None] = {}

    def get(self, card: Card) -> str | None:
        if card.id not in self._by_card:
            self._by_card[card.id] = card_answer(self.col, card)
        return self._by_card[card.id]

    def get_id(self, cid: int) -> str | None:
        if cid not in self._by_card:
            self._by_card[cid] = card_answer(self.col, self.col.get_card(cid))  # type: ignore[arg-type]
        return self._by_card[cid]


def card_answer(col: Collection, card: Card) -> str | None:
    """A short plain-text answer for this card, or None if it doesn't have one (e.g. image-only)."""
    note = card.note()
    notetype = card.note_type()
    template = card.template()
    if notetype["type"] == 1:  # cloze
        m = re.search(r"\{\{(?:[^{}]*:)?cloze:([^{}]+)\}\}", template["qfmt"])
        if not m or m.group(1).strip() not in note:
            return None
        raw = col.extract_cloze_for_typing(note[m.group(1).strip()], card.ord + 1)
        if raw.startswith("image-occlusion:"):
            return None
    else:
        field = _answer_field(template["qfmt"], template["afmt"], note.keys())
        if field is None:
            return None
        raw = note[field]
    text = _clean(col, raw)
    if not text or len(text) > MAX_ANSWER_CHARS:
        return None
    return text


_CLOZE = re.compile(r"\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}", re.DOTALL)
MAX_PROMPT_CHARS = 180


def card_prompt(col: Collection, card: Card) -> str:
    """The question as one line of plain text, for the results list ("The [...] is the primary pacemaker…")."""
    note = card.note()
    template = card.template()
    if card.note_type()["type"] == 1:
        m = re.search(r"\{\{(?:[^{}]*:)?cloze:([^{}]+)\}\}", template["qfmt"])
        name = m.group(1).strip() if m else ""
        raw = note[name] if name in note else ""
        ord_ = str(card.ord + 1)
        raw = _CLOZE.sub(lambda c: f"[{c.group(3) or '...'}]" if c.group(1) == ord_ else c.group(2), raw)
    else:
        names = [_ref_name(r) for r in _FIELD_REF.findall(template["qfmt"])]
        raw = next((note[n] for n in names if n in note and note[n].strip()), "")
    text = _clean(col, raw)
    return text if len(text) <= MAX_PROMPT_CHARS else text[: MAX_PROMPT_CHARS - 1].rstrip() + "…"


def _answer_field(qfmt: str, afmt: str, fields: list[str]) -> str | None:
    typed = re.search(r"\{\{type:(?:nc:)?([^{}]+)\}\}", qfmt)
    if typed and typed.group(1) in fields:
        return typed.group(1)
    front = {_ref_name(r) for r in _FIELD_REF.findall(qfmt)}
    for ref in _FIELD_REF.findall(afmt):
        name = _ref_name(ref)
        if name in fields and name not in front:
            return name
    return None


def _ref_name(ref: str) -> str:
    return ref.split(":")[-1].strip()


def _clean(col: Collection, raw: str) -> str:
    # anki.utils.strip_html, via the collection's backend (the global i18n one
    # only exists once aqt sets a UI language).
    text = col._backend.strip_html(text=_SOUND.sub(" ", raw), mode=StripHtmlMode.NORMAL)
    return _SPACE.sub(" ", text).strip("  ")


def _norm(text: str) -> str:
    return re.sub(r"[^\w]+", " ", text.lower()).strip()


def _overlaps(a: str, b: str) -> bool:
    """One answer inside the other ("ACE" / "ACE inhibitors") makes a giveaway option."""
    short, long = sorted((a, b), key=len)
    return len(short) >= 3 and f" {short} " in f" {long} "


def _distractors(
    col: Collection,
    card: Card,
    answer: str,
    answers: _AnswerCache,
    rng: random.Random,
    groups: dict[str, list[int]],
    base_pool: list[int],
    prompt: str = "",
) -> list[str]:
    """Up to three other answers from related cards, similar in length and kind."""
    target = _norm(answer)
    question = _norm(prompt)  # an option already printed in the question is a giveaway
    has_digit = any(ch.isdigit() for ch in answer)
    picked: list[str] = []
    seen = {target}

    def consider(ids: list[int]) -> None:
        cands: list[tuple[float, str]] = []
        for cid in ids:
            if cid == card.id:
                continue
            text = answers.get_id(cid)
            if not text:
                continue
            key = _norm(text)
            if not key or key in seen or _overlaps(key, target) or _overlaps(key, question):
                continue
            # Similar length and the same kind (numbers with numbers) look plausible.
            score = abs(len(text) - len(answer)) / max(len(answer), 1)
            if any(ch.isdigit() for ch in text) != has_digit:
                score += 1
            cands.append((score + rng.random() * 0.6, text))
        cands.sort(key=lambda c: c[0])
        for _, text in cands:
            if len(picked) >= CHOICES - 1:
                return
            key = _norm(text)
            if key not in seen:
                seen.add(key)
                picked.append(text)

    leaf = _leaf_tag(card)
    if leaf:
        notes = [n for n in groups.get(leaf.lower(), []) if n != card.nid]
        sampled = rng.sample(notes, min(len(notes), _CANDIDATES_PER_GROUP))
        consider([rng.choice(col.card_ids_of_note(n)) for n in sampled])  # type: ignore[arg-type]
    for search in _related_searches(col, card):
        if len(picked) >= CHOICES - 1:
            break
        ids = list(col.find_cards(search))
        consider(rng.sample(ids, min(len(ids), _CANDIDATES_PER_GROUP)))
    if len(picked) < CHOICES - 1:
        others = [c for c in base_pool if c != card.id]
        consider(rng.sample(others, min(len(others), _CANDIDATES_PER_GROUP)))
    return picked


def _leaf_tag(card: Card) -> str | None:
    """The card's most specific hierarchical tag (AnKing: …::#B&B::05_Glycolysis)."""
    tags = [t for t in card.note().tags if "::" in t]
    return max(tags, key=lambda t: (t.count("::"), len(t))) if tags else None


def _like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _leaf_tag_groups(col: Collection, leaves: list[str | None]) -> dict[str, list[int]]:
    """Note ids under each tag (lowercased), in one pass over the notes.

    One Anki tag search per question costs ~35 ms at 100k notes (a regex per
    note); a single LIKE over all of them costs about the same as one.
    Matches like Anki's tag search: the tag itself or any of its children.
    """
    wanted = {t.lower() for t in leaves if t}
    if not wanted:
        return {}
    where = " or ".join(["tags like ? escape '\\'"] * len(wanted))
    args = [f"% {_like(t)}%" for t in wanted]
    groups: dict[str, list[int]] = {t: [] for t in wanted}
    for nid, tags in col.db.all(f"select id, tags from notes where {where}", *args):
        for tag in tags.lower().split():
            for want in wanted:
                if tag == want or tag.startswith(want + "::"):
                    groups[want].append(nid)
    return {t: list(dict.fromkeys(ids)) for t, ids in groups.items()}


def _related_searches(col: Collection, card: Card) -> list[str]:
    """After the card's own tag: its parent tags (two levels up), then its deck and the deck's parent."""
    searches = []
    leaf = _leaf_tag(card)
    if leaf:
        parts = leaf.split("::")
        for depth in range(len(parts) - 1, max(len(parts) - 3, 1), -1):
            searches.append(col.build_search_string(SearchNode(tag="::".join(parts[:depth]))))
    deck = deck_name(col, card.odid or card.did).split("::")
    for depth in range(len(deck), max(len(deck) - 2, 0), -1):
        searches.append(col.build_search_string(SearchNode(deck="::".join(deck[:depth]))))
    return searches
