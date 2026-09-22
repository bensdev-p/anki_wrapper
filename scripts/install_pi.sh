#!/usr/bin/env bash
# Install (or update) Rounds as a service on the Raspberry Pi: it starts at
# boot, restarts if it crashes, and serves the built app on port 8000.
#
#   ./scripts/install_pi.sh             # her AnkiWeb-synced collection (run sync_setup.py first)
#   ./scripts/install_pi.sh --demo      # the imported .colpkg copy in data/demo
#   ./scripts/install_pi.sh --sample    # the synthetic sample collection
#
# Update later with:  git pull && ./scripts/install_pi.sh
# Logs:               journalctl -u rounds -f
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"

case "${1:-}" in
  --sample) COLLECTION="data/dev/collection.anki2" ;;
  --demo)   COLLECTION="data/demo/collection.anki2" ;;
  ""|--synced) COLLECTION="data/synced/collection.anki2" ;;
  *) echo "usage: $0 [--synced|--demo|--sample]" >&2; exit 2 ;;
esac

[[ "$(uname -m)" == "aarch64" ]] || echo "note: expected aarch64 (Pi 5), found $(uname -m); continuing"

echo "→ Python environment"
[[ -x .venv/bin/python ]] || python3 -m venv .venv
.venv/bin/pip install -q -r backend/requirements.txt

echo "→ Building the app"
(cd frontend && npm ci --silent && npm run build --silent)

if [[ "$COLLECTION" == data/dev/* && ! -f "$COLLECTION" ]]; then
  .venv/bin/python scripts/make_sample_collection.py
fi
if [[ ! -f "$COLLECTION" ]]; then
  case "$COLLECTION" in
    data/synced/*) echo "No synced collection yet. Run: .venv/bin/python scripts/sync_setup.py" >&2 ;;
    data/demo/*)   echo "No demo copy yet. Run: .venv/bin/python scripts/import_colpkg.py <file.colpkg>" >&2 ;;
  esac
  exit 1
fi

# The app used to be called Lacuna: retire its service so the two don't both
# open the collection.
if [[ -f /etc/systemd/system/lacuna.service ]]; then
  echo "→ Removing the old lacuna service"
  sudo systemctl disable --now lacuna >/dev/null 2>&1 || true
  sudo rm -f /etc/systemd/system/lacuna.service
fi

echo "→ Installing the rounds service"
sudo tee /etc/systemd/system/rounds.service >/dev/null <<UNIT
[Unit]
Description=Rounds study app (Anki engine)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(id -un)
WorkingDirectory=$REPO
Environment=HOST=0.0.0.0
Environment=PORT=8000
Environment=COLLECTION_PATH=$REPO/$COLLECTION
ExecStart=$REPO/scripts/run_backend.sh
Restart=on-failure
RestartSec=5
# Give it time to take a backup and close the collection cleanly on stop.
TimeoutStopSec=90
NoNewPrivileges=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable rounds >/dev/null
sudo systemctl restart rounds

sleep 3
if curl -sf http://127.0.0.1:8000/api/info >/dev/null; then
  ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  echo
  echo "  Rounds is running. On her iPhone or Mac, open:"
  echo "    http://$(hostname).local:8000   (or http://${ip:-<pi-ip>}:8000)"
  echo "  In Safari on the iPhone: Share → Add to Home Screen."
else
  echo "The service didn't answer yet; check: journalctl -u rounds -n 50" >&2
  exit 1
fi
