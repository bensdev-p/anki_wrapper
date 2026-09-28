#!/usr/bin/env python3
"""Compare wrong-answer options on real cards: today's rules vs on-device embedding models.

Run on the Pi (it can reach Hugging Face), against a *copy* of the synced
collection:

  .venv/bin/pip install -r scripts/requirements-compare.txt   # ONNX Runtime, for the transformer candidates
  .venv/bin/python scripts/quiz_compare.py                     # 20 questions from all decks
  .venv/bin/python scripts/quiz_compare.py --tag "#AK_Step1_v12::#B&B" --count 30
  .venv/bin/python scripts/quiz_compare.py --models pubmedbert-8m,minilm

It writes data/quiz-compare/report.html (open it in the Pi's browser): each
question with the options every method picked, side by side, plus sizes and
timings. data/quiz-compare/models_registry.py has a ready-to-paste, pinned
entry (revision, SHA-256, size, license) for each model, for
backend/semantic/models.py.

Only reads: the collection is copied into data/.quiz-compare/ first, and
nothing is written to it. Card text stays on this machine.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import shutil
import sys
import time
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

import requests  # noqa: E402 (comes with anki)
from anki.collection import Collection  # noqa: E402

from safety import DATA_DIR, assert_safe_path, synced_dir  # noqa: E402
from semantic.embedders import Embedder, OnnxEmbedder, StaticEmbedder  # noqa: E402
from semantic.index import AnswerIndex, IndexNeighbours  # noqa: E402
from service import quiz  # noqa: E402

WORK = DATA_DIR / ".quiz-compare"
OUT = DATA_DIR / "quiz-compare"


@dataclass
class Candidate:
    id: str
    repo: str
    kind: str  # "static" | "onnx"
    name: str
    pooling: str = "mean"
    notes: str = ""


CANDIDATES = [
    Candidate("pubmedbert-8m", "NeuML/pubmedbert-base-embeddings-8M", "static", "PubMedBERT embeddings, static 8M (NeuML)", notes="medical, tiny, fast"),
    Candidate("potion-8m", "minishlab/potion-base-8M", "static", "potion-base-8M (Model2Vec)", notes="general, tiny, fast"),
    Candidate("minilm", "sentence-transformers/all-MiniLM-L6-v2", "onnx", "all-MiniLM-L6-v2", notes="general, small transformer"),
    Candidate("bge-small", "BAAI/bge-small-en-v1.5", "onnx", "bge-small-en-v1.5", pooling="cls", notes="general, small transformer"),
    Candidate("pubmedbert", "NeuML/pubmedbert-base-embeddings", "onnx", "PubMedBERT embeddings (NeuML)", notes="medical, larger transformer"),
]

# Files each kind needs: saved name → paths to try in the repo.
NEEDS = {
    "static": {"model.safetensors": ["model.safetensors"], "tokenizer.json": ["tokenizer.json"]},
    "onnx": {"model.onnx": ["onnx/model.onnx", "model.onnx"], "tokenizer.json": ["tokenizer.json"]},
}
OPTIONAL = {"static": {"config.json": ["config.json"]}, "onnx": {}}


# Downloading candidates (pinned to the revision fetched, with checksums)
##########################################################################


def fetch_model(c: Candidate) -> tuple[Path, dict] | None:
    api = requests.get(f"https://huggingface.co/api/models/{c.repo}", timeout=30)
    if api.status_code != 200:
        print(f"  {c.id}: not available ({api.status_code})")
        return None
    meta = api.json()
    revision = meta["sha"]
    present = {s["rfilename"] for s in meta.get("siblings", [])}
    license_ = (meta.get("cardData") or {}).get("license") or next(
        (t.split(":", 1)[1] for t in meta.get("tags", []) if t.startswith("license:")), "unknown"
    )
    folder = WORK / "models" / c.id
    folder.mkdir(parents=True, exist_ok=True)
    files = []
    for saved, options in [*NEEDS[c.kind].items(), *OPTIONAL[c.kind].items()]:
        path = next((p for p in options if p in present), None)
        if path is None:
            if saved in NEEDS[c.kind]:
                print(f"  {c.id}: the repo has no {' or '.join(options)}; skipping")
                return None
            continue
        url = f"https://huggingface.co/{c.repo}/resolve/{revision}/{path}"
        target = folder / saved
        digest = hashlib.sha256()
        marker = folder / f"{saved}.url"
        if target.exists() and marker.exists() and marker.read_text() == url:  # fetched on an earlier run
            digest.update(target.read_bytes())
        else:
            print(f"  {c.id}: downloading {path}…", end="", flush=True)
            with requests.get(url, stream=True, timeout=60) as res:
                res.raise_for_status()
                with open(target, "wb") as out:
                    for chunk in res.iter_content(1024 * 1024):
                        out.write(chunk)
                        digest.update(chunk)
            marker.write_text(url)
            print(f" {target.stat().st_size / 1e6:.1f} MB")
        files.append({"name": saved, "url": url, "sha256": digest.hexdigest(), "size": target.stat().st_size})
    return folder, {"revision": revision, "license": license_, "files": files}


def load(c: Candidate, folder: Path) -> Embedder | None:
    if c.kind == "static":
        return StaticEmbedder(folder)
    try:
        return OnnxEmbedder(folder, c.pooling)
    except ImportError:
        print(f"  {c.id}: needs ONNX Runtime (pip install -r scripts/requirements-compare.txt); skipping")
        return None


# Indexing a copy of the collection
##########################################################################


def copy_collection(src: Path) -> Path:
    src = assert_safe_path(src)
    dest_dir = assert_safe_path(WORK / "collection")
    shutil.rmtree(dest_dir, ignore_errors=True)
    dest_dir.mkdir(parents=True)
    for suffix in ("", "-wal"):
        if Path(f"{src}{suffix}").exists():
            shutil.copy2(f"{src}{suffix}", dest_dir / f"collection.anki2{suffix}")
    return dest_dir / "collection.anki2"


def build_index(col: Collection, c: Candidate, emb: Embedder, limit: int | None) -> tuple[AnswerIndex, float]:
    index = AnswerIndex(WORK / "index" / c.id, c.id, emb.dims)
    mods = quiz.note_mod_times(col)
    ids = list(mods)[:limit] if limit else list(mods)
    started = time.monotonic()
    for n in range(0, len(ids), 500):
        index.update(quiz.note_answers(col, ids[n : n + 500]), [], emb.embed)
        done = min(n + 500, len(ids))
        rate = done / max(time.monotonic() - started, 1e-6)
        print(f"\r  {c.id}: indexed {done:,}/{len(ids):,} notes ({rate:,.0f}/s)", end="", flush=True)
    print()
    return index, time.monotonic() - started


# The report
##########################################################################


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--collection", type=Path, default=synced_dir() / "collection.anki2")
    ap.add_argument("--deck", help="deck name (default: all decks)")
    ap.add_argument("--tag", help="tag, e.g. '#AK_Step1_v12::#B&B'")
    ap.add_argument("--count", type=int, default=20)
    ap.add_argument("--cards", choices=["mixed", "weak", "all"], default="mixed")
    ap.add_argument("--models", help="comma-separated ids: " + ", ".join(c.id for c in CANDIDATES))
    ap.add_argument("--limit-notes", type=int, help="index only this many notes (a quick first look)")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    wanted = set(args.models.split(",")) if args.models else None
    candidates = [c for c in CANDIDATES if not wanted or c.id in wanted]
    WORK.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)

    print(f"Copying {args.collection} …")
    try:
        col = Collection(str(copy_collection(args.collection)))
    except Exception as err:
        sys.exit(f"Couldn't open the copy ({err}). Stop the server first (sudo systemctl stop rounds) and try again.")
    try:
        deck_id = col.decks.id_for_name(args.deck) if args.deck else None
        if args.deck and not deck_id:
            sys.exit(f"No deck named {args.deck!r}.")
        t = time.monotonic()
        base = quiz.build_quiz(col, deck_id, args.tag, args.count, args.cards, seed=args.seed)  # type: ignore[arg-type]
        rules_ms = (time.monotonic() - t) * 1000
        if not base.questions:
            sys.exit("No questions: try --cards all, or another deck/tag.")
        card_ids = [q.card_id for q in base.questions]
        print(f"{len(card_ids)} questions from {base.available:,} matching cards.\n")

        methods: list[tuple[str, dict]] = [("Rules (no AI)", {q.card_id: q for q in base.questions})]
        summary = [{"id": "rules", "name": "Rules (no AI)", "kind": "-", "size": 0, "index_s": 0, "answers": 0, "quiz_ms": rules_ms, "license": "-", "notes": "today's app"}]
        registry = []
        for c in candidates:
            print(f"{c.name}:")
            got = fetch_model(c)
            if not got:
                continue
            folder, pinned = got
            emb = load(c, folder)
            if emb is None:
                continue
            index, secs = build_index(col, c, emb, args.limit_notes)
            t = time.monotonic()
            res = quiz.build_quiz(col, None, None, len(card_ids), card_ids=card_ids, seed=args.seed, neighbours=IndexNeighbours(index, emb.embed))
            quiz_ms = (time.monotonic() - t) * 1000
            methods.append((c.name, {q.card_id: q for q in res.questions}))
            size = sum(f["size"] for f in pinned["files"])
            summary.append({"id": c.id, "name": c.name, "kind": c.kind, "size": size, "index_s": secs, "answers": index.size, "quiz_ms": quiz_ms, "license": pinned["license"], "notes": c.notes})
            registry.append(_registry_entry(c, pinned))
            print(f"  {index.size:,} answers, indexed in {secs:.0f}s, a {len(card_ids)}-question quiz in {quiz_ms:.0f} ms\n")

        _print_text(base.questions, methods)
        (OUT / "report.html").write_text(_html(base.questions, methods, summary, args))
        (OUT / "models_registry.py").write_text("\n\n".join(registry) + "\n")
        print(f"\nReport: {OUT / 'report.html'}")
        print(f"Pinned model entries: {OUT / 'models_registry.py'}")
    finally:
        col.close()


def _wrong(q: object) -> list[str]:
    if q is None or not q.choices:  # type: ignore[attr-defined]
        return ["(asked as type-the-answer)"]
    return [c for c in q.choices if c != q.answer]  # type: ignore[attr-defined]


def _print_text(questions: list, methods: list[tuple[str, dict]]) -> None:
    width = max(len(n) for n, _ in methods)
    for i, q in enumerate(questions, 1):
        print(f"Q{i}. {q.prompt}\n    Answer: {q.answer}")
        for name, by_card in methods:
            print(f"    {name:<{width}}  {' | '.join(_wrong(by_card.get(q.card_id)))}")
        print()


def _html(questions: list, methods: list[tuple[str, dict]], summary: list[dict], args: argparse.Namespace) -> str:
    e = html.escape
    head = "".join(f"<th>{e(n)}</th>" for n, _ in methods)
    rows = []
    for i, q in enumerate(questions, 1):
        cells = "".join("<td><ul>" + "".join(f"<li>{e(w)}</li>" for w in _wrong(by.get(q.card_id))) + "</ul></td>" for _, by in methods)
        rows.append(f"<tr><td class=q><b>Q{i}.</b> {e(q.prompt)}<div class=a>Answer: {e(q.answer)}</div><div class=d>{e(q.deck_name)}</div></td>{cells}</tr>")
    stats = "".join(
        f"<tr><td>{e(s['name'])}</td><td>{e(s['kind'])}</td><td>{s['size'] / 1e6:.1f} MB</td><td>{s['index_s']:.0f} s</td>"
        f"<td>{s['answers']:,}</td><td>{s['quiz_ms']:.0f} ms</td><td>{e(str(s['license']))}</td><td>{e(s['notes'])}</td></tr>"
        for s in summary
    )
    scope = e(args.tag or args.deck or "all decks")
    return f"""<!doctype html><meta charset=utf-8><title>Quiz options compared</title>
