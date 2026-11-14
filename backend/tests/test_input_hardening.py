"""Every field the API accepts is checked, and every refusal says nothing it should not.

The whole service (`server.app`) is driven in a fresh interpreter with its
outside dependencies replaced by small fakes, so a request gets as far as the
field checks on every route, staff routes included. Nothing uses the network.

What is checked, for every route:

* the route list itself: a route added to the service without being added to
  the tables below fails `test_every_route_of_the_service_is_in_these_tables`;
* a field the route does not know, an over-long string, NaN, Infinity and
  absurd numbers, a list that is too long: 422;
* a body over the route's size limit: 413, whether or not it says how long it
  is; a body that is not JSON: 415; JSON that does not parse: 4xx;
* a query parameter the route does not declare: 422; an address that is too
  long: 414;
* no refusal repeats what was sent (a marker stands for a visitor's words),
  shows a stack trace, a file path, an exception class or the validation
  library, and every refusal is `{"detail": ...}`;
* the requests the site, the staff app and the monitor really send are still
  accepted.

All values are synthetic.
"""
import copy
import json
import os
import re
import shutil
import subprocess
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
sys.path.insert(0, str(BACKEND))

import request_guard  # noqa: E402

# Stands for something a visitor typed. It must never come back in a refusal.
MARKER = "VISITOR-WORDS-7c1e"
# Stands for a hostname or a stack frame inside an injected failure.
INTERNAL = "INTERNAL-DETAIL-10.0.0.7"
PUBLIC_ORIGIN = "https://public.example.com"
STAFF_ORIGIN = "https://staff.example.com"
STAFF = {"Authorization": "Bearer a-staff-token"}

ENVIRONMENT = {
    "INQUIRY_STAFF_QUEUE_ENABLED": "true", "FIREBASE_PROJECT_ID": "demo-diamondecho",
    "INQUIRY_STAFF_UIDS": "staff-1", "PUBLIC_ORIGIN": PUBLIC_ORIGIN, "STAFF_ORIGIN": STAFF_ORIGIN,
    "CORS_ORIGINS": f"{PUBLIC_ORIGIN},{STAFF_ORIGIN}", "MARKET_BRIEF_ENABLED": "true",
    "PODCAST_BUCKET": "demo-diamondecho-podcast", "RENTCAST_API_KEY": "rentcast-key-for-tests",
    "MAPBOX_ACCESS_TOKEN": "mapbox-token-for-tests",
    "INQUIRY_LIMIT_PER_ADDRESS": "1000", "INQUIRY_LIMIT_PER_HOUR": "1000",
}

SERVICE = r'''
import json, socket, sys, time

def no_network(*args, **kwargs):
    raise AssertionError("an input test tried to use the network")
socket.socket.connect = no_network
socket.create_connection = no_network

sys.path.insert(0, sys.argv[1])
plan = json.loads(sys.stdin.read())

import server
import inquiries.router as inquiry_routes
from inquiries.service import StaffUnauthorized
import deal_intelligence.router as deal_routes
import property_data.router as property_routes
import property_data.service as property_service
import market_brief.router as brief_routes
import podcast.router as podcast_routes
import podcast.service as podcast_service
import routes.assistant as assistant_routes
from fastapi.testclient import TestClient


class Database:
    def collection(self, name): return self
    def document(self, name): return self
    def limit(self, count): return self
    def create(self, document, **kwargs): return None
    def stream(self, **kwargs): return iter(())

class Queue:
    """A working inquiry queue held in memory."""
    documents = {}
    db = Database()
    def create_once(self, request_id, document):
        replay = request_id in self.documents
        self.documents.setdefault(request_id, document)
        return self.documents[request_id], replay
    def list_newest(self, limit):
        return list(self.documents.values())[:limit]
    def acknowledge(self, request_id, account, timestamp):
        return {"request_id": request_id, "status": "acknowledged", "acknowledged_at": timestamp}

def verify_staff(authorization):
    if authorization != "Bearer a-staff-token":
        raise StaffUnauthorized()
    return "staff-1"

class Episodes:
    """One finished episode, so publish and unpublish have something to act on."""
    def staff_list(self): return []
    def public_list(self): return []
    def start_episode(self, title, description, content_type, size_bytes, staff, origin):
        return {"id": "a" * 32, "upload_url": "https://storage.example.com/upload/session"}
    def publish(self, episode_id):
        if not podcast_service.ID_PATTERN.fullmatch(episode_id or ""):
            raise podcast_service.EpisodeNotFound(episode_id)
        return {"id": episode_id, "status": "published"}
    unpublish = publish

class Brief:
    def brief(self): return {"market": {"items": []}, "tour": {}}
    def audio(self, key): raise KeyError(key)

class ProviderAnswer:
    def __init__(self, body): self.body = json.dumps(body).encode()
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def read(self, *args): return self.body

def provider(request, timeout=None):
    if "rentcast" in request.full_url:
        return ProviderAnswer([{"id": "record-1", "formattedAddress": "1 Example St, Atlanta, GA 30303"}])
    return ProviderAnswer({"suggestions": [{"mapbox_id": "m1", "name": "1 Example St", "feature_type": "address"}]})

inquiry_routes.get_store = lambda: Queue()
inquiry_routes.verify_staff = verify_staff
server.app.dependency_overrides[podcast_routes.service] = lambda: Episodes()
brief_routes.get_service = lambda: Brief()
property_service.urlopen = provider

def assistant_crashes():
    def crash(request):
        raise RuntimeError(plan["internal"] + " " + request.message)
    assistant_routes.assistant.respond = crash

for name in plan["faults"]:
    {"assistant_crashes": assistant_crashes}[name]()

def pieces(size):
    left = size
    yield b'{"message": "'
    while left > 0:
        yield b"x" * min(left, 16384)
        left -= 16384
    yield b'"}'

results = {}
with TestClient(server.app, raise_server_exceptions=False) as client:
    for step in plan["requests"]:
        if plan["reset_limits"]:
            deal_routes.heavy_limiter.reset()
            property_routes.lookup_limiter.reset()
        kwargs = {}
        if "json" in step:
            kwargs["json"] = step["json"]
        if "body" in step:
            kwargs["content"] = step["body"].encode("utf-8")
        if "pad" in step:  # a body of about this many bytes, with its length declared
            kwargs["content"] = b'{"message": "' + b"x" * step["pad"] + b'"}'
        if "pieces" in step:  # the same, sent in pieces with no Content-Length
            kwargs["content"] = pieces(step["pieces"])
        started = time.monotonic()
        response = client.request(step["method"], step["path"], headers=step.get("headers"), **kwargs)
        results[step["name"]] = {
            "status": response.status_code, "headers": dict(response.headers),
            "text": response.text[:20000], "bytes": len(response.content),
            "seconds": round(time.monotonic() - started, 3),
        }

# The routes of the service and the query parameters FastAPI itself reads for
# each, next to the ones request_guard allows.
import request_guard
described = server.app.openapi()["paths"]
functions = {(path, method): function for path, methods, function in request_guard.route_functions(server.app)
             for method in methods}
routes = []
for path, operations in described.items():
    for method, operation in operations.items():
        routes.append({
            "method": method.upper(), "path": path,
            "query": sorted(p["name"] for p in operation.get("parameters", []) if p["in"] == "query"),
            "allowed": sorted(request_guard._declared_query(functions[(path, method.upper())])),
            "body": "requestBody" in operation,
        })
assert len(routes) == len(functions), (sorted(functions), routes)
layers = [m.cls.__name__ for m in server.app.user_middleware]
print("RESULTS " + json.dumps({"answers": results, "routes": routes, "layers": layers,
                               "stored": len(Queue.documents)}))
'''


