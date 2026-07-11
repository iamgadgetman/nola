#!/usr/bin/env python3
"""
NOLA mic streamer — runs on NOLA-mic-1 (Raspberry Pi).

  - Captures audio from INPUT_DEVICE, resamples to 16 kHz, streams to NUC.
  - Listens on PLAYBACK_PORT for TTS audio from the NUC and plays it through
    OUTPUT_DEVICE (Pi built-in headphone jack).
"""

import io
import math
import os
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time

import numpy as np
import sounddevice as sd
import soundfile as sf
from dotenv import load_dotenv
from scipy.signal import resample_poly

load_dotenv()

TARGET_RATE = 16000
CHANNELS = 1
DTYPE = np.int16
TARGET_CHUNK = 1280   # 80 ms at 16 kHz


def resolve_device(device_str: str | None, kind: str = 'input') -> int | None:
    """Convert 'card0' → sounddevice index, or return None for default."""
    if not device_str:
        return None
    if device_str.startswith('card'):
        try:
            card_num = int(device_str[4:])
        except ValueError:
            return None
        key = 'max_input_channels' if kind == 'input' else 'max_output_channels'
        for i, dev in enumerate(sd.query_devices()):
            if dev[key] > 0 and f'hw:{card_num}' in dev.get('name', ''):
                return i
    return None


def get_native_rate(device: int | None, kind: str = 'input') -> int:
    """Probe for a supported sample rate on the given device."""
    for rate in [48000, 44100, 32000, 16000]:
        try:
            if kind == 'input':
                sd.check_input_settings(device=device, samplerate=rate, channels=CHANNELS, dtype='float32')
            else:
                sd.check_output_settings(device=device, samplerate=rate, channels=CHANNELS, dtype='float32')
            return rate
        except Exception:
            continue
    raise RuntimeError(f"No supported sample rate found for device {device}")


# ── TTS Playback server ───────────────────────────────────────────────────────

def _playback_server(port: int, output_device: int | None):
    """Receive mp3/wav audio bytes from NUC and play through output device."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as srv:
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind(('0.0.0.0', port))
        srv.listen(1)
        print(f"TTS playback server listening on port {port}")
        while True:
            try:
                conn, addr = srv.accept()
                with conn:
                    data = b''
                    while True:
                        chunk = conn.recv(65536)
                        if not chunk:
                            break
                        data += chunk
                if not data:
                    continue
                played = False
                try:
                    buf = io.BytesIO(data)
                    audio, sr = sf.read(buf, dtype='float32', always_2d=False)
                    sd.play(audio, samplerate=sr, device=output_device)
                    sd.wait()
                    played = True
                except Exception:
                    pass
                if not played:
                    with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as f:
                        f.write(data)
                        fname = f.name
                    try:
                        subprocess.run(
                            ['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet', fname],
                            check=False,
                        )
                    finally:
                        os.unlink(fname)
            except Exception as e:
                print(f"Playback error: {e}")


# ── Mic capture + NUC stream ─────────────────────────────────────────────────

def main():
    nuc_host = os.getenv('NUC_HOST', '10.0.3.218')
    nuc_port = int(os.getenv('NUC_PORT', '8765'))
    playback_port = int(os.getenv('PLAYBACK_PORT', '8766'))

    input_device = resolve_device(os.getenv('INPUT_DEVICE'), 'input')
    output_device = resolve_device(os.getenv('OUTPUT_DEVICE'), 'output')

    in_rate = get_native_rate(input_device, 'input')
    up, down = (TARGET_RATE // math.gcd(in_rate, TARGET_RATE),
                in_rate // math.gcd(in_rate, TARGET_RATE))
    capture_chunk = math.ceil(TARGET_CHUNK * in_rate / TARGET_RATE)

    in_info = sd.query_devices(input_device, 'input')
    out_info = sd.query_devices(output_device, 'output') if output_device is not None else {'name': 'default'}

    print(f"NOLA mic streamer")
    print(f"  Mic:     {in_info['name']}  ({in_rate} Hz → {TARGET_RATE} Hz)")
    print(f"  Speaker: {out_info['name']}")
    print(f"  NUC:     {nuc_host}:{nuc_port}  |  Playback port: {playback_port}")

    threading.Thread(target=_playback_server, args=(playback_port, output_device), daemon=True).start()

    def shutdown(sig=None, frame=None):
        print("\nMic streamer shutting down.")
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    resample_buf = np.array([], dtype=np.float32)

    while True:
        try:
            print(f"Connecting to NUC at {nuc_host}:{nuc_port}...")
            with socket.create_connection((nuc_host, nuc_port), timeout=10) as sock:
                print("Connected — streaming mic audio.")
                send_error = [False]

                def callback(indata, frames, time_info, status):
                    nonlocal resample_buf
                    if send_error[0]:
                        return
                    try:
                        mono = indata[:, 0] if indata.ndim > 1 else indata.flatten()
                        resampled = resample_poly(mono, up, down).astype(np.float32) if in_rate != TARGET_RATE else mono.astype(np.float32)
                        resample_buf = np.concatenate([resample_buf, resampled])
                        while len(resample_buf) >= TARGET_CHUNK:
                            frame = resample_buf[:TARGET_CHUNK]
                            resample_buf = resample_buf[TARGET_CHUNK:]
                            pcm = (frame * 32767).clip(-32768, 32767).astype(np.int16)
                            sock.sendall(pcm.tobytes())
                    except (BrokenPipeError, OSError):
                        send_error[0] = True

                with sd.InputStream(
                    samplerate=in_rate,
                    channels=CHANNELS,
                    dtype='float32',
                    blocksize=capture_chunk,
                    callback=callback,
                    device=input_device,
                ):
                    while not send_error[0]:
                        sd.sleep(500)

                print("Connection lost — reconnecting...")
                resample_buf = np.array([], dtype=np.float32)

        except (ConnectionRefusedError, ConnectionResetError, TimeoutError, OSError) as e:
            print(f"Connection error: {e}. Retrying in 5 s...")
            time.sleep(5)
        except Exception as e:
            print(f"Unexpected error: {e}. Retrying in 5 s...")
            time.sleep(5)


if __name__ == '__main__':
    main()
