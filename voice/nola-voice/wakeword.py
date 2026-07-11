"""
Wake word detection using openWakeWord — no account, no key, fully local.

Custom 'hola nola' model (hola_nola.onnx):
  - Uses openWakeWord's preprocessor to extract 96-dim audio embeddings.
  - Keeps a rolling window of embeddings; mean-pools to a single 96-dim vector.
  - Feeds that vector into the custom LogisticRegression ONNX classifier.
  - This detects actual phonetics, not scores from another model.

Fallback (no hola_nola.onnx):
  - Uses hey_jarvis via openWakeWord's built-in model.
"""

import collections
import os
import pathlib
import importlib.resources

import numpy as np
import onnxruntime as ort
from openwakeword.model import Model

# Rolling window of UNIQUE embeddings (the preprocessor only emits a new
# embedding roughly every 10 frames / 800 ms).  3 unique embeddings ≈ 2.4 s,
# which matches the ~2-3 embeddings produced per 2-second training clip.
N_FRAMES = 3


def _ensure_hey_jarvis():
    """Download hey_jarvis model if not already on disk."""
    try:
        pkg = pathlib.Path(importlib.resources.files('openwakeword')).parent / \
              'openwakeword' / 'resources' / 'models'
    except Exception:
        return
    if not (pkg / 'hey_jarvis_v0.1.onnx').exists():
        print("  Downloading pre-trained models (first run only)...")
        from openwakeword.utils import download_models
        download_models()


class WakeWordDetector:
    def __init__(self, config):
        self._threshold = getattr(config, 'WAKE_WORD_THRESHOLD', 0.5)
        model_path = config.WAKE_WORD_PATH

        _ensure_hey_jarvis()

        # Load openWakeWord — always needed for its audio embedding pipeline.
        self._oww = Model(wakeword_models=['hey_jarvis'], inference_framework='onnx')

        if os.path.exists(model_path):
            print(f"  Loading custom wake word model: {model_path}")
            self._clf = ort.InferenceSession(model_path)
            self._clf_input_name = self._clf.get_inputs()[0].name
            self._emb_buf = collections.deque(maxlen=N_FRAMES)
            self._use_custom = True
            print(f"  Threshold: {self._threshold}")
        else:
            print(f"  '{model_path}' not found — using 'hey_jarvis' placeholder.")
            print("  Say 'Hey Jarvis' to test, then run:  venv/bin/python3 train_hola_nola.py")
            self._use_custom = False

        self.frame_length = 1280   # 80 ms at 16 kHz — openWakeWord native frame
        self.sample_rate = 16000

    def detect(self, pcm: np.ndarray) -> bool:
        """Returns True if wake word probability exceeds threshold."""
        scores = self._oww.predict(pcm.astype(np.int16))

        if not self._use_custom:
            return any(s >= self._threshold for s in scores.values())

        # Only add embedding when it has actually changed (new computation)
        buf = self._oww.preprocessor.feature_buffer
        if buf is None or len(buf) == 0:
            return False
        cur_emb = np.array(buf[-1], dtype=np.float32).flatten()
        if hasattr(self, '_last_emb') and np.allclose(cur_emb, self._last_emb):
            return False   # no new embedding yet
        self._last_emb = cur_emb.copy()
        self._emb_buf.append(cur_emb)

        if len(self._emb_buf) < N_FRAMES:
            return False

        # Mean-pool the window → (1, 96) feature vector matching training
        features = np.mean(self._emb_buf, axis=0, dtype=np.float32).reshape(1, -1)

        result = self._clf.run(None, {self._clf_input_name: features})

        # result[1] is float32 probabilities [N, 2] (zipmap=False export)
        # result[1][0][1] = P(hola nola)
        probs = result[1]
        if isinstance(probs, list) and isinstance(probs[0], dict):
            prob_positive = float(probs[0].get(1, 0.0))
        else:
            prob_positive = float(probs[0][1])

        if prob_positive >= self._threshold:
            self._emb_buf.clear()   # avoid immediate re-trigger
            return True
        print(f"[wake score: {prob_positive:.3f}]", flush=True)
        return False

    def cleanup(self):
        pass