def service(requests, faults=(), reset_limits=True):
    """What the real `server.app` answers to `requests`; also its route list."""
    plan = {"internal": INTERNAL, "faults": list(faults), "requests": requests, "reset_limits": reset_limits}
    done = subprocess.run([sys.executable, "-c", SERVICE, str(BACKEND)], input=json.dumps(plan),
                          capture_output=True, text=True, timeout=300,
                          env={"PATH": os.environ.get("PATH", ""), **ENVIRONMENT})
    lines = [line for line in done.stdout.splitlines() if line.startswith("RESULTS ")]
    assert done.returncode == 0 and lines, done.stderr[-3000:]
    report = json.loads(lines[-1][len("RESULTS "):])
    report["stdout"] = done.stdout
    return report


def step(name, method, path, **more):
    return {"name": name, "method": method, "path": path, **more}


def key():
    return {"X-Idempotency-Key": str(uuid.uuid4())}


JSON_BODY = {"Content-Type": "application/json"}

# ---------------------------------------------------------------------------
# Every route that takes a body: a request it accepts, and where its fields are.
# ---------------------------------------------------------------------------

DEAL = {
    "strategy": "rental",
    "property": {"property_type": "multifamily", "unit_count": 4, "market": "Atlanta, GA"},
    "acquisition": {"purchase_price": 1_000_000, "closing_costs": 20_000, "hold_months": 60},
    "debt": [{"loan_to_value": 0.70, "annual_interest_rate": 0.06, "amortization_years": 30, "term_months": 120}],
    "operating": {"gross_scheduled_rent": 120_000, "other_income": 5_000, "vacancy_rate": 0.05,
                  "operating_expenses": 40_000, "replacement_reserves": 5_000,
                  "annual_income_growth_rate": 0.03, "annual_expense_growth_rate": 0.03},
    "exit": {"exit_cap_rate": 0.06},
}
DEBT = DEAL["debt"][0]
MORTGAGE = {"purchase_price": 500000, "down_payment": 100000, "annual_interest_rate": 6, "term_years": 30}

# valid: a request the route accepts, and `ok` its status.
# text: a string field (where an over-long string and, on routes with no
#       number, a number are put). number: a numeric field, if there is one.
# nested: every object inside the body, each of which must refuse an unknown field.
# lists: a list field and one more item than it may hold.
BODY_ROUTES = {
    "/api/v1/inquiries": dict(
        valid={"kind": "buyer", "full_name": "Test Visitor", "email": "visitor@example.com",
               "message": "Please contact me", "consent": True},
        ok=201, headers=key, text=("message",), number=None, nested=[], lists=[]),
    "/api/v1/deals/analyze": dict(
        valid=DEAL, ok=200, text=("property", "market"), number=("acquisition", "purchase_price"),
        nested=[("property",), ("acquisition",), ("debt", 0), ("operating",), ("exit",)],
        lists=[(("debt",), [DEBT] * 21)]),
    "/api/v1/deals/scenarios": dict(
        valid={"deal": DEAL, "scenarios": [{"name": "Rents fall", "rent_change": -0.1}]},
        ok=200, text=("scenarios", 0, "name"), number=("scenarios", 0, "rent_change"),
        nested=[("deal",), ("deal", "property"), ("scenarios", 0)],
        lists=[(("scenarios",), [{"name": "Rents fall", "rent_change": -0.1}] * 21)]),
    "/api/v1/deals/sensitivity": dict(
        valid={"deal": DEAL, "metric": "irr", "x_axis": {"field": "rent", "changes": [-0.1, 0, 0.1]}},
        ok=200, text=("deal", "property", "market"), number=("x_axis", "changes", 0),
        nested=[("deal",), ("x_axis",)], lists=[(("x_axis", "changes"), [0.01] * 12)]),
    "/api/v1/deals/monte-carlo": dict(
        valid={"deal": DEAL, "scenarios": [{"name": "Base", "iterations": 250, "drivers": {
            "rent_change": {"minimum": -0.1, "mode": 0, "maximum": 0.1}}}]},
        ok=200, text=("scenarios", 0, "name"), number=("scenarios", 0, "drivers", "rent_change", "maximum"),
        nested=[("deal",), ("scenarios", 0), ("scenarios", 0, "drivers", "rent_change")],
        lists=[(("scenarios",), [{"name": "Base", "iterations": 250, "drivers": {
            "rent_change": {"minimum": -0.1, "mode": 0, "maximum": 0.1}}}] * 7)]),
    "/api/assistant/chat": dict(
        valid={"message": "What is a cap rate?", "jurisdiction": {"country": "US", "state": None},
               "history": [{"role": "user", "content": "Hello"}]},
        ok=200, text=("message",), number=None, nested=[("jurisdiction",), ("history", 0)],
        lists=[(("history",), [{"role": "user", "content": "Hello"}] * 13)]),
    "/api/assistant/analyze": dict(
        valid={"model": "mortgage", "inputs": MORTGAGE, "jurisdiction": {"country": "US", "state": "GA"}},
        ok=200, text=("jurisdiction", "locality"), number=("inputs", "purchase_price"),
        nested=[("jurisdiction",)], lists=[]),
    "/api/status": dict(
        valid={"client_name": "resilience"}, ok=200, headers=lambda: STAFF,
        text=("client_name",), number=None, nested=[], lists=[]),
    "/api/v1/podcast/staff/episodes": dict(
        valid={"title": "Atlanta in October", "description": "A synthetic episode.",
               "content_type": "audio/mpeg", "size_bytes": 5},
        ok=201, headers=lambda: STAFF, text=("title",), number=("size_bytes",), nested=[], lists=[]),
}
# POST routes that take no body: only the whole-request limits apply.
NO_BODY_POSTS = {
    "/api/v1/podcast/staff/episodes/{episode_id}/publish": "/api/v1/podcast/staff/episodes/" + "a" * 32 + "/publish",
    "/api/v1/podcast/staff/episodes/{episode_id}/unpublish": "/api/v1/podcast/staff/episodes/" + "a" * 32 + "/unpublish",
}

ACKNOWLEDGE = f"/api/v1/inquiries/staff/{uuid.uuid4()}/acknowledge"
SUGGEST = f"/api/v1/properties/suggest?q=1+Example&session_token={uuid.uuid4()}"
# Every other route: the request the site, the staff app or the monitor sends,
# and its answer here.
READ_ROUTES = {
    ("GET", "/health"): ("/health", None, 200),
    ("GET", "/healthz"): ("/healthz", None, 200),
    ("GET", "/api/"): ("/api/", None, 200),
    ("GET", "/api/assistant/health"): ("/api/assistant/health", None, 200),
    ("GET", "/api/v1/deals/assumption-profiles"): ("/api/v1/deals/assumption-profiles", None, 200),
    ("GET", "/api/v1/market-brief"): ("/api/v1/market-brief", None, 200),
    ("GET", "/api/v1/market-brief/audio/{key}.mp3"): ("/api/v1/market-brief/audio/2026-10-09.mp3", None, 404),
    ("GET", "/api/v1/podcast/episodes"): ("/api/v1/podcast/episodes", None, 200),
    ("GET", "/api/v1/podcast/staff/episodes"): ("/api/v1/podcast/staff/episodes", STAFF, 200),
    ("GET", "/api/v1/properties/suggest"): (SUGGEST, None, 200),
    ("GET", "/api/v1/properties/lookup"): ("/api/v1/properties/lookup?address=1+Example+St+Atlanta+GA", None, 200),
    ("GET", "/api/v1/inquiries/staff"): ("/api/v1/inquiries/staff?limit=50", STAFF, 200),
    ("GET", "/api/status"): ("/api/status", STAFF, 200),
    ("PATCH", "/api/v1/inquiries/staff/{request_id}/acknowledge"): (ACKNOWLEDGE, STAFF, 200),
}
# The query parameters each route declares. Everything else is refused.
QUERY = {
    "/api/v1/properties/suggest": ["q", "session_token"],
    "/api/v1/properties/lookup": ["address"],
    "/api/v1/inquiries/staff": ["limit"],
}


