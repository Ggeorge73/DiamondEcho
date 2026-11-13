"""What the API does when the things it depends on break.

Every test here injects a failure (the database is down or slow, a provider
times out, errors or answers nonsense, a request body is malformed or huge)
and checks that the service degrades: a clean 4xx, 502 or 503 with the
documented message, `no-store` where the answer must not be kept, no internal
detail in the body, and `/health` still up. Nothing here uses the network.

A test marked `xfail` is a weakness that was found and written down, not a
test that is broken. The reason names the file and line, and
docs/sre/chaos-and-game-days.md lists them. `strict=True` means the test
fails the day the weakness is fixed, so the mark is removed then and the
behaviour stays protected. Application code is not changed from this file.
"""
import base64
import json
import os
import subprocess
import sys
import urllib.error
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

import inquiries.firebase as identity
import inquiries.router as inquiry_routes
from inquiries.firebase import FirestoreInquiryStore
from inquiries.models import InquiryCreate
from inquiries.service import QueueUnavailable, acknowledge_inquiry, list_staff_inquiries, submit_inquiry
from market_brief import router as brief_router, script as brief_script, service as brief_service, sources, tts
from podcast import router as podcast_router, service as podcast_service
from property_data import router as property_router, service as property_service

# Cloud Run ends a request after 30 seconds (docs/de13-production-setup.md).
# A call that can outlast it holds the only worker of an instance for nothing.
REQUEST_TIMEOUT_SECONDS = 30
# A marker put in every injected error. It stands for a hostname, a key or a
# stack frame: if it ever reaches a response body, internal detail leaks.
INTERNAL = "INTERNAL-DETAIL-10.0.0.7"
LEAKS = (INTERNAL, "Traceback", "site-packages", ".py\"", "RuntimeError", "googleapis")

CONFIGURED = {
    "INQUIRY_STAFF_QUEUE_ENABLED": "true", "FIREBASE_PROJECT_ID": "demo-diamondecho",
    "INQUIRY_STAFF_UIDS": "staff-1", "PUBLIC_ORIGIN": "https://public.example.com",
    "STAFF_ORIGIN": "https://staff.example.com", "MARKET_BRIEF_ENABLED": "true",
    "PODCAST_BUCKET": "demo-diamondecho-podcast", "RENTCAST_API_KEY": "rentcast-key-for-tests",
    "MAPBOX_ACCESS_TOKEN": "mapbox-token-for-tests",
}


def buyer(**changes):
    return {"kind": "buyer", "full_name": "Test Visitor", "email": "visitor@example.com",
            "message": "Please contact me", "consent": True, **changes}


def assert_no_leak(text):
    for needle in LEAKS:
        assert needle not in text, f"the answer shows internal detail ({needle})"


# ---------------------------------------------------------------------------
# The whole service, in a fresh interpreter, with faults switched on by name.
# A fresh interpreter because tests/deal_intelligence shadows the service's
# own package here (the same reason test_inquiries.py starts one).
# ---------------------------------------------------------------------------

WHOLE_SERVICE = r'''
import json, socket, sys, time, urllib.error, urllib.request

def no_network(*args, **kwargs):
    raise AssertionError("a resilience test tried to use the network")
socket.socket.connect = no_network
socket.create_connection = no_network

sys.path.insert(0, sys.argv[1])
plan = json.loads(sys.stdin.read())
INTERNAL = plan["internal"]

import firebase_admin
from firebase_admin import auth, firestore
from google.api_core.exceptions import ServiceUnavailable
import server
import inquiries.firebase as identity
import inquiries.router as inquiry_routes
import market_brief.tts as tts
import property_data.service as property_service
from fastapi.testclient import TestClient


class DeadDatabase:
    """Queries can be built, but every call that would reach Firestore fails."""
    def collection(self, *args, **kwargs):
        return self
    document = order_by = limit = collection
    def down(self, *args, **kwargs):
        raise ServiceUnavailable(INTERNAL + " firestore.googleapis.com refused the connection")
    create = get = set = update = stream = transaction = down


def boom(*args, **kwargs):
    raise RuntimeError(INTERNAL + " dependency unavailable")

def provider_timeout(*args, **kwargs):
    raise urllib.error.URLError(TimeoutError(INTERNAL + " timed out"))

def database_client_fails():
    identity._store.cache_clear()
    firestore.client = boom

def database_calls_fail():
    identity._store.cache_clear()
    identity.firebase_app = lambda project: object()
    firestore.client = lambda app=None: DeadDatabase()

def identity_down():
    auth.verify_id_token = boom

def staff_signed_in():
    inquiry_routes.verify_staff = lambda authorization: "staff-1"

def storage_down():
    from google.cloud import storage
    storage.Client = boom

class MemoryQueue:
    """A working inquiry queue, so a request gets as far as the field checks."""
    documents = {}
    def create_once(self, request_id, document):
        replay = request_id in self.documents
        self.documents.setdefault(request_id, document)
        return self.documents[request_id], replay

def memory_queue():
    inquiry_routes.get_store = lambda: MemoryQueue()

def providers_down():
    property_service.urlopen = provider_timeout
    urllib.request.urlopen = provider_timeout
    tts.google_session = boom

FAULTS = dict(database_client_fails=database_client_fails, database_calls_fail=database_calls_fail,
              identity_down=identity_down, staff_signed_in=staff_signed_in, storage_down=storage_down,
              providers_down=providers_down, memory_queue=memory_queue)
for name in plan["faults"]:
    FAULTS[name]()

results = {}
with TestClient(server.app, raise_server_exceptions=False) as client:
    for step in plan["requests"]:
        kwargs = {}
        if "json" in step:
            kwargs["json"] = step["json"]
        if "big" in step:  # {"field": ..., "size": ...}: a body too large to pass by hand
            kwargs["json"] = {**step.get("json", {}), step["big"]["field"]: "x" * step["big"]["size"]}
        if "body" in step:
            kwargs["content"] = step["body"].encode("utf-8")
        started = time.monotonic()
        response = client.request(step["method"], step["path"], headers=step.get("headers"), **kwargs)
        results[step["name"]] = {
            "status": response.status_code, "headers": dict(response.headers),
            "text": response.text[:4000], "bytes": len(response.content),
            "seconds": round(time.monotonic() - started, 3),
        }
results["stored inquiries"] = len(MemoryQueue.documents)
print("RESULTS " + json.dumps(results))
'''


