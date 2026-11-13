// Tests for edge.mjs. No test reaches the site or a resolver: fetch and the
// DNS-over-HTTPS transport are fakes, and lib/http.mjs's pauses are skipped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRun } from "../lib/schema.mjs";
import { TARGETS } from "../targets.mjs";
import { run, suites, cloudflareRefusal, ANALYTICS_MARKERS } from "./edge.mjs";

const NOW = Date.parse("2026-11-13T12:00:00Z");
const CLEAN_HOME = "<!doctype html><html><head><title>DiamondEcho</title></head><body><div id=\"root\">Metro Atlanta</div></body></html>";
// Cloudflare's "Access denied" page, cut down to the parts the module reads.
// It prints the requester's address; the test checks that it is never copied.
const BLOCK_PAGE = `<!doctype html><title>Access denied | diamondecho.com used Cloudflare to restrict access</title>
<div id="cf-error-details"><span data-translate="error">Error</span>
<span>1010</span><p>The owner of this website (diamondecho.com) has banned your access based on your browser's signature.</p>
<span id="cf-footer-ip">203.0.113.77</span></div>`;

const redirect = (location) => new Response(null, { status: 301, headers: { location, server: "cloudflare" } });
const page = (body, headers = {}) => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "strict-transport-security": "max-age=15552000", server: "cloudflare", ...headers } });

// The site as it answers today (with a user agent Cloudflare lets through).
const healthy = {
  "http://diamondecho.com/": () => redirect("https://diamondecho.com/"),
  "https://diamondecho.com/": () => page(CLEAN_HOME),
  "https://www.diamondecho.com/search": () => redirect("https://diamondecho.com/search"),
};

function zone({ ds = [], caa = [], down = false } = {}) {
  return async ({ type }) => {
    if (down) throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    return { rcode: 0, answers: type === "DS" ? ds : type === "CAA" ? caa : [] };
  };
}

function ctxWith(routes = {}, over = {}) {
  const site = { ...healthy, ...routes };
  const calls = [];
  return {
    calls,
    ctx: {
      fetch: async (url, init) => {
        calls.push({ url, method: init.method, redirect: init.redirect, ua: init.headers["User-Agent"] });
        const answer = site[url];
        if (!answer) throw new Error(`test site has no route for ${url}`);
        return answer();
      },
      now: () => NOW, sleep: async () => {}, targets: TARGETS.production, env: {}, dohQuery: zone(), ...over,
    },
  };
}
const byId = (checks, id) => checks.find((check) => check.id === id);

test("runs hourly and after every deploy", () => {
  assert.deepEqual(suites, ["slow", "post-deploy"]);
});

test("the edge as it is today passes and makes a valid run", async () => {
  const { ctx, calls } = ctxWith();
  const checks = await run(ctx);
  assert.deepEqual(checks.map((check) => [check.id, check.ok, check.component, check.severity]), [
    ["edge-http-redirect", true, "public-site", "sev3"],
    ["edge-hsts", true, "public-site", "sev3"],
    ["edge-www-redirect", true, "public-site", "sev3"],
    ["edge-no-analytics-beacon", true, "public-site", "sev3"],
    ["edge-dnssec", true, "dns", "sev4"],
    ["edge-caa", true, "dns", "sev4"],
  ]);
  assert.deepEqual(byId(checks, "edge-hsts").observed, { "max-age": "15552000" });
  for (const check of checks) assert.deepEqual(check.slis, []);
  makeRun({ suite: "slow", started_at: "2026-11-13T12:00:00Z", finished_at: "2026-11-13T12:00:01Z", checks });
});

test("only three GETs reach the site, none follows a redirect, all carry the monitor's name", async () => {
  const { ctx, calls } = ctxWith();
  await run(ctx);
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.method, "GET");
    assert.equal(call.redirect, "manual");
    assert.match(call.ua, /DiamondEcho-SRE-Monitor/);
  }
});