def put(body, where, value):
    """A copy of `body` with `value` at the path `where`."""
    changed = copy.deepcopy(body)
    target = changed
    for part in where[:-1]:
        target = target[part]
    target[where[-1]] = value
    return changed


def raw(body, where, token):
    """`body` as JSON text with the bare word `token` (NaN, 1e400) at `where`."""
    return json.dumps(put(body, where, "@@TOKEN@@")).replace('"@@TOKEN@@"', token)


def headers_for(route, **more):
    return {**BODY_ROUTES[route].get("headers", dict)(), **more}


BAD_NUMBERS = {
    "NaN": "NaN", "Infinity": "Infinity", "-Infinity": "-Infinity",
    "1e400 (reads as infinity)": "1e400", "400 digits": "9" * 400, "1e300": "1e300", "-1e300": "-1e300",
}
NOT_JSON_TYPES = {
    "text/plain": "text/plain", "form": "application/x-www-form-urlencoded",
    "multipart": "multipart/form-data; boundary=x", "xml": "application/xml", "none": None,
}
MALFORMED = {
    "not json": "{not json", "cut off": "{\"message\": \"abc", "a list": "[1, 2, 3]", "a string": "\"hello\"",
    "null": "null", "nested 5000 deep": "[" * 5000 + "]" * 5000,
    "a name repeated": "{\"a\": 1, \"a\": 2}",
}


