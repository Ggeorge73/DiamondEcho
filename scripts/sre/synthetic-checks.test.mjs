import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODULES, AZURE_REGION_URL, MODULE_TIME_LIMIT_MS, RUN_TIME_LIMIT_MS, runSuite, main, makeClock, detectVantage, safeMessage, summary } from "./synthetic-checks.mjs";
import { request } from "./lib/http.mjs";
import { runProblems } from "./lib/schema.mjs";

const NOW = "2026-11-13T00:00:00.000Z";
const env = { SRE_NOW: NOW };
const noFetch = async () => { throw new Error("this test must not touch the network"); };

const check = (id, ok = true, over = {}) => ({ id, name: `Check ${id}`, component: "public-site", severity: "sev2", ok, status: ok ? 200 : 500, latency_ms: 5, detail: ok ? "" : "Answered 500, expected 200.", attempts: 1, slis: [], ...over });
const fakeModule = (suites, checks) => ({ suites, run: async () => checks });

// A module loader that serves fake modules by name; an unlisted name is
// "missing", as a deleted file would be.
const loader = (modules) => async (name) => {
  if (!(name in modules)) throw Object.assign(new Error(`Cannot find module '/x/checks/${name}.mjs'`), { code: "ERR_MODULE_NOT_FOUND" });
  const module = modules[name];
  if (module instanceof Error) throw module;
  return module;
};

const quiet = { env, fetch: noFetch, sleep: async () => {}, vantage: { provider: "local", region: null } };

test("the module list is the contract's fixed list, in order", () => {
  assert.deepEqual(MODULES, ["pages", "uptime", "api", "calculators", "inquiry", "search", "staff", "tls", "dns", "domain", "edge"]);
});

test("only the modules of the suite run, in order, into one valid run document", async () => {
  const run = await runSuite({ ...quiet, suite: "fast", modules: ["pages", "tls"], loadModule: loader({
    pages: fakeModule(["fast"], [check("public-home"), check("public-page-about")]),
    tls: fakeModule(["slow"], [check("tls-public")]),
  }) });
  assert.deepEqual(runProblems(run), []);
  assert.deepEqual(run.checks.map((c) => c.id), ["public-home", "public-page-about"]);
  assert.equal(run.suite, "fast");
  assert.equal(run.started_at, NOW);
  assert.equal(run.commit, null);
});

test("a missing module is reported as a failed sev3 check of its own and the others still run", async () => {
  const run = await runSuite({ ...quiet, suite: "slow", modules: ["api", "tls", "dns"], loadModule: loader({
    api: fakeModule(["slow"], [check("api-docs-off")]),
    dns: fakeModule(["slow"], [check("dns-apex-resolves")]),
  }) });
  assert.deepEqual(run.checks.map((c) => [c.id, c.ok]), [["api-docs-off", true], ["monitor-tls", false], ["dns-apex-resolves", true]]);
  const missing = run.checks[1];
  assert.equal(missing.severity, "sev3");
  assert.equal(missing.component, "tls");
  assert.deepEqual(missing.slis, []);
  assert.match(missing.detail, /file is missing/);
});

