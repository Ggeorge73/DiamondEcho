"""Builds the day's brief, keeps it current, and serves it to every visitor.

The sources are read again at REFRESH_HOURS, Eastern time (12am, 6am, 12pm
and 6pm), on the first request after each, so a figure the publisher releases
during the day (Freddie Mac's rates on Thursdays, FRED's monthly updates)
reaches the page by the next of those times, not the next day. The voice reads
the script again only when the figures have changed. A complete brief
(figures and audio) is kept in Firestore under market_briefs/<date>-<hash of
its contents>, and market_briefs/current-<voice> names the latest one and when
the sources were last read, so other instances and later visitors reuse it
instead of calling the sources or the voice again. An incomplete brief is
kept only in memory for RETRY_SECONDS; meanwhile the day's last complete
brief, if there is one, is still served.

The welcome and tour audio does not change from day to day. It is kept under
market_briefs/tour-<hash of script and voice> and made again only when the
script or the voice changes.
"""
from __future__ import annotations

import hashlib
import json
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

REFRESH_HOURS = (0, 6, 12, 18)  # Eastern time
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


def _eastern():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo("America/New_York")
    except Exception:  # no time zone data in the image: standard time is close enough
        return timezone(timedelta(hours=-5))


def eastern_today() -> date:
    return datetime.now(_eastern()).date()


def next_refresh(now: float) -> float:
    """The first of REFRESH_HOURS after `now`, as a Unix time."""
    local = datetime.fromtimestamp(now, _eastern())
    later = [h for h in REFRESH_HOURS if h > local.hour]
    start = local.replace(minute=0, second=0, microsecond=0)
    if later:
        return start.replace(hour=later[0]).timestamp()
    return (start.replace(hour=REFRESH_HOURS[0]) + timedelta(days=1)).timestamp()


class MemoryStore:
    """Used when no Firebase project is set, for example a local run."""

    def __init__(self):
        self.rows = {}

    def get(self, key):
        return self.rows.get(key)

    def put(self, key, data):
        self.rows.setdefault(key, data)

    def set(self, key, data):
        self.rows[key] = data


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
            pass  # another instance stored the same brief first

    def set(self, key, data):
        self.collection.document(key).set(data, timeout=5)


def tour_key() -> str:
    digest = hashlib.sha256((brief_script.TOUR_SCRIPT + repr(voice_settings())).encode()).hexdigest()
    return f"tour-{digest[:16]}"


def _voice_digest() -> str:
    return hashlib.sha256(repr(voice_settings()).encode()).hexdigest()[:8]


def market_key(day: date, text: str, items: list) -> str:
    """The day, plus a hash of the voice and what the brief says: new figures,
    or a new voice, record the brief again instead of serving an older one."""
    content = repr(voice_settings()) + text + json.dumps(items, sort_keys=True)
    return f"{day.isoformat()}-{hashlib.sha256(content.encode()).hexdigest()[:8]}"


def current_key() -> str:
    return f"current-{_voice_digest()}"


class MarketBriefService:
    def __init__(self, store, collect=collect, synthesize=synthesize, today=eastern_today, clock=time.time):
        self.store, self.collect, self.synthesize = store, collect, synthesize
        self.today, self.clock = today, clock
        self._lock = Lock()
        self._memory = {}  # key -> (kept until, data)
        self._current = None  # {"date", "key", "next_read", "read_at"}: the brief being served

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

    def _pointer(self, day):
        """The day's brief being served: this instance's own note of it, or the
        one stored by whichever instance read the sources last."""
        today = day.isoformat()
        best = self._current if self._current and self._current["date"] == today else None
        if best is None or self.clock() >= best["next_read"]:
            try:
                stored = self.store.get(current_key())
            except Exception as exc:
                log.warning("Market brief pointer not read: %s", type(exc).__name__)
                stored = None
            if stored and stored.get("date") == today and (best is None or stored["next_read"] > best["next_read"]):
                best = stored
        return best

    def _market(self, day):
        pointer = self._pointer(day)
        data = self._cached(pointer["key"]) if pointer else None
        if data is not None and self.clock() < pointer["next_read"]:
            self._current = pointer
            return pointer["key"], data

        figures, problems = self.collect()
        items = brief_script.display_items(figures, day)
        text = brief_script.market_script(figures, day)
        key = market_key(day, text, items)
        # next_read is when the sources are read again; read_at, shown on the
        # page, is when the figures being served were read.
        retry = self.clock() + RETRY_SECONDS
        read_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        if data is not None and len(items) < len(data["items"]):
            # A source failing for a moment is no reason to drop a figure
            # already on the page. Keep the day's brief and read again soon.
            self._current = {**pointer, "next_read": retry}
            return pointer["key"], data
        new = self._cached(key)  # the same figures as a brief already recorded
        if new is None:
            audio = self._speak(text)
            new = {
                "date": day.isoformat(),
                "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "script": text,
                "items": items,
                "unavailable": problems,
                "audio": audio,
            }
            self._keep(key, new, bool(items) and audio is not None)
        if not (new["items"] and new.get("audio")):
            if data is not None:
                self._current = {**pointer, "next_read": retry}
                return pointer["key"], data
            self._current = {"date": day.isoformat(), "key": key, "next_read": retry, "read_at": read_at}
            return key, new
        self._current = {"date": day.isoformat(), "key": key, "next_read": next_refresh(self.clock()), "read_at": read_at}
        try:
            self.store.set(current_key(), self._current)
        except Exception as exc:
            log.warning("Market brief pointer not stored: %s", type(exc).__name__)
        return key, new

    def brief(self) -> dict:
        day = self.today()
        with self._lock:
            # Drop earlier days held in memory; the tour stays.
            self._memory = {k: v for k, v in self._memory.items() if k.startswith(("tour-", day.isoformat()))}
            tour_id, tour = self._tour()
            market_id, market = self._market(day)
            read_at = self._current.get("read_at") or market["generated_at"]
        return {
            "date": market["date"],
            "generated_at": market["generated_at"],
            "checked_at": read_at,
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
