"""Practice quizzes: questions and wrong options from the user's own cards, read-only."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from anki.collection import Collection
from fastapi.testclient import TestClient

from service import quiz


def _add(col: Collection, notetype: str, fields: dict[str, str], tags: list[str], deck: str = "Step 1") -> int:
    note = col.new_note(col.models.by_name(notetype))  # type: ignore[arg-type]
    for k, v in fields.items():
        note[k] = v
    note.tags = tags
    col.add_note(note, col.decks.id(deck))  # type: ignore[arg-type]
    return note.id


def test_answers_for_each_kind_of_card(col: Collection) -> None:
    basic = _add(col, "Basic", {"Front": "ACE converts?", "Back": "<b>Angiotensin I</b> to II"}, [])
    rev = _add(col, "Basic (and reversed card)", {"Front": "Loop diuretic", "Back": "Furosemide"}, [])
    typed = _add(col, "Basic (type in the answer)", {"Front": "Antidote?", "Back": "Naloxone"}, [])
    cloze = _add(col, "Cloze", {"Text": "{{c1::Metformin}} lowers {{c2::hepatic gluconeogenesis}}"}, [])
    long = _add(col, "Basic", {"Front": "Explain", "Back": "x " * 80}, [])
    image = _add(col, "Basic", {"Front": "Which?", "Back": '<img src="ecg.png">'}, [])

    def answers(nid: int) -> list[str | None]:
        return [quiz.card_answer(col, c) for c in col.get_note(nid).cards()]  # type: ignore[arg-type]

    assert answers(basic) == ["Angiotensin I to II"]
    assert answers(rev) == ["Furosemide", "Loop diuretic"]  # the reverse card asks for the front
    assert answers(typed) == ["Naloxone"]
    assert answers(cloze) == ["Metformin", "hepatic gluconeogenesis"]
    assert answers(long) == [None]  # too long for an option
    assert answers(image) == [None]  # nothing to type or pick
    prompts = [quiz.card_prompt(col, c) for c in col.get_note(cloze).cards()]
    assert prompts == ["[...] lowers hepatic gluconeogenesis", "Metformin lowers [...]"]
    assert quiz.card_prompt(col, col.get_note(rev).cards()[1]) == "Furosemide"


def test_wrong_options_come_from_the_closest_tag(col: Collection) -> None:
    diuretics = ["Furosemide", "Hydrochlorothiazide", "Spironolactone", "Acetazolamide", "Mannitol"]
    for drug in diuretics:
        _add(col, "Basic", {"Front": f"Which diuretic? ({drug})", "Back": drug}, ["#AK_Step1::Pharm::Renal::Diuretics"])
    for other in ["Penicillin G", "Vancomycin", "Doxycycline"]:
        _add(col, "Basic", {"Front": f"Which antibiotic? ({other})", "Back": other}, ["#AK_Step1::Pharm::Micro::Antibiotics"])
    col.sched.unbury_deck(col.decks.id("Step 1"))  # type: ignore[arg-type]

    tag = "#AK_Step1::Pharm::Renal::Diuretics"
    q = quiz.build_quiz(col, None, tag, 5, cards="all", seed=3)
    assert q.available == 5 and len(q.questions) == 5
    for question in q.questions:
        assert question.choices[question.correct] == question.answer
        assert len(question.choices) == 4 and len(set(question.choices)) == 4
        assert set(question.choices) <= set(diuretics)  # never an antibiotic
        assert "[...]" not in question.answer and question.rendered.question_html


def test_weak_spots_are_cards_she_has_forgotten(col: Collection) -> None:
    ids = list(col.find_cards("-is:new"))
    forgotten = ids[:3]
    for cid in forgotten:
        card = col.get_card(cid)
        card.lapses = 2
        col.update_card(card)
    q = quiz.build_quiz(col, None, None, 10, cards="weak", seed=1)
    picked = {x.card_id for x in q.questions}
    assert picked and picked <= set(forgotten) | set(col.find_cards("prop:ease<2.2"))


def test_find_tags(col: Collection) -> None:
    _add(col, "Basic", {"Front": "q", "Back": "a"}, ["#AK_Step1_v12::#B&B::05_Glycolysis"])
    hits = quiz.find_tags(col, "b&b glyco")
    assert hits and hits[0].tag == "#AK_Step1_v12::#B&B::05_Glycolysis"
    assert hits[0].label == "#B&B › Glycolysis"
    assert quiz.find_tags(col, "") == []


@pytest.fixture
def client(col_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("COLLECTION_PATH", str(col_path))
    from api.main import app

    with TestClient(app) as c:
        yield c


def _run(client: TestClient, fn):  # type: ignore[no-untyped-def]
    host = client.app.state.host  # type: ignore[attr-defined]
    return host._executor.submit(lambda: fn(host._col)).result()


def test_quiz_api_changes_nothing(client: TestClient) -> None:
    before = _run(client, lambda col: (col.db.scalar("select max(mod) from cards"), col.db.scalar("select count() from revlog"), col.mod))
    step1 = next(d["id"] for d in client.get("/api/deck-names").json() if d["name"] == "Step 1")

    res = client.post("/api/quiz", json={"deck_id": step1, "count": 8, "cards": "all"})
    assert res.status_code == 200
    body = res.json()
    assert len(body["questions"]) == 8 and body["available"] >= 8
    first = body["questions"][0]
    assert first["rendered"]["question_html"] and first["rendered"]["type_answer"] is False
    assert all(q["deck_name"].startswith("Step 1") for q in body["questions"])

    # Retry exactly the missed ones.
    again = client.post("/api/quiz", json={"card_ids": [first["card_id"]], "count": 5}).json()
    assert [q["card_id"] for q in again["questions"]] == [first["card_id"]]

    assert client.get("/api/quiz/tags", params={"q": "card"}).json()[0]["tag"] == "cardio"
    assert client.post("/api/quiz", json={"count": 500}).status_code == 422

    after = _run(client, lambda col: (col.db.scalar("select max(mod) from cards"), col.db.scalar("select count() from revlog"), col.mod))
    assert after == before


def test_no_option_is_printed_in_the_question(col: Collection) -> None:
    tag = "#AK_Step1::Heme::Anticoagulants"
    nid = _add(col, "Cloze", {"Text": "Heparin is monitored with {{c1::aPTT}}; warfarin with {{c2::PT/INR}}"}, [tag])
    for lab in ["Bleeding time", "Platelet count"]:  # too few: the rest come from wider searches
        _add(col, "Basic", {"Front": f"Lab? ({lab})", "Back": lab}, [tag])
    warfarin = col.get_note(nid).cards()[1].id
    for seed in range(8):
        q = quiz.build_quiz(col, None, None, 1, card_ids=[warfarin], seed=seed).questions[0]
        assert q.answer == "PT/INR" and len(q.choices) >= 3
        assert "aPTT" not in q.choices  # it's right there in the question


def test_topic_tags_skip_question_bank_tags() -> None:
    tags = [
        "#AK_Step1_v12::#UWorld::Step::10234",
        "#AK_Step1_v12::#AMBOSS::Qid-ABC12",
        "#AK_Step1_v12::#B&B::03_Biochem::05_Glycolysis",
        "#AK_Step1_v12::#FirstAid::02_Biochem::03_Metabolism",
        "#AK_Step1_v12::#NBME::Form25::17",
        "leech",
    ]
    assert quiz.topic_tags(tags) == [
        "#AK_Step1_v12::#FirstAid::02_Biochem::03_Metabolism",
        "#AK_Step1_v12::#B&B::03_Biochem::05_Glycolysis",
    ]


def test_question_bank_tags_dont_make_options_related(col: Collection) -> None:
    uworld = "#AK_Step1::#UWorld::Step::Renal::10234"  # deeper than the topic tag; groups unrelated facts
    topic = "#AK_Step1::#B&B::Renal::Diuretics"
    loop = _add(col, "Basic", {"Front": "Loop diuretic?", "Back": "Furosemide"}, [uworld, topic])
    for drug in ["Hydrochlorothiazide", "Spironolactone", "Acetazolamide"]:
        _add(col, "Basic", {"Front": f"Diuretic ({drug})?", "Back": drug}, [topic])
    for other in ["Vancomycin", "Doxycycline", "Bleeding time"]:
        _add(col, "Basic", {"Front": f"Other ({other})?", "Back": other}, [uworld])
    card = col.get_note(loop).cards()[0].id
    for seed in range(5):
        q = quiz.build_quiz(col, None, None, 1, card_ids=[card], seed=seed).questions[0]
        assert set(q.choices) == {"Furosemide", "Hydrochlorothiazide", "Spironolactone", "Acetazolamide"}


def test_no_random_padding(col: Collection, monkeypatch: pytest.MonkeyPatch) -> None:
    """With nothing related to draw from, a question is asked as type-the-answer."""
    monkeypatch.setattr(quiz, "BROAD_GROUP", 5)  # every deck in the sample is now "too broad"
    nid = _add(col, "Basic", {"Front": "Antidote for opioids?", "Back": "Naloxone"}, [])
    card = col.get_note(nid).cards()[0].id
    q = quiz.build_quiz(col, None, None, 1, card_ids=[card], seed=1).questions[0]
    assert q.choices == [] and q.correct == -1 and q.answer == "Naloxone"


class _FakeNeighbours:
    def __init__(self, answers: list[str]) -> None:
        self.answers = answers
        self.calls: list[list[tuple[str, str]]] = []

    def nearest(self, items: list[tuple[str, str]], limit: int) -> list[list[str]]:
        self.calls.append(items)
        return [self.answers for _ in items]


def test_similar_answers_come_first(col: Collection) -> None:
    nid = _add(col, "Basic", {"Front": "Loop diuretic?", "Back": "Furosemide"}, [])
    card = col.get_note(nid).cards()[0].id
    similar = ["furosemide", "Bumetanide", "Loop diuretic", "Torsemide", "Ethacrynic acid", "Hydrochlorothiazide", "Mannitol"]
    fake = _FakeNeighbours(similar)
    q = quiz.build_quiz(col, None, None, 1, card_ids=[card], seed=2, neighbours=fake).questions[0]
    assert fake.calls == [[("Furosemide", "Loop diuretic?")]]
    wrong = set(q.choices) - {"Furosemide"}
    # Not the answer itself in another case, not text printed in the question.
    assert len(wrong) == 3 and wrong <= {"Bumetanide", "Torsemide", "Ethacrynic acid", "Hydrochlorothiazide", "Mannitol"}


def test_too_few_similar_answers_fall_back_to_related_cards(col: Collection) -> None:
    topic = "#AK_Step1::#B&B::Renal::Diuretics"
    nid = _add(col, "Basic", {"Front": "Loop diuretic?", "Back": "Furosemide"}, [topic])
    for drug in ["Hydrochlorothiazide", "Spironolactone", "Acetazolamide"]:
        _add(col, "Basic", {"Front": f"Diuretic ({drug})?", "Back": drug}, [topic])
    card = col.get_note(nid).cards()[0].id
    q = quiz.build_quiz(col, None, None, 1, card_ids=[card], seed=2, neighbours=_FakeNeighbours(["Bumetanide"])).questions[0]
    assert len(q.choices) == 4 and "Furosemide" in q.choices
