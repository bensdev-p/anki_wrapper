"""Smarter quiz options: on-device text embeddings.

An embedding model turns a short text into a vector; answers that mean
similar things ("Furosemide", "Bumetanide") get nearby vectors. Practice
quizzes use this to pick wrong options that are the same kind of thing as the
right answer, drawn from the user's own cards (so every option is a real fact
from their deck; nothing is generated).

Everything runs on this computer. The model is downloaded once, on request,
from a pinned URL and checked against a pinned SHA-256 (`models.py`); no card
text ever leaves the machine. The answer index lives next to the collection
(`<collection folder>/quiz-index/`), never inside it, so sync is unaffected.

Two kinds of model are supported:

* "static" (Model2Vec-style): a token → vector table; an answer's vector is
  the mean of its tokens'. Needs only numpy + tokenizers, is tiny and fast,
  and runs everywhere we ship (including Intel Macs and the Pi).
* "onnx": a small transformer run with ONNX Runtime (optional dependency,
  imported only for such a model; no Intel-Mac builds of recent versions).
"""