test("plain http served without a redirect fails", async () => {
  const { ctx } = ctxWith({ "http://diamondecho.com/": () => page(CLEAN_HOME) });
  const check = byId(await run(ctx), "edge-http-redirect");
  assert.equal(check.ok, false);
  assert.match(check.detail, /answered 200 instead of redirecting to https:\/\/diamondecho\.com\//);
});

test("www sending a deep link to the home page fails; the query string is never copied", async () => {
  const { ctx } = ctxWith({ "https://www.diamondecho.com/search": () => redirect("https://diamondecho.com/?ref=private-token#x") });
  const check = byId(await run(ctx), "edge-www-redirect");
  assert.equal(check.ok, false);
  assert.match(check.detail, /redirects to https:\/\/diamondecho\.com\/, not to https:\/\/diamondecho\.com\/search/);
  assert.doesNotMatch(check.detail, /private-token/);
});

test("a redirect that keeps its query string still passes", async () => {
  const { ctx } = ctxWith({ "https://www.diamondecho.com/search": () => redirect("https://diamondecho.com/search?a=1") });
  assert.equal(byId(await run(ctx), "edge-www-redirect").ok, true);
});

test("HSTS missing, or switched off with max-age=0, fails", async () => {
  const missing = ctxWith({ "https://diamondecho.com/": () => new Response(CLEAN_HOME, { status: 200 }) });
  const check = byId(await run(missing.ctx), "edge-hsts");
  assert.equal(check.ok, false);
  assert.match(check.detail, /without a Strict-Transport-Security header/);
  const off = ctxWith({ "https://diamondecho.com/": () => page(CLEAN_HOME, { "strict-transport-security": "max-age=0" }) });
  assert.match(byId(await run(off.ctx), "edge-hsts").detail, /switches the protection off \(max-age 0\)/);
  const junk = ctxWith({ "https://diamondecho.com/": () => page(CLEAN_HOME, { "strict-transport-security": "includeSubDomains" }) });
  assert.match(byId(await run(junk.ctx), "edge-hsts").detail, /max-age missing/);
});

test("the Cloudflare analytics beacon back in the page fails and says where to switch it off", async () => {
  const beacon = `${CLEAN_HOME}<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"x"}'></script>`;
  const { ctx } = ctxWith({ "https://diamondecho.com/": () => page(beacon) });
  const check = byId(await run(ctx), "edge-no-analytics-beacon");
  assert.equal(check.ok, false);
  assert.match(check.detail, /the Cloudflare analytics beacon/);
  assert.match(check.detail, /Real User Monitoring, "Disable completely"/);
  assert.doesNotMatch(check.detail, /token/);
});

test("Google Analytics in the page fails too", async () => {
  const { ctx } = ctxWith({ "https://diamondecho.com/": () => page(`${CLEAN_HOME}<script src="https://www.googletagmanager.com/gtag/js?id=G-X"></script>`) });
  assert.match(byId(await run(ctx), "edge-no-analytics-beacon").detail, /Google Analytics or Tag Manager/);
  assert.equal(ANALYTICS_MARKERS.length, 2);
});

test("Cloudflare's bot-detection script is noted, not failed", async () => {
  const withBot = `${CLEAN_HOME}<script>var u='/cdn-cgi/challenge-platform/scripts/jsd/main.js';</script>`;
  const { ctx } = ctxWith({ "https://diamondecho.com/": () => page(withBot) });
  const check = byId(await run(ctx), "edge-no-analytics-beacon");
  assert.equal(check.ok, true);
  assert.deepEqual(check.observed, { "bot-script": "present" });
  assert.match(check.detail, /bot-detection script/);
});

test("a home page that does not answer 200 is not read for scripts", async () => {
  const { ctx } = ctxWith({ "https://diamondecho.com/": () => new Response("<html>oops</html>", { status: 404, headers: { "strict-transport-security": "max-age=15552000" } }) });
  assert.match(byId(await run(ctx), "edge-no-analytics-beacon").detail, /answered 404, so the page was not read/);
});

test("Cloudflare's 1010 block page is named as a block of the monitor, and the address on it is never copied", async () => {
  const block = () => new Response(BLOCK_PAGE, { status: 403, headers: { server: "cloudflare", "content-type": "text/html" } });
  const { ctx } = ctxWith({ "http://diamondecho.com/": block, "https://diamondecho.com/": block });
  const checks = await run(ctx);
  for (const id of ["edge-http-redirect", "edge-hsts", "edge-no-analytics-beacon"]) {
    const check = byId(checks, id);
    assert.equal(check.ok, false, id);
    assert.equal(check.status, 403);
    assert.match(check.detail, /^Cloudflare refused the request \(403, error 1010: the browser signature check, usually Browser Integrity Check\): .*cloudflare-outage\.md/);
    assert.deepEqual(check.observed, { "cloudflare-refusal": "1010" });
    assert.doesNotMatch(check.detail, /203\.0\.113\.77/);
  }
  assert.equal(byId(checks, "edge-www-redirect").ok, true);
});

test("a challenge page (cf-mitigated) is named as a Cloudflare setting stopping the monitor", async () => {
  const { ctx } = ctxWith({ "https://diamondecho.com/": () => new Response("<html>Just a moment...</html>", { status: 403, headers: { "cf-mitigated": "challenge" } }) });
  const check = byId(await run(ctx), "edge-hsts");
  assert.equal(check.ok, false);
  assert.match(check.detail, /answered the monitor with a "challenge" page instead of the site \(status 403\)/);
  assert.deepEqual(check.observed, { "cloudflare-refusal": "challenge" });
});

test("cloudflareRefusal ignores ordinary errors and reads other block codes", () => {
  const result = (status, body, headers = {}) => ({ answered: true, status, body, headers: new Headers(headers) });
  assert.equal(cloudflareRefusal(result(403, "<html>Forbidden</html>")), null);
  assert.equal(cloudflareRefusal(result(200, BLOCK_PAGE)), null);
  assert.equal(cloudflareRefusal({ answered: false, status: null, body: "", headers: new Headers() }), null);
  const waf = cloudflareRefusal(result(403, BLOCK_PAGE.replace("<span>1010</span>", "<span>1020</span>")));
  assert.equal(waf.code, "1020");
  assert.match(waf.text, /^Cloudflare refused the request \(403, error 1020\)/);
  // Cloudflare's 5xx pages share the cf-error-details block: an outage, not a refusal.
  assert.equal(cloudflareRefusal(result(503, BLOCK_PAGE)), null);
  assert.equal(cloudflareRefusal(result(522, '<div id="cf-error-details">Connection timed out</div>')), null);
  const nameless = cloudflareRefusal(result(429, "<title>Attention Required! | Cloudflare</title>"));
  assert.equal(nameless.code, "unknown");
  assert.match(nameless.text, /^Cloudflare refused the request \(429\): /);
});

test("no answer at all is 'not checked', after one retry (so a hanging site cannot outlast the runner's limit)", async () => {
  const dropped = () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }); };
  const { ctx, calls } = ctxWith({ "http://diamondecho.com/": dropped });
  const check = byId(await run(ctx), "edge-http-redirect");
  assert.equal(check.ok, false);
  assert.equal(check.status, null);
  assert.equal(check.attempts, 2);
  assert.match(check.detail, /Could not reach http:\/\/diamondecho\.com\/ \(the connection was cut\), so this was not checked/);
  assert.equal(calls.filter((call) => call.url === "http://diamondecho.com/").length, 2);
});