test("a module that throws, cannot load, or exports the wrong shape costs only its own checks", async () => {
  const logged = [];
  const run = await runSuite({ ...quiet, log: (line) => logged.push(line), suite: "fast", modules: ["pages", "api", "search", "staff"], loadModule: loader({
    pages: { suites: ["fast"], run: async () => { throw new TypeError("Cannot read properties of undefined (reading 'x') at https://secret.example/?token=abc"); } },
    api: new SyntaxError("Unexpected token"),
    search: { suites: "fast", run: () => [] },
    staff: fakeModule(["fast"], [check("staff-home")]),
  }) });
  const byId = Object.fromEntries(run.checks.map((c) => [c.id, c]));
  assert.equal(byId["monitor-pages"].ok, false);
  assert.match(byId["monitor-pages"].detail, /stopped with an error \(TypeError: Cannot read properties/);
  assert.doesNotMatch(byId["monitor-pages"].detail, /secret|token/);
  assert.equal(byId["monitor-api"].component, "api");
  assert.match(byId["monitor-api"].detail, /could not be loaded/);
  assert.match(byId["monitor-search"].detail, /does not export suites and run/);
  assert.equal(byId["staff-home"].ok, true);
  assert.ok(logged.length >= 2);
});

test("a module that returns results outside the contract, or reuses an id, is reported", async () => {
  const run = await runSuite({ ...quiet, suite: "fast", modules: ["pages", "api", "calculators"], loadModule: loader({
    pages: fakeModule(["fast"], [check("public-home")]),
    api: fakeModule(["fast"], [check("public-home")]),
    calculators: fakeModule(["fast"], [check("Not Kebab")]),
  }) });
  assert.deepEqual(run.checks.map((c) => c.id), ["public-home", "monitor-api", "monitor-calculators"]);
  assert.match(run.checks[1].detail, /reused the check id public-home/);
  assert.match(run.checks[2].detail, /outside the contract/);
  const notList = await runSuite({ ...quiet, suite: "fast", modules: ["pages"], loadModule: loader({ pages: { suites: ["fast"], run: async () => ({}) } }) });
  assert.match(notList.checks[0].detail, /something other than a list/);
});

test("a module that never finishes is cut off at its time limit and reported", async () => {
  const run = await runSuite({ ...quiet, suite: "fast", modules: ["dns", "staff"], timeLimitMs: 20, graceMs: 20, loadModule: loader({
    dns: { suites: ["fast"], run: () => new Promise(() => {}) },
    staff: fakeModule(["fast"], [check("staff-home")]),
  }) });
  assert.deepEqual(run.checks.map((c) => [c.id, c.ok]), [["monitor-dns", false], ["staff-home", true]]);
  assert.match(run.checks[0].detail, /^Monitor fault, not the site: .*did not finish within 0 s/);
});

test("a public site that swallows every connection: public-home still comes back sev1 and failed, inside the time limit", async () => {
  // The edge review's case. Every diamondecho.com host accepts the connection
  // and never answers; a request ends only when its signal fires. The wider
  // internet still answers (the outside DNS probe passes), as it does when
  // the site, not the monitor, is the problem.
  // Counts what is sent after the first request was cut off: the deadline
  // has passed by then, so it must stay 0.
  let cutOff = false;
  let sentAfterCutOff = 0;
  const hanging = async (url, init) => {
    if (!url.includes("diamondecho")) return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: "192.0.2.1" }] }), { status: 200 });
    if (cutOff) sentAfterCutOff += 1;
    return new Promise((_, reject) => init.signal.addEventListener("abort", () => { cutOff = true; reject(init.signal.reason); }));
  };
  const limit = 400;
  const started = Date.now();
  const run = await runSuite({ env: { SRE_PAGE_SOURCE: "direct" }, fetch: hanging, sleep: async () => {}, suite: "fast", modules: ["pages"], timeLimitMs: limit, graceMs: 2000, vantage: { provider: "local", region: null } });
  const elapsed = Date.now() - started;
  // Without the deadline this run takes about 94 s (our hosts hang, the
  // outside probe passes at once); the margin only absorbs
  // a slow machine.
  assert.ok(elapsed < limit + 3000, `took ${elapsed} ms`);
  const byId = Object.fromEntries(run.checks.map((c) => [c.id, c]));
  assert.equal(byId["monitor-pages"], undefined, "the module handed in its own checks");
  assert.equal(byId["outside-dns-probe"].ok, true);
  const home = byId["public-home"];
  assert.deepEqual([home.severity, home.ok, home.component], ["sev1", false, "public-site"]);
  assert.match(home.detail, /^No answer: the module's time ran out while waiting\./);
  assert.deepEqual(home.slis, ["public-availability", "public-latency"], "the home page was measured: it did not answer");
  for (const id of ["public-page-about", "public-not-found", "public-www-redirect"]) {
    assert.equal(byId[id].ok, false, id);
    assert.equal(byId[id].detail, "Not tried: the module's time ran out.", id);
    assert.deepEqual(byId[id].slis, [], id);
  }
  assert.equal(byId["public-www-redirect"].severity, "sev2", "each check keeps its own severity");
  assert.equal(cutOff, true);
  assert.equal(sentAfterCutOff, 0, "nothing was sent after the deadline");
});