def refusal_cases():
    """name -> (request, expected status or statuses). Every one must be refused."""
    cases = {}
    for route, spec in BODY_ROUTES.items():
        valid, where = spec["valid"], spec["text"]
        number = spec["number"] or where

        def post(label, expected, headers=None, **body):
            cases[f"{route} | {label}"] = (
                step(f"{route} | {label}", "POST", route,
                     headers=headers if headers is not None else headers_for(route, **({} if "json" in body else JSON_BODY)),
                     **body), expected)

        post("unknown field", 422, json={**valid, MARKER: MARKER})
        for inside in spec["nested"]:
            post(f"unknown field in {inside}", 422, json=put(valid, inside + (MARKER,), 1))
        post("over-long string", 422, json=put(valid, where, MARKER + "x" * 7000))
        post("wrong type for text", 422, json=put(valid, where, {MARKER: [MARKER]}))
        for label, token in BAD_NUMBERS.items():
            post(f"number {label}", 422, body=raw(valid, number, token))
        for target, items in spec["lists"]:
            post(f"list too long {target}", 422, json=put(valid, target, items))
        post("body over the limit", 413, pad=400_000)
        post("body over the limit, no length sent", 413, pieces=400_000)
        for label, content_type in NOT_JSON_TYPES.items():
            headers = headers_for(route, **({"Content-Type": content_type} if content_type else {}))
            post(f"content type {label}", 415, headers=headers, body=json.dumps(valid))
        for label, text in MALFORMED.items():
            post(f"malformed: {label}", (400, 422), body=text)
        post("unknown query parameter", 422, json=valid, headers=headers_for(route), )
        cases[f"{route} | unknown query parameter"][0]["path"] = f"{route}?{MARKER}={MARKER}"
        post("address too long", 414, json=valid)
        cases[f"{route} | address too long"][0]["path"] = f"{route}?padding=" + "x" * 5000

    for template, path in NO_BODY_POSTS.items():
        cases[f"{template} | body over the limit"] = (
            step(f"{template} | body over the limit", "POST", path, headers={**STAFF, **JSON_BODY}, pad=400_000), 413)
        cases[f"{template} | content type text/plain"] = (
            step(f"{template} | content type text/plain", "POST", path,
                 headers={**STAFF, "Content-Type": "text/plain"}, body=MARKER), 415)
        cases[f"{template} | unknown query parameter"] = (
            step(f"{template} | unknown query parameter", "POST", f"{path}?{MARKER}=1", headers=STAFF), 422)
        cases[f"{template} | no such episode"] = (
            step(f"{template} | no such episode", "POST", path.replace("a" * 32, MARKER), headers=STAFF), 404)

    for (method, template), (path, headers, _) in READ_ROUTES.items():
        joiner = "&" if "?" in path else "?"
        if template not in request_guard.LIVENESS_PATHS:  # see test_the_liveness_routes_answer_whatever_is_added
            cases[f"{method} {template} | unknown query parameter"] = (
                step(f"{method} {template} | unknown query parameter", method, f"{path}{joiner}{MARKER}={MARKER}",
                     headers=headers), 422)
        cases[f"{method} {template} | address too long"] = (
            step(f"{method} {template} | address too long", method, f"{path}{joiner}padding=" + "x" * 5000,
                 headers=headers), 414)
        cases[f"{method} {template} | body over the limit"] = (
            step(f"{method} {template} | body over the limit", method, path,
                 headers={**(headers or {}), **JSON_BODY}, pad=400_000), 413)

    def get(label, path, expected, headers=None):
        cases[label] = (step(label, "GET", path, headers=headers), expected)

    token = str(uuid.uuid4())
    get("suggest: q too long", f"/api/v1/properties/suggest?q={MARKER}{'x' * 257}&session_token={token}", 422)
    get("suggest: q empty", f"/api/v1/properties/suggest?q=&session_token={token}", 422)
    get("suggest: q missing", f"/api/v1/properties/suggest?session_token={token}", 422)
    get("suggest: token not a UUID", f"/api/v1/properties/suggest?q=1+Example&session_token={MARKER}", 422)
    get("suggest: token too long", f"/api/v1/properties/suggest?q=1+Example&session_token={'a' * 3000}", 422)
    get("lookup: address too long", f"/api/v1/properties/lookup?address={MARKER}{'x' * 241}", 422)
    get("lookup: address too short", "/api/v1/properties/lookup?address=1+Ma", 422)
    get("lookup: address missing", "/api/v1/properties/lookup", 422)
    for label, value in {"too large": "101", "zero": "0", "negative": "-5", "not a number": MARKER, "NaN": "NaN",
                         "infinity": "Infinity", "a fraction": "1.5", "400 digits": "9" * 400}.items():
        get(f"staff list: limit {label}", f"/api/v1/inquiries/staff?limit={value}", 422, STAFF)
    cases["acknowledge: id not a UUID"] = (
        step("acknowledge: id not a UUID", "PATCH", f"/api/v1/inquiries/staff/{MARKER}/acknowledge", headers=STAFF), 422)
    get("audio: a key that is not one", f"/api/v1/market-brief/audio/{MARKER}.mp3", 404)
    get("audio: a path outside", "/api/v1/market-brief/audio/..%2F..%2Fetc.mp3", 404)

    inquiry = BODY_ROUTES["/api/v1/inquiries"]["valid"]
    for label, value in {"not a UUID": MARKER, "8000 characters": "k" * 8000, "a path": "../../etc/passwd",
                         "markup": "<script>" + MARKER + "</script>", "empty": ""}.items():
        cases[f"submission key {label}"] = (
            step(f"submission key {label}", "POST", "/api/v1/inquiries", json=inquiry,
                 headers={"X-Idempotency-Key": value}), 422)
    cases["submission key missing"] = (step("submission key missing", "POST", "/api/v1/inquiries", json=inquiry), 422)
    for label, value in {"no header": None, "not bearer": "Basic " + MARKER, "20000 characters": "Bearer " + "a" * 20000,
                         "markup": "Bearer <" + MARKER + ">", "two words": "Bearer a " + MARKER,
                         "wrong token": "Bearer " + MARKER}.items():
        cases[f"staff sign-in {label}"] = (
            step(f"staff sign-in {label}", "GET", "/api/v1/inquiries/staff",
                 headers={"Authorization": value} if value else None), 401)

    def inquiry_case(label, **changes):
        cases[f"inquiry {label}"] = (
            step(f"inquiry {label}", "POST", "/api/v1/inquiries", json={**inquiry, **changes}, headers=key()), 422)

    inquiry_case("email not an address", email=MARKER)
    inquiry_case("email with odd characters", email=f"<{MARKER}>@@example.com")
    inquiry_case("email 300 characters", email=MARKER + "a" * 300 + "@example.com")
    inquiry_case("name too short", full_name="a")
    inquiry_case("name 121 characters", full_name=MARKER + "a" * 110)
    inquiry_case("name with a NUL", full_name=MARKER + "\u0000")
    inquiry_case("name with a line break", full_name=MARKER + "\nsecond line")
    inquiry_case("phone 41 characters", phone="4" * 41)
    inquiry_case("phone with no digit", phone="call me any time")
    inquiry_case("phone with an escape sequence", phone="404-555-0100\u001b[31m")
    inquiry_case("message with an escape sequence", message=MARKER + "\u001b[2J")
    inquiry_case("address 241 characters", property_address=MARKER + "a" * 230)
    inquiry_case("listing id that is a path", property_id="../" + MARKER)
    inquiry_case("kind not one of the three", kind=MARKER)
    inquiry_case("consent false", consent=False)
    inquiry_case("consent as words", consent=MARKER)
    inquiry_case("tour time not a date", kind="tour", property_address="1 Example St", preferred_tour_time=MARKER)
    inquiry_case("tour time in the past", kind="tour", property_address="1 Example St",
                 preferred_tour_time="2020-01-01T10:00:00Z")
    inquiry_case("tour time ten years ahead", kind="tour", property_address="1 Example St",
                 preferred_tour_time=(datetime.now(timezone.utc) + timedelta(days=3650)).isoformat())
    inquiry_case("tour time in the year 9999", kind="tour", property_address="1 Example St",
                 preferred_tour_time="9999-12-31T23:59:59Z")

    def calculator_case(label, model, inputs, expected=422):
        cases[f"calculator {label}"] = (
            step(f"calculator {label}", "POST", "/api/assistant/analyze", json={"model": model, "inputs": inputs}), expected)

    commercial = {"purchase_price": 10_000_000, "equity_invested": 3_500_000, "annual_gross_potential_rent": 1_100_000,
                  "annual_operating_expenses": 390_000, "exit_cap_rate_percent": 6.5}
    calculator_case("a holding period of a thousand trillion years", "commercial", {**commercial, "holding_years": 1e15})
    calculator_case("a term of a million years", "mortgage", {**MORTGAGE, "term_years": 1_000_000})
    calculator_case("a rate of a million percent", "mortgage", {**MORTGAGE, "annual_interest_rate": 1_000_000})
    calculator_case("a rate too small for the formula", "mortgage", {**MORTGAGE, "annual_interest_rate": 1e-30})
    calculator_case("growth that outruns the arithmetic", "commercial",
                    {**commercial, "holding_years": 100, "annual_noi_growth_percent": 1000})
    calculator_case("an input of another calculator", "mortgage", {**MORTGAGE, "monthly_rent": 2000})
    calculator_case("an input nobody reads", "mortgage", {**MORTGAGE, MARKER: 1})
    calculator_case("a number sent as text", "mortgage", {**MORTGAGE, "purchase_price": "500000"})
    calculator_case("true for a number", "mortgage", {**MORTGAGE, "purchase_price": True})
    calculator_case("a list for a number", "mortgage", {**MORTGAGE, "purchase_price": [MARKER]})
    calculator_case("forty inputs", "mortgage", {f"input_{chr(97 + i % 26)}{chr(97 + i // 26)}": 1 for i in range(40)})
    calculator_case("a model that does not exist", MARKER, MORTGAGE)

    def deal_case(label, where, value, route="/api/v1/deals/analyze", body=DEAL):
        cases[f"deal {label}"] = (step(f"deal {label}", "POST", route, json=put(body, where, value)), 422)

    deal_case("price above the ceiling", ("acquisition", "purchase_price"), 1.1e15)
    deal_case("price zero", ("acquisition", "purchase_price"), 0)
    deal_case("costs negative", ("acquisition", "closing_costs"), -1)
    deal_case("costs above the ceiling", ("acquisition", "closing_costs"), 2e15)
    deal_case("hold of 601 months", ("acquisition", "hold_months"), 601)
    deal_case("units above a million", ("property", "unit_count"), 1_000_001)
    deal_case("currency that is not three letters", ("property", "currency"), "U$D")
    deal_case("property type not in the list", ("property", "property_type"), MARKER)
    deal_case("strategy not in the list", ("strategy",), MARKER)
    deal_case("schema version not 1.0", ("schema_version",), MARKER)
    deal_case("loan name 81 characters", ("debt", 0, "name"), MARKER + "x" * 70)
    deal_case("rent above the ceiling", ("operating", "gross_scheduled_rent"), 1e16)
    sensitivity = BODY_ROUTES["/api/v1/deals/sensitivity"]["valid"]
    deal_case("sensitivity change of 600%", ("x_axis", "changes", 0), 6, "/api/v1/deals/sensitivity", sensitivity)
    deal_case("sensitivity field not in the list", ("x_axis", "field"), MARKER, "/api/v1/deals/sensitivity", sensitivity)
    simulation = BODY_ROUTES["/api/v1/deals/monte-carlo"]["valid"]
    deal_case("simulation of 20001 iterations", ("scenarios", 0, "iterations"), 20001, "/api/v1/deals/monte-carlo", simulation)
    deal_case("simulation driver not in the list", ("scenarios", 0, "drivers"),
              {MARKER: {"minimum": 0, "mode": 0, "maximum": 0}}, "/api/v1/deals/monte-carlo", simulation)
    deal_case("simulation range above 1000", ("scenarios", 0, "drivers", "rent_change", "maximum"), 1001,
              "/api/v1/deals/monte-carlo", simulation)
    deal_case("simulation seed above the ceiling", ("scenarios", 0, "seed"), 2 ** 40, "/api/v1/deals/monte-carlo", simulation)
    scenarios = BODY_ROUTES["/api/v1/deals/scenarios"]["valid"]
    # Each figure is in range but the change takes the deal out of it: the
    # engine refuses, and its sentence must not repeat the scenario's name.
    cases["deal scenario that leaves the supported range"] = (
        step("deal scenario that leaves the supported range", "POST", "/api/v1/deals/scenarios",
             json=put(put(scenarios, ("scenarios", 0), {"name": MARKER, "vacancy_rate_delta": 0.9}),
                      ("deal", "operating", "vacancy_rate"), 0.5)), 422)

    chat = BODY_ROUTES["/api/assistant/chat"]["valid"]
    for label, where, value in [
        ("message of one character", ("message",), "a"),
        ("earlier message too long", ("history", 0, "content"), MARKER + "x" * 6000),
        ("earlier message from nobody", ("history", 0, "role"), "system"),
        ("state 57 characters", ("jurisdiction", "state"), MARKER + "x" * 50),
        ("session id with markup", ("session_id",), "<" + MARKER + ">"),
        ("session id 129 characters", ("session_id",), "a" * 129),
    ]:
        cases[f"chat {label}"] = (step(f"chat {label}", "POST", "/api/assistant/chat", json=put(chat, where, value)), 422)

    episode = BODY_ROUTES["/api/v1/podcast/staff/episodes"]["valid"]
    for label, where, value in [
        ("title 121 characters", ("title",), MARKER + "x" * 110), ("title empty", ("title",), ""),
        ("description 601 characters", ("description",), MARKER + "x" * 600),
        ("type not audio", ("content_type",), "text/html"), ("size zero", ("size_bytes",), 0),
        ("size over 300 MB", ("size_bytes",), 300 * 1024 * 1024 + 1), ("size a fraction", ("size_bytes",), 1.5),
        ("title with a NUL", ("title",), "Atlanta\u0000"),
    ]:
        cases[f"episode {label}"] = (
            step(f"episode {label}", "POST", "/api/v1/podcast/staff/episodes", json=put(episode, where, value),
                 headers=STAFF), 422)
    return cases


