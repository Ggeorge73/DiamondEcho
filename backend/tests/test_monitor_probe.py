"""The synthetic monitor cannot submit an inquiry or spend a visitor's allowance.

scripts/sre/synthetic-checks.mjs looks at the live API every five minutes.
The inquiry route counts every well-formed attempt against 5 per 10 minutes
per sender and 30 per hour per instance (inquiries/limits.py), and the heavy
calculation and property routes have limits of their own. A monitor that
touched any of those counters would lock real visitors out.

This test does not trust a list of what the monitor sends. It runs the
monitor's own check modules in Node with a recording fake network, takes
every request they would send to the API in every suite, and replays each one
against this service. Every limiter in the service is a SubmissionLimiter, so
watching that class's check() watches them all. A control request (a counted
inquiry attempt) proves the watch would have seen a counted call.

Node is needed to run the modules. GitHub's ubuntu-latest runners have it.
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
API_ORIGIN = "https://diamondecho-api-180189726732.us-east1.run.app"
PUBLIC_ORIGIN = "https://diamondecho.com"
STAFF_ORIGIN = "https://staff.diamondecho.com"

# Runs every one of the synthetic monitor's own check modules, in every
# suite, against a fake network that answers 404 to everything (a 404 is not
# tried again, and no module skips an API request because of it). Prints the
# requests that went to the API.
RECORD = """
const repo = process.argv[1];
const { TARGETS } = await import(`${repo}/scripts/sre/targets.mjs`);
const sent = [];
const fetch = async (url, init = {}) => {
  sent.push({ url, method: init.method || "GET", headers: init.headers || {}, body: init.body ?? null });
  return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
};
for (const name of ["pages", "api", "calculators", "inquiry", "search", "staff"]) {
  const module = await import(`${repo}/scripts/sre/checks/${name}.mjs`);
  for (const suite of module.suites) {
    await module.run({ fetch, now: () => 0, sleep: async () => {}, targets: TARGETS.production, env: {}, suite });
  }
}
const api = TARGETS.production.apiOrigin;
const seen = new Set();
const out = [];
for (const request of sent.filter((r) => r.url.startsWith(api + "/"))) {
  const key = JSON.stringify([request.method, request.url, request.headers, request.body]);
  if (!seen.has(key)) { seen.add(key); out.push({ ...request, path: request.url.slice(api.length) }); }
}
process.stdout.write(JSON.stringify({ api, requests: out }));
"""

# Replays the requests against this service, configured as production is
# (queue on, the real site and staff addresses), with Firestore replaced by a
# store that records any write. Runs in a fresh interpreter: the
# tests/deal_intelligence package would shadow the runtime package here.
REPLAY = """
import json, os, sys
sys.path.insert(0, sys.argv[1])
requests = json.loads(sys.stdin.read())
import inquiries.limits as limits
counted = []
real_check = limits.SubmissionLimiter.check
def watched(self, address, per_address, per_hour):
    counted.append(per_address)
    return real_check(self, address, per_address, per_hour)
limits.SubmissionLimiter.check = watched

import server
import inquiries.router as routes
writes = []
class Store:
    def create_once(self, key, document):
        writes.append("create")
        return document, False
    def list_newest(self, limit):
        writes.append("list")
        return []
routes.get_store = lambda: Store()

from fastapi.testclient import TestClient
answers = []
with TestClient(server.app, base_url=os.environ["API_ORIGIN"]) as client:
    for r in requests:
        response = client.request(r["method"], r["path"], headers=r["headers"], content=r["body"])
        try:
            body = response.json()
        except ValueError:
            body = None
        answers.append({"method": r["method"], "path": r["path"], "origin": r["headers"].get("Origin"),
                        "status": response.status_code, "headers": {k.lower(): v for k, v in response.headers.items()},
                        "body": body})
    during_probes = (list(counted), list(writes))
    # Control: one counted attempt (an empty JSON object to the inquiry
    # route). Only ever sent to this local test app.
    control = client.post("/api/v1/inquiries", json={}).status_code
print(json.dumps({"answers": answers, "counted": during_probes[0], "writes": during_probes[1],
                  "control_status": control, "control_counted": len(counted) - len(during_probes[0])}))
