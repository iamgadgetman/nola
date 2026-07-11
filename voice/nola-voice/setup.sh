#!/bin/bash
# NOLA voice interface setup — run on the NUC (NOLA-1, 10.0.3.218)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV="$SCRIPT_DIR/venv"

echo "=== NOLA voice interface setup ==="
echo ""

# System dependencies
echo "[1/4] Installing system packages..."
sudo apt-get update -qq
sudo apt-get install -y \
    python3-pip python3-venv python3-dev \
    portaudio19-dev libsndfile1 ffmpeg \
    alsa-utils

# Python venv
echo "[2/4] Creating Python venv and installing packages..."
python3 -m venv "$VENV"
"$VENV/bin/pip" install --upgrade pip --quiet

# openwakeword must be installed without deps first:
# tflite-runtime has no Python 3.12 wheel, but we only use the ONNX backend.
"$VENV/bin/pip" install openwakeword --no-deps --quiet
"$VENV/bin/pip" install onnxruntime scipy --quiet  # openwakeword onnx runtime deps

# Install the rest normally
grep -v '^openwakeword' "$SCRIPT_DIR/requirements.txt" | grep -v '^#' | \
    "$VENV/bin/pip" install -r /dev/stdin --quiet

# .env
if [ ! -f "$SCRIPT_DIR/.env" ]; then
    cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
    echo "[3/4] Created .env from template — edit it before starting:"
    echo "      $SCRIPT_DIR/.env"
else
    echo "[3/4] .env already exists, skipping."
fi

# Systemd service
echo "[4/4] Installing systemd service..."
SERVICE_FILE="/etc/systemd/system/nola-voice.service"
sudo tee "$SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=NOLA Voice Interface
After=network.target sound.target
Wants=sound.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$SCRIPT_DIR
ExecStart=$VENV/bin/python3 $SCRIPT_DIR/main.py
EnvironmentFile=$SCRIPT_DIR/.env
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable nola-voice

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Next steps:"
echo "  1. Edit $SCRIPT_DIR/.env"
echo "  2. Get a free Picovoice key at https://picovoice.ai"
echo "  3. Create 'hola nola' wake word at https://console.picovoice.ai"
echo "     → Wake Word → New Wake Word → 'hola nola' → download Linux x86_64 .ppn"
echo "     → drop the .ppn file into $SCRIPT_DIR/"
echo "  4. Fill in ANTHROPIC_API_KEY and ELEVENLABS_API_KEY in .env"
echo "  5. sudo systemctl start nola-voice"
echo "  6. journalctl -fu nola-voice   (to watch logs)"