<style>body{{font:14px/1.45 system-ui,sans-serif;margin:24px;color:#1b1c1e}}table{{border-collapse:collapse;width:100%}}
td,th{{border:1px solid #ddd;padding:8px;vertical-align:top;text-align:left}}th{{background:#f4f4f1;position:sticky;top:0}}
ul{{margin:0;padding-left:18px}}.q{{width:30%}}.a{{margin-top:6px;font-weight:600;color:#1f7a44}}.d{{color:#888;font-size:12px}}</style>
<h1>Wrong-answer options, compared</h1>
<p>{len(questions)} questions ({scope}, {e(args.cards)} cards). Same questions for every method. Which column gives options that are the same kind of thing as the answer, and plausible but clearly wrong?</p>
<table><tr><th>Method</th><th>Kind</th><th>Download</th><th>Index time</th><th>Answers</th><th>Quiz</th><th>License</th><th>Notes</th></tr>{stats}</table>
<h2>Questions</h2><table><tr><th>Question</th>{head}</tr>{''.join(rows)}</table>"""


def _registry_entry(c: Candidate, pinned: dict) -> str:
    files = ",\n".join(
        f'        ModelFile("{f["name"]}", "{f["url"]}", "{f["sha256"]}", {f["size"]})' for f in pinned["files"]
    )
    return f'''MODELS["{c.id}"] = ModelSpec(
    id="{c.id}",
    name={json.dumps(c.name)},
    kind="{c.kind}",
    files=(
{files},
    ),
    license={json.dumps(str(pinned["license"]))},
    source="https://huggingface.co/{c.repo}",
    pooling="{c.pooling}",
)'''


if __name__ == "__main__":
    main()
