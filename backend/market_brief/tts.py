"""Google Cloud Text-to-Speech, called with the service's own Cloud Run identity.

No key is stored: the runtime identity's Application Default Credentials sign
the request. The Text-to-Speech API must be enabled in the project. The text
sent is the brief's script only; nothing about the visitor is sent.
"""
from __future__ import annotations

import base64
import os
import re

ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize"
# Google's Chirp 3 HD voices sound like a person talking, not a reader.
# Sulafat is a warm, natural US English female voice, Gbenga's choice.
# MARKET_BRIEF_VOICE overrides it with any Google voice name.
DEFAULT_VOICE = "en-US-Chirp3-HD-Sulafat"
MAX_REQUEST_BYTES = 4500  # the API accepts 5000 bytes of text per request


def voice_settings():
    name = os.getenv("MARKET_BRIEF_VOICE", "").strip() or DEFAULT_VOICE
    if not re.fullmatch(r"[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9-]+", name):
        name = DEFAULT_VOICE
    language = "-".join(name.split("-")[:2])
    return {"languageCode": language, "name": name}


def audio_config():
    # Chirp 3 HD voices set their own natural pace; older voices read a
    # little slower than their default for a calmer delivery.
    config = {"audioEncoding": "MP3"}
    if "-Chirp3-" not in voice_settings()["name"]:
        config["speakingRate"] = 0.95
    return config


def chunks(text: str, limit: int = MAX_REQUEST_BYTES) -> list[str]:
    """Split at sentence ends so no request is over the API's size limit."""
    parts, current = [], ""
    for sentence in re.split(r"(?<=[.!?])\s+", text.strip()):
        candidate = f"{current} {sentence}".strip()
        if len(candidate.encode("utf-8")) <= limit:
            current = candidate
            continue
        if current:
            parts.append(current)
        if len(sentence.encode("utf-8")) > limit:
            raise ValueError("A single sentence is longer than the speech limit.")
        current = sentence
    if current:
        parts.append(current)
    return parts


def google_session():
    import google.auth
    from google.auth.transport.requests import AuthorizedSession
    credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    return AuthorizedSession(credentials)


def synthesize(text: str, session=None) -> bytes:
    """MP3 bytes for the text. MP3 frames from several requests join cleanly."""
    session = session or google_session()
    audio = b""
    for part in chunks(text):
        response = session.post(ENDPOINT, json={
            "input": {"text": part},
            "voice": voice_settings(),
            "audioConfig": audio_config(),
        }, timeout=20)
        response.raise_for_status()
        audio += base64.b64decode(response.json()["audioContent"])
    return audio