test("a module that overruns its time sends nothing more once the runner has moved on", async () => {
  const calls = [];
  const fetch = async (url) => { calls.push(url); return new Response("ok"); };
  let late;
  const finished = new Promise((done) => {
    const overrun = { suites: ["fast"], run: async (ctx) => {
      await new Promise((wait) => setTimeout(wait, 80));
      late = await request(ctx, "https://diamondecho.com/late");
      done();
      return [check("public-home")];
    } };
    runSuite({ ...quiet, fetch, now: Date.now, env: {}, suite: "fast", modules: ["pages"], timeLimitMs: 20, graceMs: 20, loadModule: loader({ pages: overrun }) })
      .then((run) => assert.match(run.checks[0].detail, /did not finish/));
  });
  await finished;
  assert.deepEqual(calls, []);
  assert.equal(late.notTried, true);
});

test("the worst case in the runner's comment fits: per-module and whole-run limits inside the workflow's 10 minutes", () => {
  // pages module, nothing answers at all: outside DNS probe 2 x (3 + 0.5 + 3) = 13 s,
  // home 32 s (measured by 45 s), 6 x 5 s on the quiet host, www 32 s = 107 s,
  // so the last checks are cut short at the 90 s module limit and filed "not tried".
  const probe = 2 * (3 + 0.5 + 3);
  assert.equal(probe + 32 + 6 * 5 + 32, 107);
  assert.ok(probe + 32 < MODULE_TIME_LIMIT_MS / 1000, "the home page is always measured");
  assert.ok(MODULE_TIME_LIMIT_MS < 107_000);
  assert.ok(RUN_TIME_LIMIT_MS + MODULE_TIME_LIMIT_MS + 5_000 < 600_000);
});

test("once the run has used its time, the remaining modules are reported as not run", async () => {
  let clock = 0;
  const slow = { suites: ["fast"], run: async () => { clock += 500; return [check("public-home")]; } };
  const run = await runSuite({ ...quiet, now: () => clock, suite: "fast", modules: ["pages", "api"], runLimitMs: 400, loadModule: loader({
    pages: slow, api: fakeModule(["fast"], [check("api-health")]),
  }) });
  assert.deepEqual(run.checks.map((c) => [c.id, c.ok]), [["public-home", true], ["monitor-api", false]]);
  assert.match(run.checks[1].detail, /had used its 0 s/);
});

test("modules get the contract's ctx: fetch, now, targets, env, plus the suite and a sleep", async () => {
  let seen;
  await runSuite({ ...quiet, suite: "post-deploy", modules: ["pages"], loadModule: loader({ pages: { suites: ["post-deploy"], run: async (ctx) => { seen = ctx; return [check("public-home")]; } } }) });
  assert.equal(seen.fetch, noFetch);
  assert.equal(typeof seen.now, "function");
  assert.equal(seen.targets.publicOrigin, "https://diamondecho.com");
  assert.equal(seen.env, env);
  assert.equal(seen.suite, "post-deploy");
  assert.equal(typeof seen.sleep, "function");
});

test("SRE_NOW sets the clock but time still moves at the real pace", () => {
  let real = 1_000;
  const now = makeClock({ SRE_NOW: NOW }, () => real);
  assert.equal(new Date(now()).toISOString(), NOW);
  real += 250;
  assert.equal(now() - Date.parse(NOW), 250);
  // Time that passes between making the clock and first reading it (on a
  // busy CI runner, a millisecond or more) does not move the start.
  const late = makeClock({ SRE_NOW: NOW }, () => real);
  real += 7;
  assert.equal(new Date(late()).toISOString(), NOW);
  assert.throws(() => makeClock({ SRE_NOW: "yesterday" }), /SRE_NOW is not an ISO time/);
  const plain = () => 42;
  assert.equal(makeClock({}, plain), plain);
});

