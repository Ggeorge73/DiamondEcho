import { test } from "node:test";
import assert from "node:assert/strict";
import { run, suites, identityFacts, STRANGER_ORIGIN } from "./api.mjs";
import { TARGETS } from "../targets.mjs";

const T = TARGETS.production;
const json = { "content-type": "application/json" };

// The API as it should answer. `identity` is what /api/ says; `over` replaces
// any answer (a function receives the request headers).
function api({ identity = { service: "DiamondEcho API", revision: "diamondecho-api-00031-abc", commit: "59f8d46" }, over = {} } = {}) {
  const routes = {
    [`${T.apiOrigin}/health`]: () => ({ status: 200, headers: json, body: '{"status":"ok"}' }),
    [`${T.apiOrigin}/api/`]: (headers) => ({
      status: 200, body: JSON.stringify(identity),
      headers: { ...json, ...(headers.Origin === T.publicOrigin ? { "access-control-allow-origin": T.publicOrigin, vary: "Origin" } : {}) },
    }),
    [`${T.apiOrigin}/docs`]: () => ({ status: 404, headers: json, body: '{"detail":"Not Found"}' }),
    [`${T.apiOrigin}/redoc`]: () => ({ status: 404, headers: json, body: '{"detail":"Not Found"}' }),
    [`${T.apiOrigin}/openapi.json`]: () => ({ status: 404, headers: json, body: '{"detail":"Not Found"}' }),
    ...over,
  };
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", headers: init.headers });
    const answer = routes[url];
    if (!answer) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    const { status, headers, body } = answer(init.headers || {});
    return new Response(body ?? null, { status, headers });
  };
  return { fetch, calls };
}

const ctx = (fetch, suite = "fast") => ({ fetch, now: () => 0, sleep: async () => {}, targets: T, env: {}, suite });
const byId = (checks) => Object.fromEntries(checks.map((check) => [check.id, check]));

test("fast: four checks pass, GET only, and the identity check reports which build answered", async () => {
  const { fetch, calls } = api();
  const checks = await run(ctx(fetch));
  assert.deepEqual(checks.map((check) => check.id), ["api-health", "api-identity", "api-cors-allowed", "api-cors-refused"]);
  for (const check of checks) assert.equal(check.ok, true, `${check.id}: ${check.detail}`);
  assert.deepEqual(byId(checks)["api-identity"].observed, { revision: "diamondecho-api-00031-abc", commit: "59f8d46" });
  assert.ok(calls.every((call) => call.method === "GET"));
  assert.equal(calls.length, 3);
  assert.ok(suites.includes("fast") && suites.includes("slow") && suites.includes("post-deploy"));
});

test("an API that does not publish its build yet still passes, with nothing observed", async () => {
  const { fetch } = api({ identity: { service: "DiamondEcho API" } });
  const identity = byId(await run(ctx(fetch)))["api-identity"];
  assert.equal(identity.ok, true);
  assert.deepEqual(identity.observed, {});
});

test("only values shaped like a revision or a commit are passed on", () => {
  assert.deepEqual(identityFacts({ revision: "Not a revision!", commit: "main" }), {});
  assert.deepEqual(identityFacts({ revision: "x".repeat(80), commit: "abc" }), {});
  assert.deepEqual(identityFacts({ revision: null, commit: null }), {});
  assert.deepEqual(identityFacts(null), {});
});

test("a health route that does not say ok fails", async () => {
  const { fetch } = api({ over: { [`${T.apiOrigin}/health`]: () => ({ status: 200, headers: json, body: '{"status":"starting"}' }) } });
  const health = byId(await run(ctx(fetch)))["api-health"];
  assert.equal(health.ok, false);
  assert.equal(health.detail, "The health route did not say ok.");
});

test("another service at the API's address fails, and nothing it says is observed", async () => {
  const { fetch } = api({ identity: { service: "Something else", revision: "other-00001-xyz" } });
  const identity = byId(await run(ctx(fetch)))["api-identity"];
  assert.equal(identity.ok, false);
  assert.deepEqual(identity.observed, {});
});

test("an API that stops letting the website read its answers fails the CORS check", async () => {
  const { fetch } = api({ over: { [`${T.apiOrigin}/api/`]: () => ({ status: 200, headers: json, body: '{"service":"DiamondEcho API"}' }) } });
  const checks = byId(await run(ctx(fetch)));
  assert.equal(checks["api-identity"].ok, true);
  assert.equal(checks["api-cors-allowed"].ok, false);
  assert.match(checks["api-cors-allowed"].detail, /CORS/);
});

test("an API that lets any site read its answers fails the refusal check", async () => {
  const { fetch, calls } = api({ over: { [`${T.apiOrigin}/api/`]: (headers) => ({ status: 200, headers: { ...json, "access-control-allow-origin": headers.Origin }, body: '{"service":"DiamondEcho API"}' }) } });
  const refused = byId(await run(ctx(fetch)))["api-cors-refused"];
  assert.equal(refused.ok, false);
  assert.ok(calls.some((call) => call.headers?.Origin === STRANGER_ORIGIN));
});

test("slow: only the route-list check, and it names the route that is published", async () => {
  const { fetch, calls } = api({ over: { [`${T.apiOrigin}/redoc`]: () => ({ status: 200, headers: { "content-type": "text/html" }, body: "<html>" }) } });
  const checks = await run(ctx(fetch, "slow"));
  assert.deepEqual(checks.map((check) => check.id), ["api-docs-off"]);
  assert.equal(checks[0].ok, false);
  assert.equal(checks[0].detail, "/redoc answered 200, expected 404.");
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), ["/docs", "/redoc"]);
});

test("post-deploy: everything", async () => {
  const { fetch } = api();
  const checks = await run(ctx(fetch, "post-deploy"));
  assert.deepEqual(checks.map((check) => check.id), ["api-health", "api-identity", "api-cors-allowed", "api-cors-refused", "api-docs-off"]);
  assert.ok(checks.every((check) => check.ok));
});

test("an API that is down fails every check with the reason, without throwing", async () => {
  const fetch = async () => { throw new DOMException("timed out", "TimeoutError"); };
  const checks = await run(ctx(fetch));
  assert.ok(checks.every((check) => !check.ok && /^No answer: timed out/.test(check.detail)));
});