CASES = refusal_cases()


def accepted_cases():
    """The requests that must go on working: one per route, as it is really sent."""
    requests = [step(f"POST {route}", "POST", route, json=spec["valid"], headers=headers_for(route))
                for route, spec in BODY_ROUTES.items()]
    requests += [step(f"POST {template}", "POST", path, headers=STAFF) for template, path in NO_BODY_POSTS.items()]
    requests += [step(f"{method} {template}", method, path, headers=headers)
                 for (method, template), (path, headers, _) in READ_ROUTES.items()]
    return requests


@pytest.fixture(scope="module")
def answers():
    return service(accepted_cases() + [request for request, _ in CASES.values()])


# ---------------------------------------------------------------------------
# The route list, so nothing is added without being covered here.
# ---------------------------------------------------------------------------

def test_every_route_of_the_service_is_in_these_tables(answers):
    served = {(route["method"], route["path"]) for route in answers["routes"]}
    listed = ({("POST", route) for route in BODY_ROUTES} | {("POST", route) for route in NO_BODY_POSTS}
              | set(READ_ROUTES))
    assert served == listed, "a route was added or removed: put it in BODY_ROUTES, NO_BODY_POSTS or READ_ROUTES"
    with_body = {route["path"] for route in answers["routes"] if route["body"]}
    assert with_body == set(BODY_ROUTES), "the routes that take a body are not the ones tested as such"


def test_the_query_parameters_each_route_reads_are_exactly_the_ones_it_allows(answers):
    for route in answers["routes"]:
        assert route["query"] == route["allowed"], route
        assert route["query"] == sorted(QUERY.get(route["path"], [])), route


def test_the_limits_sit_inside_cors_and_the_telemetry_stays_outermost(answers):
    # Starlette lists the outermost layer first.
    assert answers["layers"][0] == "RequestTelemetry"
    assert answers["layers"][-1] == "RequestLimits"
    assert answers["layers"].index("CORSMiddleware") < answers["layers"].index("RequestLimits")


# ---------------------------------------------------------------------------
# What is really sent is still accepted.
# ---------------------------------------------------------------------------

def expected_statuses():
    wanted = {f"POST {route}": spec["ok"] for route, spec in BODY_ROUTES.items()}
    wanted.update({f"POST {template}": 200 for template in NO_BODY_POSTS})
    wanted.update({f"{method} {template}": status for (method, template), (_, _, status) in READ_ROUTES.items()})
    return wanted


@pytest.mark.parametrize("name", sorted(expected_statuses()))
def test_an_ordinary_request_to_each_route_is_answered_as_before(answers, name):
    answer = answers["answers"][name]
    assert answer["status"] == expected_statuses()[name], answer["text"][:500]


# ---------------------------------------------------------------------------
# Every refusal: the right status, the one shape, nothing repeated or leaked.
# ---------------------------------------------------------------------------

PATH_OR_TRACE = re.compile(r"Traceback|site-packages|\.py\b|/home/|/usr/|/tmp/|File \"|line \d+, in ")
EXCEPTION_CLASS = re.compile(r"\b[A-Z][A-Za-z]*(?:Error|Exception)\b")
LIBRARIES = ("pydantic", "starlette", "fastapi", "uvicorn", "firestore", "googleapis", "rentcast", "mapbox")


def assert_clean_refusal(answer, name=""):
    text = answer["text"]
    assert answer["headers"]["content-type"] == "application/json", name
    assert MARKER not in text, f"{name}: the answer repeats what was sent"
    assert not PATH_OR_TRACE.search(text), f"{name}: the answer shows a path or a stack trace: {text[:300]}"
    assert not EXCEPTION_CLASS.search(text), f"{name}: the answer names an exception class: {text[:300]}"
    for library in LIBRARIES:
        assert library not in text.lower(), f"{name}: the answer names {library}"
    assert answer["bytes"] < 6000, f"{name}: {answer['bytes']} bytes"
    body = json.loads(text)
    assert set(body) == {"detail"}, name
    detail = body["detail"]
    if isinstance(detail, str):
        assert 0 < len(detail) <= 300, name
    else:
        assert isinstance(detail, list) and 0 < len(detail) <= request_guard.MAX_ERRORS, name
        for item in detail:
            assert set(item) == {"type", "loc", "msg"}, f"{name}: {item}"
            assert isinstance(item["msg"], str) and 0 < len(item["msg"]) <= request_guard.MAX_REASON_CHARS
            assert isinstance(item["loc"], list) and all(isinstance(part, (str, int)) for part in item["loc"])


@pytest.mark.parametrize("name", sorted(CASES))
def test_a_bad_request_is_refused_with_the_right_status_and_a_clean_answer(answers, name):
    answer = answers["answers"][name]
    expected = CASES[name][1]
    assert answer["status"] in (expected if isinstance(expected, tuple) else (expected,)), (
        f"{name}: {answer['status']} {answer['text'][:400]}")
    assert_clean_refusal(answer, name)
    assert answer["seconds"] < 5, f"{name}: took {answer['seconds']} s"


def test_the_tables_cover_every_kind_of_bad_input_on_every_route_that_takes_a_body():
    for route in BODY_ROUTES:
        for kind in ("unknown field", "over-long string", "number NaN", "number Infinity", "number -Infinity",
                     "number 1e300", "number 400 digits", "body over the limit", "body over the limit, no length sent",
                     "content type text/plain", "content type none", "malformed: not json", "unknown query parameter"):
            assert f"{route} | {kind}" in CASES, (route, kind)


def test_a_field_problem_names_the_field_and_gives_a_short_reason(answers):
    def problems(name):
        return json.loads(answers["answers"][name]["text"])["detail"]

    assert problems("inquiry name too short") == [
        {"type": "string_too_short", "loc": ["body", "full_name"], "msg": "String should have at least 2 characters"}]
    assert problems("inquiry email not an address") == [
        {"type": "value_error", "loc": ["body", "email"], "msg": "value is not a valid email address"}]
    assert problems("deal hold of 601 months") == [
        {"type": "less_than_equal", "loc": ["body", "acquisition", "hold_months"],
         "msg": "Input should be less than or equal to 600"}]
    assert problems("suggest: q too long")[0]["loc"] == ["query", "q"]
    assert problems("submission key not a UUID") == [
        {"type": "uuid_parsing", "loc": ["header", "x-idempotency-key"], "msg": "Input should be a valid UUID"}]
    # The page reads these two: Deal Studio calculates on the device when the
    # service says it does not know a field (InvestmentCalculator.jsx,
    # serviceRejectsUnknownFields), and the inquiry form looks for its own
    # field names in `loc` (InquiryForm.jsx, refusedFields).
    unknown = problems("/api/v1/deals/analyze | unknown field")
    assert unknown == [{"type": "extra_forbidden", "loc": ["body", request_guard.UNKNOWN_NAME],
                        "msg": "Extra inputs are not permitted"}]
    assert problems("/api/v1/inquiries | over-long string")[0]["loc"] == ["body", "message"]
    # A name the API knows is kept all the way down; one it does not is not.
    assert problems("deal simulation range above 1000")[0]["loc"] == [
        "body", "scenarios", 0, "drivers", "rent_change", "maximum"]
    assert all(MARKER not in json.dumps(item) for item in problems("deal simulation driver not in the list"))


