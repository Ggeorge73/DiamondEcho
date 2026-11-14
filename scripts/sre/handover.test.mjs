import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handover, parseArgs, waitSeconds, newerUnfinishedRun, MAX_WAIT_SECONDS, UsageError } from "./handover.mjs";

const TOKEN = "ghs_test-token-value";
const env = { GITHUB_TOKEN: TOKEN, GITHUB_REPOSITORY: "owner/repo", GITHUB_RUN_ID: "500", GITHUB_API_URL: "https://api.github.test" };
const T = 1_800_000_000; // seconds

function world({ runs = [], listStatus = 200, dispatchStatus = 204 } = {}) {
  const calls = [];
  const slept = [];
  const lines = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers?.Authorization });
    if (init.method === "GET") return new Response(JSON.stringify({ workflow_runs: runs }), { status: listStatus });
    return new Response(null, { status: dispatchStatus });
  };
  const run = (args, startedAgo = 30) => handover({
    args: { started: T - startedAgo, interval: 300, dryRun: false, ...args }, env, fetch,
    now: () => T * 1000, sleep: async (ms) => { slept.push(ms); }, log: (line) => lines.push(line),
  });
  return { run, calls, slept, lines };
}
const self = { id: 500, run_number: 40, event: "workflow_dispatch", status: "in_progress", created_at: "2026-11-14T19:00:00Z" };

test("it waits out the rest of the five minutes, then asks for the next run on main with the automatic suite", async () => {
  const w = world({ runs: [self, { id: 499, event: "schedule", status: "completed", created_at: "2026-11-14T18:55:00Z" }] });
  const result = await w.run();
  assert.deepEqual(result, { action: "dispatched", waited: 270 });
  assert.deepEqual(w.slept, [270_000]);
  assert.deepEqual(w.calls.map((call) => `${call.method} ${call.url}`), [
    "GET https://api.github.test/repos/owner/repo/actions/workflows/sre-monitor.yml/runs?branch=main&per_page=30",
    "POST https://api.github.test/repos/owner/repo/actions/workflows/sre-monitor.yml/dispatches",
  ]);
  assert.deepEqual(w.calls[1].body, { ref: "main", inputs: { suite: "auto" } });
  assert.ok(!w.lines.join("\n").includes(TOKEN));
});

test("a newer run that has not finished carries the chain on: this one stands down and starts nothing", async () => {
  for (const status of ["queued", "in_progress", "waiting", "pending"]) {
    const w = world({ runs: [{ id: 501, run_number: 41, event: "schedule", status, created_at: "2026-11-14T19:03:00Z" }, self] });
    const result = await w.run();
    assert.equal(result.action, "stood-down", status);
    assert.equal(w.calls.filter((call) => call.method === "POST").length, 0, status);
  }
});

test("older, finished and pull-request runs do not stop the chain", () => {
  const runs = [
    self,
    { id: 498, event: "schedule", status: "in_progress", created_at: "2026-11-14T18:50:00Z" }, // older, still running
    { id: 502, event: "schedule", status: "completed", created_at: "2026-11-14T19:02:00Z" },
    { id: 503, event: "pull_request", status: "in_progress", created_at: "2026-11-14T19:04:00Z" },
  ];
  assert.equal(newerUnfinishedRun(runs, 500), null);
  assert.equal(newerUnfinishedRun([], 500), null);
  // This run is no longer on the page: any unfinished run counts, to be safe.
  assert.equal(newerUnfinishedRun([{ id: 498, event: "schedule", status: "queued", created_at: "2026-11-14T18:50:00Z" }], 500).id, 498);
});

test("the wait is never negative and never longer than the limit", () => {
  assert.equal(waitSeconds({ started: T - 30, nowSeconds: T }), 270);
  assert.equal(waitSeconds({ started: T - 900, nowSeconds: T }), 0, "the run took longer than five minutes: start the next now");
  assert.equal(waitSeconds({ started: T + 9000, nowSeconds: T }), 300, "a start time in the future cannot hold a runner");
  assert.equal(waitSeconds({ started: T + 9000, nowSeconds: T, interval: 5000 }), MAX_WAIT_SECONDS);
});

test("GitHub refusing is an error, with no token in it; a dry run asks nothing", async () => {
  await assert.rejects(world({ listStatus: 403 }).run(), /GitHub GET \/actions\/workflows\/sre-monitor\.yml\/runs refused \(HTTP 403\)/);
  await assert.rejects(world({ runs: [self], dispatchStatus: 422 }).run(), (error) => /dispatches refused \(HTTP 422\)/.test(error.message) && !error.message.includes(TOKEN));
  const w = world();
  assert.deepEqual(await w.run({ dryRun: true }), { action: "dry-run", waited: 270 });
  assert.equal(w.calls.length, 0);
});

test("arguments are checked", () => {
  assert.deepEqual(parseArgs(["--started", "1800000000"]), { started: 1_800_000_000, interval: 300, dryRun: false });
  assert.deepEqual(parseArgs(["--started", "5", "--interval", "60", "--dry-run"]), { started: 5, interval: 60, dryRun: true });
  assert.throws(() => parseArgs([]), UsageError);
  assert.throws(() => parseArgs(["--started", "soon"]), UsageError);
  assert.throws(() => parseArgs(["--loop"]), UsageError);
});

test("the workflow hands over only on main with the monitor switched on, one handover at a time, and keeps the schedule as the watchdog", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/sre-monitor.yml", import.meta.url), "utf8");
  const job = workflow.slice(workflow.indexOf("\n  handover:"));
  assert.match(job, /vars\.SRE_MONITOR == 'enabled'/);
  assert.match(job, /vars\.SRE_MONITOR_CHAIN != 'off'/);
  assert.match(job, /github\.ref == 'refs\/heads\/main'/);
  assert.match(job, /group: sre-monitor-handover\s+cancel-in-progress: true/);
  assert.match(job, /actions: write/);
  assert.match(job, /node scripts\/sre\/handover\.mjs --started/);
  assert.match(workflow, /schedule:\s+- cron:/, "the schedule stays: it restarts the chain if a link breaks");
  assert.match(workflow, /options: \[auto, fast, slow, post-deploy\]/);
});