def whole_service(faults, requests, env=CONFIGURED):
    """Answers of the real `server.app` to `requests`, with `faults` switched on."""
    plan = {"internal": INTERNAL, "faults": faults, "requests": requests}
    clean = {"PATH": os.environ.get("PATH", ""), **env}
    done = subprocess.run([sys.executable, "-c", WHOLE_SERVICE, str(BACKEND)], input=json.dumps(plan),
                          capture_output=True, text=True, env=clean, timeout=120)
    lines = [line for line in done.stdout.splitlines() if line.startswith("RESULTS ")]
    assert done.returncode == 0 and lines, done.stderr[-2000:]
    return json.loads(lines[-1][len("RESULTS "):])


def step(name, method, path, **more):
    return {"name": name, "method": method, "path": path, **more}


STAFF = {"Authorization": "Bearer a-staff-token"}
JSON_BODY = {"Content-Type": "application/json"}


def key():
    return {"X-Idempotency-Key": str(uuid.uuid4())}


ALWAYS_UP = [
    step("health", "GET", "/health"),
    step("healthz", "GET", "/healthz"),
    step("api root", "GET", "/api/"),
    step("assistant health", "GET", "/api/assistant/health"),
    step("calculator profiles", "GET", "/api/v1/deals/assumption-profiles"),
    step("deal analysis", "POST", "/api/v1/deals/analyze", json={
        "strategy": "rental",
        "property": {"property_type": "multifamily", "unit_count": 4},
        "acquisition": {"purchase_price": 1_000_000, "closing_costs": 20_000, "hold_months": 60},
        "debt": [{"loan_to_value": 0.70, "annual_interest_rate": 0.06, "amortization_years": 30, "term_months": 120}],
        "operating": {"gross_scheduled_rent": 120_000, "other_income": 5_000, "vacancy_rate": 0.05,
                      "operating_expenses": 40_000, "replacement_reserves": 5_000,
                      "annual_income_growth_rate": 0.03, "annual_expense_growth_rate": 0.03},
        "exit": {"exit_cap_rate": 0.06},
    }),
]

DEPENDENT = [
    step("inquiry submit", "POST", "/api/v1/inquiries", json=buyer(), headers=key()),
    step("staff list", "GET", "/api/v1/inquiries/staff", headers=STAFF),
    step("staff acknowledge", "PATCH", f"/api/v1/inquiries/staff/{uuid.uuid4()}/acknowledge", headers=STAFF),
    step("status list", "GET", "/api/status", headers=STAFF),
    step("status write", "POST", "/api/status", headers=STAFF, json={"client_name": "resilience"}),
    step("market brief", "GET", "/api/v1/market-brief"),
    step("market brief audio", "GET", "/api/v1/market-brief/audio/2026-10-09.mp3"),
    step("podcast episodes", "GET", "/api/v1/podcast/episodes"),
    step("podcast staff episodes", "GET", "/api/v1/podcast/staff/episodes", headers=STAFF),
    step("property lookup", "GET", "/api/v1/properties/lookup?address=1+Main+St+Atlanta+GA"),
    step("address suggestions", "GET", f"/api/v1/properties/suggest?q=1+Main&session_token={uuid.uuid4()}"),
]

# The documented answer of each route when its dependency is down.
DOWN = {
    "inquiry submit": (503, {"Inquiry storage was not confirmed. Retry with the same submission key.",
                             "Inquiry queue is temporarily unavailable."}),
    "staff list": (503, {"Inquiry queue is temporarily unavailable."}),
    "staff acknowledge": (503, {"Inquiry acknowledgement was not confirmed.", "Inquiry queue is temporarily unavailable."}),
    "status list": (503, {"Status storage unavailable.", "Inquiry queue is temporarily unavailable."}),
    "status write": (503, {"Status storage unavailable.", "Inquiry queue is temporarily unavailable."}),
    "market brief": (503, {"The market brief is unavailable right now."}),
    "market brief audio": (503, {"The market brief is unavailable right now."}),
    "podcast episodes": (503, {"Podcast storage is unavailable."}),
    "podcast staff episodes": (503, {"Podcast storage is unavailable."}),
    "property lookup": (502, {"Property-data provider is temporarily unavailable."}),
    "address suggestions": (502, {"Address provider is temporarily unavailable."}),
}
MUST_NOT_BE_KEPT = ("inquiry submit", "staff list", "staff acknowledge", "status list", "status write")


@pytest.fixture(scope="module")
def database_refusing_calls():
    """Firestore accepts the client but every read and write fails; the staff
    member is signed in; every provider times out."""
    return whole_service(["database_calls_fail", "staff_signed_in", "storage_down", "providers_down"],
                         ALWAYS_UP + DEPENDENT)


@pytest.fixture(scope="module")
def nothing_reachable():
    """Not even a database client can be made, sign-in checks fail, and every
    provider times out."""
    return whole_service(["database_client_fails", "identity_down", "storage_down", "providers_down"],
                         ALWAYS_UP + DEPENDENT)


@pytest.mark.parametrize("name", [s["name"] for s in ALWAYS_UP])
@pytest.mark.parametrize("outage", ["database_refusing_calls", "nothing_reachable"])
def test_health_and_the_calculators_stay_up_while_every_dependency_is_down(request, outage, name):
    answer = request.getfixturevalue(outage)[name]
    assert answer["status"] == 200, answer["text"]
    assert answer["seconds"] < 2
    if name in ("health", "healthz"):
        assert json.loads(answer["text"]) == {"status": "ok"}


@pytest.mark.parametrize("name", sorted(DOWN))
def test_a_dead_database_or_provider_is_a_clean_503_or_502_with_the_documented_message(database_refusing_calls, name):
    answer = database_refusing_calls[name]
    status, messages = DOWN[name]
    assert answer["status"] == status, answer["text"]
    assert answer["headers"]["content-type"] == "application/json"
    assert json.loads(answer["text"])["detail"] in messages
    assert_no_leak(answer["text"])
    assert answer["seconds"] < 5


