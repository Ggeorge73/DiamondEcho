import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { makeCheck, makeRun } from "./lib/schema.mjs";
import { recordRun, record, componentState, overallState, expiredHistoryFiles, parseArgs } from "./state.mjs";

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIN = 60_000;
const T0 = Date.parse("2026-11-13T00:00:00.000Z");

function check(overrides = {}) {
  return makeCheck({ id: "public-home", name: "Home page", component: "public-site", severity: "sev1", ok: true, status: 200, latency_ms: 200, slis: ["public-availability"], ...overrides });
}
function aRun(at, checks, suite = "fast") {
  return makeRun({ suite, started_at: new Date(at).toISOString(), finished_at: new Date(at + 4000).toISOString(), vantage: { provider: "github-actions", region: "eastus" }, checks });
}
// Feed runs one by one, 5 minutes apart, as the workflow would.
function replay(list, { start = T0, every = 5 * MIN, status = null, uptime = null } = {}) {
  let state = { status, uptime };
  const outputs = [];
  list.forEach((checks, index) => {
    const at = start + index * every;
    const out = recordRun({ ...state, run: aRun(at, checks), now: at + 5000 });
    state = { status: out.status, uptime: out.uptime };
    outputs.push(out);
  });
  return { ...state, outputs };
}

test("a passing run makes the component operational and writes the contract shape", () => {
  const { status, outputs } = replay([[check()]]);
  assert.equal(status.schema, 1);
  assert.equal(status.overall, "operational");
  assert.deepEqual(Object.keys(status.components), ["public-site"]);
  assert.equal(status.components["public-site"].name, "Website");
  assert.deepEqual(status.components["public-site"].checks, ["public-home"]);
  const home = status.checks["public-home"];
  for (const key of ["name", "component", "severity", "suite", "ok", "status", "latency_ms", "detail", "checked_at", "consecutive_failures", "last_ok_at", "last_failure_at", "observed"]) {
    assert.ok(Object.hasOwn(home, key), key);
  }
  assert.equal(home.consecutive_failures, 0);
  assert.deepEqual(outputs[0].history.line, { t: "2026-11-13T00:00:00.000Z", suite: "fast", region: "eastus", c: { "public-home": [1, 200, ["public-availability"]] } });
  assert.equal(status.last_runs.fast.at, "2026-11-13T00:00:00.000Z");
});

test("one unconfirmed failure does not change the page; the second one does", () => {
  const failing = check({ ok: false, status: 503, detail: "Answered 503." });
  const { outputs } = replay([[check()], [failing], [failing]]);
  assert.equal(outputs[1].status.components["public-site"].state, "operational");
  assert.equal(outputs[1].status.checks["public-home"].consecutive_failures, 1);
  assert.equal(outputs[2].status.components["public-site"].state, "outage");
  assert.equal(outputs[2].status.overall, "outage");
  // The outage is dated from its first failure, not from the confirmation.
  assert.equal(outputs[2].status.components["public-site"].since, outputs[1].status.checks["public-home"].checked_at);
});

test("component rule: sev2 and sev3 degrade, all major checks failing is an outage, sev4 is a notice", () => {
  const now = T0;
  const base = { checked_at: new Date(now).toISOString(), suites: ["fast"] };
  const failing = (severity, n = 3) => ({ ...base, ok: false, severity, consecutive_failures: n });
  const passing = (severity) => ({ ...base, ok: true, severity, consecutive_failures: 0 });
  assert.equal(componentState([failing("sev2"), passing("sev2")], now), "degraded");
  assert.equal(componentState([failing("sev2"), failing("sev2")], now), "outage");
  assert.equal(componentState([failing("sev3"), passing("sev2")], now), "degraded");
  assert.equal(componentState([failing("sev3", 2), passing("sev2")], now), "operational"); // sev3 needs 3
  assert.equal(componentState([failing("sev4", 10), passing("sev2")], now), "operational");
  assert.equal(componentState([failing("sev1"), passing("sev2")], now), "outage");
});

