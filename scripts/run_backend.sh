#!/usr/bin/env bash
# Start the API on 127.0.0.1:8000 with a single worker (one open collection).
# The Vite dev server (or the built frontend) is what devices on the LAN talk to.
#
#   ./scripts/run_backend.sh                                   # dev sample collection
#   COLLECTION_PATH=data/demo/collection.anki2 ./scripts/run_backend.sh
#   HOST=0.0.0.0 ./scripts/run_backend.sh                      # also serve frontend/dist on the LAN
set -euo pipefail
cd "$(dirname "$0")/.."
exec .venv/bin/uvicorn api.main:app --app-dir backend \
  --host "${HOST:-127.0.0.1}" --port "${PORT:-8000}" --workers 1 "$@"
