// The load generator's refusals. These tests are the proof that production
// cannot be load-tested by this tool: if one fails, do not run the generator.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_ROUTES,
  HEAVY_REQUESTS_PER_SCENARIO,
  LOCAL_CAPS,
  NEVER_PATHS,
  SafetyError,
  STAGING_CAPS,
  STAGING_FLAG,
  STAGING_HOSTS,
  checkRoute,
  checkTarget,
  identityDecision,
  verifyIdentity,
  peakRate,
  productionReason,
  requestCeiling,
  scenarioProblems,
  totalSeconds,
} from "./safety.mjs";
import { SCENARIOS, STANDARD } from "./scenarios.mjs";
import { TARGETS } from "../../scripts/sre/targets.mjs";
import { fakeIo } from "./fake-io.mjs";

const refusedWith = (code) => (error) => error instanceof SafetyError && error.code === code;

const PRODUCTION = [
  "https://diamondecho.com",
  "http://diamondecho.com",
  "https://diamondecho.com/",
  "https://www.diamondecho.com",
  "https://staff.diamondecho.com",
  "https://anything.deeper.diamondecho.com",
  "https://DIAMONDECHO.COM",
  "https://diamondecho.com.",
  "https://diamondecho.com:443",
  "https://diamondecho.com:8443",
  "https://ｄｉａｍｏｎｄｅｃｈｏ.com", // full-width letters become diamondecho.com
  "https://diamondecho-api-180189726732.us-east1.run.app",
  "http://diamondecho-api-180189726732.us-east1.run.app:8080",
  "https://candidate---diamondecho-api-180189726732.us-east1.run.app",
  "https://diamondecho-api-abc123xyz-ue.a.run.app",
  "https://candidate---diamondecho-api-abc123xyz-ue.a.run.app",
  "https://diamondecho.pages.dev",
  "https://1a2b3c4d.diamondecho.pages.dev",
  "https://diamondecho-staff.pages.dev",
  "https://georgeolugbe.georgiamls.com",
];

test("every production address is refused, as production", () => {
  for (const target of PRODUCTION) {
    assert.throws(() => checkTarget(target), refusedWith("production"), target);
  }
});

test("staging approval does not open production", () => {
  for (const target of PRODUCTION) {
    assert.throws(() => checkTarget(target, { stagingApproved: true }), refusedWith("production"), target);
  }
});

test("there is no override: unknown options are ignored and production is still refused", () => {
  const tries = { stagingApproved: true, allowProduction: true, production: true, force: true, override: true, kind: "local" };
  for (const target of PRODUCTION) {
    assert.throws(() => checkTarget(target, tries), refusedWith("production"), target);
  }
});

test("every address in targets.mjs counts as production", () => {
  for (const value of Object.values(TARGETS.production)) {
    const host = String(value).includes("://") ? new URL(value).hostname : String(value);
    assert.ok(productionReason(host), host);
  }
});

test("the refusal message names production and says no flag changes it", () => {
  assert.throws(
    () => checkTarget("https://diamondecho.com"),
    (error) => /Refused/.test(error.message) && /never load-tested/.test(error.message) && /no flag/.test(error.message),
  );
});

test("a user name cannot dress production up as this machine", () => {
  assert.throws(() => checkTarget("https://localhost@diamondecho.com"), refusedWith("bad-target"));
  assert.throws(() => checkTarget("http://127.0.0.1:8080@diamondecho.com/"), refusedWith("bad-target"));
});

test("this machine is accepted, and is the only thing accepted without a flag", () => {
  for (const [target, origin] of [
    ["http://127.0.0.1:8080", "http://127.0.0.1:8080"],
    ["http://localhost:8080", "http://localhost:8080"],
    ["http://[::1]:8080", "http://[::1]:8080"],
    ["http://127.0.0.2:9000/", "http://127.0.0.2:9000"],
    ["http://127.1:8080", "http://127.0.0.1:8080"], // short form, normalized
  ]) {
    const checked = checkTarget(target);
    assert.equal(checked.kind, "local", target);
    assert.equal(checked.origin, origin, target);
  }
});