@pytest.mark.parametrize("name", sorted(DOWN))
def test_nothing_reachable_at_all_is_still_a_clean_answer_and_never_a_500(nothing_reachable, name):
    answer = nothing_reachable[name]
    assert answer["status"] in (502, 503), answer["text"]
    assert isinstance(json.loads(answer["text"])["detail"], str)
    assert_no_leak(answer["text"])
    assert answer["seconds"] < 5


@pytest.mark.parametrize("name", MUST_NOT_BE_KEPT)
@pytest.mark.parametrize("outage", ["database_refusing_calls", "nothing_reachable"])
def test_failed_inquiry_and_staff_answers_are_never_stored_by_a_browser(request, outage, name):
    assert request.getfixturevalue(outage)[name]["headers"].get("cache-control") == "no-store"


def test_identity_provider_down_is_503_for_staff_not_a_sign_in_failure(nothing_reachable):
    # A 401 would send a signed-in staff member back to the sign-in page for
    # an outage that is not theirs to fix.
    answer = nothing_reachable["staff list"]
    assert answer["status"] == 503
    assert json.loads(answer["text"])["detail"] == "Staff identity verification is temporarily unavailable."


@pytest.mark.xfail(strict=True, reason=(
    "backend/server.py, protect_staff_surface: its last lines add no-store only for /api/v1/inquiries and /api/status. A staff podcast answer that "
    "fails in a dependency (401, 403 or 503 from require_staff or podcast/router.py:23 service()) carries no "
    "Cache-Control. Fix: include /api/v1/podcast/staff in that condition."))
def test_failed_staff_podcast_answers_are_never_stored_by_a_browser(database_refusing_calls, nothing_reachable):
    for outage in (database_refusing_calls, nothing_reachable):
        assert outage["podcast staff episodes"]["headers"].get("cache-control") == "no-store"


def test_the_service_starts_and_answers_health_with_no_settings_at_all():
    answers = whole_service([], ALWAYS_UP + DEPENDENT[:1] + [DEPENDENT[5], DEPENDENT[7]], env={})
    assert answers["health"]["status"] == 200
    assert answers["deal analysis"]["status"] == 200
    # Switched-off features say so; they do not crash.
    assert answers["inquiry submit"]["status"] == 503
    assert json.loads(answers["inquiry submit"]["text"])["detail"] == "Inquiry queue is not configured."
    assert json.loads(answers["market brief"]["text"])["detail"] == "The market brief is switched off."
    assert json.loads(answers["podcast episodes"]["text"])["detail"] == "Podcast storage is not configured."


def test_the_service_starts_with_nonsense_settings_and_refuses_safely():
    nonsense = {"INQUIRY_STAFF_QUEUE_ENABLED": "TRUE ", "FIREBASE_PROJECT_ID": "Not A Project!",
                "INQUIRY_STAFF_UIDS": ",,,", "PUBLIC_ORIGIN": "javascript:alert(1)", "STAFF_ORIGIN": "ftp://x",
                "PODCAST_BUCKET": "../../etc", "MARKET_BRIEF_ENABLED": "yes", "INQUIRY_LIMIT_PER_ADDRESS": "-1",
                "MONTE_CARLO_TIME_BUDGET_SECONDS": "soon", "CORS_ORIGINS": ",,", "API_DOCS_ENABLED": "1"}
    answers = whole_service([], ALWAYS_UP + DEPENDENT, env=nonsense)
    assert answers["health"]["status"] == 200
    for name in DOWN:
        assert answers[name]["status"] < 500 or answers[name]["status"] in (502, 503), (name, answers[name]["text"])
    assert answers["inquiry submit"]["status"] == 503
    assert answers["staff list"]["status"] == 503


# ---------------------------------------------------------------------------
# Malformed and oversized request bodies, against the whole service.
# ---------------------------------------------------------------------------

POST_ROUTES = ["/api/v1/inquiries", "/api/v1/deals/analyze", "/api/v1/deals/monte-carlo",
               "/api/assistant/chat", "/api/assistant/analyze", "/api/status"]
BROKEN_BODIES = {
    "empty": "",
    "not json": "{not json",
    "a list": "[1, 2, 3]",
    "a string": "\"hello\"",
    "null": "null",
    "wrong types": "{\"kind\": 7, \"strategy\": [], \"message\": {\"a\": 1}, \"deal\": \"x\"}",
    "control characters": "{\"full_name\": \"a\\u0000b\", \"message\": \"\\u202e\"}",
    "nested 100000 deep": "[" * 100_000 + "]" * 100_000,
    "a number of 400 digits": "{\"acquisition\": {\"purchase_price\": " + "9" * 400 + "}}",
}


@pytest.fixture(scope="module")
def broken_requests():
    requests = [step(f"{path} {label}", "POST", path, body=body, headers={**JSON_BODY, **key()})
                for path in POST_ROUTES for label, body in BROKEN_BODIES.items()]
    requests += [
        step("form encoded", "POST", "/api/v1/inquiries", body="kind=buyer&consent=true",
             headers={"Content-Type": "application/x-www-form-urlencoded", **key()}),
        step("huge key", "POST", "/api/v1/inquiries", json=buyer(), headers={"X-Idempotency-Key": "k" * 8000}),
        step("three megabyte message", "POST", "/api/v1/inquiries", json=buyer(), big={"field": "message", "size": 3_000_000},
             headers=key()),
        step("three megabyte deal", "POST", "/api/v1/deals/analyze", json={}, big={"field": "strategy", "size": 3_000_000}),
        step("nan inquiry", "POST", "/api/v1/inquiries", body="{\"kind\": \"buyer\", \"full_name\": NaN}",
             headers={**JSON_BODY, **key()}),
        step("nan deal", "POST", "/api/v1/deals/analyze", body="{\"strategy\": \"rental\", \"acquisition\": {\"purchase_price\": NaN}}",
             headers=JSON_BODY),
        step("infinity simulation", "POST", "/api/v1/deals/monte-carlo", body="{\"deal\": Infinity}", headers=JSON_BODY),
        step("health after all that", "GET", "/health"),
    ]
    # Roomy inquiry limits, as in conftest.py: this is about bodies, not limits.
    roomy = {**CONFIGURED, "INQUIRY_LIMIT_PER_ADDRESS": "1000", "INQUIRY_LIMIT_PER_HOUR": "1000"}
    return whole_service(["staff_signed_in", "memory_queue"], requests, env=roomy)


