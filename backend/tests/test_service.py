from __future__ import annotations

import re

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
    assert any("igoxin" in h.preview for h in result.hits)
    assert service.search_cards(col, "deck:*", limit=5).total == col.card_count()
    assert len(service.search_cards(col, "deck:*", limit=5).hits) == 5


# Stats
##########################################################################


def test_stats_whole_collection(col: Collection) -> None:
    s = service.stats(col)
    c = s.cards
    assert c.new + c.learning + c.young + c.mature + c.suspended + c.buried == col.card_count()
    assert s.fsrs
    assert len(s.reviews) > 60  # simulated months of history
    assert all(-90 < r.day <= 0 for r in s.reviews)  # default window
    year = service.stats(col, days=365)
    assert year.days == 365 and len(year.reviews) >= len(s.reviews)
    with pytest.raises(ValueError):
        service.stats(col, days=0)
    assert [r.day for r in s.reviews] == sorted(r.day for r in s.reviews)
    assert s.forecast and s.forecast[0].day >= 0
    assert s.average_retrievability is not None and 0.5 < s.average_retrievability < 1
    assert set(s.retention) == {"today", "yesterday", "week", "month", "year", "all_time"}


def test_stats_deck_scope_and_answer_updates_today(col: Collection) -> None:
    did = _deck(col, "Step 1::Cardio")
    whole, deck = service.stats(col), service.stats(col, did)
    assert deck.deck_name == "Step 1::Cardio"
    total = lambda s: sum(vars(s.cards).values())  # noqa: E731
    assert 0 < total(deck) < total(whole)

    state = service.select_deck(col, did)
    service.answer_card(col, state.card.card_id, 3, 5000)
    after = service.stats(col, did)
    assert after.today.answered == deck.today.answered + 1


def test_stats_unknown_deck(col: Collection) -> None:
    with pytest.raises(service.NotFound):
        service.stats(col, 999_999)


# Card actions, card info, notes
##########################################################################


def _front(col: Collection):
    state = service.select_deck(col, _deck(col, "Step 1"))
    assert state.card is not None
    return state


def test_flag_toggles_and_is_undoable(col: Collection) -> None:
    card = _front(col).card
    assert service.set_flag(col, card.card_id, 1) == 1
    assert col.get_card(card.card_id).user_flag() == 1
    assert service.set_flag(col, card.card_id, 1) == 0  # same flag again clears it
    assert service.set_flag(col, card.card_id, 4) == 4
    assert service.study_state(col).can_undo
    result = service.undo(col)
    assert not result.was_answer
    assert col.get_card(card.card_id).user_flag() == 0


def test_mark_toggles_tag(col: Collection) -> None:
    card = _front(col).card
    assert service.toggle_mark(col, card.note_id) is True
    assert col.get_note(card.note_id).has_tag("marked")
    assert service.toggle_mark(col, card.note_id) is False
    assert not col.get_note(card.note_id).has_tag("marked")


@pytest.mark.parametrize("action", [service.suspend, service.bury])
def test_suspend_and_bury_remove_card_from_queue_and_undo(col: Collection, action) -> None:
    state = _front(col)
    cid = state.card.card_id
    after = action(col, cid)
    assert after.card is None or after.card.card_id != cid
    assert service.undo(col).was_answer is False
    assert service.study_state(col).card.card_id == cid


def test_bury_note_buries_siblings(col: Collection) -> None:
    # a cloze note with two cards
    nid = next(n for n in col.find_notes('"note:Med Cloze (sample)"') if len(col.get_note(n).card_ids()) > 1)
    cids = col.get_note(nid).card_ids()
    service.bury(col, cids[0], whole_note=True)
    assert all(col.get_card(c).queue < 0 for c in cids)


def test_answer_undo_reports_was_answer(col: Collection) -> None:
    card = _front(col).card
    service.answer_card(col, card.card_id, 3, 1000)
    assert service.undo(col).was_answer is True


def test_card_info(col: Collection) -> None:
    reviewed = col.find_cards("-is:new")[0]
    info = service.card_info(col, reviewed)
    assert info.reviews >= 1 and info.revlog
    assert info.fsrs and info.stability_days and info.difficulty
    assert info.revlog[0].kind in ("learning", "review", "relearning", "filtered", "manual", "rescheduled")
    new = service.card_info(col, col.find_cards("is:new")[0])
    assert new.reviews == 0 and new.due and new.due.startswith("New")