test("vantage: GitHub's region comes from Azure's metadata service, asked with one second to answer", async () => {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init }); return new Response("eastus\n", { status: 200 }); };
  assert.deepEqual(await detectVantage({ GITHUB_ACTIONS: "true" }, fetch), { provider: "github-actions", region: "eastus" });
  assert.equal(calls[0].url, AZURE_REGION_URL);
  assert.equal(calls[0].init.headers.Metadata, "true");
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test("vantage: no metadata answer, or a strange one, leaves the region unknown; off GitHub nothing is asked", async () => {
  const failing = async () => { throw new DOMException("timed out", "TimeoutError"); };
  assert.deepEqual(await detectVantage({ GITHUB_ACTIONS: "true" }, failing), { provider: "github-actions", region: null });
  const odd = async () => new Response("<html>not a region</html>", { status: 200 });
  assert.deepEqual(await detectVantage({ GITHUB_ACTIONS: "true" }, odd), { provider: "github-actions", region: null });
  assert.deepEqual(await detectVantage({}, noFetch), { provider: "local", region: null });
});

test("the commit is taken from GITHUB_SHA only when it looks like one", async () => {
  const modules = { modules: ["pages"], loadModule: loader({ pages: fakeModule(["fast"], [check("public-home")]) }) };
  const sha = "59f8d46a8e0c6e3b0d1f2a3b4c5d6e7f8a9b0c1d";
  assert.equal((await runSuite({ ...quiet, ...modules, suite: "fast", env: { ...env, GITHUB_SHA: sha } })).commit, sha);
  assert.equal((await runSuite({ ...quiet, ...modules, suite: "fast", env: { ...env, GITHUB_SHA: "not a commit" } })).commit, null);
});

test("error text put in a result carries no addresses and stays on one line", () => {
  assert.equal(safeMessage(new Error("failed at https://a.example/x?token=1\nmore")), "Error: failed at an address");
  assert.ok(safeMessage(new Error("x".repeat(500))).length <= 160);
});

test("the summary is one line per check and a total", async () => {
  const run = await runSuite({ ...quiet, suite: "fast", modules: ["pages"], loadModule: loader({ pages: fakeModule(["fast"], [check("public-home"), check("public-page-about", false)]) }) });
  const lines = summary(run).split("\n");
  assert.equal(lines.length, 3);
  assert.match(lines[1], /^FAIL\s+sev2\s+public-page-about\s+500\s+5 ms\s+Answered 500/);
  assert.equal(lines[2], "fast run from local: 2 checks, 1 passed, 1 failed.");
});

function cli(argv, modules, extraEnv = {}) {
  const out = [];
  const err = [];
  return main(argv, {
    env: { ...env, ...extraEnv }, stdout: (t) => out.push(t), stderr: (t) => err.push(t),
    run: { fetch: noFetch, sleep: async () => {}, modules: Object.keys(modules), loadModule: loader(modules) },
  }).then((code) => ({ code, out: out.join("\n"), err: err.join("\n") }));
}

test("command: writes the run and exits 0, even when a check failed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sre-synthetic-"));
  const file = join(dir, "nested", "run.json");
  const { code, out } = await cli(["--suite", "fast", "--out", file], { pages: fakeModule(["fast"], [check("public-home", false)]) });
  assert.equal(code, 0);
  const run = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual(runProblems(run), []);
  assert.equal(run.started_at, NOW);
  assert.equal(existsSync(`${file}.partial`), false);
  assert.match(out, /1 failed/);
});

test("command: --fail-on-failure exits 1 when a check failed and 0 when none did", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sre-synthetic-"));
  const failing = await cli(["--suite", "post-deploy", "--out", join(dir, "a.json"), "--fail-on-failure"], { pages: fakeModule(["post-deploy"], [check("public-home", false)]) });
  assert.equal(failing.code, 1);
  const passing = await cli(["--suite", "post-deploy", "--out", join(dir, "b.json"), "--fail-on-failure"], { pages: fakeModule(["post-deploy"], [check("public-home")]) });
  assert.equal(passing.code, 0);
});

