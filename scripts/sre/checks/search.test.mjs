import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { run, suites, framingProblem, IDX_SEARCH_PATH } from "./search.mjs";
import { TARGETS } from "../targets.mjs";

const T = TARGETS.production;
const repo = new URL("../../../", import.meta.url);
const html = { "content-type": "text/html; charset=utf-8" };
const IDX = T.idxOrigin + IDX_SEARCH_PATH;
const ourPage = (frame = `<iframe src="${IDX}?styp=sale"></iframe>`) =>
  `<html><head><link rel="canonical" href="${T.publicOrigin}/search"/></head><body><h1>Search homes</h1>${frame}</body></html>`;

function site(over = {}) {
  const routes = {
    [`${T.publicOrigin}/search`]: { status: 200, headers: html, body: ourPage() },
    [IDX]: { status: 200, headers: html, body: "<html>search</html>" },
    ...over,
  };
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET" });
    const answer = routes[url];
    if (!answer) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    if (answer instanceof Error) throw answer;
    return new Response(answer.body ?? null, { status: answer.status, headers: answer.headers });
  };
  return { fetch, calls };
}

const ctx = (fetch, suite) => ({ fetch, now: () => 0, sleep: async () => {}, targets: T, env: {}, suite });

test("the frame address matches the one the website uses", () => {
  const component = readFileSync(new URL("frontend/src/components/GamlsSearch.jsx", repo), "utf8");
  assert.equal(/GAMLS_SEARCH_URL = '([^']+)'/.exec(component)?.[1], IDX);
});

test("fast: only our own /search page, with the Georgia MLS frame in it; Georgia MLS is not contacted", async () => {
  const { fetch, calls } = site();
  const checks = await run(ctx(fetch, "fast"));
  assert.deepEqual(checks.map((check) => [check.id, check.ok, check.component, check.severity]), [["search-page", true, "search", "sev2"]]);
  assert.deepEqual(calls.map((call) => call.url), [`${T.publicOrigin}/search`]);
  assert.deepEqual(suites, ["fast", "slow", "post-deploy"]);
});

test("a /search page without the frame fails", async () => {
  const { fetch } = site({ [`${T.publicOrigin}/search`]: { status: 200, headers: html, body: ourPage("<p>Search is unavailable</p>") } });
  const [check] = await run(ctx(fetch, "fast"));
  assert.equal(check.ok, false);
  assert.match(check.detail, /Georgia MLS search frame/);
});

test("slow: one GET to Georgia MLS, filed as a sev3 dependency that feeds no SLO", async () => {
  const { fetch, calls } = site();
  const [check] = await run(ctx(fetch, "slow"));
  assert.equal(check.id, "search-idx-provider");
  assert.equal(check.ok, true);
  assert.equal(check.severity, "sev3");
  assert.deepEqual(check.slis, []);
  assert.deepEqual(calls, [{ url: IDX, method: "GET" }]);
});

test("Georgia MLS down: at most two attempts, never three", async () => {
  const { fetch, calls } = site({ [IDX]: { status: 503, headers: html, body: "down" } });
  const [check] = await run(ctx(fetch, "slow"));
  assert.equal(check.ok, false);
  assert.equal(check.detail, "Answered 503, expected 200.");
  assert.equal(calls.length, 2);
});

test("Georgia MLS forbidding the frame fails, in either header", async () => {
  for (const headers of [{ ...html, "x-frame-options": "SAMEORIGIN" }, { ...html, "content-security-policy": "default-src 'self'; frame-ancestors 'self' https://other.example" }]) {
    const { fetch } = site({ [IDX]: { status: 200, headers, body: "<html>" } });
    const [check] = await run(ctx(fetch, "slow"));
    assert.equal(check.ok, false, JSON.stringify(headers));
    assert.match(check.detail, /Georgia MLS now/);
  }
});

test("a frame-ancestors list that includes this site is fine", () => {
  const headers = (policy) => new Headers({ "content-security-policy": policy });
  assert.equal(framingProblem(headers("frame-ancestors https://diamondecho.com"), T.publicOrigin), "");
  assert.equal(framingProblem(headers("frame-ancestors *"), T.publicOrigin), "");
  assert.equal(framingProblem(headers("frame-ancestors https:"), T.publicOrigin), "");
  assert.equal(framingProblem(headers("default-src 'self'"), T.publicOrigin), "");
  assert.equal(framingProblem(new Headers(), T.publicOrigin), "");
  assert.notEqual(framingProblem(headers("frame-ancestors 'none'"), T.publicOrigin), "");
});
