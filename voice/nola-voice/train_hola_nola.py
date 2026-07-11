#!/usr/bin/env python3
"""
Train a custom 'hola nola' wake word model using openWakeWord.

How it works:
  1. Generates ~400 TTS clips of "hola nola" (positive examples).
  2. Generates ~300 TTS clips of OTHER phrases (negative examples — real speech,
     not just noise, so the model learns "hola nola" specifically).
  3. Extracts 96-dim audio embeddings via openWakeWord's preprocessor.
  4. Trains a logistic regression classifier on those embeddings.
  5. Exports to ONNX → hola_nola.onnx

Run on the NUC.  Takes ~20 minutes.
Usage:
    venv/bin/python3 train_hola_nola.py
"""

import asyncio
import os
import random
import sys
import tempfile
import urllib.request
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import cross_val_score
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType
from tqdm import tqdm

try:
    import edge_tts
except ImportError:
    sys.exit("Run: venv/bin/pip install edge-tts")

try:
    from openwakeword.model import Model as OWWModel
except ImportError:
    sys.exit("Run: venv/bin/pip install openwakeword")

# ── Config ────────────────────────────────────────────────────────────────────

OUTPUT_MODEL = Path(__file__).parent / "hola_nola.onnx"
WORK_DIR = Path(tempfile.mkdtemp(prefix="hola_nola_train_"))

SAMPLE_RATE = 16000

# ── Positive examples: "hola nola" variants ───────────────────────────────────

POSITIVE_PHRASES = [
    "hola nola",
    "hola, nola",
    "hola nola!",
    "Hola Nola",
    "Hola, Nola",
    "hola Nola",
    "ola nola",       # softer h (common in NM Spanish)
    "hola nola.",
]

POSITIVE_VOICES = [
    "es-MX-DaliaNeural",      # Mexican Spanish — most authentic for NM
    "es-US-AlonsoNeural",     # US Spanish
    "es-US-PalomaNeural",     # US Spanish female
    "es-ES-ElviraNeural",     # Spain Spanish
    "es-MX-JorgeNeural",      # Mexican Spanish male
    "en-US-JennyNeural",      # English — recognise cross-accent
    "en-US-GuyNeural",
    "en-GB-SoniaNeural",
    "en-AU-NatashaNeural",
]

RATES = ["-15%", "-8%", "+0%", "+8%", "+15%", "+20%"]

# ── Negative examples: other speech phrases ───────────────────────────────────
# Real speech negatives are critical — without them the model fires on any speech.

NEGATIVE_PHRASES = [
    "hey alexa", "ok google", "hey siri", "hey cortana",
    "hey jarvis", "hey computer", "jarvis", "computer",
    "what time is it", "turn on the lights", "play some music",
    "good morning", "hello there", "how are you doing",
    "the weather today", "set a timer for five minutes",
    "what is the temperature", "turn off the lights",
    "hola amigo", "hola como estas", "hola mundo",
    "ola que tal", "buenas noches", "buenos dias",
    "nola louisiana", "new orleans", "nola",
    "hello nola", "hey nola", "yo nola",
]

NEGATIVE_VOICES = [
    "en-US-JennyNeural",
    "en-US-GuyNeural",
    "en-GB-SoniaNeural",
    "es-MX-DaliaNeural",
    "es-US-AlonsoNeural",
]

NEGATIVE_RATES = ["-8%", "+0%", "+8%"]


# ── TTS generation ────────────────────────────────────────────────────────────

async def _tts_clip(text: str, voice: str, rate: str, path: str):
    communicate = edge_tts.Communicate(text, voice, rate=rate)
    await communicate.save(path)


async def generate_clips(phrases, voices, rates, out_dir: Path, prefix: str) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    tasks = []
    for phrase in phrases:
        for voice in voices:
            for rate in rates:
                mp3_path = out_dir / f"{prefix}_{len(tasks):04d}.mp3"
                tasks.append((phrase, voice, rate, mp3_path))

    print(f"Generating {len(tasks)} {prefix} TTS clips...")
    results = []
    for phrase, voice, rate, mp3_path in tqdm(tasks):
        try:
            await _tts_clip(phrase, voice, rate, str(mp3_path))
            results.append(mp3_path)
        except Exception:
            pass
    print(f"  {len(results)} clips generated.")
    return results


# ── Noise negatives ───────────────────────────────────────────────────────────

def generate_noise_clips(out_dir: Path, n: int = 40) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    results = []
    for i in range(n):
        path = out_dir / f"noise_{i:03d}.wav"
        duration = random.uniform(0.8, 2.0)
        samples = int(SAMPLE_RATE * duration)
        noise = (np.random.randn(samples) * 0.02).astype(np.float32)
        sf.write(str(path), noise, SAMPLE_RATE)
        results.append(path)
    return results


# ── Audio loading ─────────────────────────────────────────────────────────────

