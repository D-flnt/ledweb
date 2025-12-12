#!/usr/bin/env bash
set -euo pipefail

BASE="/home/pi"
VENV="$BASE/.venv"
SERVICE_SRC="$BASE/systemd/piled.service"
SERVICE_DEST="/etc/systemd/system/piled.service"

echo "[setup] apt packages..."
sudo apt update
sudo apt install -y python3 python3-venv python3-pip git \
  libportaudio2 portaudio19-dev libffi-dev build-essential \
  avahi-daemon libnss-mdns jq
# Atlas variant differs per distro; try common options but continue if none match.
if ! sudo apt install -y libatlas-base-dev; then
  sudo apt install -y libatlas3-base || sudo apt install -y libatlas-dev || true
fi

echo "[setup] python venv + pip deps..."
python3 -m venv "$VENV"
source "$VENV/bin/activate"
pip install -U pip
pip install -r "$BASE/requirements.txt"

echo "[setup] systemd service..."
if [[ ! -f "$SERVICE_SRC" ]]; then
  echo "Service file not found at $SERVICE_SRC" >&2
  exit 1
fi
sudo cp "$SERVICE_SRC" "$SERVICE_DEST"
sudo systemctl daemon-reload
sudo systemctl enable piled.service
sudo systemctl restart piled.service

echo "[setup] klaar. Controleer met: systemctl status piled.service"
