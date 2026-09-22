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

_TYPE_ANSWER_RE = re.compile(r"\[\[type:[^\]]+\]\]")

# Same markup as aqt.sound.av_refs_to_play_icons, so deck CSS targeting
# .replay-button / .soundLink / .playImage still applies. Clicks are handled by
# the iframe runtime via data-av instead of pycmd().
_PLAY_BUTTON = """<a class="replay-button soundLink" href="#" data-av="{ref}" draggable="false" aria-label="Play audio"><svg class="playImage" viewBox="0 0 64 64" version="1.1"><circle cx="32" cy="32" r="29" /><path d="M56.502,32.301l-37.502,20.101l0.329,-40.804l37.173,20.703Z" /></svg></a>"""


def render_card(col: Collection, card: Card) -> RenderedCard:
    out = card.render_output(reload=True)
    audio = _audio_refs("q", out.question_av_tags) + _audio_refs(
        "a", out.answer_av_tags
    )
    question = _prepare(col, out.question_text, side="q")
    answer = _prepare(col, out.answer_text, side="a")
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
    )


def _prepare(col: Collection, text: str, side: str) -> str:
    text = col.media.escape_media_filenames(text)
    text = AV_REF_RE.sub(lambda m: _PLAY_BUTTON.format(ref=html.escape(m.group(1))), text)
    if side == "q":
        text = _TYPE_ANSWER_RE.sub(
            '<input id="typeans" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Type answer">',
            text,
        )
    else:
        text = _TYPE_ANSWER_RE.sub("", text)
    return text


def _audio_refs(side: str, tags: list) -> list[AudioRef]:
    return [
        AudioRef(side=side, index=i, filename=tag.filename)  # type: ignore[arg-type]
        for i, tag in enumerate(tags)
        if isinstance(tag, SoundOrVideoTag)
    ]
