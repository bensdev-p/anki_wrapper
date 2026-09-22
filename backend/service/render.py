"""Card HTML rendering, matching what Anki desktop's reviewer feeds its webview.

Mirrors aqt: `card.render_output()` → `col.media.escape_media_filenames()` →
replace `[anki:play:q:N]` refs with play buttons (aqt.sound.av_refs_to_play_icons).
The client places the HTML inside a sandboxed iframe with the notetype CSS.
"""

from __future__ import annotations

import html
import re

from anki.cards import Card
from anki.collection import Collection
from anki.sound import AV_REF_RE, SoundOrVideoTag

from .types import AudioRef, RenderedCard

# aqt.reviewer.Reviewer.typeAnsPat
_TYPE_ANSWER_RE = re.compile(r"\[\[type:(.+?)\]\]")

# Same markup as aqt.sound.av_refs_to_play_icons, so deck CSS targeting
# .replay-button / .soundLink / .playImage still applies. Clicks are handled by
# the iframe runtime via data-av instead of pycmd().
_PLAY_BUTTON = """<a class="replay-button soundLink" href="#" data-av="{ref}" draggable="false" aria-label="Play audio"><svg class="playImage" viewBox="0 0 64 64" version="1.1"><circle cx="32" cy="32" r="29" /><path d="M56.502,32.301l-37.502,20.101l0.329,-40.804l37.173,20.703Z" /></svg></a>"""


def render_card(col: Collection, card: Card) -> RenderedCard:
    out = card.render_output(reload=True)
    audio = _audio_refs("q", out.question_av_tags) + _audio_refs(
        "a", out.answer_av_tags
    )
    field = _type_answer_field(card, out.question_text)
    question = _prepare(col, out.question_text, side="q", field=field)
    answer = _prepare(col, out.answer_text, side="a", field=field)
    conf = col.decks.config_dict_for_deck_id(card.current_deck_id())
    return RenderedCard(
        question_html=question,
        answer_html=answer,
        css=out.css,
        # aqt.theme.body_classes_for_card_ord(); night-mode classes
        # ("nightMode night_mode") are added client-side from the active theme.
        body_class=f"card card{card.ord + 1}",
        audio=audio,
        autoplay=bool(conf.get("autoplay", True)),
        type_answer=field is not None,
    )


def _prepare(col: Collection, text: str, side: str, field: _TypeField | None) -> str:
    text = col.media.escape_media_filenames(text)
    text = AV_REF_RE.sub(lambda m: _PLAY_BUTTON.format(ref=html.escape(m.group(1))), text)
    if field is None:
        return _TYPE_ANSWER_RE.sub("", text)
    style = f"font-family: '{html.escape(field.font)}'; font-size: {int(field.size)}px;"
    if side == "q":
        box = (
            f'<center><input id="typeans" type="text" style="{style}" autocomplete="off" '
            'autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Type your answer"></center>'
        )
    else:
        # Filled in with col.compare_answer() output once the typed text is known.
        box = f'<div id="typeans-result" style="{style}"></div>'
    return _TYPE_ANSWER_RE.sub(lambda _: box, text, count=1)


class _TypeField:
    def __init__(self, name: str, cloze_ord: int | None, combining: bool, font: str, size: int) -> None:
        self.name, self.cloze_ord, self.combining, self.font, self.size = name, cloze_ord, combining, font, size


def _type_answer_field(card: Card, question_text: str) -> _TypeField | None:
    """Mirror of aqt.reviewer.Reviewer.typeAnsQuestionFilter's field lookup."""
    m = _TYPE_ANSWER_RE.search(question_text)
    if not m:
        return None
    name = m.group(1)
    cloze_ord = None
    combining = True
    if name.startswith("cloze:"):
        cloze_ord = card.ord + 1
        name = name.split(":", 1)[1]
    if name.startswith("nc:"):
        combining = False
        name = name.split(":", 1)[1]
    for f in card.note_type()["flds"]:
        if f["name"] == name:
            return _TypeField(name, cloze_ord, combining, f.get("font", "Arial"), f.get("size", 20))
    return None


def compare_typed_answer(col: Collection, card: Card, typed: str) -> str:
    """HTML diff of what she typed vs the expected answer (col.compare_answer, as aqt)."""
    field = _type_answer_field(card, card.render_output().question_text)
    if field is None:
        return ""
    expected = card.note()[field.name]
    if field.cloze_ord:
        expected = col.extract_cloze_for_typing(expected, field.cloze_ord)
    return col.compare_answer(expected, typed, field.combining)


def _audio_refs(side: str, tags: list) -> list[AudioRef]:
    return [
        AudioRef(side=side, index=i, filename=tag.filename)  # type: ignore[arg-type]
        for i, tag in enumerate(tags)
        if isinstance(tag, SoundOrVideoTag)
    ]
