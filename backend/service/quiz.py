"""Practice quizzes built from the user's own cards.

A quiz is read-only: it renders cards and reads their notes, and never
answers, reschedules or edits anything, so it can't affect reviews or sync.

Each question is a card's front (rendered as Anki would, shown in the
sandboxed card frame) and a short answer:

* cloze cards: the text of that card's cloze (`col.extract_cloze_for_typing`,
  as Anki's type-the-answer uses);
* other cards: the `[[type:Field]]` field if the card has one, else the first
  field the answer side shows that the front doesn't (Back on Basic).

Wrong options for multiple choice are other cards' answers:

* with smarter options on, the answers that mean the most similar thing
  (an `AnswerNeighbours` index, e.g. on-device embeddings; see backend/semantic);
* otherwise, or when that finds too few, answers from closely related cards:
  the card's most specific *topic* tags (AnKing: …::#B&B::03_Biochem::05_Glycolysis;
  not question-bank tags like …::#UWorld::Step::12345, which group unrelated
  facts), then their parent tags, then the card's deck. Groups too broad to
  mean "related" (a whole AnKing deck) are skipped.

A question with fewer than two good wrong options is asked as type-the-answer
rather than padded with random ones.
"""

from __future__ import annotations

import random
import re
from typing import Literal, Protocol

from anki.cards import Card
from anki.collection import Collection, SearchNode, StripHtmlMode

from .decks import deck_name
from .render import render_card
from .types import QuizQuestion, QuizSet, TagMatch

QuizCards = Literal["mixed", "weak", "all"]

MAX_QUESTIONS = 50
MAX_ANSWER_CHARS = 90
CHOICES = 4
MIN_WRONG = 2
"""Fewer good wrong options than this and the question is asked as type-the-answer."""
BROAD_GROUP = 1500
"""A tag, deck or quiz with more notes/cards than this is too broad to count as "related"."""
TOPIC_TAGS = 3
VARIETY = 0.05
"""Similar answers scoring within this of the best are equally good; pick among them for variety."""
_CANDIDATES_PER_GROUP = 30

# Question banks and resource IDs: their tags group facts by question, not by topic.
_QBANK = {"uworld", "amboss", "nbme", "uwsa", "qid", "qids", "truelearn", "kaplan", "rx", "usmlerx", "free120", "cms"}


class AnswerNeighbours(Protocol):
    """Finds answers in the collection that mean something similar (optional; see backend/semantic)."""

    def nearest(self, items: list[tuple[str, str]], limit: int) -> list[list[tuple[str, float]]]:
        """For each (answer, question) pair: other answers with a similarity score, best first."""
        ...

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
    neighbours: AnswerNeighbours | None = None,
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

    prompts = [card_prompt(col, card) for card, _ in picked]
    nearest = neighbours.nearest([(a, p) for (_, a), p in zip(picked, prompts)], 40) if neighbours and picked else None
    groups = _tag_groups(col, [t for card, _ in picked for t in topic_tags(card.note().tags)])
    # The quiz's own cards are "related" only when the quiz itself is focused (a tag, a small deck).
    focused_pool = pool if available <= BROAD_GROUP else []
    questions: list[QuizQuestion] = []
    for i, (card, answer) in enumerate(picked):
        prompt = prompts[i]
        wrong = _distractors(
            col, card, answer, answers, rng, groups, focused_pool, prompt, nearest[i] if nearest else None
        )
        if len(wrong) < MIN_WRONG:
            wrong = []  # asked as type-the-answer rather than padded with unrelated options
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


# For the answer index (backend/semantic): read-only, a chunk of notes at a time.
##########################################################################


def note_mod_times(col: Collection) -> dict[int, int]:
    """Every note's id and modification time: ids and numbers only, no note contents."""
    return {int(nid): int(mod) for nid, mod in col.db.all("select id, mod from notes")}