def test_a_body_of_a_thousand_unknown_fields_gets_a_short_answer():
    body = {f"field_{index}": index for index in range(1000)}
    answer = service([step("many", "POST", "/api/v1/deals/analyze", json=body)])["answers"]["many"]
    assert answer["status"] == 422
    assert len(json.loads(answer["text"])["detail"]) == request_guard.MAX_ERRORS
    assert answer["bytes"] < 4000


def test_nothing_refused_was_stored(answers):
    # Only the one ordinary inquiry of accepted_cases() reached the queue.
    assert answers["stored"] == 1


def test_refusals_made_before_parsing_still_pass_out_through_cors_and_carry_the_usual_headers():
    origin = {"Origin": PUBLIC_ORIGIN}
    made = service([
        step("too large", "POST", "/api/v1/deals/analyze", headers={**JSON_BODY, **origin}, pad=400_000),
        step("not json", "POST", "/api/v1/deals/analyze", headers={"Content-Type": "text/plain", **origin}, body="{}"),
        step("too long", "GET", "/api/v1/deals/assumption-profiles?x=" + "x" * 5000, headers=origin),
        step("bad field", "POST", "/api/v1/deals/analyze", headers=origin, json={MARKER: 1}),
        step("inquiry too large", "POST", "/api/v1/inquiries", headers={**JSON_BODY, **origin, **key()}, pad=400_000),
        step("other site", "POST", "/api/v1/deals/analyze", headers={"Origin": "https://elsewhere.example"}, json={}),
    ])["answers"]
    assert [made[name]["status"] for name in ("too large", "not json", "too long", "bad field", "inquiry too large")] == [
        413, 415, 414, 422, 413]
    for name in ("too large", "not json", "too long", "bad field", "inquiry too large"):
        headers = made[name]["headers"]
        assert headers["access-control-allow-origin"] == PUBLIC_ORIGIN, name
        assert headers["x-content-type-options"] == "nosniff", name
        assert headers["cache-control"] == "no-store", name
        assert "server-timing" in headers, name
    assert "access-control-allow-origin" not in made["other site"]["headers"]


def test_the_size_limit_is_per_route_and_exact():
    default, chat = request_guard.DEFAULT_BODY_BYTES, request_guard.BODY_BYTES["/api/assistant/chat"]
    overhead = len(b'{"message": ""}')
    made = service([
        step("deal at the limit", "POST", "/api/v1/deals/analyze", headers=JSON_BODY, pad=default - overhead),
        step("deal one over", "POST", "/api/v1/deals/analyze", headers=JSON_BODY, pad=default - overhead + 1),
        step("deal one over, in pieces", "POST", "/api/v1/deals/analyze", headers=JSON_BODY, pieces=default - overhead + 1),
        step("chat above the default", "POST", "/api/assistant/chat", headers=JSON_BODY, pad=default * 2),
        step("chat one over", "POST", "/api/assistant/chat", headers=JSON_BODY, pad=chat - overhead + 1),
        step("length not a number", "POST", "/api/v1/deals/analyze", headers={**JSON_BODY, "Content-Length": "abc"}, body="{}"),
    ])["answers"]
    assert made["deal at the limit"]["status"] == 422   # read and refused field by field
    assert made["deal one over"]["status"] == 413
    assert made["deal one over, in pieces"]["status"] == 413
    assert made["chat above the default"]["status"] == 422  # a message over 6,000 characters, not a body too large
    assert made["chat one over"]["status"] == 413
    assert made["length not a number"]["status"] == 400
    for answer in made.values():
        assert_clean_refusal(answer)


def test_the_longest_conversation_the_models_allow_fits_inside_the_chat_size_limit():
    # 6,000 characters of a four-byte script in the question and in each of 12
    # earlier messages: the largest body the field limits allow.
    letter = "\U00010348"
    body = {"message": letter * 6000, "jurisdiction": {"country": "US", "state": None},
            "history": [{"role": "user", "content": letter * 6000}] * 12}
    assert len(json.dumps(body, ensure_ascii=False).encode()) < request_guard.BODY_BYTES["/api/assistant/chat"]
    answer = service([step("longest", "POST", "/api/assistant/chat", headers=JSON_BODY,
                           body=json.dumps(body, ensure_ascii=False))])["answers"]["longest"]
    assert answer["status"] == 200, answer["text"][:300]


def test_an_error_nothing_handled_is_a_plain_500_and_the_telemetry_still_records_it():
    report = service([step("crash", "POST", "/api/assistant/chat", json={"message": MARKER + " please"}),
                      step("health", "GET", "/health")], faults=["assistant_crashes"])
    answer = report["answers"]["crash"]
    assert answer["status"] == 500
    assert json.loads(answer["text"]) == {"detail": request_guard.SERVER_ERROR}
    assert INTERNAL not in answer["text"]
    assert_clean_refusal(answer)
    assert report["answers"]["health"]["status"] == 200
    lines = [json.loads(line) for line in report["stdout"].splitlines() if line.startswith("{")]
    errors = [line for line in lines if line.get("event") == "request.error"]
    assert len(errors) == 1 and errors[0]["status"] == 500 and errors[0]["error"] == "RuntimeError"
    assert errors[0]["route"].endswith("/assistant/chat")
    # The log line names the error's type and the route template, never what was sent.
    assert MARKER not in report["stdout"] and INTERNAL not in report["stdout"]


def test_a_sensitivity_cell_that_cannot_be_calculated_says_so_in_plain_words():
    # Found by sending in-range extremes: the same field on both axes, whose
    # changes add up past what a shock allows. The cell's warning was the
    # validation library's own text, version and all, in a 200 answer.
    flip = {"strategy": "flip", "property": {"property_type": "single_family"},
            "acquisition": {"purchase_price": 200_000, "hold_months": 6},
            "flip": {"after_repair_value": 320_000, "rehab_cost": 40_000}}
    body = {"deal": flip, "metric": "flip_profit", "x_axis": {"field": "after_repair_value", "changes": [5]},
            "y_axis": {"field": "after_repair_value", "changes": [5, 0]}}
    answer = service([step("cells", "POST", "/api/v1/deals/sensitivity", json=body)])["answers"]["cells"]
    assert answer["status"] == 200, answer["text"][:300]
    cells = json.loads(answer["text"])["cells"]
    assert cells[0]["value"] is None
    assert cells[0]["warning"] == "these changes together are outside the supported range"
    assert cells[1]["value"] is not None
    assert "pydantic" not in answer["text"] and "input_value" not in answer["text"]