test("stale data reads as unknown, and the headline never claims operational over it", () => {
  const now = T0;
  const old = { ok: true, severity: "sev1", consecutive_failures: 0, checked_at: new Date(now - 30 * MIN).toISOString(), suites: ["fast"] };
  assert.equal(componentState([old], now), "unknown");
  // An hourly check is not stale after 30 minutes.
  assert.equal(componentState([{ ...old, suites: ["slow"] }], now), "operational");
  // A check seen in both suites is held to the shorter limit.
  assert.equal(componentState([{ ...old, suites: ["fast", "slow"] }], now), "unknown");
  assert.equal(overallState(["operational", "unknown"]), "unknown");
  assert.equal(overallState(["degraded", "unknown"]), "degraded");
  assert.equal(overallState([]), "unknown");
});

test("a changed revision or commit is recorded once as a deploy; a first sighting is not", () => {
  const identity = (revision, commit) => makeCheck({ id: "api-identity", name: "API identity", component: "api", severity: "sev2", ok: true, status: 200, slis: [], observed: { revision, commit } });
  const lost = makeCheck({ id: "api-identity", name: "API identity", component: "api", severity: "sev2", ok: false, status: null, detail: "No answer.", slis: [] });
  const { outputs } = replay([
    [identity("diamondecho-api-00028-zin", "59f8d46")],
    [lost], // a failed read must not erase the facts...
    [identity("diamondecho-api-00028-zin", "59f8d46")], // ...or this would look like a deploy
    [identity("diamondecho-api-00029-abc", "672aa79")],
  ]);
  assert.deepEqual(outputs.slice(0, 3).flatMap((out) => out.deploys), []);
  const lines = outputs[3].deploys;
  assert.deepEqual(lines.map(({ what, check: id, fact, from, to }) => ({ what, id, fact, from, to })), [
    { what: "api", id: "api-identity", fact: "revision", from: "diamondecho-api-00028-zin", to: "diamondecho-api-00029-abc" },
    { what: "api", id: "api-identity", fact: "commit", from: "59f8d46", to: "672aa79" },
  ]);
  assert.equal(lines[0].at, outputs[3].status.checks["api-identity"].checked_at);
});

test("uptime counts runs and sev1/sev2 failures per component per day", () => {
  const minor = makeCheck({ id: "public-page-terms", name: "Terms", component: "public-site", severity: "sev3", ok: false, status: 500, slis: [] });
  const { uptime } = replay([[check(), minor], [check({ ok: false, status: 500 }), minor], [check(), minor]]);
  assert.deepEqual(uptime, { "public-site": { "2026-11-13": { runs: 3, failed: 1 } } });
});

test("the same run filed twice counts once", () => {
  const first = recordRun({ status: null, uptime: null, run: aRun(T0, [check({ ok: false, status: 500 })]), now: T0 });
  const again = recordRun({ status: first.status, uptime: first.uptime, run: aRun(T0, [check({ ok: false, status: 500 })]), now: T0 + MIN });
  assert.equal(again.skipped, "already filed");
  assert.equal(again.status.checks["public-home"].consecutive_failures, 1);
});

test("a blind run (nothing reachable, not even outside services) counts against nothing", () => {
  const dark = (id, component) => makeCheck({ id, name: id, component, severity: "sev2", ok: false, status: null, detail: "No answer: timed out.", slis: ["public-availability"] });
  const blindChecks = [dark("public-home", "public-site"), dark("api-health", "api"), dark("search-idx-provider", "search")];
  const { status, uptime, outputs } = replay([[check()], blindChecks, blindChecks]);
  assert.equal(status.checks["public-home"].consecutive_failures, 0);
  assert.equal(status.last_runs.fast.blind, true);
  assert.deepEqual(outputs[1].history.line.c, {});
  assert.equal(outputs[1].history.line.blind, 3);
  assert.deepEqual(uptime["public-site"]["2026-11-13"], { runs: 1, failed: 0 });
  // Our own hosts failing while an outside service answers is NOT blind.
  const real = [dark("public-home", "public-site"), dark("api-health", "api"), makeCheck({ id: "search-idx-provider", name: "IDX", component: "search", severity: "sev3", ok: true, status: 200, slis: [] })];
  const seen = recordRun({ status: null, uptime: null, run: aRun(T0, real), now: T0 });
  assert.equal(seen.history.line.blind, undefined);
  assert.equal(seen.status.checks["public-home"].consecutive_failures, 1);
});

