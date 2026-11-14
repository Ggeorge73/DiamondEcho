import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { run, suites, expectedMonitors, readMonitors, UPTIME_API } from "./uptime.mjs";
import { PAGES } from "./pages.mjs";
import { FORM_MARKER } from "./inquiry.mjs";
import { isBlindRun } from "../alert-policy.mjs";
import { makeRun, runProblems } from "../lib/schema.mjs";
import { TARGETS } from "../targets.mjs";

const T = TARGETS.production;
const KEY = "ur-READONLY-key-value";
const repo = new URL("../../../", import.meta.url);

const monitor = (expected, over = {}) => ({ id: 1, friendly_name: expected.id, url: expected.url, type: 1, status: 2, response_times: [{ datetime: 1, value: 180 }], ...over });
const allUp = (change = {}) => ({ stat: "ok", monitors: expectedMonitors(T).map((expected) => monitor(expected, change[expected.id])) });

function service(answer, { status = 200 } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    if (answer instanceof Error) throw answer;
    return new Response(typeof answer === "string" ? answer : JSON.stringify(answer), { status, headers: { "content-type": "application/json" } });
  };
  return { fetch, calls };
}
const ctx = (fetch, env = { UPTIMEROBOT_API_KEY: KEY }) => ({ fetch, now: () => 0, sleep: async () => {}, targets: T, env, suite: "fast", pageSource: "uptime-service" });
const byId = (checks) => Object.fromEntries(checks.map((check) => [check.id, check]));

test("one monitor for every page of the site and for the staff site, named after its check", () => {
  const expected = expectedMonitors(T);
  assert.deepEqual(expected.map((item) => item.id), [...PAGES.map((page) => page.id), "staff-home"]);
  assert.equal(expected.find((item) => item.id === "public-home").url, "https://diamondecho.com/");
  assert.equal(expected.find((item) => item.id === "staff-home").url, "https://staff.diamondecho.com/");
  assert.equal(new Set(expected.map((item) => item.url)).size, expected.length);
  assert.deepEqual(suites, ["fast"], "a verdict up to five minutes old says nothing about a build that just went live");
});

test("every page up: each is filed under its own id, component, severity and SLIs, with the service's response time", async () => {
  const { fetch, calls } = service(allUp());
  const checks = await run(ctx(fetch));
  assert.deepEqual(runProblems(makeRun({ suite: "fast", started_at: "2026-11-14T00:00:00.000Z", finished_at: "2026-11-14T00:00:01.000Z", checks })), []);
  assert.equal(checks.length, expectedMonitors(T).length + 1);
  for (const check of checks) assert.equal(check.ok, true, `${check.id}: ${check.detail}`);
  const home = byId(checks)["public-home"];
  assert.deepEqual([home.component, home.severity, home.latency_ms, home.status], ["public-site", "sev1", 180, null]);
  assert.deepEqual(home.slis, ["public-availability", "public-latency"]);
  assert.deepEqual(byId(checks)["inquiry-page"].slis, ["inquiry-availability"]);
  assert.equal(byId(checks)["staff-home"].component, "staff-site");
  assert.deepEqual(byId(checks)["uptime-service"].observed, { monitors: "12", expected: "12" });
  // One read-only request, to the service and nowhere else.
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].url, calls[0].method], [UPTIME_API, "POST"]);
  assert.equal(new URLSearchParams(calls[0].body).get("api_key"), KEY);
});

test("a page the service calls down, or seems down, fails under its own check; the others pass", async () => {
  const { fetch } = service(allUp({ "public-home": { status: 9 }, "search-page": { status: 8 } }));
  const checks = byId(await run(ctx(fetch)));
  assert.deepEqual([checks["public-home"].ok, checks["public-home"].severity, checks["public-home"].latency_ms], [false, "sev1", null]);
  assert.match(checks["public-home"].detail, /^UptimeRobot reports this page down/);
  assert.match(checks["search-page"].detail, /seems down/);
  assert.equal(checks["public-page-about"].ok, true);
  assert.equal(checks["uptime-service"].ok, true, "the service did its job: it reported every page");
});