def load_audio(path: Path) -> np.ndarray | None:
    """Load audio, resample to 16 kHz mono, pad/trim to 2 s, return int16."""
    try:
        audio, sr = librosa.load(str(path), sr=SAMPLE_RATE, mono=True)
        target_len = SAMPLE_RATE * 2
        if len(audio) < target_len:
            audio = np.pad(audio, (0, target_len - len(audio)))
        else:
            audio = audio[:target_len]
        return (audio * 32767).astype(np.int16)
    except Exception:
        return None


# ── Feature extraction using openWakeWord embeddings ─────────────────────────

def extract_embedding_features(
    audio_files: list[Path],
    oww: OWWModel,
    label: str,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Feed each clip through openWakeWord's preprocessor, collect 96-dim
    embeddings per frame, mean-pool across the clip.
    Returns (X: float32 [N, 96], y: int [N]).
    """
    X, y = [], []
    lbl = 1 if label == 'positive' else 0

    print(f"Extracting embeddings from {len(audio_files)} {label} clips...")
    for path in tqdm(audio_files):
        audio = load_audio(path)
        if audio is None:
            continue

        oww.preprocessor.reset()
        frame_embeddings = []
        chunk_size = 1280

        for start in range(0, len(audio) - chunk_size + 1, chunk_size):
            chunk = audio[start:start + chunk_size]
            oww.predict(chunk)
            buf = oww.preprocessor.feature_buffer
            if buf is not None and len(buf) > 0:
                frame_embeddings.append(np.array(buf[-1], dtype=np.float32).flatten())

        if len(frame_embeddings) >= 3:
            X.append(np.mean(frame_embeddings, axis=0))   # (96,)
            y.append(lbl)

    return np.array(X, dtype=np.float32), np.array(y)


# ── Train and export ──────────────────────────────────────────────────────────

def train_and_export(X: np.ndarray, y: np.ndarray, output_path: Path):
    n_pos = int(y.sum())
    n_neg = int((y == 0).sum())
    print(f"\nTraining classifier on {len(X)} examples ({n_pos} positive, {n_neg} negative)...")
    print(f"  Feature dimension: {X.shape[1]}")

    clf = LogisticRegression(C=1.0, max_iter=2000, class_weight='balanced')
    cv = min(5, n_pos, n_neg)
    scores = cross_val_score(clf, X, y, cv=cv, scoring='f1')
    print(f"  Cross-val F1: {scores.mean():.3f} ± {scores.std():.3f}")

    clf.fit(X, y)

    initial_type = [('float_input', FloatTensorType([None, X.shape[1]]))]
    onnx_model = convert_sklearn(
        clf,
        initial_types=initial_type,
        options={LogisticRegression: {'zipmap': False}},
    )

    with open(str(output_path), 'wb') as f:
        f.write(onnx_model.SerializeToString())

    print(f"\nModel saved: {output_path}")
    print(f"  Input shape: ({X.shape[1]},)  |  Classes: {clf.classes_}")


# ── Main ──────────────────────────────────────────────────────────────────────

async def main():
    print("=" * 60)
    print("  NOLA — 'hola nola' wake word trainer  (embedding edition)")
    print("=" * 60)
    print(f"Working directory: {WORK_DIR}\n")

    pos_dir = WORK_DIR / "positive"
    neg_speech_dir = WORK_DIR / "negative_speech"
    neg_noise_dir = WORK_DIR / "negative_noise"

    pos_files = await generate_clips(POSITIVE_PHRASES, POSITIVE_VOICES, RATES, pos_dir, "pos")
    if len(pos_files) < 20:
        sys.exit("Not enough positive examples (need ≥20). Check internet connection.")

    neg_speech_files = await generate_clips(NEGATIVE_PHRASES, NEGATIVE_VOICES, NEGATIVE_RATES, neg_speech_dir, "neg")
    neg_noise_files = generate_noise_clips(neg_noise_dir, n=40)
    neg_files = neg_speech_files + neg_noise_files

    print("\nLoading openWakeWord preprocessor...")
    oww = OWWModel(wakeword_models=['hey_jarvis'], inference_framework='onnx')

    X_pos, y_pos = extract_embedding_features(pos_files, oww, 'positive')
    X_neg, y_neg = extract_embedding_features(neg_files, oww, 'negative')

    if len(X_pos) == 0 or len(X_neg) == 0:
        sys.exit("Feature extraction yielded no data.")

    X = np.vstack([X_pos, X_neg])
    y = np.concatenate([y_pos, y_neg])

    train_and_export(X, y, OUTPUT_MODEL)

    print("\nNext steps:")
    print(f"  sudo systemctl restart nola-voice")
    print(f"\nTuning threshold (WAKE_WORD_THRESHOLD in .env):")
    print(f"  Raise toward 0.8 to reduce false positives.")
    print(f"  Lower toward 0.3 if it misses your voice.")


if __name__ == '__main__':
    asyncio.run(main())
