import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODULES, AZURE_REGION_URL, runSuite, main, makeClock, detectVantage, safeMessage, summary } from "./synthetic-checks.mjs";
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
  assert.deepEqual(MODULES, ["pages", "api", "calculators", "inquiry", "search", "staff", "tls", "dns", "domain", "edge"]);
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
  const run = await runSuite({ ...quiet, suite: "fast", modules: ["dns", "staff"], timeLimitMs: 20, loadModule: loader({
    dns: { suites: ["fast"], run: () => new Promise(() => {}) },
    staff: fakeModule(["fast"], [check("staff-home")]),
  }) });
  assert.deepEqual(run.checks.map((c) => [c.id, c.ok]), [["monitor-dns", false], ["staff-home", true]]);
  assert.match(run.checks[0].detail, /did not finish within 0 s/);
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

test("the real modules: a fast run with no network at all still produces a complete, valid run", async () => {
  const unreachable = async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }); };
  const run = await runSuite({ env, fetch: unreachable, sleep: async () => {}, suite: "fast", vantage: { provider: "local", region: null } });
  assert.deepEqual(runProblems(run), []);
  assert.ok(run.checks.length >= 20);
  assert.ok(run.checks.every((c) => c.ok === false));
  assert.ok(!run.checks.some((c) => c.id.startsWith("monitor-")), "every real module loaded and ran");
  const components = new Set(run.checks.map((c) => c.component));
  for (const component of ["public-site", "api", "calculators", "inquiry", "search", "staff-site"]) assert.ok(components.has(component), component);
});