test("command: exits 2 when it is used wrongly or cannot do its job", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sre-synthetic-"));
  const pages = { pages: fakeModule(["fast"], [check("public-home")]) };
  assert.equal((await cli(["--suite", "nightly", "--out", join(dir, "x.json")], pages)).code, 2);
  assert.equal((await cli(["--suite", "fast"], pages)).code, 2);
  assert.equal((await cli(["--suite", "fast", "--out", join(dir, "x.json"), "--bogus"], pages)).code, 2);
  const badClock = await cli(["--suite", "fast", "--out", join(dir, "x.json")], pages, { SRE_NOW: "soon" });
  assert.equal(badClock.code, 2);
  assert.match(badClock.err, /SRE_NOW/);
  // No module runs in this suite, so there is no run to file.
  assert.equal((await cli(["--suite", "slow", "--out", join(dir, "x.json")], pages)).code, 2);
  // The output path is a directory.
  assert.equal((await cli(["--suite", "fast", "--out", dir], pages)).code, 2);
});

test("the real modules, pages from the uptime service: the monitor sends nothing to a page on Cloudflare", async () => {
  const asked = [];
  const unreachable = async (url, init = {}) => {
    asked.push(`${init.method || "GET"} ${url}`);
    throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
  };
  for (const suite of ["fast", "slow", "post-deploy"]) {
    asked.length = 0;
    const run = await runSuite({ env: { ...env, UPTIMEROBOT_API_KEY: "ur-read-only-key" }, fetch: unreachable, sleep: async () => {}, suite, vantage: { provider: "local", region: null } });
    assert.deepEqual(runProblems(run), []);
    assert.ok(!run.checks.some((c) => c.id.startsWith("monitor-")), "every real module loaded and ran");
    // To our own names on Cloudflare only the two redirects are asked: the
    // plain-http address and www. Never a page of the site or the staff site.
    const OUR_HOSTS = new Set(["diamondecho.com", "www.diamondecho.com", "staff.diamondecho.com"]);
    const ours = asked.filter((line) => OUR_HOSTS.has(new URL(line.split(" ")[1]).hostname));
    for (const line of ours) assert.match(line, /^GET (http:\/\/diamondecho\.com\/|https:\/\/www\.diamondecho\.com\/)/, `${suite}: ${line}`);
    const ids = run.checks.map((c) => c.id);
    for (const id of ["public-home", "search-page", "calculators-deal-page", "inquiry-page", "staff-home", "public-asset-js", "public-not-found", "edge-hsts"]) {
      assert.ok(!ids.includes(id), `${suite}: ${id} is not asked by the monitor`);
    }
    if (suite === "fast") {
      assert.ok(asked.includes("POST https://api.uptimerobot.com/v2/getMonitors"));
      for (const id of ["uptime-service", "public-www-redirect", "api-health", "calculators-api-analyze", "inquiry-route", "staff-api-auth"]) assert.ok(ids.includes(id), id);
    } else {
      assert.ok(!ids.includes("uptime-service"), `${suite}: the uptime service is read by the fast runs only`);
    }
  }
});

test("the real modules, loading the pages directly: a fast run with no network at all still produces a complete, valid run", async () => {
  const unreachable = async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }); };
  const run = await runSuite({ env: { ...env, SRE_PAGE_SOURCE: "direct" }, fetch: unreachable, sleep: async () => {}, suite: "fast", vantage: { provider: "local", region: null } });
  assert.deepEqual(runProblems(run), []);
  assert.ok(run.checks.length >= 20);
  assert.ok(run.checks.every((c) => c.ok === false));
  assert.ok(!run.checks.some((c) => c.id.startsWith("monitor-")), "every real module loaded and ran");
  const components = new Set(run.checks.map((c) => c.component));
  for (const component of ["public-site", "api", "calculators", "inquiry", "search", "staff-site"]) assert.ok(components.has(component), component);
});
