import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { run, suites, INQUIRY_PATH, FORM_MARKER, CLOSED_MARKER } from "./inquiry.mjs";
import { TARGETS } from "../targets.mjs";

const T = TARGETS.production;
const repo = new URL("../../../", import.meta.url);
const html = { "content-type": "text/html; charset=utf-8" };
const json = { "content-type": "application/json" };
const ROUTE = T.apiOrigin + INQUIRY_PATH;
const page = (inside) => `<html><head><link rel="canonical" href="${T.publicOrigin}/inquire"/></head><body><h1>Contact</h1>${inside}</body></html>`;
const openForm = page(`<form><button class="mf-btn ${FORM_MARKER}" type="submit">Submit request</button></form>`);

// The API's answers as FastAPI and Starlette give them today.
function site(over = {}) {
  const routes = {
    [`GET ${T.publicOrigin}/inquire`]: { status: 200, headers: html, body: openForm },
    [`OPTIONS ${ROUTE}`]: { status: 200, body: "OK", headers: {
      "access-control-allow-origin": T.publicOrigin, "access-control-allow-methods": "GET, POST, PATCH",
      "access-control-allow-headers": "Accept, Accept-Language, Authorization, Content-Language, Content-Type, X-Idempotency-Key",
    } },
    [`GET ${ROUTE}`]: { status: 405, headers: { ...json, allow: "POST" }, body: '{"detail":"Method Not Allowed"}' },
    [`GET ${ROUTE}/staff`]: { status: 401, headers: json, body: '{"detail":"Staff authentication required."}' },
    ...over,
  };
  const calls = [];
  const fetch = async (url, init = {}) => {
    const method = init.method || "GET";
    calls.push({ url, method, headers: init.headers || {}, body: init.body });
    const answer = routes[`${method} ${url}`];
    if (!answer) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    return new Response(answer.body ?? null, { status: answer.status, headers: answer.headers });
  };
  return { fetch, calls };
}

const ctx = (fetch) => ({ fetch, now: () => 0, sleep: async () => {}, targets: T, env: {}, suite: "fast" });
const byId = (checks) => Object.fromEntries(checks.map((check) => [check.id, check]));

test("an open, working inquiry form passes all four checks", async () => {
  const { fetch } = site();
  const checks = await run(ctx(fetch));
  assert.deepEqual(checks.map((check) => check.id), ["inquiry-page", "inquiry-preflight", "inquiry-route", "inquiry-queue"]);
  for (const check of checks) assert.equal(check.ok, true, `${check.id}: ${check.detail}`);
  assert.deepEqual(suites, ["fast", "post-deploy"]);
});

test("rule 2: nothing is ever sent to the inquiry route, and no request carries a body", async () => {
  // Run against a healthy API and a broken one: a failure must not change
  // what is sent (no "try a POST to see" fallback).
  for (const over of [{}, { [`GET ${ROUTE}`]: { status: 404, headers: json, body: "{}" } }]) {
    const { fetch, calls } = site(over);
    await run(ctx(fetch));
    for (const call of calls) {
      assert.ok(["GET", "OPTIONS"].includes(call.method), `${call.method} ${call.url}`);
      assert.equal(call.body, undefined);
      assert.equal(call.headers.Authorization, undefined);
      assert.equal(call.headers["X-Idempotency-Key"], undefined);
    }
    assert.equal(calls.length, 4);
  }
});

test("the form markers are still in the frontend source", () => {
  assert.ok(readFileSync(new URL("frontend/src/components/InquiryForm.jsx", repo), "utf8").includes(FORM_MARKER));
  assert.ok(readFileSync(new URL("frontend/src/pages/Inquire.jsx", repo), "utf8").includes(`"de-inquiry-card ${CLOSED_MARKER}"`));
});

test("a page built without the API's address shows the closed card, and that fails", async () => {
  const closed = page(`<section class="de-inquiry-card ${CLOSED_MARKER}"><h2>Call or email us</h2></section>`);
  const { fetch } = site({ [`GET ${T.publicOrigin}/inquire`]: { status: 200, headers: html, body: closed } });
  const check = byId(await run(ctx(fetch)))["inquiry-page"];
  assert.equal(check.ok, false);
  assert.match(check.detail, /call or email us/);
});

test("a preflight that drops the idempotency header, POST or the website fails", async () => {
  const variants = [
    [{ "access-control-allow-origin": T.publicOrigin, "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "Content-Type" }, /headers the form sends/],
    [{ "access-control-allow-origin": T.publicOrigin, "access-control-allow-methods": "GET", "access-control-allow-headers": "Content-Type, X-Idempotency-Key" }, /POST/],
    [{ "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "Content-Type, X-Idempotency-Key" }, /CORS/],
  ];
  for (const [headers, detail] of variants) {
    const { fetch } = site({ [`OPTIONS ${ROUTE}`]: { status: 200, headers, body: "OK" } });
    const check = byId(await run(ctx(fetch)))["inquiry-preflight"];
    assert.equal(check.ok, false);
    assert.match(check.detail, detail);
  }
  // Starlette refuses a preflight from an unknown site with a 400.
  const { fetch } = site({ [`OPTIONS ${ROUTE}`]: { status: 400, headers: {}, body: "Disallowed CORS origin" } });
  assert.equal(byId(await run(ctx(fetch)))["inquiry-preflight"].detail, "Answered 400, expected 200.");
});

test("a missing inquiry route fails", async () => {
  const { fetch } = site({ [`GET ${ROUTE}`]: { status: 404, headers: json, body: '{"detail":"Not Found"}' } });
  const check = byId(await run(ctx(fetch)))["inquiry-route"];
  assert.equal(check.ok, false);
  assert.match(check.detail, /^Answered 404 to a GET/);
});

test("the queue route's body is never read unless it is a 503: a 200 would be the queue itself", async () => {
  let cancelled = false;
  const routes = site();
  const fetch = async (url, init = {}) => {
    if (url === `${ROUTE}/staff`) {
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"items":[{"reference":"DE-1"}]}')); }, cancel() { cancelled = true; } }), { status: 200, headers: json });
    }
    return routes.fetch(url, init);
  };
  const check = byId(await run(ctx(fetch)))["inquiry-queue"];
  assert.equal(check.ok, false);
  assert.equal(check.detail, "Answered 200, expected 401.");
  assert.equal(cancelled, true);
});

test("a queue that is switched off is named as such; another 503 is reported as a plain status", async () => {
  const { fetch } = site({ [`GET ${ROUTE}/staff`]: { status: 503, headers: json, body: '{"detail":"Inquiry queue is not configured."}' } });
  const off = byId(await run(ctx(fetch)))["inquiry-queue"];
  assert.equal(off.ok, false);
  assert.match(off.detail, /switched off or not configured/);
  const { fetch: platform } = site({ [`GET ${ROUTE}/staff`]: { status: 503, headers: { "content-type": "text/html" }, body: "<html>Service Unavailable</html>" } });
  assert.equal(byId(await run(ctx(platform)))["inquiry-queue"].detail, "Answered 503, expected 401.");
});