def test_type_answer_render_and_compare(col: Collection) -> None:
    cid = col.find_cards('"note:Basic (type in the answer)" acetaminophen')[0]
    rendered = service.render_card(col, col.get_card(cid))
    assert rendered.type_answer
    assert 'id="typeans"' in rendered.question_html
    assert 'id="typeans-result"' in rendered.answer_html
    assert "[[type:" not in rendered.question_html + rendered.answer_html
    good = service.compare_answer(col, cid, "N-acetylcysteine")
    bad = service.compare_answer(col, cid, "naloxone")
    assert "typeGood" in good and "typeBad" not in good
    assert "typeBad" in bad or "typeMissed" in bad


def test_update_note_writes_only_changed_fields_and_undoes(col: Collection) -> None:
    card = _front(col).card
    before = service.note_for_edit(col, card.note_id)
    first = before.fields[0]
    edited = service.update_note(col, card.note_id, {first.name: first.html + " <b>edited</b>"}, tags=[*before.tags, "rounds"])
    assert edited.fields[0].html.endswith("<b>edited</b>")
    assert edited.fields[1:] == before.fields[1:]
    assert "rounds" in edited.tags
    assert "edited" in service.rerender(col, card.card_id).question_html + service.rerender(col, card.card_id).answer_html
    assert service.study_state(col).undo_label == "Update Note"
    service.undo(col)
    assert service.note_for_edit(col, card.note_id).fields[0].html == first.html
    with pytest.raises(ValueError):
        service.update_note(col, card.note_id, {"Nope": "x"})


def test_note_edit_never_changes_schema(col: Collection) -> None:
    card = _front(col).card
    note = service.note_for_edit(col, card.note_id)
    scm = col.db.scalar("select scm from col")
    service.update_note(col, card.note_id, {note.fields[0].name: note.fields[0].html + " changed"})
    assert col.db.scalar("select scm from col") == scm


def test_update_note_refuses_blanking_cards(col: Collection) -> None:
    nid = next(n for n in col.find_notes('"note:Med Cloze (sample)"') if len(col.get_note(n).card_ids()) > 1)
    text = service.note_for_edit(col, nid).fields[0].html
    with pytest.raises(ValueError, match="c2"):
        service.update_note(col, nid, {"Text": re.sub(r"\{\{c2::(.*?)\}\}", r"\1", text)})
    with pytest.raises(ValueError):
        service.update_note(col, nid, {"Text": "no clozes at all"})
    assert service.note_for_edit(col, nid).fields[0].html == text  # unchanged


# Browser
##########################################################################


def test_browser_search_sort_and_rows(col: Collection) -> None:
    ids = service.browser.search_ids(col, "deck:*", "cardDue", False)
    assert len(ids) == col.card_count()
    rows = service.browser.rows(col, ids[:50])
    assert [r.card_id for r in rows] == ids[:50]
    assert all(r.text and r.deck for r in rows)
    reverse = service.browser.search_ids(col, "deck:*", "cardDue", True)
    assert reverse != ids
    assert set(reverse) == set(ids)
    assert service.browser.search_ids(col, "is:suspended", "noteFld") == []
    with pytest.raises(service.browser.InvalidSearch):
        service.browser.search_ids(col, "deck:(", "noteFld")
    with pytest.raises(ValueError):
        service.browser.search_ids(col, "", "notAColumn")


def test_browser_rows_states(col: Collection) -> None:
    new = service.browser.rows(col, list(col.find_cards("is:new"))[:1])[0]
    assert new.state == "new" and new.due.startswith("New #")
    review = service.browser.rows(col, list(col.find_cards("is:review -is:learn"))[:1])[0]
    assert review.state == "review" and review.interval_days > 0 and review.difficulty is not None


def test_browser_bulk_actions_and_undo(col: Collection) -> None:
    ids = list(col.find_cards('"deck:Step 1::Renal"'))
    assert service.browser.suspend(col, ids) == len(ids)
    assert set(col.find_cards("is:suspended")) == set(ids)
    service.undo(col)
    assert not col.find_cards("is:suspended")

    service.browser.add_tags(col, ids, "lecture-12 hy")
    assert set(col.find_cards("tag:lecture-12")) == set(ids)
    service.browser.remove_tags(col, ids, "hy")
    assert not col.find_cards("tag:hy")

    service.browser.set_flag(col, ids[:2], 3)
    assert set(col.find_cards("flag:3")) == set(ids[:2])

    service.browser.set_due_date(col, ids[:1], "0")
    assert ids[0] in col.find_cards("prop:due=0")
    with pytest.raises(ValueError):
        service.browser.set_due_date(col, ids, "tomorrow")
    with pytest.raises(ValueError):
        service.browser.add_tags(col, ids, "   ")