@pytest.mark.parametrize("label", sorted(BROKEN_BODIES))
@pytest.mark.parametrize("path", POST_ROUTES)
def test_a_malformed_body_is_refused_with_a_4xx_and_never_a_500(broken_requests, path, label):
    answer = broken_requests[f"{path} {label}"]
    assert 400 <= answer["status"] < 500 or answer["status"] == 503, answer["text"][:300]
    assert answer["headers"]["content-type"] == "application/json"
    assert_no_leak(answer["text"])


def test_other_content_types_and_an_absurd_submission_key_are_refused(broken_requests):
    assert broken_requests["form encoded"]["status"] == 422
    assert broken_requests["huge key"]["status"] == 422
    assert broken_requests["health after all that"]["status"] == 200


def test_no_malformed_or_oversized_request_put_anything_in_the_queue(broken_requests):
    assert broken_requests["stored inquiries"] == 0


@pytest.mark.xfail(strict=True, reason=(
    "A body holding the bare word NaN or Infinity (Python's JSON reader accepts both) makes FastAPI's own 422 "
    "answer fail to serialise the echoed input, so every public POST route answers 500 'Internal Server Error' "
    "and logs a stack trace. Seen on /api/v1/inquiries, /api/v1/deals/analyze and /api/v1/deals/monte-carlo. "
    "No handler is registered where backend/server.py creates the app (app = FastAPI(...)). Fix: add a RequestValidationError handler there that "
    "answers 422 from exc.errors(include_input=False, include_context=False)."))
def test_a_body_with_nan_or_infinity_is_refused_with_a_422(broken_requests):
    for name in ("nan inquiry", "nan deal", "infinity simulation"):
        assert broken_requests[name]["status"] == 422, (name, broken_requests[name]["text"])


def test_a_body_with_nan_or_infinity_shows_no_internal_detail_and_leaves_the_service_up(broken_requests):
    # Today these are 500s (see the xfail above). Until that is fixed, at
    # least the body must say nothing and the next request must work.
    for name in ("nan inquiry", "nan deal", "infinity simulation"):
        assert broken_requests[name]["status"] in (422, 500)
        assert_no_leak(broken_requests[name]["text"])
    assert broken_requests["health after all that"]["status"] == 200


@pytest.mark.xfail(strict=True, reason=(
    "No route limits the size of a request body, and FastAPI's 422 answer echoes the rejected input back: a "
    "3 MB message to /api/v1/inquiries is read, parsed and returned in a 3 MB 422 (the same on "
    "/api/v1/deals/analyze). Cloud Run's own ceiling is 32 MiB on a 1 GiB instance. Fix: in backend/server.py, "
    "refuse a Content-Length above about 64 KiB with 413 in protect_staff_surface, and drop the echoed "
    "input with the same RequestValidationError handler as the NaN finding."))
def test_an_oversized_body_is_refused_with_a_short_answer(broken_requests):
    for name in ("three megabyte message", "three megabyte deal"):
        assert broken_requests[name]["status"] in (413, 422)
        assert broken_requests[name]["bytes"] < 10_000, f"{name}: answered with {broken_requests[name]['bytes']} bytes"


def test_an_oversized_body_is_refused_and_never_a_500(broken_requests):
    for name in ("three megabyte message", "three megabyte deal"):
        assert broken_requests[name]["status"] in (413, 422)


# ---------------------------------------------------------------------------
# The inquiry queue: a slow or failing database, at the store itself.
# ---------------------------------------------------------------------------

class RecordingReference:
    """A Firestore document reference that notes the deadline of each call."""
    def __init__(self, calls, fail=None):
        self.calls, self.fail = calls, fail

    def _call(self, name, kwargs):
        self.calls.append((name, kwargs.get("timeout")))
        if self.fail:
            raise self.fail

    def create(self, document, **kwargs):
        self._call("create", kwargs)
        return SimpleNamespace(update_time="now")

    def get(self, **kwargs):
        self._call("get", kwargs)
        return SimpleNamespace(exists=False, to_dict=lambda: None)

    def set(self, data, **kwargs):
        self._call("set", kwargs)

    def update(self, changes, **kwargs):
        self._call("update", kwargs)


class RecordingDatabase:
    def __init__(self, fail=None):
        self.calls = []
        self.reference = RecordingReference(self.calls, fail)
        self.fail = fail

    def collection(self, name):
        return self

    def document(self, name):
        return self.reference

    def order_by(self, *args, **kwargs):
        return self

    def limit(self, count):
        return self

    def stream(self, **kwargs):
        self.calls.append(("stream", kwargs.get("timeout")))
        if self.fail:
            raise self.fail
        return iter(())


def deadlines(calls):
    return [timeout for _, timeout in calls]


def test_every_inquiry_queue_call_has_a_deadline_well_inside_the_request_timeout():
    database = RecordingDatabase()
    store = FirestoreInquiryStore(database)
    store.create_once("request", {"a": 1})
    store.list_newest(50)
    assert [name for name, _ in database.calls] == ["create", "stream"]
    assert all(timeout is not None and timeout <= 10 for timeout in deadlines(database.calls))


def test_market_brief_and_podcast_database_calls_have_deadlines_too():
    database = RecordingDatabase()
    brief = brief_service.FirestoreBriefStore(database)
    brief.get("key"), brief.put("key", {}), brief.set("key", {})
    episodes = podcast_service.FirestoreEpisodes(database)
    episodes.create("id", {}), episodes.get("id"), episodes.update("id", {}), episodes.all()
    assert len(database.calls) == 7
    assert all(timeout is not None and timeout <= 10 for timeout in deadlines(database.calls))


class CallRecorder:
    """Every Firestore read and write made through it, with all its arguments."""
    def __init__(self):
        self.calls = []

    def collection(self, name):
        return self

    def document(self, name):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def limit(self, count):
        return self

    def get(self, **kwargs):
        self.calls.append(("get", kwargs))
        return SimpleNamespace(exists=False, to_dict=lambda: None)

    def stream(self, **kwargs):
        self.calls.append(("stream", kwargs))
        return iter(())

    def create(self, document, **kwargs):
        self.calls.append(("create", kwargs))
        return SimpleNamespace(update_time="now")


