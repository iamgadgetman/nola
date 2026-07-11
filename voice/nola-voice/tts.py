"""ElevenLabs TTS — synthesize text to mp3 bytes using the Lily voice."""

from elevenlabs import VoiceSettings
from elevenlabs.client import ElevenLabs


class TextToSpeech:
    def __init__(self, config):
        self._client = ElevenLabs(api_key=config.ELEVENLABS_API_KEY)
        self._voice_id = config.ELEVENLABS_VOICE_ID
        self._settings = VoiceSettings(
            stability=0.45,
            similarity_boost=0.75,
            style=0.35,
            use_speaker_boost=True,
        )

    def synthesize(self, text: str) -> bytes:
        """Returns mp3 bytes for the given text."""
        chunks = self._client.text_to_speech.convert(
            voice_id=self._voice_id,
            text=text,
            model_id='eleven_turbo_v2_5',
            voice_settings=self._settings,
            output_format='mp3_44100_128',
        )
        return b''.join(chunks)
