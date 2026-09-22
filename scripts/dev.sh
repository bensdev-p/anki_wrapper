#!/usr/bin/env bash
# Start the API (localhost only) and the Vite dev server (on the LAN) together.
# Ctrl+C stops both.
#
#   ./scripts/dev.sh                                             # sample collection
#   COLLECTION_PATH=data/demo/collection.anki2 ./scripts/dev.sh  # imported copy
set -euo pipefail
cd "$(dirname "$0")/.."

./scripts/run_backend.sh &
api=$!
trap 'kill $api 2>/dev/null' EXIT INT TERM

# Wait for the API so the first page load doesn't fail.
for _ in $(seq 1 50); do
  curl -sf http://127.0.0.1:8000/api/info >/dev/null && break
  kill -0 $api 2>/dev/null || { echo "Backend failed to start" >&2; exit 1; }
  sleep 0.2
done

ip=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
echo "  Open on this network:  http://$(hostname).local:5173   (or http://${ip:-<pi-ip>}:5173)"
echo
cd frontend && npx vite --host