test("any other address is refused, whatever it is", () => {
  for (const target of [
    "https://example.com",
    "http://10.0.0.5:8080",
    "http://192.168.1.10",
    "http://0.0.0.0:8080",
    "http://[::ffff:127.0.0.1]:8080",
    "http://127.0.0.1.nip.io:8080",
    "https://diamondecho.com.example.org",
    "https://diamondecho-api-staging-299705773978.us-east1.run.app.example.org",
    "https://other-service-299705773978.us-east1.run.app",
  ]) {
    assert.throws(() => checkTarget(target, { stagingApproved: true }), refusedWith("unknown-target"), target);
  }
});

test("a target must be a plain http(s) origin", () => {
  for (const target of ["", "not a url", "ftp://127.0.0.1", "file:///etc/passwd", "http://127.0.0.1:8080/api", "http://127.0.0.1:8080/?x=1", "http://127.0.0.1:8080/#a"]) {
    assert.throws(() => checkTarget(target), refusedWith("bad-target"), target);
  }
});

test("staging needs the flag, https and a listed address", () => {
  for (const host of STAGING_HOSTS) {
    assert.throws(() => checkTarget(`https://${host}`), refusedWith("staging-needs-approval"), host);
    assert.throws(() => checkTarget(`http://${host}`, { stagingApproved: true }), refusedWith("staging-http"), host);
    assert.equal(checkTarget(`https://${host}`, { stagingApproved: true }).kind, "staging");
  }
  assert.equal(STAGING_FLAG, "--i-have-approval-for-staging");
});

test("the staging list holds only staging addresses", () => {
  for (const host of STAGING_HOSTS) {
    assert.equal(productionReason(host), null, host);
    assert.match(host, /^diamondecho-api-staging-/);
  }
});

test("the inquiry route is refused by name, however it is spelled", () => {
  for (const path of [
    "/api/v1/inquiries",
    "/api/v1/inquiries/",
    "/API/V1/INQUIRIES",
    "/api/v1/%69nquiries",
    "/api/v1/inquiries/staff",
    "/api/v1/deals/../inquiries",
    "/api/v1/./inquiries",
  ]) {
    for (const method of ["POST", "GET", "OPTIONS", "post"]) {
      assert.throws(() => checkRoute(method, path, "local"), (error) => refusedWith("forbidden-route")(error) && /inquir/.test(error.message), `${method} ${path}`);
    }
  }
});

test("the paid property routes and the market brief are refused by name", () => {
  for (const path of ["/api/v1/properties/lookup", "/api/v1/properties/suggest", "/api/v1/Properties/lookup", "/api/v1/properties"]) {
    assert.throws(() => checkRoute("GET", path, "local"), (error) => /paid/.test(error.message), path);
  }
  for (const path of ["/api/v1/market-brief", "/api/v1/market-brief/audio/tour-0123456789abcdef.mp3"]) {
    assert.throws(() => checkRoute("GET", path, "local"), (error) => /text-to-speech/.test(error.message), path);
  }
});

test("staff routes are refused", () => {
  for (const path of ["/api/status", "/api/v1/podcast/staff/episodes", "/api/v1/inquiries/staff"]) {
    assert.throws(() => checkRoute("GET", path, "local"), refusedWith("forbidden-route"), path);
  }
});

test("only listed routes, exactly as listed, may be requested", () => {
  for (const route of ALLOWED_ROUTES) {
    assert.ok(checkRoute(route.method, route.path, "local"), `${route.method} ${route.path}`);
  }
  for (const [method, path] of [
    ["GET", "/api/v1/deals/analyze"], // listed for POST only
    ["DELETE", "/health"],
    ["GET", "/health?x=1"],
    ["GET", "/health#x"],
    ["GET", "//diamondecho.com/health"],
    ["GET", "https://diamondecho.com/health"],
    ["GET", "/api/v1/podcast/episodes"],
    ["GET", "/docs"],
    ["GET", "/api/v1/%E0%A4%A"], // a broken escape
    ["POST", "/api/assistant/analyze"],
  ]) {
    assert.throws(() => checkRoute(method, path, "local"), refusedWith("forbidden-route"), `${method} ${path}`);
  }
});