test("a check not seen for a week is forgotten", () => {
  const first = recordRun({ status: null, uptime: null, run: aRun(T0, [check({ id: "old-check" }), check()]), now: T0 });
  const later = T0 + 8 * 24 * 60 * MIN;
  const next = recordRun({ status: first.status, uptime: first.uptime, run: aRun(later, [check()]), now: later });
  assert.deepEqual(Object.keys(next.status.checks), ["public-home"]);
});

test("history day files older than 400 days are pruned by name", () => {
  const names = ["2025-10-08.jsonl", "2025-10-09.jsonl", "2026-11-13.jsonl", "notes.txt"];
  assert.deepEqual(expiredHistoryFiles(names, T0), ["2025-10-08.jsonl"]);
});

test("record writes the files, honours SRE_NOW from the command line, and refuses a bad run", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sre-state-"));
  try {
    const runFile = path.join(dir, "run.json");
    const stateDir = path.join(dir, "state");
    await mkdir(path.join(stateDir, "history"), { recursive: true });
    await writeFile(path.join(stateDir, "history", "2025-01-01.jsonl"), "{}\n");
    await writeFile(runFile, JSON.stringify(aRun(T0, [check()])));
    const env = { ...process.env, SRE_NOW: "2026-11-13T00:00:05.000Z" };
    await run(process.execPath, [path.join(HERE, "state.mjs"), "record", "--run", runFile, "--state-dir", stateDir], { env });
    const status = JSON.parse(await readFile(path.join(stateDir, "status.json"), "utf8"));
    assert.equal(status.updated_at, "2026-11-13T00:00:05.000Z");
    assert.deepEqual(await readdir(path.join(stateDir, "history")), ["2026-11-13.jsonl"]);
    assert.ok(JSON.parse(await readFile(path.join(stateDir, "uptime", "daily.json"), "utf8"))["public-site"]);

    // A damaged status.json is set aside, not trusted.
    await writeFile(path.join(stateDir, "status.json"), "{not json");
    const lines = [];
    await record({ runFile: await writeRun(dir, aRun(T0 + 5 * MIN, [check()])), stateDir, now: T0 + 5 * MIN, log: (line) => lines.push(line) });
    assert.match(lines.join("\n"), /could not be read/);
    assert.equal(await readFile(path.join(stateDir, "status.json.damaged"), "utf8"), "{not json");

    await writeFile(runFile, JSON.stringify({ schema: 1, suite: "fast", checks: [] }));
    const failed = await run(process.execPath, [path.join(HERE, "state.mjs"), "record", "--run", runFile, "--state-dir", stateDir], { env }).catch((error) => error);
    assert.equal(failed.code, 2);
    assert.match(failed.stderr, /not valid/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function writeRun(dir, value) {
  const file = path.join(dir, `run-${Date.now()}-${Math.random()}.json`);
  await writeFile(file, JSON.stringify(value));
  return file;
}

test("arguments are checked", () => {
  assert.throws(() => parseArgs(["record", "--run", "x"]), /required/);
  assert.throws(() => parseArgs(["other"]), /usage/);
  assert.deepEqual(parseArgs(["record", "--run", "r.json", "--state-dir", "d"]), { runFile: "r.json", stateDir: "d" });
});