def test_the_liveness_routes_answer_whatever_is_added_to_their_address():
    # They read nothing, and a probe that adds a query string must not be
    # told the service is down. The address length limit still applies.
    made = service([step("health", "GET", f"/health?{MARKER}=1&probe=uptime"),
                    step("healthz", "GET", f"/healthz?{MARKER}=1"),
                    step("too long", "GET", "/health?x=" + "x" * 5000)])["answers"]
    assert made["health"]["status"] == 200 and json.loads(made["health"]["text"]) == {"status": "ok"}
    assert made["healthz"]["status"] == 200
    assert made["too long"]["status"] == 414


def test_the_limits_on_heavy_routes_still_count_refused_requests():
    # As tests/test_route_limits.py, but through the whole service with the
    # new checks in front: a body refused field by field is still counted.
    requests = [step(f"attempt {index}", "POST", "/api/v1/deals/monte-carlo", json={}) for index in range(11)]
    made = service(requests, reset_limits=False)["answers"]
    assert [made[f"attempt {index}"]["status"] for index in range(10)] == [422] * 10
    assert made["attempt 10"]["status"] == 429
    assert int(made["attempt 10"]["headers"]["retry-after"]) > 0


# ---------------------------------------------------------------------------
# The requests the site and the staff app really send.
# ---------------------------------------------------------------------------

def javascript_time(moment):
    """A time as `Date.prototype.toISOString` writes it."""
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def test_the_inquiry_form_requests_are_accepted():
    # frontend/src/components/InquiryForm.jsx, submit(): these names, and the
    # optional ones only when filled in.
    visitor = {"full_name": "Zoë O'Brien-Núñez", "email": "visitor@example.com", "consent": True}
    soon = javascript_time(datetime.now(timezone.utc) + timedelta(days=7))
    forms = {
        "buyer": {"kind": "buyer", **visitor, "phone": "+1 (404) 555-0100 ext. 12",
                  "message": "Looking in Decatur.\nTwo bedrooms, near the train.\tBudget to discuss."},
        "buyer, no phone": {"kind": "buyer", **visitor, "message": "Please call me."},
        "seller": {"kind": "seller", **visitor, "message": "Thinking of selling this spring.",
                   "property_address": "1 Example St, Apt #4, Atlanta, GA 30303"},
        "tour": {"kind": "tour", **visitor, "property_address": "1 Example St, Atlanta, GA 30303",
                 "preferred_tour_time": soon},
        "tour with a note": {"kind": "tour", **visitor, "phone": "404.555.0100 (after 5pm)", "message": "Weekends are best.",
                             "property_address": "1 Example St, Atlanta, GA 30303", "preferred_tour_time": soon},
    }
    made = service([step(name, "POST", "/api/v1/inquiries", json=body, headers={**key(), "Origin": PUBLIC_ORIGIN})
                    for name, body in forms.items()])
    for name in forms:
        answer = made["answers"][name]
        assert answer["status"] == 201, (name, answer["text"])
        assert json.loads(answer["text"])["status"] == "queued"
    assert made["stored"] == len(forms)


def test_the_assistant_chat_request_is_accepted():
    # frontend/src/components/assistant/RealEstateAssistant.jsx, sendMessage():
    # the question, the state box (null when empty) and the last 8 messages.
    history = [{"role": "user" if index % 2 == 0 else "assistant", "content": f"Earlier message {index}. " * 20}
               for index in range(8)]
    bodies = {
        "first question": {"message": "What is a cap rate?", "jurisdiction": {"country": "US", "state": None}, "history": []},
        "with a state": {"message": "What are closing costs like?", "jurisdiction": {"country": "US", "state": "GA"},
                         "history": history},
        "state written out": {"message": "And transfer tax?", "jurisdiction": {"country": "US", "state": "Georgia"},
                              "history": history[-2:]},
    }
    made = service([step(name, "POST", "/api/assistant/chat", json=body, headers={"Origin": PUBLIC_ORIGIN})
                    for name, body in bodies.items()])["answers"]
    for name in bodies:
        assert made[name]["status"] == 200, (name, made[name]["text"][:300])
        assert json.loads(made[name]["text"])["answer"].strip()


def test_the_staff_app_requests_are_accepted():
    # staff-queue/app.js: request() sends Authorization always, and
    # Content-Type only with a body; publish and acknowledge have none.
    staff = {**STAFF, "Origin": STAFF_ORIGIN}
    episodes = "/api/v1/podcast/staff/episodes"
    made = service([
        step("list", "GET", "/api/v1/inquiries/staff?limit=50", headers=staff),
        step("acknowledge", "PATCH", ACKNOWLEDGE, headers=staff),
        step("episodes", "GET", episodes, headers=staff),
        step("upload", "POST", episodes, headers={**staff, **JSON_BODY},
             json={"title": "Atlanta in October", "description": "", "content_type": "audio/mp4", "size_bytes": 31_457_280}),
        step("publish", "POST", f"{episodes}/{'a' * 32}/publish", headers=staff),
        step("unpublish", "POST", f"{episodes}/{'a' * 32}/unpublish", headers=staff),
    ])["answers"]
    assert {name: answer["status"] for name, answer in made.items()} == {
        "list": 200, "acknowledge": 200, "episodes": 200, "upload": 201, "publish": 200, "unpublish": 200}
    for answer in made.values():
        assert answer["headers"]["cache-control"] == "no-store"


# The page's own code builds the deal requests: frontend/src/lib/dealRequest.js
# from the form the page starts with (initialForm in InvestmentCalculator.jsx)
# and the land and flip examples it swaps in. Run in Node so a field the page
# starts sending is tried against the service here.
DEAL_REQUESTS = """
import { readFileSync } from "node:fs";
const repo = process.argv[1];
const source = readFileSync(`${repo}/frontend/src/lib/dealRequest.js`, "utf8");
const { buildDealRequest } = await import("data:text/javascript," + encodeURIComponent(source));
const page = readFileSync(`${repo}/frontend/src/pages/InvestmentCalculator.jsx`, "utf8");
const literal = (name) => {
  const found = page.match(new RegExp("(?:export )?const " + name + " = (?:Object\\\\.freeze\\\\()?(\\\\{[\\\\s\\\\S]*?\\\\n\\\\})\\\\)?;"));
  if (!found) throw new Error("no " + name + " in InvestmentCalculator.jsx");
  return new Function("return " + found[1])();
};
const form = literal("initialForm");
const land = { ...form, ...literal("LAND_EXAMPLE_SHARED"), strategy: "land" };
const flip = { ...form, ...literal("FLIP_EXAMPLE_SHARED"), strategy: "flip", propertyType: "single_family" };
process.stdout.write(JSON.stringify({
  "rental, as the page opens": buildDealRequest(form),
  "rental, sale price entered": buildDealRequest({ ...form, explicitSalePrice: "3900000" }),
  "rental, no loan": buildDealRequest({ ...form, ltv: "0" }),
  "flip example": buildDealRequest(flip),
  "flip, loan on after-repair value with rehab financed": buildDealRequest({ ...flip, rehabFinanced: "100", loanBasis: "after_repair_value" }),
  "land example": buildDealRequest(land),
  "land, pro rata, early sale and a kept piece": buildDealRequest({ ...land, landDrawOrder: "pro_rata",
    earlySaleProceeds: "150000", earlySaleMonth: "6", retainedValue: "200000", retainedMonthlyIncome: "900" }),
  "land, zoning and flood zone typed": buildDealRequest({ ...land, currentZoning: "R-4", proposedZoning: "MR-2",
    floodZone: "Zone X (unshaded)" }),
}));
"""


