"""
Audio capture (local mic) and playback (local speaker).
All audio is 16 kHz, mono, int16 — matching openWakeWord's requirements.
"""

import math
import queue
import subprocess
import threading

import numpy as np
import sounddevice as sd
from scipy.signal import resample_poly

SAMPLE_RATE = 16000
CHUNK_SIZE = 1280  # openWakeWord native frame: 80 ms at 16 kHz


def _set_pcm_mute(mute: bool):
    # Card 3 = C-Media USB speaker; numid=5 is the Speaker Playback Switch
    state = 'off' if mute else 'on'
    subprocess.run(['amixer', '-c', '3', 'cset', 'numid=5', state], capture_output=True)


def _probe_native_rate(device) -> tuple[int, int]:
    """Return (native_rate, num_channels) for the given input device."""
    info = sd.query_devices(device, 'input') if device is not None else sd.query_devices(sd.default.device[0], 'input')
    native_channels = min(info['max_input_channels'], 2)
    for rate in [48000, 44100, 32000, 16000]:
        try:
            sd.check_input_settings(device=device, samplerate=rate, channels=native_channels, dtype='int16')
            return rate, native_channels
        except Exception:
            continue
    raise RuntimeError(f"No supported sample rate found for input device {device}")


class AudioCapture:
    """Reads 1280-sample int16 mono frames from the local mic, resampling if needed."""

    def __init__(self, config):
        self._queue: queue.Queue = queue.Queue(maxsize=200)
        self._start_local(config.INPUT_DEVICE)

    def _start_local(self, device=None):
        in_rate, in_channels = _probe_native_rate(device)
        g = math.gcd(in_rate, SAMPLE_RATE)
        up, down = SAMPLE_RATE // g, in_rate // g
        needs_resample = in_rate != SAMPLE_RATE
        capture_chunk = math.ceil(CHUNK_SIZE * in_rate / SAMPLE_RATE)

        info = sd.query_devices(device, 'input') if device is not None else sd.query_devices(sd.default.device[0], 'input')
        print(f"  Mic: {info['name']}  ({in_rate} Hz, {in_channels}ch"
              + (f" → {SAMPLE_RATE} Hz mono" if needs_resample or in_channels > 1 else "") + ")")

        resample_buf = np.array([], dtype=np.float32)

        def callback(indata, frames, time_info, status):
            nonlocal resample_buf
            # Downmix to mono
            mono = indata[:, 0] if indata.ndim > 1 else indata.flatten()
            mono = mono.astype(np.float32)

            if needs_resample:
                resample_buf = np.concatenate([resample_buf, mono])
                while len(resample_buf) >= capture_chunk:
                    chunk_f = resample_buf[:capture_chunk]
                    resample_buf = resample_buf[capture_chunk:]
                    resampled = resample_poly(chunk_f, up, down)
                    pcm = (resampled * 32767).clip(-32768, 32767).astype(np.int16)
                    if not self._queue.full():
                        self._queue.put_nowait(pcm[:CHUNK_SIZE])
            else:
                pcm = (mono * 32767).clip(-32768, 32767).astype(np.int16)
                if not self._queue.full():
                    self._queue.put_nowait(pcm[:CHUNK_SIZE])

        self._stream = sd.InputStream(
            samplerate=in_rate,
            channels=in_channels,
            dtype=np.float32,
            blocksize=capture_chunk,
            callback=callback,
            device=device,
        )
        self._stream.start()

    # ── Public interface ──────────────────────────────────────────

    def read_chunk(self) -> np.ndarray:
        """Block until a 512-sample int16 frame is available."""
        return self._queue.get()

    def drain(self):
        """Discard all queued audio — call after playback to flush echo."""
        while not self._queue.empty():
            try:
                self._queue.get_nowait()
            except queue.Empty:
                break

    def record_utterance(
        self,
        max_seconds: float = 10.0,
        silence_threshold: float = 80.0,
        silence_duration: float = 1.2,
    ) -> np.ndarray:
        """
        Record until silence, up to max_seconds.
        Returns float32 numpy array at 16 kHz suitable for Whisper.
        """
        frames = []
        silence_count = 0
        silence_limit = int(SAMPLE_RATE / CHUNK_SIZE * silence_duration)
        max_frames = int(SAMPLE_RATE / CHUNK_SIZE * max_seconds)
        peak_energy = 0.0

        for _ in range(max_frames):
            chunk = self.read_chunk()
            frames.append(chunk)
            energy = float(np.sqrt(np.mean(chunk.astype(np.float32) ** 2)))
            if energy > peak_energy:
                peak_energy = energy
            if energy < silence_threshold:
                silence_count += 1
                if silence_count >= silence_limit:
                    break
            else:
                silence_count = 0

        print(f"  [utterance peak energy: {peak_energy:.1f}]")
        return np.concatenate(frames).astype(np.float32) / 32768.0

    def stop(self):
        if hasattr(self, '_stream'):
            self._stream.stop()
            self._stream.close()


class AudioPlayer:
    """Plays TTS audio through the local speaker."""

    def __init__(self, config):
        self._device = config.OUTPUT_DEVICE
        self.playing = threading.Event()  # set while audio is playing
        _set_pcm_mute(True)

    def play_bytes(self, audio_bytes: bytes):
        self.playing.set()
        _set_pcm_mute(False)
        try:
            # Decode audio (any format) to float32 PCM via ffmpeg, then play
            # through sounddevice so OUTPUT_DEVICE is respected — same path as beeps.
            proc = subprocess.run(
                ['ffmpeg', '-i', 'pipe:0',
                 '-f', 'f32le', '-ar', '44100', '-ac', '1', 'pipe:1',
                 '-loglevel', 'quiet'],
                input=audio_bytes,
                capture_output=True,
            )
            if proc.stdout:
                data = np.frombuffer(proc.stdout, dtype=np.float32)
                sd.play(data, samplerate=44100, device=self._device)
                sd.wait()
            else:
                print(f"  [play_bytes ffmpeg error: {proc.stderr.decode(errors='replace').strip()}]")
        finally:
            _set_pcm_mute(True)
            self.playing.clear()

    def play_tone(self, freq: float = 880.0, duration: float = 0.13, volume: float = 0.3):
        rate = 44100
        t = np.linspace(0, duration, int(rate * duration), endpoint=False)
        tone = (np.sin(2 * np.pi * freq * t) * volume).astype(np.float32)
        _set_pcm_mute(False)
        try:
            sd.play(tone, samplerate=rate, device=self._device)
            sd.wait()
        finally:
            _set_pcm_mute(True)

    def play_wake_ding(self):
        """Double beep — wake word confirmed."""
        self.play_tone(880, 0.11)
        self.play_tone(1100, 0.11)

    def play_thinking_ding(self):
        """Single soft tone — query received, processing."""
        self.play_tone(660, 0.08, volume=0.2)
