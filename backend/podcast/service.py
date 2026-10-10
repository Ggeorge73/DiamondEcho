"""Podcast episodes recorded by DiamondEcho and uploaded by staff.

Audio files go straight from the staff browser to a Cloud Storage bucket
(PODCAST_BUCKET) through a resumable upload session that this service opens
with its own Cloud Run identity, so no storage key reaches the browser and the
file never passes through the API (Cloud Run limits a request to 32 MiB).
Episode details are kept in Firestore under podcast_episodes. Only published
episodes are listed publicly; their files are read straight from the bucket,
which allows public reading of episode files only.
"""
from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timezone

COLLECTION = "podcast_episodes"
MAX_BYTES = 300 * 1024 * 1024  # about five hours of speech at 128 kbps
TYPES = {"audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/x-m4a": ".m4a"}
ID_PATTERN = re.compile(r"[0-9a-f]{32}")
LIST_LIMIT = 200


class PodcastUnavailable(Exception):
    pass


class EpisodeNotFound(Exception):
    pass


class UploadIncomplete(Exception):
    pass


def bucket_name() -> str:
    name = os.getenv("PODCAST_BUCKET", "").strip()
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]", name):
        raise PodcastUnavailable("Podcast storage is not configured.")
    return name


def public_url(bucket: str, obj: str) -> str:
    return f"https://storage.googleapis.com/{bucket}/{obj}"


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class GcsStorage:
    def __init__(self, bucket: str, client=None):
        if client is None:
            from google.cloud import storage
            client = storage.Client()
        self.name = bucket
        self.bucket = client.bucket(bucket)

    def start_upload(self, obj: str, content_type: str, size: int, origin: str) -> str:
        blob = self.bucket.blob(obj)
        blob.cache_control = "public, max-age=86400"
        # The session allows browser requests from the staff site's origin only.
        return blob.create_resumable_upload_session(content_type=content_type, size=size, origin=origin)

    def size_of(self, obj: str) -> int | None:
        blob = self.bucket.get_blob(obj)
        return blob.size if blob is not None else None


class FirestoreEpisodes:
    def __init__(self, db):
        self.collection = db.collection(COLLECTION)

    def create(self, episode_id: str, data: dict) -> None:
        self.collection.document(episode_id).create(data, timeout=5)

    def get(self, episode_id: str) -> dict | None:
        snapshot = self.collection.document(episode_id).get(timeout=5)
        return snapshot.to_dict() if snapshot.exists else None

    def update(self, episode_id: str, changes: dict) -> None:
        self.collection.document(episode_id).update(changes, timeout=5)

    def all(self) -> list[dict]:
        return [row.to_dict() for row in self.collection.limit(LIST_LIMIT).stream(timeout=10)]


class PodcastService:
    def __init__(self, episodes, storage, clock=now, new_id=lambda: uuid.uuid4().hex):
        self.episodes, self.storage, self.clock, self.new_id = episodes, storage, clock, new_id

    def start_episode(self, title, description, content_type, size_bytes, staff_uid, origin) -> dict:
        episode_id = self.new_id()
        obj = f"episodes/{episode_id}{TYPES[content_type]}"
        upload_url = self.storage.start_upload(obj, content_type, size_bytes, origin)
        self.episodes.create(episode_id, {
            "id": episode_id, "title": title, "description": description, "object": obj,
            "content_type": content_type, "size_bytes": size_bytes, "status": "uploading",
            "created_at": self.clock(), "created_by": staff_uid, "published_at": None,
        })
        return {"id": episode_id, "upload_url": upload_url}

    def _episode(self, episode_id: str) -> dict:
        if not ID_PATTERN.fullmatch(episode_id or ""):
            raise EpisodeNotFound(episode_id)
        episode = self.episodes.get(episode_id)
        if not episode:
            raise EpisodeNotFound(episode_id)
        return episode

    def publish(self, episode_id: str) -> dict:
        episode = self._episode(episode_id)
        size = self.storage.size_of(episode["object"])
        if size != episode["size_bytes"]:
            raise UploadIncomplete(episode_id)
        changes = {"status": "published", "published_at": episode.get("published_at") or self.clock()}
        self.episodes.update(episode_id, changes)
        return self.view({**episode, **changes}, staff=True)

    def unpublish(self, episode_id: str) -> dict:
        episode = self._episode(episode_id)
        if episode["status"] == "uploading":
            raise UploadIncomplete(episode_id)
        self.episodes.update(episode_id, {"status": "hidden"})
        return self.view({**episode, "status": "hidden"}, staff=True)

    def view(self, episode: dict, staff=False) -> dict:
        item = {key: episode.get(key) for key in ("id", "title", "description", "published_at", "content_type", "size_bytes")}
        item["audio_url"] = public_url(self.storage.name, episode["object"])
        if staff:
            item.update(status=episode["status"], created_at=episode.get("created_at"))
        return item

    def staff_list(self) -> list[dict]:
        rows = sorted(self.episodes.all(), key=lambda e: e.get("created_at") or "", reverse=True)
        return [self.view(e, staff=True) for e in rows]

    def public_list(self) -> list[dict]:
        rows = [e for e in self.episodes.all() if e.get("status") == "published" and e.get("published_at")]
        rows.sort(key=lambda e: e["published_at"], reverse=True)
        return [self.view(e) for e in rows]


_service = None


def get_service() -> PodcastService:
    global _service
    bucket = bucket_name()
    project = os.getenv("FIREBASE_PROJECT_ID", "").strip()
    if not project:
        raise PodcastUnavailable("Podcast storage is not configured.")
    if _service is None or _service.storage.name != bucket:
        from firebase_admin import firestore
        from inquiries.firebase import firebase_app
        _service = PodcastService(FirestoreEpisodes(firestore.client(app=firebase_app(project))), GcsStorage(bucket))
    return _service