@pytest.mark.xfail(strict=True, reason=(
    "Every Firestore call passes only timeout=5 or 10, which bounds one attempt. The client's default retry then "
    "tries again on UNAVAILABLE (and reads also on DEADLINE_EXCEEDED). Measured with google-cloud-firestore 2.34.1 "
    "against an unreachable database: a document get(timeout=5) gave up after 293 s ('Timeout of 300.0s exceeded'), "
    "a query stream(timeout=10) after 259 s, a create(timeout=5) after 57 s ('Timeout of 60.0s exceeded'), and a "
    "whole inquiry submission answered 503 after 54 s (chaos experiment dependencies-refuse-at-call-time). Calls: "
    "backend/inquiries/firebase.py:68, :73, :80; backend/market_brief/service.py:99, :105, :110; "
    "backend/podcast/service.py:76, :79, :83, :86; backend/server.py:82, :90. A visitor gets Cloud Run's 504 after "
    "30 s instead of the documented 503, and the worker thread keeps waiting. Fix: pass "
    "retry=google.api_core.retry.Retry(timeout=10) (or retry=None) with each call."))
def test_firestore_calls_give_up_in_total_not_only_per_attempt():
    database = CallRecorder()
    store = FirestoreInquiryStore(database)
    store.create_once("request", {"a": 1})
    store.list_newest(50)
    brief = brief_service.FirestoreBriefStore(database)
    brief.get("key"), brief.put("key", {})
    episodes = podcast_service.FirestoreEpisodes(database)
    episodes.get("id"), episodes.all()
    assert [name for name, _ in database.calls] == ["create", "stream", "get", "create", "get", "stream"]
    for name, kwargs in database.calls:
        assert "retry" in kwargs, f"{name} keeps the client's default retry (60 s for writes, 300 s for reads)"
        retry = kwargs["retry"]
        assert retry is None or (retry.timeout is not None and retry.timeout <= 10), f"{name}: {retry}"


@pytest.mark.parametrize("error", [TimeoutError("deadline exceeded " + INTERNAL), ConnectionError(INTERNAL),
                                   RuntimeError(INTERNAL)])
def test_a_database_that_times_out_or_refuses_is_reported_as_unavailable_and_nothing_is_confirmed(error):
    store = FirestoreInquiryStore(RecordingDatabase(fail=error))
    inquiry = InquiryCreate(**buyer())
    with pytest.raises(QueueUnavailable) as submitted:
        submit_inquiry(store, inquiry, uuid.uuid4())
    # The visitor is told to retry with the same key, so a write that did
    # land is found again instead of being stored twice.
    assert str(submitted.value) == "Inquiry storage was not confirmed. Retry with the same submission key."
    with pytest.raises(QueueUnavailable) as listed:
        list_staff_inquiries(store, 50)
    assert INTERNAL not in str(listed.value)


def test_a_damaged_record_in_the_queue_is_unavailable_not_a_crash():
    class Damaged:
        def list_newest(self, limit):
            return [{"request_id": "x"}]  # no payload, no dates: not what the service wrote
    with pytest.raises(QueueUnavailable):
        list_staff_inquiries(Damaged(), 50)


def test_an_acknowledgement_the_database_did_not_apply_is_not_reported_as_done():
    class Unchanged:
        def acknowledge(self, request_id, account, timestamp):
            return {"request_id": request_id, "status": "queued"}
    with pytest.raises(QueueUnavailable, match="not confirmed"):
        acknowledge_inquiry(Unchanged(), uuid.uuid4(), "staff-1")


@pytest.mark.xfail(strict=True, reason=(
    "backend/inquiries/firebase.py:40 starts the Firebase app with only a project id, so the staff token check "
    "(verify_id_token with check_revoked=True, line 48) uses the SDK's default HTTP timeout of 120 seconds: a slow "
    "identity service holds a staff request, and the instance's one worker, past Cloud Run's 30 second limit. "
    "Fix: pass options={'projectId': project, 'httpTimeout': 10}."))
def test_the_staff_sign_in_check_has_a_deadline_inside_the_request_timeout(monkeypatch):
    seen = {}

    def not_started(name):
        raise ValueError("no such app")

    def initialize(credential=None, options=None, name="[DEFAULT]"):
        seen.update(options or {})
        return object()
    monkeypatch.setattr(identity.firebase_admin, "get_app", not_started)
    monkeypatch.setattr(identity.firebase_admin, "initialize_app", initialize)
    identity.firebase_app.cache_clear()
    try:
        identity.firebase_app("demo-diamondecho")
    finally:
        identity.firebase_app.cache_clear()
    assert seen.get("httpTimeout") is not None and seen["httpTimeout"] < REQUEST_TIMEOUT_SECONDS


@pytest.mark.xfail(strict=True, reason=(
    "backend/podcast/service.py:64 (create_resumable_upload_session) and :67 (get_blob) pass no timeout, so the "
    "storage SDK's default applies: 60 seconds a try, with retries up to 120 seconds on get_blob. A slow bucket "
    "holds a staff upload or publish past Cloud Run's 30 second limit. Fix: pass timeout=10 to both calls."))
def test_podcast_storage_calls_have_a_deadline_inside_the_request_timeout():
    calls = []

    class Blob:
        cache_control = None

        def create_resumable_upload_session(self, **kwargs):
            calls.append(kwargs.get("timeout"))
            return "https://storage.googleapis.com/upload/session"

    class Bucket:
        def blob(self, name):
            return Blob()

        def get_blob(self, name, **kwargs):
            calls.append(kwargs.get("timeout"))
            return None

    storage = podcast_service.GcsStorage("demo-bucket", client=SimpleNamespace(bucket=lambda name: Bucket()))
    storage.start_upload("episodes/a.mp3", "audio/mpeg", 10, "https://staff.example.com")
    storage.size_of("episodes/a.mp3")
    assert all(timeout is not None and timeout < REQUEST_TIMEOUT_SECONDS for timeout in calls), calls


# ---------------------------------------------------------------------------
# Property data: RentCast and Mapbox timing out, erroring, answering garbage.
# ---------------------------------------------------------------------------

