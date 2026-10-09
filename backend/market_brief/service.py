"""Builds the day's brief once, keeps it, and serves it to every visitor.

The first request of each Eastern-time day reads the sources and has the
voice read the script. A complete brief (figures and audio) is kept in
Firestore under market_briefs/<date>, so other instances and later visitors
reuse it instead of calling the sources or the voice again. An incomplete
brief is kept only in memory for RETRY_SECONDS, then built again.

The welcome and tour audio does not change from day to day. It is kept under
market_briefs/tour-<hash of script and voice> and made again only when the
script or the voice changes.
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from threading import Lock

from . import script as brief_script
from .sources import DISABLED_SOURCES, collect
from .tts import synthesize, voice_settings

log = logging.getLogger(__name__)

RETRY_SECONDS = 15 * 60
# A Firestore document holds at most 1 MiB, and Google's MP3 for a two-minute
# script is about 1 MB. Audio is therefore stored in parts of PART_BYTES, each
# its own document, and joined again when read.
PART_BYTES = 700_000
MAX_AUDIO_BYTES = 6_000_000  # a sanity limit, several times the longest script
AUDIO_PATH = "/api/v1/market-brief/audio/{key}.mp3"
KEY_PATTERN = re.compile(r"(\d{4}-\d{2}-\d{2}(-[0-9a-f]{8})?|tour-[0-9a-f]{16})")


class BriefUnavailable(Exception):
    pass


def enabled() -> bool:
    return os.getenv("MARKET_BRIEF_ENABLED", "").strip().lower() == "true"


def eastern_today() -> date:
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/New_York")).date()
    except Exception:  # no time zone data in the image: standard time is close enough for a date
        return datetime.now(timezone(timedelta(hours=-5))).date()


class MemoryStore:
    """Used when no Firebase project is set, for example a local run."""

    def __init__(self):
        self.rows = {}

    def get(self, key):
        return self.rows.get(key)

    def put(self, key, data):
        self.rows.setdefault(key, data)


class FirestoreBriefStore:
    def __init__(self, db):
        self.collection = db.collection("market_briefs")

    def get(self, key):
        snapshot = self.collection.document(key).get(timeout=5)
        return snapshot.to_dict() if snapshot.exists else None

    def put(self, key, data):
        from google.api_core.exceptions import AlreadyExists
        try:
            self.collection.document(key).create(data, timeout=5)
        except AlreadyExists:
            pass  # another instance stored the same day first


def tour_key() -> str:
    digest = hashlib.sha256((brief_script.TOUR_SCRIPT + repr(voice_settings())).encode()).hexdigest()
    return f"tour-{digest[:16]}"


def market_key(day: date) -> str:
    """The day, plus the voice: a new voice records the day's brief again
    instead of serving the one already stored in the old voice."""
    digest = hashlib.sha256(repr(voice_settings()).encode()).hexdigest()
    return f"{day.isoformat()}-{digest[:8]}"


class MarketBriefService:
    def __init__(self, store, collect=collect, synthesize=synthesize, today=eastern_today, clock=time.monotonic):
        self.store, self.collect, self.synthesize = store, collect, synthesize
        self.today, self.clock = today, clock
        self._lock = Lock()
        self._memory = {}  # key -> (kept until, data)

    def _speak(self, text):
        try:
            audio = self.synthesize(text)
        except Exception as exc:
            # The status and the API's own message say why (quota, voice name, size...).
            status = getattr(getattr(exc, "response", None), "status_code", None)
            log.warning("Market brief voice failed: %s %s %s", type(exc).__name__, status or "", str(exc)[:300])
            return None
        if not audio or len(audio) > MAX_AUDIO_BYTES:
            log.warning("Market brief audio missing or too large (%s bytes)", len(audio or b""))
            return None
        return audio

    def _load(self, key):
        stored = self.store.get(key)
        if not stored or not stored.get("audio_parts"):
            return stored  # absent, or audio kept inline by an earlier version
        build = stored.get("audio_build", "")
        parts = [self.store.get(f"{key}-part-{build}{i}") for i in range(stored["audio_parts"])]
        if not all(part and part.get("data") for part in parts):
            log.warning("Market brief %s is missing audio parts; building it again", key)
            return None
        return {**stored, "audio": b"".join(bytes(part["data"]) for part in parts)}

    def _cached(self, key):
        kept = self._memory.get(key)
        if kept and (kept[0] is None or kept[0] > self.clock()):
            return kept[1]
        stored = self._load(key)
        if stored:
            self._memory[key] = (None, stored)
        return stored

    def _keep(self, key, data, complete):
        if complete:
            audio = bytes(data["audio"])
            parts = [audio[i:i + PART_BYTES] for i in range(0, len(audio), PART_BYTES)]
            # Parts first, so a reader never finds the brief without its audio.
            # Each build names its own parts: if two instances build the same day
            # at once, the brief that is stored first points only at its own.
            build = f"{uuid.uuid4().hex[:8]}-"
            for i, part in enumerate(parts):
                self.store.put(f"{key}-part-{build}{i}", {"data": part})
            self.store.put(key, {**data, "audio": None, "audio_parts": len(parts), "audio_build": build})
            self._memory[key] = (None, data)
        else:
            self._memory[key] = (self.clock() + RETRY_SECONDS, data)

    def _tour(self):
        key = tour_key()
        data = self._cached(key)
        if data is None:
            audio = self._speak(brief_script.TOUR_SCRIPT)
            data = {"script": brief_script.TOUR_SCRIPT, "audio": audio}
            self._keep(key, data, audio is not None)
        return key, data

    def _market(self, day):
        key = market_key(day)
        data = self._cached(key)
        if data is None:
            figures, problems = self.collect()
            items = brief_script.display_items(figures, day)
            text = brief_script.market_script(figures, day)
            audio = self._speak(text)
            data = {
                "date": day.isoformat(),
                "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "script": text,
                "items": items,
                "unavailable": problems,
                "audio": audio,
            }
            self._keep(key, data, bool(items) and audio is not None)
        return key, data

    def brief(self) -> dict:
        day = self.today()
        with self._lock:
            # Drop earlier days held in memory; the tour stays.
            self._memory = {k: v for k, v in self._memory.items() if k.startswith(("tour-", day.isoformat()))}
            tour_id, tour = self._tour()
            market_id, market = self._market(day)
        return {
            "date": market["date"],
            "generated_at": market["generated_at"],
            "tour": {
                "script": tour["script"],
                "audio_url": AUDIO_PATH.format(key=tour_id) if tour.get("audio") else None,
            },
            "market": {
                "script": market["script"],
                "audio_url": AUDIO_PATH.format(key=market_id) if market.get("audio") else None,
                "items": market["items"],
                "unavailable": market["unavailable"],
            },
            "not_used": list(DISABLED_SOURCES),
        }

    def audio(self, key: str) -> bytes:
        if not KEY_PATTERN.fullmatch(key):
            raise KeyError(key)
        with self._lock:
            data = self._cached(key)
        if not data or not data.get("audio"):
            raise KeyError(key)
        return bytes(data["audio"])


_service = None
_service_lock = Lock()


def get_service() -> MarketBriefService:
    global _service
    if not enabled():
        raise BriefUnavailable("The market brief is switched off.")
    with _service_lock:
        if _service is None:
            project = os.getenv("FIREBASE_PROJECT_ID", "").strip()
            if project:
                from firebase_admin import firestore
                from inquiries.firebase import firebase_app
                store = FirestoreBriefStore(firestore.client(app=firebase_app(project)))
            else:
                store = MemoryStore()
            _service = MarketBriefService(store)
        return _service