"""

PRODUCTION_LIKE = {
    "CORS_ORIGINS": f"{PUBLIC_ORIGIN},{STAFF_ORIGIN}",
    "INQUIRY_STAFF_QUEUE_ENABLED": "true",
    "FIREBASE_PROJECT_ID": "demo-diamondecho",
    "INQUIRY_STAFF_UIDS": "staff-1",
    "PUBLIC_ORIGIN": PUBLIC_ORIGIN,
    "STAFF_ORIGIN": STAFF_ORIGIN,
}


@pytest.fixture(scope="module")
def probes():
    node = shutil.which("node")
    if not node:
        pytest.skip("Node is not installed; the monitor's modules cannot be run")
    recorded = subprocess.run([node, "--input-type=module", "-e", RECORD, str(REPO)],
                              check=True, capture_output=True, text=True, timeout=60)
    sent = json.loads(recorded.stdout)
    assert sent["api"] == API_ORIGIN, "targets.mjs moved the API: update API_ORIGIN here"
    env = {key: value for key, value in __import__("os").environ.items()
           if key not in ("K_SERVICE", "API_DOCS_ENABLED", "INQUIRY_LIMIT_PER_ADDRESS", "INQUIRY_LIMIT_PER_HOUR")}
    env.update(PRODUCTION_LIKE, API_ORIGIN=API_ORIGIN)
    replayed = subprocess.run([sys.executable, "-c", REPLAY, str(BACKEND)], input=json.dumps(sent["requests"]),
                              check=True, capture_output=True, text=True, timeout=120, env=env)
    return sent["requests"], json.loads(replayed.stdout.strip().splitlines()[-1])


def test_the_monitor_never_posts_to_the_inquiry_route_or_the_limited_and_paid_routes(probes):
    requests, _ = probes
    assert requests, "the monitor's modules sent nothing to the API: the recording is broken"
    for r in requests:
        assert r["method"] in ("GET", "OPTIONS", "POST"), r
        assert not r["path"].startswith("/api/v1/properties"), r
        for heavy in ("/scenarios", "/sensitivity", "/monte-carlo"):
            assert heavy not in r["path"], r
        assert "Authorization" not in r["headers"] and "X-Idempotency-Key" not in r["headers"], r
        if r["path"].startswith("/api/v1/inquiries"):
            assert r["method"] in ("GET", "OPTIONS") and r["body"] is None, r
    posts = [r["path"] for r in requests if r["method"] == "POST"]
    assert posts == ["/api/v1/deals/analyze"], "the reference calculation is the monitor's only POST"


def test_no_probe_reaches_any_rate_limiter_or_writes_anything(probes):
    _, result = probes
    assert result["counted"] == [], "a monitor request was counted against a visitor limit"
    assert result["writes"] == [], "a monitor request reached the inquiry store"


def test_the_watch_would_have_seen_a_counted_attempt(probes):
    _, result = probes
    assert result["control_counted"] == 1
    assert result["control_status"] == 422


def test_the_service_answers_each_probe_the_way_the_monitor_expects(probes):
    # The check modules judge these answers; a change in the service that
    # would make a healthy production look broken (or the other way round)
    # shows up here first.
    _, result = probes
    answers = {(a["method"], a["path"], a["origin"]): a for a in result["answers"]}
    route = "/api/v1/inquiries"

    preflight = answers[("OPTIONS", route, PUBLIC_ORIGIN)]
    assert preflight["status"] == 200
    assert preflight["headers"]["access-control-allow-origin"] == PUBLIC_ORIGIN
    assert "POST" in preflight["headers"]["access-control-allow-methods"]
    allowed = preflight["headers"]["access-control-allow-headers"].lower()
    assert "content-type" in allowed and "x-idempotency-key" in allowed

    exists = answers[("GET", route, None)]
    assert exists["status"] == 405 and "POST" in exists["headers"]["allow"]

    assert answers[("GET", route + "/staff", None)]["status"] == 401
    staff = answers[("GET", route + "/staff", STAFF_ORIGIN)]
    assert staff["status"] == 401
    assert staff["headers"]["access-control-allow-origin"] == STAFF_ORIGIN
    assert "no-store" in staff["headers"]["cache-control"]

    analysis = answers[("POST", "/api/v1/deals/analyze", PUBLIC_ORIGIN)]
    assert analysis["status"] == 200
    assert analysis["body"]["metrics"]["flip_profit"]["value"] == pytest.approx(44_800)
    assert analysis["body"]["formula_version"].startswith("diamond-underwriting-")

    assert answers[("GET", "/health", None)]["body"] == {"status": "ok"}
    identity = answers[("GET", "/api/", PUBLIC_ORIGIN)]
    assert identity["body"]["service"] == "DiamondEcho API"
    assert identity["headers"]["access-control-allow-origin"] == PUBLIC_ORIGIN
    assert "access-control-allow-origin" not in answers[("GET", "/api/", "https://sre-monitor.invalid")]["headers"]
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert answers[("GET", path, None)]["status"] == 404, path
