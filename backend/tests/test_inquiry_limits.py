"""Submission limits on POST /api/v1/inquiries (DE-9, DE-33)."""
import copy
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import inquiries.router as routes
from inquiries import limits as L
from inquiries.firebase import verify_staff


class Clock:
    def __init__(self):
        self.now = 1000.0
    def __call__(self):
        return self.now


class Store:
    def __init__(self):
        self.documents = {}
    def create_once(self, key, document):
        replay = key in self.documents
        if not replay:
            self.documents[key] = copy.deepcopy(document)
        return copy.deepcopy(self.documents[key]), replay
    def list_newest(self, limit):
        return list(self.documents.values())[:limit]


@pytest.fixture
def configured(monkeypatch):
    for name, value in {
        "INQUIRY_STAFF_QUEUE_ENABLED": "true", "FIREBASE_PROJECT_ID": "demo-diamondecho",
        "INQUIRY_STAFF_UIDS": "staff-1", "PUBLIC_ORIGIN": "https://public.example.com",
        "STAFF_ORIGIN": "https://staff.example.com",
    }.items():
        monkeypatch.setenv(name, value)
    monkeypatch.delenv("K_SERVICE", raising=False)
    monkeypatch.delenv(L.PER_ADDRESS_ENV, raising=False)
    monkeypatch.delenv(L.PER_HOUR_ENV, raising=False)


@pytest.fixture
def client(configured, monkeypatch):
    app = FastAPI()
    app.include_router(routes.router, prefix="/api")
    store = Store()
    clock = Clock()
    monkeypatch.setattr(routes, "get_store", lambda: store)
    monkeypatch.setattr(routes, "limiter", L.SubmissionLimiter(clock=clock))
    monkeypatch.setattr(routes, "verify_staff", lambda header: verify_staff(
        header, verifier=lambda token: dict(uid="staff-1", email_verified=True, firebase={"sign_in_second_factor": "totp"})))
    with TestClient(app) as c:
        yield c, store, clock


def body():
    return dict(kind="buyer", full_name="Test Visitor", email="visitor@example.com",
                message="Please contact me", consent=True)


def post(c, key=None, json=None, **headers):
    return c.post("/api/v1/inquiries", json=body() if json is None else json,
                  headers={"X-Idempotency-Key": str(key or uuid.uuid4()), **headers})


# --- the limiter on its own -------------------------------------------------

def test_admits_up_to_the_limit_then_says_how_long_to_wait():
    clock = Clock()
    limiter = L.SubmissionLimiter(clock=clock)
    assert [limiter.check("203.0.113.7", 3, 100) for _ in range(3)] == [(None, 0)] * 3
    clock.now += 100
    assert limiter.check("203.0.113.7", 3, 100) == ("address", 500)
    assert limiter.check("203.0.113.8", 3, 100) == (None, 0)


def test_window_slides_and_refusals_are_not_counted():
    clock = Clock()
    limiter = L.SubmissionLimiter(clock=clock)
    for _ in range(2):
        assert limiter.check("203.0.113.7", 2, 100)[0] is None
    for _ in range(50):
        clock.now += 1
        assert limiter.check("203.0.113.7", 2, 100)[0] == "address"
    # Hammering while refused must not push the release time back.
    clock.now = 1000.0 + L.ADDRESS_WINDOW_SECONDS
    assert limiter.check("203.0.113.7", 2, 100) == (None, 0)


def test_instance_cap_holds_whatever_the_address():
    clock = Clock()
    limiter = L.SubmissionLimiter(clock=clock)
    for index in range(4):
        assert limiter.check(f"198.51.100.{index}", 5, 4) == (None, 0)
    clock.now += 600
    assert limiter.check("198.51.100.200", 5, 4) == ("instance", 3000)
    clock.now = 1000.0 + L.INSTANCE_WINDOW_SECONDS
    assert limiter.check("198.51.100.200", 5, 4) == (None, 0)


def test_one_ipv6_household_counts_once_and_mapped_ipv4_matches_ipv4():
    limiter = L.SubmissionLimiter(clock=Clock())
    assert limiter.check("2001:db8:1:2::1", 2, 100)[0] is None
    assert limiter.check("2001:db8:1:2:ffff::9", 2, 100)[0] is None
    assert limiter.check("2001:db8:1:2:aaaa:bbbb:cccc:dddd", 2, 100)[0] == "address"
    assert limiter.check("2001:db8:1:3::1", 2, 100)[0] is None
    assert limiter.check("192.0.2.5", 1, 100)[0] is None
    assert limiter.check("::ffff:192.0.2.5", 1, 100)[0] == "address"


def test_memory_is_bounded_and_holds_no_readable_address():
    clock = Clock()
    limiter = L.SubmissionLimiter(clock=clock, max_tracked=10)
    for index in range(200):
        assert limiter.check(f"10.0.{index // 250}.{index % 250}", 5, 1000)[0] is None
    assert len(limiter._addresses) == 10
    assert all(isinstance(key, bytes) and len(key) == 16 for key in limiter._addresses)
    assert b"10.0." not in b"".join(limiter._addresses)
    clock.now += L.ADDRESS_WINDOW_SECONDS
    limiter.check("10.9.9.9", 5, 1000)
    assert len(limiter._addresses) == 1


def test_counts_are_exact_under_concurrency():
    limiter = L.SubmissionLimiter(clock=Clock())
    with ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(lambda _: limiter.check("203.0.113.7", 7, 1000)[0], range(200)))
    assert results.count(None) == 7 and results.count("address") == 193


@pytest.mark.parametrize("raw", ["", "0", "-3", "abc", "1.5", "1001", " "])
def test_a_bad_setting_falls_back_to_the_default_and_never_switches_the_limit_off(raw):
    assert L.limits({L.PER_ADDRESS_ENV: raw, L.PER_HOUR_ENV: raw}) == (L.DEFAULT_PER_ADDRESS, L.DEFAULT_PER_HOUR)


