import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    # Wake word (openWakeWord)
    WAKE_WORD_PATH = os.getenv('WAKE_WORD_PATH', 'hola_nola.onnx')
    WAKE_WORD_THRESHOLD = float(os.getenv('WAKE_WORD_THRESHOLD', '0.5'))

    # STT (faster-whisper, local)
    WHISPER_MODEL = os.getenv('WHISPER_MODEL', 'base.en')
    WHISPER_DEVICE = os.getenv('WHISPER_DEVICE', 'auto')

    # Brain (OpenAI)
    OPENAI_API_KEY = os.getenv('OPENAI_API_KEY', '')
    OPENAI_MODEL = os.getenv('OPENAI_MODEL', 'gpt-4o')

    # TTS (ElevenLabs)
    ELEVENLABS_API_KEY = os.getenv('ELEVENLABS_API_KEY', '')
    ELEVENLABS_VOICE_ID = os.getenv('ELEVENLABS_VOICE_ID', 'pFZP5JQG7iQjIQuC4Bku')  # Lily

    # Audio — accepts integer device index or substring of device name
    _input = os.getenv('INPUT_DEVICE', '')
    INPUT_DEVICE = int(_input) if _input.isdigit() else (_input or None)
    _output = os.getenv('OUTPUT_DEVICE', '')
    OUTPUT_DEVICE = int(_output) if _output.isdigit() else (_output or None)

    # Tools
    UPS_HOST = os.getenv('UPS_HOST', '')
    UPS_PORT = int(os.getenv('UPS_PORT', '3551'))
    NETDATA_HOSTS = os.getenv('NETDATA_HOSTS', '')
    PROMETHEUS_URL = os.getenv('PROMETHEUS_URL', '')
    N8N_WEBHOOK_BASE_URL = os.getenv('N8N_WEBHOOK_BASE_URL', '')

    # AMP game servers (optional)
    AMP_HOST = os.getenv('AMP_HOST', '')
    AMP_PORT = int(os.getenv('AMP_PORT', '8080'))
    AMP_USER = os.getenv('AMP_USER', 'admin')
    AMP_PASSWORD = os.getenv('AMP_PASSWORD', '')