test("DNSSEC and CAA: present, absent and unknown are all information only", async () => {
  const on = await run(ctxWith({}, { dohQuery: zone({ ds: ["2371 13 2 ABCDEF"], caa: ['0 issue "letsencrypt.org"'] }) }).ctx);
  assert.deepEqual(byId(on, "edge-dnssec").observed, { dnssec: "present" });
  assert.deepEqual(byId(on, "edge-caa").observed, { caa: "present" });
  const off = await run(ctxWith().ctx);
  assert.match(byId(off, "edge-dnssec").detail, /not switched on/);
  assert.match(byId(off, "edge-caa").detail, /No CAA record/);
  const blind = await run(ctxWith({}, { dohQuery: zone({ down: true }) }).ctx);
  for (const checks of [on, off, blind]) {
    for (const id of ["edge-dnssec", "edge-caa"]) {
      assert.equal(byId(checks, id).ok, true);
      assert.equal(byId(checks, id).severity, "sev4");
    }
  }
  assert.deepEqual(byId(blind, "edge-dnssec").observed, { dnssec: "unknown" });
  assert.equal(byId(blind, "edge-dnssec").attempts, 2);
});

test("the DNS questions go out before the first page request", async () => {
  const order = [];
  const { ctx } = ctxWith({}, { dohQuery: async ({ type }) => { order.push(`dns ${type}`); return { rcode: 0, answers: [] }; } });
  const fetch = ctx.fetch;
  ctx.fetch = (url, init) => { order.push(`get ${url}`); return fetch(url, init); };
  await run(ctx);
  // Each question goes to both resolvers: four DNS questions, then the pages.
  assert.deepEqual(order.slice(0, 4).sort(), ["dns CAA", "dns CAA", "dns DS", "dns DS"]);
  assert.equal(order.filter((entry) => entry.startsWith("get")).length, 3);
});

test("a Cloudflare 5xx outage page is reported as the status it is, not as a security block", async () => {
  const outage = () => new Response('<html><div id="cf-error-details"><span data-translate="error">Error</span> <span>522</span></div></html>', { status: 522, headers: { server: "cloudflare" } });
  const { ctx } = ctxWith({ "https://diamondecho.com/": outage });
  const checks = await run(ctx);
  const beacon = byId(checks, "edge-no-analytics-beacon");
  assert.equal(beacon.ok, false);
  assert.equal(beacon.status, 522);
  assert.match(beacon.detail, /answered 522, so the page was not read/);
  assert.doesNotMatch(beacon.detail, /security setting/);
  assert.doesNotMatch(byId(checks, "edge-hsts").detail, /security setting/);
});