def test_the_deal_requests_the_page_builds_are_accepted():
    node = shutil.which("node")
    if not node:
        pytest.skip("Node is not installed; the page's request builder cannot be run")
    built = subprocess.run([node, "--input-type=module", "-e", DEAL_REQUESTS, str(REPO)],
                           check=True, capture_output=True, text=True, timeout=60)
    requests = json.loads(built.stdout)
    assert len(requests) == 8
    made = service([step(name, "POST", "/api/v1/deals/analyze", json=body, headers={"Origin": PUBLIC_ORIGIN})
                    for name, body in requests.items()])["answers"]
    for name, body in requests.items():
        assert made[name]["status"] == 200, (name, made[name]["text"][:500])
        assert json.loads(made[name]["text"])["strategy"] == body["strategy"]


def test_the_deal_requests_of_the_page_tests_are_accepted_without_node():
    # The same shapes, written out (frontend/src/lib/dealRequest.js applied to
    # the forms in dealRequest.test.js), so they are tried where Node is missing.
    loan = {"name": "Senior acquisition loan", "loan_to_value": 0.65, "annual_interest_rate": 0.0675,
            "amortization_years": 30, "interest_only_months": 0, "term_months": 120, "origination_fee_rate": 0.01}
    rental = {
        "strategy": "rental",
        "property": {"property_type": "multifamily", "unit_count": 12, "rentable_square_feet": 18000,
                     "market": "Austin, TX", "currency": "USD"},
        "acquisition": {"purchase_price": 3000000, "closing_costs": 75000, "due_diligence_costs": 25000,
                        "initial_capex": 125000, "hold_months": 60},
        "debt": [loan],
        "exit": {"selling_cost_rate": 0.06, "exit_cap_rate": 0.065},
        "assumptions": {"annual_discount_rate": 0.1},
        "operating": {"gross_scheduled_rent": 360000, "other_income": 18000, "vacancy_rate": 0.05,
                      "operating_expenses": 126000, "management_fee_rate": 0.04, "replacement_reserves": 30000,
                      "annual_below_noi_costs": 10000, "annual_income_growth_rate": 0.03,
                      "annual_expense_growth_rate": 0.03},
    }
    flip = {
        "strategy": "flip",
        "property": {"property_type": "single_family", "unit_count": 1, "rentable_square_feet": 1655,
                     "market": None, "currency": "USD"},
        "acquisition": {"purchase_price": 93000, "closing_costs": 3000, "due_diligence_costs": 2000,
                        "initial_capex": 0, "hold_months": 7},
        "debt": [{**loan, "loan_to_value": 0.7, "annual_interest_rate": 0.11, "interest_only_months": 7,
                  "term_months": 12, "origination_fee_rate": 0.02, "rehab_financed_rate": 1,
                  "loan_basis": "after_repair_value"}],
        "exit": {"selling_cost_rate": 0.07},
        "assumptions": {"annual_discount_rate": 0.1},
        "flip": {"after_repair_value": 250000, "rehab_cost": 85000, "rehab_contingency_rate": 0.15,
                 "monthly_holding_costs": 450, "other_project_costs": 4000},
    }
    made = service([step("rental", "POST", "/api/v1/deals/analyze", json=rental),
                    step("flip", "POST", "/api/v1/deals/analyze", json=flip)])["answers"]
    assert made["rental"]["status"] == 200, made["rental"]["text"][:500]
    assert made["flip"]["status"] == 200, made["flip"]["text"][:500]


def test_the_monitor_reference_calculation_is_accepted():
    # scripts/sre/checks/calculators.mjs, ANALYZE_REQUEST, read from the file
    # itself. tests/test_monitor_probe.py replays the monitor's whole run; this
    # is the one request, where Node is missing.
    source = (REPO / "scripts/sre/checks/calculators.mjs").read_text(encoding="utf-8")
    literal = re.search(r"export const ANALYZE_REQUEST = Object\.freeze\((\{.*?\})\);", source, re.DOTALL).group(1)
    as_json = re.sub(r"(?<=\d)_(?=\d)", "", re.sub(r"([{,]\s*)([a-z_]+):", r'\1"\2":', literal))
    as_json = re.sub(r",(\s*})", r"\1", as_json)  # JavaScript allows a comma after the last entry
    request = json.loads(as_json)
    assert request["strategy"] == "flip" and request["acquisition"]["purchase_price"] == 200000
    answer = service([step("reference", "POST", "/api/v1/deals/analyze", json=request,
                           headers={"Origin": PUBLIC_ORIGIN})])["answers"]["reference"]
    assert answer["status"] == 200, answer["text"][:500]
    assert json.loads(answer["text"])["metrics"]["flip_profit"]["value"] == pytest.approx(44_800)


# ---------------------------------------------------------------------------
# The parts on their own.
# ---------------------------------------------------------------------------

def test_the_reason_never_quotes_what_was_sent():
    known = frozenset({"body", "email", "x-idempotency-key", "header"})
    detail = request_guard.validation_detail([
        {"type": "value_error", "loc": ("body", "email"), "input": "<" + MARKER + ">@example.com",
         "msg": "value is not a valid email address: The email address contains invalid characters before the @-sign: '<', '>'.",
         "ctx": {"reason": "invalid characters"}},
        {"type": "uuid_parsing", "loc": ("header", "x-idempotency-key"), "input": "k",
         "msg": "Input should be a valid UUID, invalid character: expected [0-9a-fA-F-], found `k` at 1",
         "ctx": {"error": "invalid character: found `k` at 1"}},
        {"type": "made_up", "loc": ("body", MARKER, 3, None), "input": MARKER, "msg": f"cannot use {MARKER} here"},
        {"type": "float_type", "loc": ("body", "email"), "input": float("nan"), "msg": "Input should be a valid number"},
    ], known)
    assert detail == [
        {"type": "value_error", "loc": ["body", "email"], "msg": "value is not a valid email address"},
        {"type": "uuid_parsing", "loc": ["header", "x-idempotency-key"], "msg": "Input should be a valid UUID"},
        {"type": "made_up", "loc": ["body", request_guard.UNKNOWN_NAME, 3, request_guard.UNKNOWN_NAME], "msg": "Invalid value."},
        {"type": "float_type", "loc": ["body", "email"], "msg": "Input should be a valid number"},
    ]
    json.dumps(detail, allow_nan=False)


def test_each_calculator_lists_exactly_the_inputs_it_reads():
    from ai import calculators
    source = (BACKEND / "ai" / "calculators.py").read_text(encoding="utf-8")
    for model, function in (("mortgage", "analyze_mortgage"), ("rental", "analyze_rental"),
                            ("fix_flip", "analyze_fix_flip"), ("commercial", "analyze_commercial")):
        body = source.split(f"def {function}(", 1)[1].split("\ndef ", 1)[0]
        assert set(re.findall(r'_d\(inputs, "([a-z_]+)"', body)) == calculators.INPUTS[model], model


def test_the_bearer_token_is_checked_before_the_identity_provider_sees_it(monkeypatch):
    import inquiries.firebase as identity
    from inquiries.service import StaffUnauthorized
    for name, value in ENVIRONMENT.items():
        monkeypatch.setenv(name, value)
    seen = []

    def verifier(token):
        seen.append(token)
        return {"uid": "staff-1", "email_verified": True, "firebase": {"sign_in_second_factor": "totp"}}
    assert identity.verify_staff("Bearer header.payload.signature-_", verifier) == "staff-1"
    for header in (None, "", "Bearer", "Bearer ", "Basic abc", "Bearer a b", "Bearer <script>", "Bearer a\u0000b",
                   "Bearer café", "Bearer " + "a" * 16385):
        with pytest.raises(StaffUnauthorized):
            identity.verify_staff(header, verifier)
    assert seen == ["header.payload.signature-_"]