test("no allowed route is a forbidden one", () => {
  for (const route of ALLOWED_ROUTES) {
    for (const never of NEVER_PATHS) {
      assert.ok(!route.path.toLowerCase().startsWith(never.prefix), `${route.path} vs ${never.prefix}`);
    }
  }
});

test("the heavy calculation routes run on this machine only", () => {
  for (const route of ALLOWED_ROUTES.filter((item) => item.heavy)) {
    assert.ok(route.localOnly, route.path);
    assert.ok(checkRoute(route.method, route.path, "local"));
    assert.throws(() => checkRoute(route.method, route.path, "staging"), refusedWith("forbidden-route"), route.path);
  }
});

const base = {
  id: "t",
  mode: "closed",
  concurrency: 1,
  durationSeconds: 5,
  warmupSeconds: 0,
  timeoutMs: 1000,
  steps: [{ method: "GET", path: "/health" }],
};

test("a well-formed local scenario passes", () => {
  assert.deepEqual(scenarioProblems(base, "local"), []);
});

test("scenario settings must make sense", () => {
  const cases = [
    [{ mode: "fast" }, /mode/],
    [{ steps: [] }, /step/],
    [{ concurrency: 0 }, /concurrency/],
    [{ concurrency: 1.5 }, /whole number/],
    [{ maxRequests: 2.5 }, /maxRequests/],
    [{ timeoutMs: 0 }, /timeoutMs/],
    [{ durationSeconds: 0 }, /duration/],
    [{ mode: "open" }, /arrival rate/],
  ];
  for (const [change, pattern] of cases) {
    const problems = scenarioProblems({ ...base, ...change }, "local");
    assert.ok(problems.some((item) => pattern.test(item)), `${JSON.stringify(change)}: ${problems}`);
  }
});

test("local ceilings stop a typing mistake", () => {
  assert.ok(scenarioProblems({ ...base, concurrency: LOCAL_CAPS.concurrency + 1 }, "local").some((p) => /concurrency/.test(p)));
  assert.ok(scenarioProblems({ ...base, durationSeconds: LOCAL_CAPS.totalSeconds + 1 }, "local").some((p) => /seconds/.test(p)));
  assert.ok(scenarioProblems({ ...base, mode: "open", ratePerSecond: LOCAL_CAPS.ratePerSecond + 1 }, "local").some((p) => /arrival rate/.test(p)));
  // A local closed loop with no pause is allowed: that is how throughput is measured.
  assert.deepEqual(scenarioProblems({ ...base, concurrency: 8 }, "local"), []);
});

test("staging ceilings hold for open and closed loops alike", () => {
  const open = { ...base, mode: "open", concurrency: 3, ratePerSecond: STAGING_CAPS.ratePerSecond + 1, durationSeconds: 10 };
  assert.ok(scenarioProblems(open, "staging").some((p) => /arrival rate/.test(p)));
  // Closed loop with no pause: its rate is unbounded, so it is refused.
  assert.ok(scenarioProblems({ ...base, maxRequests: 10 }, "staging").some((p) => /think time/.test(p)));
  // Six visitors pausing 250 ms can send 24 a second: refused.
  assert.ok(scenarioProblems({ ...base, concurrency: 6, thinkTimeMs: 250 }, "staging").some((p) => /24 requests per second/.test(p)));
  // Three visitors pausing a second: 3 a second, allowed.
  assert.deepEqual(scenarioProblems({ ...base, concurrency: 3, thinkTimeMs: 1000 }, "staging"), []);
  assert.ok(scenarioProblems({ ...base, concurrency: STAGING_CAPS.concurrency + 1, thinkTimeMs: 5000 }, "staging").some((p) => /concurrency/.test(p)));
  assert.ok(scenarioProblems({ ...base, thinkTimeMs: 1000, durationSeconds: STAGING_CAPS.totalSeconds + 1 }, "staging").some((p) => /seconds/.test(p)));
  const many = { ...base, mode: "open", concurrency: 3, ratePerSecond: 5, durationSeconds: 119, warmupSeconds: 0, maxRequests: STAGING_CAPS.requests + 1 };
  assert.ok(scenarioProblems(many, "staging").some((p) => /requests is over/.test(p)));
});