def test_settings_are_read_when_valid():
    assert L.limits({L.PER_ADDRESS_ENV: " 3 ", L.PER_HOUR_ENV: "1000"}) == (3, 1000)
    assert L.limits({}) == (5, 30)


def request(forwarded=None, host="10.1.1.1"):
    headers = {} if forwarded is None else {"x-forwarded-for": forwarded}
    return SimpleNamespace(headers=headers, client=SimpleNamespace(host=host) if host else None)


def test_on_cloud_run_only_the_entry_the_platform_appended_is_trusted():
    cloud = {"K_SERVICE": "diamondecho-api-staging"}
    assert L.client_address(request("1.1.1.1, 2.2.2.2, 203.0.113.9"), cloud) == "203.0.113.9"
    assert L.client_address(request(" 203.0.113.9 "), cloud) == "203.0.113.9"
    assert L.client_address(request(""), cloud) == "10.1.1.1"
    assert L.client_address(request(None, host=None), cloud) == "unknown"


def test_off_cloud_run_the_forwarded_header_is_ignored():
    assert L.client_address(request("203.0.113.9"), {}) == "10.1.1.1"


# --- through the route ------------------------------------------------------

def test_sixth_submission_from_one_connection_is_refused_and_nothing_is_stored(client):
    c, store, clock = client
    assert [post(c).status_code for _ in range(5)] == [201] * 5
    refused = post(c)
    assert refused.status_code == 429
    assert refused.json()["detail"] == routes.TOO_MANY_FROM_ADDRESS
    assert refused.headers["retry-after"] == str(L.ADDRESS_WINDOW_SECONDS)
    assert refused.headers["cache-control"] == "no-store"
    assert len(store.documents) == 5
    clock.now += L.ADDRESS_WINDOW_SECONDS
    assert post(c).status_code == 201


def test_replays_and_submissions_that_fail_the_field_checks_count_too(client):
    c, store, _ = client
    key = uuid.uuid4()
    assert post(c, key).status_code == 201
    assert post(c, key).status_code == 200
    assert post(c, json={"kind": "buyer"}).status_code == 422
    assert c.post("/api/v1/inquiries", json=body(), headers={"X-Idempotency-Key": "not-a-uuid"}).status_code == 422
    assert c.post("/api/v1/inquiries", json=body()).status_code == 422
    assert post(c).status_code == 429
    assert len(store.documents) == 1


def test_a_body_that_is_not_json_is_refused_earlier_and_not_counted(client, monkeypatch):
    c, store, _ = client
    monkeypatch.setenv(L.PER_ADDRESS_ENV, "1")
    for _ in range(3):
        broken = c.post("/api/v1/inquiries", content=b"{", headers={
            "X-Idempotency-Key": str(uuid.uuid4()), "Content-Type": "application/json"})
        assert broken.status_code == 422
    assert post(c).status_code == 201
    assert post(c).status_code == 429
    assert len(store.documents) == 1


def test_instance_cap_answers_busy_not_success(client, monkeypatch):
    c, store, _ = client
    monkeypatch.setenv("K_SERVICE", "diamondecho-api-staging")
    monkeypatch.setenv(L.PER_HOUR_ENV, "3")
    codes = [post(c, **{"X-Forwarded-For": f"198.51.100.{index}"}).status_code for index in range(4)]
    assert codes == [201, 201, 201, 503]
    busy = post(c, **{"X-Forwarded-For": "198.51.100.77"})
    assert busy.json()["detail"] == routes.QUEUE_BUSY
    assert busy.headers["retry-after"] == str(L.INSTANCE_WINDOW_SECONDS)
    assert len(store.documents) == 3


def test_a_typed_forwarded_header_cannot_dodge_the_limit_on_cloud_run(client, monkeypatch):
    c, store, _ = client
    monkeypatch.setenv("K_SERVICE", "diamondecho-api-staging")
    monkeypatch.setenv(L.PER_ADDRESS_ENV, "2")
    codes = [post(c, **{"X-Forwarded-For": f"9.9.9.{index}, 203.0.113.50"}).status_code for index in range(4)]
    assert codes == [201, 201, 429, 429]
    assert post(c, **{"X-Forwarded-For": "9.9.9.9, 203.0.113.51"}).status_code == 201


def test_off_cloud_run_a_forwarded_header_changes_nothing(client, monkeypatch):
    c, _, _ = client
    monkeypatch.setenv(L.PER_ADDRESS_ENV, "2")
    codes = [post(c, **{"X-Forwarded-For": f"203.0.113.{index}"}).status_code for index in range(3)]
    assert codes == [201, 201, 429]


def test_queue_off_is_still_503_and_counts_nothing(client, monkeypatch):
    c, store, _ = client
    monkeypatch.setenv(L.PER_ADDRESS_ENV, "1")
    def unavailable():
        raise routes.QueueUnavailable("Inquiry queue is not configured.")
    monkeypatch.setattr(routes, "get_store", unavailable)
    for _ in range(4):
        response = post(c)
        assert response.status_code == 503 and response.json()["detail"] == "Inquiry queue is not configured."
    monkeypatch.setattr(routes, "get_store", lambda: store)
    assert post(c).status_code == 201


def test_staff_routes_are_not_limited(client, monkeypatch):
    c, _, _ = client
    monkeypatch.setenv(L.PER_ADDRESS_ENV, "1")
    assert post(c).status_code == 201
    assert post(c).status_code == 429
    for _ in range(5):
        assert c.get("/api/v1/inquiries/staff", headers={"Authorization": "Bearer approved"}).status_code == 200