test("a page that is paused, not checked yet, missing or watching another address is not filed, and the service check names it", async () => {
  const answer = allUp({ "public-page-terms": { status: 0 }, "inquiry-page": { status: 1 }, "staff-home": { url: "https://example.com/" } });
  answer.monitors = answer.monitors.filter((item) => item.friendly_name !== "search-page");
  const checks = await run(ctx(service(answer).fetch));
  const ids = checks.map((check) => check.id);
  for (const id of ["public-page-terms", "inquiry-page", "staff-home", "search-page"]) assert.ok(!ids.includes(id), `${id} measured nothing`);
  const serviceCheck = byId(checks)["uptime-service"];
  assert.deepEqual([serviceCheck.ok, serviceCheck.severity, serviceCheck.slis.length], [false, "sev3", 0]);
  assert.match(serviceCheck.detail, /did not report 4 of 12 pages: public-page-terms \(paused\); search-page \(no monitor with this name\); inquiry-page \(not checked yet\); staff-home \(the monitor watches another address\)/);
});

test("no key, no answer, a refused key, a broken answer: only the service check fails, and the key is never in a result", async () => {
  const none = await run(ctx(service(allUp()).fetch, {}));
  assert.deepEqual(none.map((check) => [check.id, check.ok]), [["uptime-service", false]]);
  assert.match(none[0].detail, /key is not set up \(the secret UPTIMEROBOT_API_KEY/);

  const down = await run(ctx(service(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } })).fetch));
  assert.deepEqual(down.map((check) => [check.id, check.ok, check.status]), [["uptime-service", false, null]]);
  assert.match(down[0].detail, /UptimeRobot did not answer/);

  const refused = await run(ctx(service({ stat: "fail", error: { type: "invalid_parameter", message: `api_key ${KEY} is wrong` } }).fetch));
  assert.match(refused[0].detail, /refused the read \(HTTP 200, invalid_parameter\)/);
  const broken = await run(ctx(service("<html>busy</html>", { status: 503 }).fetch));
  assert.match(broken[0].detail, /refused the read \(HTTP 503\)/);
  for (const checks of [none, down, refused, broken]) assert.ok(!JSON.stringify(checks).includes(KEY), "the key is never filed");
});

test("when the monitor itself loads the pages, the uptime service is not read", async () => {
  const { fetch, calls } = service(allUp());
  assert.deepEqual(await run({ ...ctx(fetch), pageSource: "direct" }), []);
  assert.equal(calls.length, 0);
});

test("readMonitors ignores what it does not know and never throws on a strange answer", () => {
  for (const answer of [null, {}, { monitors: "no" }, { monitors: [null, 7, { friendly_name: 3 }] }]) {
    const { checks, unreported } = readMonitors(answer, T);
    assert.equal(checks.length, 0);
    assert.equal(unreported.length, 12);
  }
  const { checks } = readMonitors({ monitors: [monitor(expectedMonitors(T)[0], { response_times: [{ value: "fast" }] }), { friendly_name: "someone-elses-monitor", url: "https://example.com", status: 9 }] }, T);
  assert.deepEqual(checks.map((check) => [check.id, check.ok, check.latency_ms]), [["public-home", true, null]]);
});

test("a run where nothing answers, the uptime service included, is still a blind run", () => {
  const dead = (id, component = "public-site") => ({ id, name: id, component, severity: "sev2", ok: false, status: null, latency_ms: null, attempts: 1, detail: "No answer.", slis: [], observed: {} });
  assert.equal(isBlindRun({ checks: [dead("outside-dns-probe", "dns"), dead("uptime-service"), dead("api-health", "api"), dead("public-www-redirect")] }), true);
});

test("the setup steps name every monitor, with its address, and the inquiry page's keyword", () => {
  const steps = readFileSync(new URL("docs/sre/needs-from-gbenga.md", repo), "utf8");
  for (const expected of expectedMonitors(T)) {
    assert.ok(steps.includes(`\`${expected.id}\``), `the steps name the monitor ${expected.id}`);
    assert.ok(steps.includes(`\`${expected.url}\``), `the steps give the address ${expected.url}`);
  }
  assert.ok(steps.includes(`\`${FORM_MARKER}\``), "the steps give the inquiry page's keyword");
  assert.ok(steps.includes("UPTIMEROBOT_API_KEY"));
});