class ProviderAnswer:
    """What urlopen returns: a context manager with the bytes of a body."""
    def __init__(self, body):
        self.body = body if isinstance(body, bytes) else json.dumps(body).encode()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, *args):
        return self.body


@pytest.fixture
def properties(monkeypatch):
    monkeypatch.delenv("K_SERVICE", raising=False)
    monkeypatch.setenv("RENTCAST_API_KEY", "rentcast-key-for-tests")
    monkeypatch.setenv("MAPBOX_ACCESS_TOKEN", "mapbox-token-for-tests")
    property_router.lookup_limiter.reset()
    app = FastAPI()
    app.include_router(property_router.router, prefix="/api")
    seen = {"timeouts": []}

    def provider(answer):
        def urlopen(request, timeout=None):
            seen["timeouts"].append(timeout)
            if isinstance(answer, Exception):
                raise answer
            return ProviderAnswer(answer)
        monkeypatch.setattr(property_service, "urlopen", urlopen)

    with TestClient(app, raise_server_exceptions=False) as client:
        yield SimpleNamespace(
            provider=provider, seen=seen,
            lookup=lambda: client.get("/api/v1/properties/lookup", params={"address": "1 Main St, Atlanta, GA"}),
            suggest=lambda: client.get("/api/v1/properties/suggest", params={"q": "1 Main", "session_token": str(uuid.uuid4())}))
    property_router.lookup_limiter.reset()


def http_error(status):
    return urllib.error.HTTPError("https://provider.example/?key=" + INTERNAL, status, "error", {}, None)


PROVIDER_FAILURES = {
    "times out": urllib.error.URLError(TimeoutError("timed out " + INTERNAL)),
    "read times out": TimeoutError("The read operation timed out " + INTERNAL),
    "refuses the connection": ConnectionRefusedError(INTERNAL),
    "answers 500": http_error(500),
    "answers 429 (quota spent)": http_error(429),
    "answers 401 (key revoked)": http_error(401),
}
PROVIDER_GARBAGE = {
    "an HTML error page": b"<html><body>502 Bad Gateway " + INTERNAL.encode() + b"</body></html>",
    "an empty body": b"",
    "bytes that are not text": b"\xff\xfe\x00\x01",
    "half a JSON document": b"[{\"id\": \"abc\", \"formattedAddr",
    "a JSON string": "maintenance",
    "a JSON number": 7,
    "a list of numbers": [1, 2, 3],
}


@pytest.mark.parametrize("failure", sorted(PROVIDER_FAILURES))
def test_rentcast_and_mapbox_failing_is_a_502_with_the_documented_message(properties, failure):
    properties.provider(PROVIDER_FAILURES[failure])
    looked, suggested = properties.lookup(), properties.suggest()
    assert looked.status_code == 502 and looked.json() == {"detail": "Property-data provider is temporarily unavailable."}
    assert suggested.status_code == 502 and suggested.json() == {"detail": "Address provider is temporarily unavailable."}
    for answer in (looked, suggested):
        assert_no_leak(answer.text)
        assert "key-for-tests" not in answer.text and "token-for-tests" not in answer.text


@pytest.mark.parametrize("garbage", sorted(PROVIDER_GARBAGE))
def test_rentcast_and_mapbox_answering_garbage_is_a_502_not_a_crash_or_an_invented_record(properties, garbage):
    properties.provider(PROVIDER_GARBAGE[garbage])
    looked, suggested = properties.lookup(), properties.suggest()
    assert looked.status_code == 502, looked.text
    assert suggested.status_code == 502, suggested.text
    assert_no_leak(looked.text + suggested.text)


def test_provider_calls_have_a_deadline_well_inside_the_request_timeout(properties):
    properties.provider([])
    properties.lookup(), properties.suggest()
    assert len(properties.seen["timeouts"]) == 2
    assert all(timeout is not None and timeout <= 10 for timeout in properties.seen["timeouts"])


def test_mapbox_entries_without_an_id_are_a_502_not_a_half_filled_list(properties):
    properties.provider({"suggestions": [{"name": "1 Main St"}]})
    assert properties.suggest().status_code == 502
    properties.provider({"suggestions": "none"})
    assert properties.suggest().status_code == 502


@pytest.mark.xfail(strict=True, reason=(
    "backend/property_data/service.py:83 reads payload[0] without checking that RentCast answered with a list. A "
    "JSON object (an error document, or a changed answer shape) raises KeyError(0); KeyError is a LookupError, so "
    "backend/property_data/router.py:40 answers 404 with the detail '0' instead of 502. Fix: raise a provider "
    "error unless the payload is a list of objects."))
def test_rentcast_answering_an_object_instead_of_a_list_is_a_502(properties):
    properties.provider({"error": "maintenance", "status": 200})
    answer = properties.lookup()
    assert answer.status_code == 502, answer.text
    assert answer.json() == {"detail": "Property-data provider is temporarily unavailable."}


@pytest.mark.xfail(strict=True, reason=(
    "backend/property_data/service.py:83-99: a RentCast record with no fields at all ([{}]) is returned as a 200 "
    "'rentcast' property whose id and address are the words the visitor typed and whose facts are all empty. "
    "Nothing is invented, but an empty answer is presented as a found record. Fix: treat a record with no id and "
    "no formattedAddress as 'No property record was found' (404)."))
def test_an_empty_rentcast_record_is_not_presented_as_a_found_property(properties):
    properties.provider([{}])
    assert properties.lookup().status_code in (404, 502)


def test_a_missing_rentcast_record_stays_a_404_the_page_can_explain(properties):
    properties.provider([])
    answer = properties.lookup()
    assert answer.status_code == 404
    assert answer.json() == {"detail": "No property record was found for that address."}


# ---------------------------------------------------------------------------
# The market brief: its database, its sources and its voice.
# ---------------------------------------------------------------------------

TODAY = brief_service.eastern_today


def sources_down(url):
    raise OSError("source down " + INTERNAL)


def brief_client(monkeypatch, service):
    app = FastAPI()
    app.include_router(brief_router.router, prefix="/api")
    monkeypatch.setattr(brief_router, "get_service", lambda: service)
    return TestClient(app, raise_server_exceptions=False)


