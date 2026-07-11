"""faster-whisper speech-to-text — runs entirely locally on the NUC."""

import numpy as np
from faster_whisper import WhisperModel


class Transcriber:
    def __init__(self, config):
        device = config.WHISPER_DEVICE
        if device == 'auto':
            device = 'auto'
        self._model = WhisperModel(
            config.WHISPER_MODEL,
            device=device,
            compute_type='int8',
        )

    def transcribe(self, audio: np.ndarray) -> str:
        """
        audio: float32 numpy array at 16 kHz (from AudioCapture.record_utterance).
        Returns transcribed text, or empty string if nothing was said.
        """
        segments, _info = self._model.transcribe(
            audio,
            language='en',
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=400),
        )
        return ' '.join(seg.text.strip() for seg in segments).strip()
