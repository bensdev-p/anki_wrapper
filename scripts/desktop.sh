#!/usr/bin/env bash
# Run the desktop app from a checkout (development). Builds the UI first if needed.
#
#   ./scripts/desktop.sh              # native window, data in the real app folder
#   ./scripts/desktop.sh --browser    # default browser instead of a window
#   ROUNDS_DATA_DIR=data/.desk ./scripts/desktop.sh   # a throwaway data folder
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f frontend/dist/index.html ]]; then
  (cd frontend && npm run build)
fi
if [[ -n "${ROUNDS_DATA_DIR:-}" ]]; then
  export ROUNDS_DATA_DIR="$(cd "$(dirname "$ROUNDS_DATA_DIR")" && pwd)/$(basename "$ROUNDS_DATA_DIR")"
fi
exec .venv/bin/python desktop/rounds_desktop.py "$@"