def make_brief(store=None, fetch=sources_down, speak=lambda text: b"ID3" + text[:8].encode()):
    calls = {"collect": 0, "speak": 0}

    def collect():
        calls["collect"] += 1
        return sources.collect(fetch)

    def synthesize(text):
        calls["speak"] += 1
        return speak(text)
    return brief_service.MarketBriefService(store or brief_service.MemoryStore(), collect, synthesize), calls


@pytest.mark.parametrize("fetch", [
    sources_down,
    lambda url: "<html><body>Service unavailable</body></html>",
    lambda url: "",
    lambda url: "observation_date,WRONGCOLUMN\n2026-10-01,1\n",
    lambda url: "observation_date,GAUR\nnot-a-date,not-a-number\n",
    lambda url: "\x00\x01\x02 binary",
], ids=["down", "an HTML page", "empty", "wrong columns", "unreadable rows", "binary"])
def test_sources_down_or_answering_garbage_give_a_brief_that_says_so_and_invents_nothing(monkeypatch, fetch):
    service, calls = make_brief(fetch=fetch)
    answer = brief_client(monkeypatch, service).get("/api/v1/market-brief")
    assert answer.status_code == 200, answer.text
    market = answer.json()["market"]
    assert market["items"] == []
    assert market["script"] == brief_script.UNAVAILABLE
    assert len(market["unavailable"]) == len(sources.FRED_SERIES) + 1  # every source is named as not read
    assert all(set(problem) == {"source", "reason"} for problem in market["unavailable"])
    assert not any(ch.isdigit() for ch in market["script"]), "a figure was read out with no source behind it"
    assert_no_leak(answer.text)


def test_a_failed_read_of_the_sources_is_not_repeated_on_every_visit(monkeypatch):
    service, calls = make_brief()
    client = brief_client(monkeypatch, service)
    for _ in range(5):
        assert client.get("/api/v1/market-brief").status_code == 200
    assert calls["collect"] == 1  # read again only after RETRY_SECONDS


class VoiceSession:
    """Stands in for the signed Google session that tts.synthesize posts to."""
    def __init__(self, answer):
        self.answer, self.timeouts = answer, []

    def post(self, url, json=None, timeout=None):
        self.timeouts.append(timeout)
        if isinstance(self.answer, Exception):
            raise self.answer
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: self.answer)


VOICE_FAILURES = {
    "times out": TimeoutError("read timed out " + INTERNAL),
    "refuses": ConnectionError(INTERNAL),
    "answers an error document": {"error": {"code": 429, "message": "quota " + INTERNAL}},
    "answers audio that is not base64": {"audioContent": "!!! not base64 !!!"},
    "answers an empty recording": {"audioContent": ""},
    "answers a list": ["unexpected"],
}


@pytest.mark.parametrize("failure", sorted(VOICE_FAILURES))
def test_the_voice_failing_or_answering_garbage_leaves_the_figures_on_the_page_without_audio(monkeypatch, failure):
    from test_market_brief import fake_fetch
    session = VoiceSession(VOICE_FAILURES[failure])
    service, _ = make_brief(fetch=fake_fetch, speak=lambda text: tts.synthesize(text, session=session))
    monkeypatch.setattr(service, "today", lambda: __import__("datetime").date(2026, 10, 9))
    answer = brief_client(monkeypatch, service).get("/api/v1/market-brief")
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert body["market"]["audio_url"] is None and body["tour"]["audio_url"] is None
    assert body["market"]["items"], "the figures were dropped because the voice failed"
    assert_no_leak(answer.text)


def test_audio_that_was_never_made_is_a_404_not_a_500(monkeypatch):
    service, _ = make_brief(speak=lambda text: None)
    client = brief_client(monkeypatch, service)
    client.get("/api/v1/market-brief")
    assert client.get("/api/v1/market-brief/audio/2026-10-09.mp3").status_code == 404
    assert client.get("/api/v1/market-brief/audio/..%2F..%2Fetc.mp3").status_code == 404


class BrokenStore(brief_service.MemoryStore):
    def __init__(self, reads=True, writes=True):
        super().__init__()
        self.reads, self.writes = reads, writes

    def get(self, key):
        if not self.reads:
            raise TimeoutError("Firestore deadline exceeded " + INTERNAL)
        return super().get(key)

    def put(self, key, data):
        if not self.writes:
            raise PermissionError("Firestore write refused " + INTERNAL)
        super().put(key, data)

    set = put


def test_the_brief_database_down_is_a_clean_503_and_the_paid_voice_is_not_called(monkeypatch):
    service, calls = make_brief(store=BrokenStore(reads=False))
    client = brief_client(monkeypatch, service)
    for path in ("/api/v1/market-brief", "/api/v1/market-brief/audio/2026-10-09.mp3"):
        answer = client.get(path)
        assert answer.status_code == 503
        assert answer.json() == {"detail": "The market brief is unavailable right now."}
        assert "max-age" not in answer.headers.get("cache-control", ""), "an outage answer must not be kept"
    assert calls == {"collect": 0, "speak": 0}


def test_a_damaged_brief_record_is_a_clean_503(monkeypatch):
    class Damaged(brief_service.MemoryStore):
        def get(self, key):
            return {"audio_parts": "three"}
    service, _ = make_brief(store=Damaged())
    answer = brief_client(monkeypatch, service).get("/api/v1/market-brief")
    assert answer.status_code == 503 and answer.json() == {"detail": "The market brief is unavailable right now."}


@pytest.mark.xfail(strict=True, reason=(
    "backend/market_brief/service.py:183-184 (_keep) writes a finished brief to Firestore before noting it in "
    "memory. If the write fails (quota, permission, a write outage while reads work) the request answers 503 "
    "although figures and audio were ready, nothing is remembered, and every later visit calls the paid "
    "Text-to-Speech voice again and fails again. Fix: catch the store error in _keep, keep the brief in memory "
    "for RETRY_SECONDS and serve it."))
def test_a_brief_that_cannot_be_saved_is_still_served_and_the_voice_is_not_paid_for_twice(monkeypatch):
    service, calls = make_brief(store=BrokenStore(writes=False))
    client = brief_client(monkeypatch, service)
    answers = [client.get("/api/v1/market-brief") for _ in range(3)]
    assert [answer.status_code for answer in answers] == [200, 200, 200]
    assert calls["speak"] <= 2  # the tour and the day's brief, once each


