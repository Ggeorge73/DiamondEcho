import { test } from "node:test";
import assert from "node:assert/strict";
import { run, suites } from "./staff.mjs";
import { TARGETS } from "../targets.mjs";

const T = TARGETS.production;
const STAFF_API = `${T.apiOrigin}/api/v1/inquiries/staff`;
const protectedPage = {
  "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; script-src 'self'; frame-ancestors 'none'", "x-frame-options": "DENY",
};
const refused = { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": T.staffOrigin };

function site({ page = {}, api = {} } = {}) {
  const routes = {
    [`${T.staffOrigin}/`]: { status: 200, body: "<!doctype html><html><body>Staff sign-in</body></html>", ...page, headers: { ...protectedPage, ...page.headers } },
    [STAFF_API]: { status: 401, body: '{"detail":"Staff authentication required."}', ...api, headers: { ...refused, ...api.headers } },
  };
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", headers: init.headers || {} });
    const answer = routes[url];
    if (!answer) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    const headers = Object.fromEntries(Object.entries(answer.headers).filter(([, value]) => value !== undefined));
    return new Response(answer.body ?? null, { status: answer.status, headers });
  };
  return { fetch, calls };
}

const ctx = (fetch) => ({ fetch, now: () => 0, sleep: async () => {}, targets: T, env: {}, suite: "fast" });
const byId = (checks) => Object.fromEntries(checks.map((check) => [check.id, check]));

test("a protected staff page and an API that asks for sign-in pass; nothing signs in", async () => {
  const { fetch, calls } = site();
  const checks = await run(ctx(fetch));
  assert.deepEqual(checks.map((check) => [check.id, check.ok]), [["staff-home", true], ["staff-api-auth", true]]);
  assert.ok(calls.every((call) => call.method === "GET" && call.headers.Authorization === undefined && call.headers.Cookie === undefined));
  assert.equal(calls[1].headers.Origin, T.staffOrigin);
  assert.deepEqual(suites, ["fast", "post-deploy"]);
});

test("each missing protection on the staff page fails and is named", async () => {
  for (const [header, wanted] of [["cache-control", /no-store/], ["content-security-policy", /default-src 'none'/], ["x-frame-options", /DENY/]]) {
    const { fetch } = site({ page: { headers: { [header]: undefined } } });
    const check = byId(await run(ctx(fetch)))["staff-home"];
    assert.equal(check.ok, false, header);
    assert.match(check.detail, new RegExp(`Header ${header} is missing`));
    assert.match(check.detail, wanted);
  }
});

test("a staff API that answers without sign-in is reported as a security incident", async () => {
  const { fetch } = site({ api: { status: 200, body: '{"items":[]}' } });
  const check = byId(await run(ctx(fetch)))["staff-api-auth"];
  assert.equal(check.ok, false);
  assert.match(check.detail, /security incident/);
});

test("a staff API that no longer knows the staff site (403) or is off (503) fails", async () => {
  for (const status of [403, 503]) {
    const { fetch } = site({ api: { status, body: '{"detail":"Staff origin denied."}' } });
    assert.equal(byId(await run(ctx(fetch)))["staff-api-auth"].detail, `Answered ${status}, expected 401.`);
  }
});

test("a staff API that does not let the staff site read its answer fails", async () => {
  const { fetch } = site({ api: { headers: { "access-control-allow-origin": undefined } } });
  assert.match(byId(await run(ctx(fetch)))["staff-api-auth"].detail, /CORS/);
});