test("a heavy route runs a few times, one at a time", () => {
  const heavy = { ...base, steps: [{ method: "POST", path: "/api/v1/deals/monte-carlo" }] };
  assert.ok(scenarioProblems(heavy, "local").some((p) => /maxRequests/.test(p)));
  assert.ok(scenarioProblems({ ...heavy, maxRequests: HEAVY_REQUESTS_PER_SCENARIO + 1 }, "local").some((p) => /maxRequests/.test(p)));
  assert.ok(scenarioProblems({ ...heavy, maxRequests: 3, concurrency: 2 }, "local").some((p) => /one request at a time/.test(p)));
  assert.deepEqual(scenarioProblems({ ...heavy, maxRequests: 3 }, "local"), []);
});

test("rate, duration and request ceilings are computed from the settings", () => {
  const spike = { mode: "open", warmupSeconds: 2, stages: [{ seconds: 8, ratePerSecond: 5 }, { seconds: 8, ratePerSecond: 50 }] };
  assert.equal(peakRate(spike), 50);
  assert.equal(totalSeconds(spike), 18);
  assert.equal(requestCeiling(spike), 8 * 5 + 8 * 50 + 2 * 5);
  assert.equal(peakRate({ mode: "closed", concurrency: 3, thinkTimeMs: 1000 }), 3);
  assert.equal(peakRate({ mode: "closed", concurrency: 3 }), Infinity);
  assert.equal(requestCeiling({ mode: "closed", concurrency: 2, thinkTimeMs: 500, durationSeconds: 10 }), 42);
  assert.equal(requestCeiling({ mode: "closed", concurrency: 2, durationSeconds: 10 }), null);
  assert.equal(requestCeiling({ mode: "closed", concurrency: 2, maxRequests: 7 }), 7);
});

test("every shipped scenario may run on this machine", () => {
  for (const scenario of SCENARIOS) {
    assert.deepEqual(scenarioProblems(scenario, "local"), [], scenario.id);
  }
  for (const id of STANDARD) assert.ok(SCENARIOS.some((scenario) => scenario.id === id), id);
});

test("only the staging scenarios may run on staging", () => {
  for (const scenario of SCENARIOS) {
    const problems = scenarioProblems(scenario, "staging");
    if (scenario.id.startsWith("staging-")) assert.deepEqual(problems, [], scenario.id);
    else assert.ok(problems.length > 0, `${scenario.id} should be refused on staging`);
  }
});

const LOCAL = checkTarget("http://127.0.0.1:8080");
const STAGING = checkTarget("https://diamondecho-api-staging-299705773978.us-east1.run.app", { stagingApproved: true });
const answer = (body, status = 200) => ({ status, body: typeof body === "string" ? body : JSON.stringify(body) });

test("identity: a forwarded port that answers as production is refused (fake network)", async () => {
  const io = fakeIo({ respond: () => ({ status: 200, body: '{"revision":"diamondecho-api-00028-zin"}', ms: 30 }) });
  await assert.rejects(io.drive(verifyIdentity(LOCAL, { io })), refusedWith("production"));
  await assert.rejects(io.drive(verifyIdentity(LOCAL, { io, stagingApproved: true })), refusedWith("production"));
  assert.equal(io.calls.length, 2);
  for (const call of io.calls) {
    assert.equal(call.url, "http://127.0.0.1:8080/api/");
    assert.equal(call.method, "GET");
    assert.equal(call.redirect, "manual");
  }
});