def note_answers(col: Collection, note_ids: list[int]) -> dict[int, tuple[int, list[str]]]:
    """For each note that still exists: (mod time, its cards' short answers)."""
    out: dict[int, tuple[int, list[str]]] = {}
    for nid in note_ids:
        try:
            note = col.get_note(nid)  # type: ignore[arg-type]
        except Exception:  # deleted meanwhile
            continue
        texts = [a for a in (card_answer(col, c) for c in note.cards()) if a]
        out[nid] = (int(note.mod), list(dict.fromkeys(texts)))
    return out


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
    focused_pool: list[int],
    prompt: str = "",
    similar: list[tuple[str, float]] | None = None,
) -> list[str]:
    """Up to three wrong options: similar answers first (if an index is on), then related cards."""
    target = _norm(answer)
    question = _norm(prompt)  # an option already printed in the question is a giveaway
    has_digit = any(ch.isdigit() for ch in answer)
    picked: list[str] = []
    seen = {target}

    def usable(text: str | None) -> bool:
        if not text:
            return False
        key = _norm(text)
        return bool(key) and key not in seen and not _overlaps(key, target) and not _overlaps(key, question)

    def take(text: str) -> None:
        seen.add(_norm(text))
        picked.append(text)

    if similar:
        close: list[tuple[str, float]] = []
        for text, score in similar:
            if usable(text) and all(_norm(text) != _norm(c) for c, _ in close):
                close.append((text, score))
            if len(close) >= CHOICES + 2:
                break
        if close:
            # Variety only among options about as good as the best; then the next best.
            band = [t for t, score in close if score >= close[0][1] - VARIETY]
            for text in rng.sample(band, min(len(band), CHOICES - 1)):
                take(text)
            for text, _ in close:
                if len(picked) >= CHOICES - 1:
                    break
                if usable(text):
                    take(text)
        if len(picked) >= MIN_WRONG:
            return picked

    def consider(ids: list[int]) -> None:
        cands: list[tuple[float, str]] = []
        for cid in ids:
            if cid == card.id:
                continue
            text = answers.get_id(cid)
            if text is None or not usable(text):
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
            if usable(text):
                take(text)

    tags = topic_tags(card.note().tags)
    notes = list(dict.fromkeys(n for t in tags for n in groups.get(t.lower(), []) if n != card.nid))
    if notes:
        sampled = rng.sample(notes, min(len(notes), _CANDIDATES_PER_GROUP))
        consider([rng.choice(col.card_ids_of_note(n)) for n in sampled])  # type: ignore[arg-type]
    for search in _related_searches(col, card, tags):
        if len(picked) >= CHOICES - 1:
            break
        ids = list(col.find_cards(search))
        if len(ids) > BROAD_GROUP:
            continue  # "same subject" at this size means nothing
        consider(rng.sample(ids, min(len(ids), _CANDIDATES_PER_GROUP)))
    if len(picked) < CHOICES - 1 and focused_pool:
        others = [c for c in focused_pool if c != card.id]
        consider(rng.sample(others, min(len(others), _CANDIDATES_PER_GROUP)))
    return picked


def topic_tags(tags: list[str]) -> list[str]:
    """The note's most specific hierarchical topic tags, deepest first.

    AnKing tags a card by topic (…::#B&B::03_Biochem::05_Glycolysis) and by
    the question-bank questions that test it (…::#UWorld::Step::12345). Only
    the first kind groups related facts.
    """
    topics = [t for t in tags if "::" in t and not _is_question_tag(t)]
    return sorted(topics, key=lambda t: (-t.count("::"), -len(t)))[:TOPIC_TAGS]


def _is_question_tag(tag: str) -> bool:
    for part in tag.lower().split("::")[1:]:
        word = re.sub(r"[^a-z0-9&]", "", part)
        if word in _QBANK or re.fullmatch(r"[\d_.\-]+", part):
            return True
    return False


def _like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _tag_groups(col: Collection, tags: list[str]) -> dict[str, list[int]]:
    """Note ids under each tag (lowercased), in one pass over the notes.

    One Anki tag search per question costs ~35 ms at 100k notes (a regex per
    note); a single LIKE over all of them costs about the same as one.
    Matches like Anki's tag search: the tag itself or any of its children.
    """
    wanted = {t.lower() for t in tags if t}
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
    # A tag on thousands of notes doesn't mean "related".
    return {t: list(dict.fromkeys(ids)) for t, ids in groups.items() if len(set(ids)) <= BROAD_GROUP}


def _related_searches(col: Collection, card: Card, tags: list[str]) -> list[str]:
    """After the card's own topic tags: their parents (one level up), then its deck and the deck's parent.

    The caller skips results too broad to mean "related".
    """
    searches = []
    for tag in tags:
        parts = tag.split("::")
        if len(parts) > 2:
            searches.append(col.build_search_string(SearchNode(tag="::".join(parts[:-1]))))
    deck = deck_name(col, card.odid or card.did).split("::")
    for depth in range(len(deck), max(len(deck) - 2, 0), -1):
        searches.append(col.build_search_string(SearchNode(deck="::".join(deck[:depth]))))
    return list(dict.fromkeys(searches))
