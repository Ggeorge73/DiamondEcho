import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PAGES, UNKNOWN_PATH, homeAssets, hasCanonical, run, suites, outsideDnsProbe, dnsAnswerProblem, OUTSIDE_RESOLVERS, OUTSIDE_NAME } from "./pages.mjs";
import { TARGETS } from "../targets.mjs";

const T = TARGETS.production;
const repo = new URL("../../../", import.meta.url);
const source = (path) => readFileSync(new URL(path, repo), "utf8");

// A saved page as the build writes it: its own canonical address and a heading.
const savedPage = (path, extra = "") =>
  `<!doctype html><html><head><link rel="canonical" href="${T.publicOrigin}${path}"/>`
  + '<script type="module" crossorigin src="/assets/index-Ab12.js"></script>'
  + '<link rel="stylesheet" crossorigin href="/assets/index-Cd34.css"></head>'
  + `<body><h1>A heading</h1>${extra}</body></html>`;

const html = { "content-type": "text/html; charset=utf-8" };
const DNS_OK = JSON.stringify({ Status: 0, Answer: [{ name: "example.com.", type: 1, TTL: 300, data: "93.184.215.14" }] });
const [GOOGLE, CLOUDFLARE] = OUTSIDE_RESOLVERS.map((resolver) => `${resolver.url}?name=${OUTSIDE_NAME}&type=A`);

// The live site as it should be, with any answer replaced through `over`
// (keyed by URL, or "METHOD URL"). An unknown URL fails like a missing host.
function site(over = {}) {
  const routes = {};
  for (const page of PAGES) routes[T.publicOrigin + page.path] = { status: 200, headers: html, body: savedPage(page.path) };
  routes[`${T.publicOrigin}/version.json`] = { status: 200, headers: { "content-type": "application/json" }, body: '{"commit":"59f8d46","built_at":"2026-11-13T00:00:00Z"}' };
  routes[T.publicOrigin + UNKNOWN_PATH] = { status: 404, headers: html, body: "<h1>Page not found</h1>" };
  routes[`${T.wwwOrigin}/about`] = { status: 301, headers: { location: `${T.publicOrigin}/about` } };
  routes[`${T.publicOrigin}/assets/index-Ab12.js`] = { status: 200, headers: { "content-type": "application/javascript" }, body: "export{}" };
  routes[`${T.publicOrigin}/assets/index-Cd34.css`] = { status: 200, headers: { "content-type": "text/css" }, body: "a{}" };
  for (const resolver of OUTSIDE_RESOLVERS) routes[`${resolver.url}?name=${OUTSIDE_NAME}&type=A`] = { status: 200, headers: { "content-type": "application/dns-json" }, body: DNS_OK };
  Object.assign(routes, over);
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET" });
    const answer = routes[`${init.method || "GET"} ${url}`] ?? routes[url];
    if (!answer) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    if (answer instanceof Error) throw answer;
    return new Response(answer.body ?? null, { status: answer.status, headers: answer.headers ?? {} });
  };
  return { fetch, calls };
}

const ctx = (fetch, suite = "fast") => ({ fetch, now: () => 0, sleep: async () => {}, targets: T, env: {}, suite });
const byId = (checks) => Object.fromEntries(checks.map((check) => [check.id, check]));

