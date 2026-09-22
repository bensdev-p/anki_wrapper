from __future__ import annotations

import pytest
from anki.collection import Collection

import service
from service.types import Counts


def _deck(col: Collection, name: str) -> int:
    did = col.decks.id_for_name(name)
    assert did, name
    return did


def _find(nodes, full_name):
    for n in nodes:
        if n.full_name == full_name:
            return n
        if found := _find(n.children, full_name):
            return found
    return None


# Deck tree
##########################################################################


def test_deck_tree_is_nested_with_counts(col: Collection) -> None:
    tree = service.deck_tree(col)
    pharm = _find(tree, "Step 1::Cardio::Pharm")
    assert pharm is not None
    assert pharm.name == "Pharm" and pharm.level == 3

    step1 = _find(tree, "Step 1")
    c = step1.counts
    assert c.new > 0 and c.learning > 0 and c.review > 0, c


def test_deck_counts_match_scheduler_queue(col: Collection) -> None:
    state = service.select_deck(col, _deck(col, "Step 1"))
    node = _find(service.deck_tree(col), "Step 1")
    assert state.counts == node.counts


# Studying
##########################################################################


def test_study_card_has_labels_and_rendering(col: Collection) -> None:
    state = service.select_deck(col, _deck(col, "Step 1"))
    card = state.card
    assert card is not None
    assert len(card.button_labels) == 4 and all(card.button_labels)
    assert not any("⁨" in label for label in card.button_labels)
    assert card.rendered.css
    assert card.rendered.body_class.startswith("card card")


def test_answering_changes_due_and_updates_counts(col: Collection) -> None:
    state = service.select_deck(col, _deck(col, "Step 1"))
    card = state.card
    assert card is not None
    before = col.get_card(card.card_id)

    result = service.answer_card(col, card.card_id, rating=3, ms_taken=4000)

    after = col.get_card(card.card_id)
    assert result.due_before == before.due
    assert after.due != before.due
    assert result.due_after == after.due
    assert after.reps == before.reps + 1

    new_state = service.study_state(col)
    assert new_state.counts != state.counts
    assert new_state.can_undo
    assert new_state.card is None or new_state.card.card_id != card.card_id or card.queue == "learning"


@pytest.mark.parametrize("queue", ["new", "learning", "review"])
def test_answer_decrements_the_right_count(col: Collection, queue: str) -> None:
    service.select_deck(col, _deck(col, "Step 1"))
    # Answer until a card from the wanted queue is at the front.
    for _ in range(200):
        state = service.study_state(col)
        assert state.card is not None
        if state.card.queue == queue:
            break
        service.answer_card(col, state.card.card_id, 3, 1000)
    before: Counts = state.counts
    service.answer_card(col, state.card.card_id, 4, 1000)  # Easy leaves learning
    after = service.study_state(col).counts
    assert getattr(after, queue) == getattr(before, queue) - 1


def test_undo_reverts_answer(col: Collection) -> None:
    state = service.select_deck(col, _deck(col, "Step 1"))
    card = state.card
    assert card is not None
    before = col.get_card(card.card_id)
    revlog_before = col.db.scalar("select count() from revlog where cid = ?", card.card_id)

    service.answer_card(col, card.card_id, rating=1, ms_taken=2000)
    assert col.get_card(card.card_id).due != before.due or col.get_card(card.card_id).queue != before.queue

    result = service.undo(col)
    assert result.undone == "Answer Card"

    restored = col.get_card(card.card_id)
    assert (restored.due, restored.queue, restored.type, restored.ivl, restored.reps) == (
        before.due, before.queue, before.type, before.ivl, before.reps,
    )
    assert col.db.scalar("select count() from revlog where cid = ?", card.card_id) == revlog_before

    again = service.study_state(col)
    assert again.card is not None and again.card.card_id == card.card_id
    assert again.counts == state.counts


def test_undo_does_not_undo_deck_selection(col: Collection) -> None:
    service.select_deck(col, _deck(col, "Step 2 CK"))
    assert not service.study_state(col).can_undo
    with pytest.raises(service.NothingToUndo):
        service.undo(col)
    assert col.decks.get_current_id() == _deck(col, "Step 2 CK")


def test_answering_a_stale_card_is_rejected(col: Collection) -> None:
    state = service.select_deck(col, _deck(col, "Step 1"))
    card = state.card
    assert card is not None
    service.answer_card(col, card.card_id, 4, 1000)
    with pytest.raises(service.StaleCard):
        service.answer_card(col, card.card_id, 4, 1000)


def test_invalid_rating(col: Collection) -> None:
    state = service.select_deck(col, _deck(col, "Step 1"))
    with pytest.raises(ValueError):
        service.answer_card(col, state.card.card_id, 5, 1000)


def test_unknown_deck(col: Collection) -> None:
    with pytest.raises(service.NotFound):
        service.select_deck(col, 999_999)


# Rendering
##########################################################################


def test_render_audio_becomes_play_button(col: Collection) -> None:
    cid = col.find_cards('"Front:Listen*"')[0]
    rendered = service.render_card(col, col.get_card(cid))
    assert "[sound:" not in rendered.answer_html
    assert 'data-av="play:a:0"' in rendered.answer_html
    assert [a.filename for a in rendered.audio] == ["s3_gallop.wav"]


def test_render_custom_notetype_css_and_script(col: Collection) -> None:
    cid = col.find_cards('"note:Med Cloze (sample)"')[0]
    rendered = service.render_card(col, col.get_card(cid))
    assert ".nightMode" in rendered.css
    assert "<script>" in rendered.question_html
    assert 'class="cloze"' in rendered.question_html


def test_render_escapes_media_filenames(col: Collection) -> None:
    cid = col.find_cards("ecg_afib")[0]
    rendered = service.render_card(col, col.get_card(cid))
    html = rendered.question_html + rendered.answer_html
    assert 'src="ecg_afib.svg"' in html


# Search
##########################################################################


def test_search(col: Collection) -> None:
    result = service.search_cards(col, "digoxin")
    assert result.total >= 2
    assert all("igoxin" in h.preview for h in result.hits)
    assert service.search_cards(col, "deck:*", limit=5).total == col.card_count()
    assert len(service.search_cards(col, "deck:*", limit=5).hits) == 5