def test_a_brief_that_cannot_be_saved_fails_cleanly_today(monkeypatch):
    # The other half of the xfail above: until it is fixed, the failure is a
    # plain 503 with no internal detail.
    service, _ = make_brief(store=BrokenStore(writes=False))
    answer = brief_client(monkeypatch, service).get("/api/v1/market-brief")
    assert answer.status_code == 503
    assert_no_leak(answer.text)


def test_each_source_and_voice_call_has_its_own_deadline():
    session = VoiceSession({"audioContent": base64.b64encode(b"ID3").decode()})
    assert tts.synthesize("A short sentence.", session=session) == b"ID3"
    assert session.timeouts and all(timeout is not None and timeout <= 20 for timeout in session.timeouts)
    assert 0 < sources.TIMEOUT_SECONDS <= 10


@pytest.mark.xfail(strict=True, reason=(
    "The first build of a day's brief runs inside one visitor's request (backend/market_brief/router.py:14) and "
    "its calls run one after another: the tour voice (tts.py:72, 20 s), the mortgage sources (sources.py:153-162, "
    "FRED twice then Freddie Mac, 8 s each) and the market voice (20 s). Slow providers can therefore hold the "
    "request for about 64 seconds, past Cloud Run's 30 second limit: the visitor gets the platform's 504, the "
    "instance's one worker is held, and nothing is kept so the next visit starts again. Fix: build the brief "
    "outside the request (a scheduled call), or give the whole build one deadline of about 20 seconds and serve "
    "the figures without audio when it is passed."))
def test_the_slowest_possible_brief_still_fits_inside_the_request_timeout():
    session = VoiceSession({"audioContent": base64.b64encode(b"ID3").decode()})
    tts.synthesize("A short sentence.", session=session)
    voice = session.timeouts[0]
    mortgage_chain = 3 * sources.TIMEOUT_SECONDS  # two FRED series, then the fallback file
    worst = voice + mortgage_chain + voice
    assert worst < REQUEST_TIMEOUT_SECONDS, f"worst case {worst} s"


# ---------------------------------------------------------------------------
# Podcast episodes: the episode list and the storage bucket.
# ---------------------------------------------------------------------------

class FailingEpisodes:
    def _down(self, *args, **kwargs):
        raise TimeoutError("Firestore deadline exceeded " + INTERNAL)
    create = get = update = all = _down


class WorkingStorage:
    name = "demo-diamondecho-podcast"

    def start_upload(self, obj, content_type, size, origin):
        return "https://storage.googleapis.com/upload/session/1"

    def size_of(self, obj):
        return None


@pytest.fixture
def podcast(monkeypatch):
    app = FastAPI()
    app.include_router(podcast_router.router, prefix="/api")
    app.dependency_overrides[inquiry_routes.require_staff] = lambda: "staff-1"
    monkeypatch.setattr(podcast_router, "queue_settings",
                        lambda: ("proj", {"staff-1"}, "https://public.example.com", "https://staff.example.com"))

    def use(service):
        app.dependency_overrides[podcast_router.service] = lambda: service
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client, use


EPISODE = {"title": "Atlanta in October", "content_type": "audio/mpeg", "size_bytes": 5}


def test_the_episode_database_down_is_a_clean_503_that_is_not_kept(podcast):
    client, use = podcast
    use(podcast_service.PodcastService(FailingEpisodes(), WorkingStorage()))
    answers = [
        client.get("/api/v1/podcast/episodes"),
        client.get("/api/v1/podcast/staff/episodes"),
        client.post("/api/v1/podcast/staff/episodes", json=EPISODE),
        client.post("/api/v1/podcast/staff/episodes/" + "a" * 32 + "/publish"),
        client.post("/api/v1/podcast/staff/episodes/" + "a" * 32 + "/unpublish"),
    ]
    for answer in answers:
        assert answer.status_code == 503, answer.text
        assert answer.json() == {"detail": "Podcast storage is unavailable."}
        # The public list is normally kept for five minutes; an outage must not be.
        assert answer.headers.get("cache-control") == "no-store"
        assert_no_leak(answer.text)


def test_the_storage_bucket_failing_is_a_clean_503_and_no_episode_is_recorded(podcast):
    class FailingStorage(WorkingStorage):
        def start_upload(self, *args):
            raise ConnectionError("storage.googleapis.com " + INTERNAL)

    class Episodes(FailingEpisodes):
        created = []

        def create(self, episode_id, data):
            self.created.append(episode_id)
    client, use = podcast
    episodes = Episodes()
    use(podcast_service.PodcastService(episodes, FailingStorage()))
    answer = client.post("/api/v1/podcast/staff/episodes", json=EPISODE)
    assert answer.status_code == 503 and answer.headers.get("cache-control") == "no-store"
    assert episodes.created == [], "an episode was recorded although no upload could start"
    assert_no_leak(answer.text)


def test_a_damaged_episode_record_is_a_clean_503_not_a_crash(podcast):
    class Damaged(FailingEpisodes):
        def all(self):
            return [{"status": "published", "published_at": "2026-10-09", "title": "No file recorded"}]
    client, use = podcast
    use(podcast_service.PodcastService(Damaged(), WorkingStorage()))
    answer = client.get("/api/v1/podcast/episodes")
    assert answer.status_code == 503 and answer.json() == {"detail": "Podcast storage is unavailable."}


def test_an_unconfigured_or_unreachable_podcast_service_is_a_503(monkeypatch):
    app = FastAPI()
    app.include_router(podcast_router.router, prefix="/api")
    client = TestClient(app, raise_server_exceptions=False)
    monkeypatch.delenv("PODCAST_BUCKET", raising=False)
    assert client.get("/api/v1/podcast/episodes").json() == {"detail": "Podcast storage is not configured."}

    def unreachable():
        raise RuntimeError("no credentials " + INTERNAL)
    monkeypatch.setattr(podcast_router, "get_service", unreachable)
    answer = client.get("/api/v1/podcast/episodes")
    assert answer.status_code == 503 and answer.json() == {"detail": "Podcast storage is unavailable."}
