"""Request telemetry (backend/observability): what is logged, and what never is.

The API keeps uvicorn's access log off on purpose. The middleware may write
one line per server error or slow request, with the route template and a
trace id, and nothing a visitor typed.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from observability import UNMATCHED, RequestTelemetry, route_template, trace_fields

BACKEND = str(Path(__file__).resolve().parents[1])
ALLOWED_KEYS = {
    "severity", "message", "event", "method", "route", "status", "duration_ms", "slow_threshold_ms", "error",
    "logging.googleapis.com/trace", "logging.googleapis.com/spanId", "logging.googleapis.com/trace_sampled",
}
TRACE = "105445aa7843bc8bf206b12000100000"


class Clock:
    """Each reading moves time on by `step` seconds."""

    def __init__(self, step=0.001):
        self.now = 100.0
        self.step = step

    def __call__(self):
        self.now += self.step
        return self.now


def make_app(lines, *, step=0.001, project_id="diamondecho-prod", slow_ms=1000, staff_guard=True):
    app = FastAPI()

    @app.get("/fine")
    def fine():
        return {"ok": True}

    @app.get("/items/{item_id}")
    def item(item_id: str):
        return JSONResponse({"detail": "Storage unavailable."}, status_code=503)

    @app.post("/echo/{name}")
    async def echo(name: str):
        raise ValueError(f"could not use {name}")  # a message that quotes visitor input

    if staff_guard:
        # Like server.py's protect_staff_surface: a BaseHTTPMiddleware between
        # the router and the telemetry must not hide the matched route.
        @app.middleware("http")
        async def guard(request, call_next):
            return await call_next(request)

    app.add_middleware(RequestTelemetry, write=lines.append, clock=Clock(step), project_id=project_id, slow_ms=slow_ms)
    return app


def test_a_normal_fast_request_writes_nothing_and_gets_server_timing():
    lines = []
    response = TestClient(make_app(lines)).get("/fine")
    assert response.status_code == 200
    assert lines == []
    assert response.headers["server-timing"].startswith("app;dur=")


def test_a_server_error_writes_one_line_with_the_route_template_and_trace():
    lines = []
    client = TestClient(make_app(lines))
    response = client.get("/items/DE-12345?email=visitor@example.com", headers={"X-Cloud-Trace-Context": f"{TRACE}/1;o=1"})
    assert response.status_code == 503
    assert len(lines) == 1
    entry = lines[0]
    assert set(entry) <= ALLOWED_KEYS
    assert entry["severity"] == "ERROR"
    assert entry["event"] == "request.error"
    assert entry["route"] == "/items/{item_id}"
    assert entry["method"] == "GET"
    assert entry["status"] == 503
    assert entry["message"] == "API server error (status 503) on GET /items/{item_id}"
    assert entry["logging.googleapis.com/trace"] == f"projects/diamondecho-prod/traces/{TRACE}"
    assert entry["logging.googleapis.com/spanId"] == "0000000000000001"
    assert entry["logging.googleapis.com/trace_sampled"] is True
    assert "DE-12345" not in json.dumps(entry)


def test_an_unhandled_exception_is_logged_by_type_only_and_still_answers_500():
    lines = []
    client = TestClient(make_app(lines), raise_server_exceptions=False)
    response = client.post("/echo/Jane%20Visitor", json={"message": "my phone is 555-0100"})
    assert response.status_code == 500
    assert len(lines) == 1
    entry = lines[0]
    assert entry["error"] == "ValueError"
    assert entry["status"] == 500
    assert entry["route"] == "/echo/{name}"
    assert entry["message"] == "API server error (unhandled ValueError) on POST /echo/{name}"
    text = json.dumps(entry)
    for secret in ("Jane", "Visitor", "555-0100", "could not use"):
        assert secret not in text


def test_a_slow_request_is_a_warning():
    lines = []
    response = TestClient(make_app(lines, step=0.6, slow_ms=1000)).get("/fine")
    assert response.status_code == 200
    assert len(lines) == 1
    assert lines[0]["severity"] == "WARNING"
    assert lines[0]["event"] == "request.slow"
    assert lines[0]["duration_ms"] >= 1000
    assert lines[0]["message"].startswith("Slow API request (")


def test_nothing_a_visitor_sends_reaches_the_log():
    lines = []
    client = TestClient(make_app(lines, step=5.0), raise_server_exceptions=False)  # every request is slow: all logged
    visitor = {
        "User-Agent": "VisitorBrowser/9 secret-ua",
        "Cookie": "session=cookie-value",
        "Authorization": "Bearer token-value",
        "X-Forwarded-For": "203.0.113.77",
        "Referer": "https://example.com/private-page",
    }
    client.get("/fine?name=Jane+Visitor&email=jane@example.com", headers=visitor)
    client.get("/no/such/place/jane@example.com", headers=visitor)
    client.post("/echo/jane@example.com?q=private", headers=visitor, content=b"free text from the form")
    assert len(lines) == 3
    text = json.dumps(lines)
    for secret in ("Jane", "jane@example.com", "secret-ua", "cookie-value", "token-value", "203.0.113.77",
                   "private", "free text", "/no/such/place", "testserver"):
        assert secret not in text, secret
    assert lines[1]["route"] == UNMATCHED
    for entry in lines:
        assert set(entry) <= ALLOWED_KEYS


def test_trace_fields_accept_only_well_formed_ids():
    def scope(**headers):
        return {"headers": [(key.lower().encode(), value.encode()) for key, value in headers.items()]}

    assert trace_fields(scope(**{"X-Cloud-Trace-Context": TRACE}), "diamondecho-prod") == {
        "logging.googleapis.com/trace": f"projects/diamondecho-prod/traces/{TRACE}"}
    assert trace_fields(scope(**{"X-Cloud-Trace-Context": f"{TRACE}/12;o=1"}), None) == {}
    assert trace_fields(scope(**{"X-Cloud-Trace-Context": "not-a-trace/<script>"}), "diamondecho-prod") == {}
    assert trace_fields(scope(**{"X-Cloud-Trace-Context": "0" * 32}), "diamondecho-prod") == {}
    assert trace_fields(scope(**{"X-Cloud-Trace-Context": TRACE}), "Bad Project!") == {}
    parent = f"00-{TRACE}-00f067aa0ba902b7-01"
    assert trace_fields(scope(traceparent=parent), "diamondecho-prod") == {
        "logging.googleapis.com/trace": f"projects/diamondecho-prod/traces/{TRACE}",
        "logging.googleapis.com/spanId": "00f067aa0ba902b7",
        "logging.googleapis.com/trace_sampled": True,
    }


def test_route_template_never_falls_back_to_the_path():
    assert route_template({"path": "/items/secret"}) == UNMATCHED
    assert route_template({"route": object(), "path": "/x"}) == UNMATCHED


def test_settings_come_from_the_environment(monkeypatch):
    monkeypatch.setenv("OBSERVABILITY_SLOW_MS", "2500")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "diamondecho-prod")
    middleware = RequestTelemetry(lambda *a: None)
    assert middleware.slow_ms == 2500.0
    assert middleware.project_id == "diamondecho-prod"
    monkeypatch.setenv("OBSERVABILITY_SLOW_MS", "soon")
    assert RequestTelemetry(lambda *a: None).slow_ms == 1000.0


def test_wired_into_the_real_api_it_sees_the_route_templates():
    # A fresh interpreter, as in test_build_identity.py: backend/tests holds a
    # package that would shadow the service's own deal_intelligence.
    script = """
import json, sys
sys.path.insert(0, sys.argv[1])
from fastapi.testclient import TestClient
import server
from observability import RequestTelemetry
lines = []
server.app.add_middleware(RequestTelemetry, write=lines.append, slow_ms=0.0, project_id="diamondecho-prod")
client = TestClient(server.app)
assert client.get("/health").status_code == 200
assert client.get("/api/").status_code == 200
assert client.get("/api/v1/nothing-here?x=1").status_code == 404
print(json.dumps([(line["route"], line["status"]) for line in lines]))
"""
    env = {key: value for key, value in os.environ.items() if key not in ("API_DOCS_ENABLED",)}
    out = subprocess.run([sys.executable, "-c", script, BACKEND], check=True, env=env, capture_output=True, text=True)
    assert json.loads(out.stdout.strip().splitlines()[-1]) == [["/health", 200], ["/api/", 200], [UNMATCHED, 404]]