test("identity: this machine answers with no revision and stays local", async () => {
  const io = fakeIo({ respond: () => ({ status: 200, body: '{"service":"DiamondEcho API","revision":null,"commit":null}', ms: 3 }) });
  assert.deepEqual(await io.drive(verifyIdentity(LOCAL, { io })), { kind: "local", revision: null });
  // An older build without the revision field is also a local run.
  assert.deepEqual(identityDecision(LOCAL, answer({ service: "DiamondEcho API" })), { kind: "local", revision: null });
});

test("identity: any deployed revision that is not staging is refused, wherever it answers", () => {
  for (const revision of ["diamondecho-api-00028-zin", "candidate", "x", "diamondecho-api-stagingx-1", 42]) {
    assert.throws(() => identityDecision(LOCAL, answer({ service: "DiamondEcho API", revision }), { stagingApproved: true }), refusedWith("production"), String(revision));
    assert.throws(() => identityDecision(STAGING, answer({ service: "DiamondEcho API", revision }), { stagingApproved: true }), refusedWith("production"), String(revision));
  }
});

test("identity: a staging revision needs the flag, and a local port to staging becomes a staging run", () => {
  const body = answer({ service: "DiamondEcho API", revision: "diamondecho-api-staging-00003-gdl" });
  assert.throws(() => identityDecision(LOCAL, body), refusedWith("staging-needs-approval"));
  assert.deepEqual(identityDecision(LOCAL, body, { stagingApproved: true }), { kind: "staging", revision: "diamondecho-api-staging-00003-gdl" });
  assert.deepEqual(identityDecision(STAGING, body, { stagingApproved: true }), { kind: "staging", revision: "diamondecho-api-staging-00003-gdl" });
  // Staging running a build from before the identity field.
  assert.deepEqual(identityDecision(STAGING, answer({ service: "DiamondEcho API" }), { stagingApproved: true }), { kind: "staging", revision: null });
});

test("identity: no answer, a wrong status or a body that is not the API is refused", async () => {
  for (const reply of [{ error: "could not connect" }, answer("", 404), answer("", 302), answer("<html>"), answer("[]"), answer({ service: "Other" }), null]) {
    assert.throws(() => identityDecision(LOCAL, reply), refusedWith("identity-unknown"), JSON.stringify(reply));
  }
  const silent = fakeIo({ respond: () => ({ status: 200, body: "{}", ms: 60_000 }) });
  await assert.rejects(silent.drive(verifyIdentity(LOCAL, { io: silent })), (error) => refusedWith("identity-unknown")(error) && /timed out/.test(error.message));
  const down = fakeIo({ respond: () => ({ throws: new TypeError("fetch failed") }) });
  await assert.rejects(down.drive(verifyIdentity(LOCAL, { io: down })), (error) => /could not connect/.test(error.message));
});

test("on staging the run plus one request timeout must fit the time ceiling", () => {
  const closedStaging = { ...base, concurrency: 3, thinkTimeMs: 1000, durationSeconds: 100, timeoutMs: 35000 };
  assert.ok(scenarioProblems(closedStaging, "staging").some((p) => /request timeout can run past/.test(p)));
  assert.deepEqual(scenarioProblems({ ...closedStaging, durationSeconds: 60 }, "staging"), []);
  // Locally the overrun is harmless and not checked.
  assert.deepEqual(scenarioProblems({ ...base, durationSeconds: 590, timeoutMs: 30000 }, "local"), []);
});

test("every shipped scenario fails a run that measured nothing", () => {
  for (const scenario of SCENARIOS) {
    for (const [kind, limits] of Object.entries(scenario.thresholds ?? {})) {
      assert.ok(limits.min_requests >= 1, `${scenario.id} ${kind}`);
    }
  }
});
