# NOLA Voice Interface

Local Alexa-style voice assistant for the homelab. Say **"hola Nola"** to wake it.

## Architecture

```
NUC (NOLA-1 · 10.0.4.218)
─────────────────────────────────────
USB mic (local)
  │ raw int16 PCM @ 16 kHz
  ▼
nola-voice service
  openWakeWord → "hola nola" detector
  faster-whisper (base.en, local STT)
  Claude API (claude-sonnet-4-6)
  ElevenLabs TTS (Lily voice)
  │ mp3 bytes
  ▼
local speaker
```

One systemd service:
- **`nola-voice`** — runs on the NUC, handles everything from wake word to speech

---

## Hardware

| Role | Device | Location |
|------|--------|----------|
| Mic | USB mic (any) | NUC |
| Speaker | any output device | NUC |
| Brain | Intel NUC (NOLA-1) | NUC |

---

## Services

### nola-voice (NUC)

**Location:** `~/nola-voice/`
**Service file:** `/etc/systemd/system/nola-voice.service`
**Venv:** `~/nola-voice/venv/`

```bash
sudo systemctl start|stop|restart|status nola-voice
sudo journalctl -u nola-voice -f        # live logs
```

**Setup:**
```bash
cd ~/nola-voice
bash setup.sh
# edit .env with your keys
sudo systemctl enable --now nola-voice
```

---

## Configuration

### `~/nola-voice/.env`

```env
# Wake word
WAKE_WORD_PATH=hola_nola.onnx
WAKE_WORD_THRESHOLD=0.5       # raise toward 1.0 to reduce false positives

# STT (local Whisper)
WHISPER_MODEL=base.en         # tiny.en / base.en / small.en / medium.en
WHISPER_DEVICE=auto

# APIs
ANTHROPIC_API_KEY=...
CLAUDE_MODEL=claude-sonnet-4-6
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=pFZP5JQG7iQjIQuC4Bku   # Lily

# Audio — leave blank for system default
# INPUT_DEVICE=
# OUTPUT_DEVICE=

# Tools
UPS_HOST=10.0.4.100
NETDATA_HOSTS=containy:http://10.0.3.11:19999,...
PROMETHEUS_URL=http://10.0.3.69:9090
N8N_WEBHOOK_BASE_URL=http://10.0.3.11:5678
```

---

## Wake Word Model

The custom **"hola Nola"** model (`hola_nola.onnx`) lives at `~/nola-voice/hola_nola.onnx`.

It uses openWakeWord's 96-dim audio embeddings fed into a logistic regression classifier. To retrain (takes ~20 min, requires internet for edge-tts):

```bash
cd ~/nola-voice
venv/bin/python3 train_hola_nola.py
sudo systemctl restart nola-voice
```

Training generates ~400 positive TTS clips ("hola nola" in multiple Spanish/English voices and speeds) and ~300 negative clips (other wake words, similar-sounding phrases). Cross-val F1 ~0.96.

**Threshold tuning** (`WAKE_WORD_THRESHOLD` in `.env`):
- Too many false positives → raise toward 0.8
- Missing your voice → lower toward 0.2
- Default: 0.3

---

## Audio Notes

### PCH idle noise (NUC)
The Intel PCH amp hisses when idle. `audio.py` mutes the NUC's Master/Headphone/Speaker controls between playbacks via `amixer` and unmutes only during TTS.

**Set volume:**
```bash
amixer -c 0 sset Master 95%
```

### Echo suppression
When NOLA speaks, the mic picks up the speaker and could re-trigger the wake word. Two defences in `main.py`:
1. Wake detection is skipped while `AudioPlayer.playing` is set
2. The mic queue is drained after playback finishes

### Mic sample rate
If your USB mic doesn't natively support 16 kHz, sounddevice will raise an error on open. Either set `INPUT_DEVICE` to a device that supports 16 kHz, or use `arecord -l` to find your card and set ALSA to resample via `~/.asoundrc`.

---

## List Audio Devices

```bash
cd ~/nola-voice && venv/bin/python3 -c "import sounddevice; print(sounddevice.query_devices())"
# or
aplay -l && arecord -l
```