test("every public page in frontend/src/lib/pageMeta.js is checked, and nothing else", () => {
  const tools = Object.fromEntries([...source("frontend/src/lib/intelligenceTools.js")
    .match(/TOOL_PATHS = Object\.freeze\(\{([^}]*)\}/)[1]
    .matchAll(/'?([\w-]+)'?:\s*'([^']+)'/g)].map(([, key, path]) => [key, path]));
  const listed = [...source("frontend/src/lib/pageMeta.js").matchAll(/\bpage\(\s*('([^']+)'|TOOL_PATHS(?:\.([\w]+)|\['([\w-]+)'\]))/g)]
    .map(([, , literal, dotted, bracketed]) => literal ?? tools[dotted ?? bracketed]);
  assert.ok(listed.length >= 11, "pageMeta.js could not be read: update this test's pattern");
  assert.ok(listed.every(Boolean), "a TOOL_PATHS key in pageMeta.js is unknown");
  assert.deepEqual([...PAGES.map((page) => page.path)].sort(), [...listed].sort(),
    "A page was added to or removed from pageMeta.js: add or remove it in PAGES in scripts/sre/checks/pages.mjs");
});

test("page check ids are stable, unique and filed under a known module", () => {
  const ids = PAGES.map((page) => page.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const page of PAGES) assert.ok(["pages", "search", "calculators", "inquiry"].includes(page.module), page.path);
  assert.deepEqual(suites, ["fast", "post-deploy"]);
});

test("a healthy site passes every check, with GET only, and the home page reports the commit it was built from", async () => {
  const { fetch, calls } = site();
  const checks = await run(ctx(fetch));
  assert.deepEqual(checks.map((check) => check.id), [
    "outside-dns-probe", "public-home", "public-page-agents", "public-page-about", "public-page-podcast", "public-page-privacy", "public-page-terms",
    "public-not-found", "public-www-redirect", "public-asset-js", "public-asset-css",
  ]);
  for (const check of checks) assert.equal(check.ok, true, `${check.id}: ${check.detail}`);
  assert.deepEqual(byId(checks)["public-home"].observed, { commit: "59f8d46" });
  assert.ok(calls.every((call) => call.method === "GET"));
});

test("a site without /version.json is not a failure: the commit is simply not reported", async () => {
  const { fetch } = site({ [`${T.publicOrigin}/version.json`]: { status: 404, headers: html, body: "nope" } });
  const home = byId(await run(ctx(fetch)))["public-home"];
  assert.equal(home.ok, true);
  assert.deepEqual(home.observed, {});
});

test("the empty shell in place of a page fails, and says so", async () => {
  const shell = '<!doctype html><html><head></head><body><div id="root"></div></body></html>';
  const { fetch } = site({ [`${T.publicOrigin}/about`]: { status: 200, headers: html, body: shell } });
  const about = byId(await run(ctx(fetch)))["public-page-about"];
  assert.equal(about.ok, false);
  assert.match(about.detail, /empty shell/);
});

test("another page served in place of this one fails", () => {
  assert.equal(hasCanonical(T.publicOrigin, "/about")(savedPage("/")), false);
  assert.equal(hasCanonical(T.publicOrigin, "/about")(savedPage("/about")), true);
});

test("a home page server error is reported at once (no retry), and the files it would name are not checked and count toward no SLO", async () => {
  const { fetch, calls } = site({ [`${T.publicOrigin}/`]: { status: 502, headers: html, body: "bad gateway" } });
  const checks = byId(await run(ctx(fetch)));
  assert.equal(checks["public-home"].ok, false);
  assert.equal(checks["public-home"].status, 502);
  assert.equal(checks["public-home"].attempts, 1);
  assert.deepEqual(checks["public-home"].slis, ["public-availability", "public-latency"], "the failure itself is measured");
  assert.equal(calls.filter((call) => call.url === `${T.publicOrigin}/`).length, 1);
  for (const id of ["public-asset-js", "public-asset-css"]) {
    assert.equal(checks[id].ok, false);
    assert.match(checks[id].detail, /did not load/);
    assert.deepEqual(checks[id].slis, [], `${id} measured nothing`);
  }
  // The other pages are still checked.
  assert.equal(checks["public-page-about"].ok, true);
});

test("a home page refused by Cloudflare: the refusal is named, and the files it would name say why they were not checked", async () => {
  const block = '<title>Access denied | diamondecho.com used Cloudflare to restrict access</title><span data-translate="error">Error</span> <span>1010</span>';
  const { fetch } = site({ [`${T.publicOrigin}/`]: { status: 403, headers: { ...html, server: "cloudflare", "cf-ray": "abc-ATL" }, body: block } });
  const checks = byId(await run(ctx(fetch)));
  assert.match(checks["public-home"].detail, /^Cloudflare refused the request \(403, error 1010/);
  assert.match(checks["public-asset-js"].detail, /^The home page was refused by Cloudflare, so the file it asks for is not known\. See docs\/sre\/runbooks\/cloudflare-outage\.md\.$/);
});

test("an unknown address that answers 200 fails (search engines would list pages that do not exist)", async () => {
  const { fetch } = site({ [T.publicOrigin + UNKNOWN_PATH]: { status: 200, headers: html, body: savedPage("/") } });
  const notFound = byId(await run(ctx(fetch)))["public-not-found"];
  assert.equal(notFound.ok, false);
  assert.equal(notFound.detail, "Answered 200, expected 404.");
});

test("www pointing anywhere but the same page on the bare domain fails", async () => {
  const { fetch } = site({ [`${T.wwwOrigin}/about`]: { status: 301, headers: { location: `${T.publicOrigin}/` } } });
  assert.equal(byId(await run(ctx(fetch)))["public-www-redirect"].ok, false);
  const { fetch: temporary } = site({ [`${T.wwwOrigin}/about`]: { status: 302, headers: { location: `${T.publicOrigin}/about` } } });
  assert.equal(byId(await run(ctx(temporary)))["public-www-redirect"].detail, "Answered 302, expected 301.");
});

test("a script answered with a page (the usual sign of a missing file) fails", async () => {
  const { fetch } = site({ [`${T.publicOrigin}/assets/index-Ab12.js`]: { status: 200, headers: html, body: savedPage("/") } });
  const script = byId(await run(ctx(fetch)))["public-asset-js"];
  assert.equal(script.ok, false);
  assert.match(script.detail, /Content type is "text\/html/);
});

test("a page that times out fails with the reason; the other pages are still checked", async () => {
  const { fetch } = site({ [`${T.publicOrigin}/`]: new DOMException("timed out", "TimeoutError") });
  const checks = byId(await run(ctx(fetch)));
  assert.match(checks["public-home"].detail, /^No answer: timed out after 10 s\./);
  assert.equal(checks["public-home"].attempts, 3);
  assert.equal(checks["public-page-about"].ok, true);
});

test("a site that does not answer at all fails every check without throwing", async () => {
  const refused = async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); };
  const checks = await run(ctx(refused));
  assert.equal(checks.length, 11);
  assert.ok(checks.every((check) => check.ok === false));
  assert.match(checks[0].detail, /connection was refused/);
});

test("the home page's script and stylesheet are read from the page", () => {
  assert.deepEqual(homeAssets(savedPage("/")), { script: "/assets/index-Ab12.js", style: "/assets/index-Cd34.css" });
  assert.deepEqual(homeAssets("<html></html>"), { script: null, style: null });
});

test("outside-dns-probe: asked first, of a name that is not ours, and passes on a real answer", async () => {
  const { fetch, calls } = site();
  const checks = await run(ctx(fetch));
  const probe = checks[0];
  assert.deepEqual([probe.id, probe.name, probe.component, probe.severity, probe.slis, probe.ok, probe.detail],
    ["outside-dns-probe", "Monitor can reach the internet", "dns", "sev4", [], true, ""]);
  assert.equal(calls[0].url, GOOGLE, "the network is asked about before our pages");
  assert.equal(calls.filter((call) => call.url === CLOUDFLARE).length, 0, "the second resolver is asked only when needed");
});

test("outside-dns-probe sends nothing to our hosts, and only DNS-over-HTTPS GETs", async () => {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", accept: init.headers?.Accept });
    return new Response(DNS_OK, { status: 200 });
  };
  await outsideDnsProbe(ctx(fetch));
  const ours = Object.entries(T).filter(([key]) => key.endsWith("Origin")).map(([, origin]) => new URL(origin).hostname);
  for (const call of calls) {
    const host = new URL(call.url).hostname;
    assert.ok(!ours.includes(host) && !host.endsWith(T.domain), call.url);
    assert.equal(call.method, "GET");
    assert.equal(call.accept, "application/dns-json");
    assert.equal(new URL(call.url).searchParams.get("name"), "example.com");
  }
});

test("outside-dns-probe falls back to the second resolver and says so", async () => {
  const { fetch, calls } = site({ [GOOGLE]: { status: 503, headers: {}, body: "" } });
  const probe = (await run(ctx(fetch)))[0];
  assert.equal(probe.ok, true);
  assert.equal(probe.detail, "Google's resolver did not answer properly (answered 503). Cloudflare's resolver did.");
  assert.equal(calls.filter((call) => call.url === GOOGLE).length, 1, "a wrong answer is not asked again");
});

test("outside-dns-probe fails when neither resolver answers, and the site checks still run", async () => {
  const down = new DOMException("timed out", "TimeoutError");
  const { fetch, calls } = site({ [GOOGLE]: down, [CLOUDFLARE]: down });
  const checks = await run(ctx(fetch));
  const probe = checks[0];
  assert.equal(probe.ok, false);
  assert.equal(probe.severity, "sev4");
  assert.match(probe.detail, /^Neither outside resolver answered: if our own checks failed in this run, the monitor's network is the likely cause, not the site\. /);
  assert.match(probe.detail, /Google's resolver did not answer properly \(no answer: timed out after 3 s\)\. Cloudflare's resolver did not answer properly/);
  assert.ok(probe.detail.length <= 300);
  // "Nothing answered" is tried once more per resolver, no more.
  assert.equal(calls.filter((call) => call.url === GOOGLE).length, 2);
  assert.equal(calls.filter((call) => call.url === CLOUDFLARE).length, 2);
  assert.equal(probe.attempts, 4);
  assert.equal(checks.find((check) => check.id === "public-home").ok, true);
});

test("a DNS answer is judged by its content, not only its status", () => {
  assert.equal(dnsAnswerProblem(JSON.parse(DNS_OK)), "");
  assert.equal(dnsAnswerProblem({ Status: 2 }), "answered DNS status 2");
  assert.equal(dnsAnswerProblem({ Status: 0, Answer: [] }), "gave no address");
  assert.equal(dnsAnswerProblem(null), "did not answer in DNS JSON");
});
