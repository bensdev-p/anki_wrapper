"""The built UI: index.html is never cached (so updates show up), hashed assets are."""

from __future__ import annotations

import uuid

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.main import _SpaStaticFiles
from safety import DATA_DIR


def test_index_is_revalidated_and_assets_are_immutable() -> None:
    dist = DATA_DIR / ".pytest" / uuid.uuid4().hex
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>Rounds</title>")
    (dist / "assets" / "index-abc123.js").write_text("console.log(1)")
    app = FastAPI()
    app.mount("/", _SpaStaticFiles(directory=dist, html=True))
    client = TestClient(app)
    try:
        for path in ("/", "/index.html", "/practice"):  # "/practice": a client-side route
            r = client.get(path)
            assert r.status_code == 200 and r.headers["cache-control"] == "no-cache"
        asset = client.get("/assets/index-abc123.js")
        assert "immutable" in asset.headers["cache-control"]
        # A file from an older version that's gone: the fallback page must not be cached for good.
        missing = client.get("/assets/index-old999.js")
        assert missing.headers["cache-control"] == "no-cache"
    finally:
        import shutil

        shutil.rmtree(dist, ignore_errors=True)
