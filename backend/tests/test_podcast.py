import pytest

from podcast import service as podcast_service
from podcast.service import EpisodeNotFound, PodcastService, UploadIncomplete

IDS = iter(f"{n:032x}" for n in range(1, 1000))


class FakeEpisodes:
    def __init__(self):
        self.rows = {}

    def create(self, episode_id, data):
        assert episode_id not in self.rows
        self.rows[episode_id] = dict(data)

    def get(self, episode_id):
        return dict(self.rows[episode_id]) if episode_id in self.rows else None

    def update(self, episode_id, changes):
        self.rows[episode_id].update(changes)

    def all(self):
        return [dict(row) for row in self.rows.values()]


class FakeStorage:
    name = "diamondecho-podcast"

    def __init__(self):
        self.sessions, self.objects = [], {}

    def start_upload(self, obj, content_type, size, origin):
        self.sessions.append((obj, content_type, size, origin))
        return f"https://storage.googleapis.com/upload/session/{len(self.sessions)}"

    def size_of(self, obj):
        return self.objects.get(obj)


class Clock:
    def __init__(self):
        self.n = 0

    def __call__(self):
        self.n += 1
        return f"2026-10-09T12:00:{self.n:02d}+00:00"


def make():
    episodes, storage = FakeEpisodes(), FakeStorage()
    return PodcastService(episodes, storage, clock=Clock(), new_id=lambda: next(IDS)), episodes, storage


def test_an_upload_session_is_opened_for_the_staff_site_only():
    service, episodes, storage = make()
    started = service.start_episode("Atlanta in October", "Rates and listings.", "audio/mpeg", 1234, "staff-uid",
                                    "https://staff.diamondecho.com")
    obj = f"episodes/{started['id']}.mp3"
    assert storage.sessions == [(obj, "audio/mpeg", 1234, "https://staff.diamondecho.com")]
    assert started["upload_url"].startswith("https://storage.googleapis.com/upload/")
    row = episodes.rows[started["id"]]
    assert row["status"] == "uploading" and row["created_by"] == "staff-uid"
    assert service.public_list() == []  # nothing is public until it is published


def test_publishing_checks_the_whole_file_arrived():
    service, _, storage = make()
    started = service.start_episode("Episode", "", "audio/mp4", 2000, "uid", "https://staff.example.com")
    with pytest.raises(UploadIncomplete):
        service.publish(started["id"])
    storage.objects[f"episodes/{started['id']}.m4a"] = 1999
    with pytest.raises(UploadIncomplete):
        service.publish(started["id"])
    storage.objects[f"episodes/{started['id']}.m4a"] = 2000
    published = service.publish(started["id"])
    assert published["status"] == "published"
    assert published["audio_url"] == f"https://storage.googleapis.com/diamondecho-podcast/episodes/{started['id']}.m4a"


def test_public_list_is_published_episodes_newest_first_without_staff_details():
    service, _, storage = make()
    ids = []
    for title in ("First", "Second", "Draft"):
        started = service.start_episode(title, "", "audio/mpeg", 10, "uid", "https://staff.example.com")
        ids.append(started["id"])
        if title != "Draft":
            storage.objects[f"episodes/{started['id']}.mp3"] = 10
            service.publish(started["id"])
    public = service.public_list()
    assert [e["title"] for e in public] == ["Second", "First"]
    assert "status" not in public[0] and "created_by" not in public[0]
    assert [e["title"] for e in service.staff_list()] == ["Draft", "Second", "First"]
    service.unpublish(ids[1])
    assert [e["title"] for e in service.public_list()] == ["First"]
    # Publishing again keeps the original date, so the order does not jump.
    first_date = service.public_list()[0]["published_at"]
    service.publish(ids[1])
    assert [e["published_at"] for e in service.public_list()][1] == first_date


def test_unknown_or_malformed_ids_are_not_found():
    service, _, _ = make()
    for bad in ("../x", "0" * 31, "f" * 32):
        with pytest.raises(EpisodeNotFound):
            service.publish(bad)


def test_storage_must_be_configured(monkeypatch):
    monkeypatch.delenv("PODCAST_BUCKET", raising=False)
    with pytest.raises(podcast_service.PodcastUnavailable):
        podcast_service.get_service()
    monkeypatch.setenv("PODCAST_BUCKET", "Not A Bucket!")
    with pytest.raises(podcast_service.PodcastUnavailable):
        podcast_service.bucket_name()


def test_routes(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from inquiries.router import require_staff
    from podcast import router as podcast_router

    app = FastAPI()
    app.include_router(podcast_router.router, prefix="/api")
    client = TestClient(app)
    monkeypatch.delenv("PODCAST_BUCKET", raising=False)
    assert client.get("/api/v1/podcast/episodes").status_code == 503

    service, _, storage = make()
    app.dependency_overrides[podcast_router.service] = lambda: service
    app.dependency_overrides[require_staff] = lambda: "staff-uid"
    monkeypatch.setattr(podcast_router, "queue_settings",
                        lambda: ("proj", {"staff-uid"}, "https://public.example.com", "https://staff.example.com"))

    assert client.post("/api/v1/podcast/staff/episodes", json={"title": "  ", "content_type": "audio/mpeg",
                                                                "size_bytes": 5}).status_code == 422
    assert client.post("/api/v1/podcast/staff/episodes", json={"title": "x", "content_type": "video/mp4",
                                                                "size_bytes": 5}).status_code == 422
    assert client.post("/api/v1/podcast/staff/episodes", json={"title": "x", "content_type": "audio/mpeg",
                                                                "size_bytes": 301 * 1024 * 1024}).status_code == 422
    started = client.post("/api/v1/podcast/staff/episodes",
                          json={"title": "Atlanta in October", "description": "Rates.", "content_type": "audio/mpeg",
                                "size_bytes": 5})
    assert started.status_code == 201 and started.headers["cache-control"] == "no-store"
    episode_id = started.json()["id"]
    assert storage.sessions[-1][3] == "https://staff.example.com"
    assert client.post(f"/api/v1/podcast/staff/episodes/{episode_id}/publish").status_code == 409
    storage.objects[f"episodes/{episode_id}.mp3"] = 5
    assert client.post(f"/api/v1/podcast/staff/episodes/{episode_id}/publish").json()["status"] == "published"
    listed = client.get("/api/v1/podcast/episodes")
    assert listed.headers["cache-control"] == "public, max-age=300"
    assert [e["title"] for e in listed.json()["items"]] == ["Atlanta in October"]
    assert client.post("/api/v1/podcast/staff/episodes/" + "a" * 32 + "/publish").status_code == 404


def test_staff_routes_need_a_staff_sign_in():
    # A fresh interpreter, as in test_inquiries.py: tests/deal_intelligence
    # would shadow the service's own package.
    import subprocess
    import sys
    from pathlib import Path
    script = """
import sys
sys.path.insert(0, sys.argv[1])
import server
from fastapi.testclient import TestClient
with TestClient(server.app) as c:
    r = c.get('/api/v1/podcast/staff/episodes')
    assert r.status_code in (401, 503), r.status_code
    r = c.post('/api/v1/podcast/staff/episodes', json={'title': 'x', 'content_type': 'audio/mpeg', 'size_bytes': 5})
    assert r.status_code in (401, 503), r.status_code
    r = c.get('/api/v1/podcast/staff/episodes', headers={'Origin': 'https://public.example.com', 'Authorization': 'Bearer t'})
    assert r.status_code in (403, 503), r.status_code
"""
    subprocess.run([sys.executable, "-c", script, str(Path(__file__).resolve().parents[1])], check=True)
