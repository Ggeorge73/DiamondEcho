import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { run, suites, ANALYZE_REQUEST, EXPECTED_FLIP_PROFIT, analysisProblem } from "./calculators.mjs";
import { pagesFor } from "./pages.mjs";
import { TARGETS } from "../targets.mjs";

const T = TARGETS.production;
const repo = new URL("../../../", import.meta.url);
const html = { "content-type": "text/html; charset=utf-8" };
const json = { "content-type": "application/json" };
const ANALYZE = `${T.apiOrigin}/api/v1/deals/analyze`;
const savedPage = (path) => `<html><head><link rel="canonical" href="${T.publicOrigin}${path}"/></head><body><h1>Tool</h1></body></html>`;
const analysis = (over = {}) => JSON.stringify({ formula_version: "diamond-underwriting-1.4.0", metrics: { flip_profit: { value: 44_800 } }, ...over });

function site(over = {}) {
  const routes = { [`POST ${ANALYZE}`]: { status: 200, headers: json, body: analysis() } };
  for (const page of pagesFor("calculators")) routes[`GET ${T.publicOrigin}${page.path}`] = { status: 200, headers: html, body: savedPage(page.path) };
  Object.assign(routes, over);
  const calls = [];
  const fetch = async (url, init = {}) => {
    const method = init.method || "GET";
    calls.push({ url, method, headers: init.headers, body: init.body });
    const answer = routes[`${method} ${url}`];
    if (!answer) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    return new Response(answer.body ?? null, { status: answer.status, headers: answer.headers });
  };
  return { fetch, calls };
}

const ctx = (fetch) => ({ fetch, now: () => 0, sleep: async () => {}, targets: T, env: {}, suite: "fast" });
const byId = (checks) => Object.fromEntries(checks.map((check) => [check.id, check]));

test("a healthy calculator area passes: three pages and one reference calculation", async () => {
  const { fetch, calls } = site();
  const checks = await run(ctx(fetch));
  assert.deepEqual(checks.map((check) => check.id), ["calculators-deal-page", "calculators-mortgage-page", "calculators-net-sheet-page", "calculators-api-analyze"]);
  for (const check of checks) assert.equal(check.ok, true, `${check.id}: ${check.detail}`);
  assert.deepEqual(suites, ["fast", "post-deploy"]);
  // The pages feed the calculators SLO. The analysis call feeds API
  // availability instead: the calculators still work in the browser when the
  // API is down (scripts/sre/slo.config.mjs).
  for (const check of checks) {
    const expected = check.id === "calculators-api-analyze" ? ["api-availability"] : ["calculators-availability"];
    assert.deepEqual(check.slis, expected, check.id);
  }
  // The analysis is sent the way the website sends it.
  const post = calls.find((call) => call.method === "POST");
  assert.equal(post.headers["Content-Type"], "application/json");
  assert.equal(post.headers.Origin, T.publicOrigin);
  assert.deepEqual(JSON.parse(post.body), ANALYZE_REQUEST);
});

test("the one POST goes to the analysis route and nowhere else: never the limited or paid routes", async () => {
  const { fetch, calls } = site();
  await run(ctx(fetch));
  const posts = calls.filter((call) => call.method !== "GET");
  assert.deepEqual(posts.map((call) => `${call.method} ${call.url}`), [`POST ${ANALYZE}`]);
  for (const call of calls) assert.doesNotMatch(new URL(call.url).pathname, /scenarios|sensitivity|monte-carlo|properties|inquiries/);
});

test("a wrong figure fails and names both figures", async () => {
  const { fetch } = site({ [`POST ${ANALYZE}`]: { status: 200, headers: json, body: analysis({ metrics: { flip_profit: { value: 41_000 } } }) } });
  const check = byId(await run(ctx(fetch)))["calculators-api-analyze"];
  assert.equal(check.ok, false);
  assert.match(check.detail, /41000\.00, expected 44800\.00/);
  assert.equal(check.severity, "sev2");
});

test("an answer without a formula version, or not JSON, fails", () => {
  assert.equal(analysisProblem({ metrics: { flip_profit: { value: 44_800 } } }), "The answer carries no formula version.");
  assert.equal(analysisProblem(null), "The answer is not JSON.");
  assert.match(analysisProblem({ formula_version: "diamond-underwriting-1.0.0", metrics: {} }), /came back as nothing/);
  assert.equal(analysisProblem(JSON.parse(analysis())), "");
});

test("a refused or failing calculation fails at once; only no answer at all is tried once more", async () => {
  const { fetch } = site({ [`POST ${ANALYZE}`]: { status: 422, headers: json, body: '{"detail":"invalid"}' } });
  assert.equal(byId(await run(ctx(fetch)))["calculators-api-analyze"].detail, "Answered 422, expected 200.");
  const { fetch: broken, calls } = site({ [`POST ${ANALYZE}`]: { status: 500, headers: json, body: "{}" } });
  const check = byId(await run(ctx(broken)))["calculators-api-analyze"];
  assert.equal(check.ok, false);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1, "a server error is not hidden by a retry");
  const { fetch: silent, calls: tries } = site({ [`POST ${ANALYZE}`]: undefined });
  const unanswered = byId(await run(ctx(silent)))["calculators-api-analyze"];
  assert.equal(unanswered.attempts, 2);
  assert.equal(tries.filter((call) => call.method === "POST").length, 2);
});

test("a calculator page that fails is reported under the calculators, not the website", async () => {
  const { fetch } = site({ [`GET ${T.publicOrigin}/seller-net-sheet`]: { status: 404, headers: html, body: "not found" } });
  const check = byId(await run(ctx(fetch)))["calculators-net-sheet-page"];
  assert.equal(check.ok, false);
  assert.equal(check.component, "calculators");
});

test("the reference deal and its figure are the ones the backend's own test pins", () => {
  // backend/tests/deal_intelligence/test_engine.py,
  // test_flip_profit_includes_all_equity_costs. If that test's figures move,
  // move ANALYZE_REQUEST and EXPECTED_FLIP_PROFIT with them.
  const python = readFileSync(new URL("backend/tests/deal_intelligence/test_engine.py", repo), "utf8");
  const body = /def test_flip_profit_includes_all_equity_costs\(\):([\s\S]*?)\n\ndef /.exec(python)?.[1];
  assert.ok(body, "the backend test this check mirrors was renamed or removed");
  const numbers = (text) => [...text.matchAll(/(?<![\w.])\d[\d_]*(?:\.\d+)?/g)].map(([n]) => Number(n.replaceAll("_", "")));
  const requestPart = body.slice(0, body.indexOf("result = analyze_deal"));
  const sent = [];
  JSON.stringify(ANALYZE_REQUEST, (key, value) => { if (typeof value === "number") sent.push(value); return value; });
  assert.deepEqual(numbers(requestPart).sort((a, b) => a - b), sent.sort((a, b) => a - b));
  assert.match(body, /\["flip_profit"\]\.value == pytest\.approx\(44_800\)/);
  assert.equal(EXPECTED_FLIP_PROFIT, 44_800);
  assert.match(requestPart, /strategy="flip"/);
  assert.match(requestPart, /"property_type": "single_family"/);
});
