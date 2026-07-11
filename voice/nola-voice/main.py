#!/usr/bin/env python3
"""NOLA voice interface — say 'hola Nola' to wake, speak, get a voice response."""

import signal
import sys
import time
import traceback

from audio import AudioCapture, AudioPlayer
from brain import Brain
from config import Config
from stt import Transcriber
from tts import TextToSpeech
from wakeword import WakeWordDetector


def main():
    print("NOLA voice interface starting...")
    cfg = Config()

    print("Loading wake word detector...")
    wake = WakeWordDetector(cfg)

    print(f"Loading Whisper ({cfg.WHISPER_MODEL}) — first load may take a moment...")
    stt = Transcriber(cfg)

    print("Initialising audio...")
    audio_in = AudioCapture(cfg)
    audio_out = AudioPlayer(cfg)

    print("Connecting to Claude API...")
    brain = Brain(cfg)

    print("Connecting to ElevenLabs...")
    tts = TextToSpeech(cfg)

    def shutdown(sig=None, frame=None):
        print("\nNOLA shutting down. Goodbye!")
        wake.cleanup()
        audio_in.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    print("\nNOLA ready. Say 'hola Nola' to begin.")
    print("─" * 50)

    while True:
        try:
            chunk = audio_in.read_chunk()

            # Skip wake detection while TTS is playing (avoid echo re-trigger)
            if audio_out.playing.is_set():
                continue

            if not wake.detect(chunk):
                continue

            print("\n[Wake word detected]")
            audio_out.play_wake_ding()

            print("Listening...")
            utterance = audio_in.record_utterance()

            text = stt.transcribe(utterance)
            if not text.strip():
                print("[No speech detected]")
                continue

            print(f"You : {text}")
            audio_out.play_thinking_ding()

            response = brain.respond(text)
            if not response:
                continue

            print(f"NOLA: {response}")

            audio_bytes = tts.synthesize(response)
            audio_out.play_bytes(audio_bytes)
            audio_in.drain()  # discard echo captured while speaker was active

        except KeyboardInterrupt:
            shutdown()
        except Exception as e:
            print(f"Error: {e}")
            traceback.print_exc()
            time.sleep(0.5)


if __name__ == '__main__':
    main()
