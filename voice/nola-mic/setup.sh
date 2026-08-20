#!/bin/bash
# NOLA mic streamer setup — run on the Pi (NOLA-mic-1, 10.0.5.33)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV="$SCRIPT_DIR/venv"

echo "=== NOLA mic streamer setup ==="
echo ""

echo "[1/3] Installing system packages..."
sudo apt-get update -qq
sudo apt-get install -y python3-pip python3-venv python3-dev portaudio19-dev alsa-utils

echo "[2/3] Creating Python venv..."
python3 -m venv "$VENV"
"$VENV/bin/pip" install --upgrade pip --quiet
"$VENV/bin/pip" install -r "$SCRIPT_DIR/requirements.txt"

if [ ! -f "$SCRIPT_DIR/.env" ]; then
    cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
    echo "[3/3] Created .env — edit NUC_HOST and INPUT_DEVICE if needed."
else
    echo "[3/3] .env already exists, skipping."
fi

SERVICE_FILE="/etc/systemd/system/nola-mic.service"
sudo tee "$SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=NOLA Mic Streamer
After=network.target sound.target
Wants=sound.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$SCRIPT_DIR
ExecStart=$VENV/bin/python3 $SCRIPT_DIR/stream.py
EnvironmentFile=$SCRIPT_DIR/.env
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable nola-mic

echo ""
echo "=== Setup complete! ==="
echo "Run: sudo systemctl start nola-mic"
echo "Watch: journalctl -fu nola-mic"
