// Tests for slo-calc.mjs with generated probe history. Nothing here touches
// the network; every clock is fixed. Run: node --test scripts/sre/slo-calc.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  budgetState, burnAlertFor, burnRate, computeSlo, historyStart, main, parseArgs,
  parseHistory, parseHistoryLine, percent, readHistory, resolveNow, tally,
} from "./slo-calc.mjs";
import { SLOS } from "./slo.config.mjs";

const run = promisify(execFile);
const SCRIPT = fileURLToPath(new URL("./slo-calc.mjs", import.meta.url));
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-11-13T12:00:00.000Z");
const slo = (id) => SLOS.find((s) => s.id === id);

// ---- fixtures -------------------------------------------------------------

// One fast run as the state store files it: one check per SLI, all good unless
// `bad` names an SLI (failed) or `slow` names a latency SLI (answered slowly).
function checks({ bad = [], slow = [] } = {}) {
  const c = (sli, okLatency, also = []) => {
    const failed = bad.includes(sli);
    const latency = slow.some((s) => also.includes(s)) ? 4200 : okLatency;
    return [failed ? 0 : 1, failed ? null : latency, [sli, ...also]];
  };
  return {
    "public-home": c("public-availability", 230, ["public-latency"]),
    "api-health": c("api-availability", 180, ["api-latency"]),
    "calculators-deal-page": c("calculators-availability", 260),
    "inquiry-route": c("inquiry-availability", 150),
    "staff-home": c("staff-availability", 210),
  };
}

const line = (t, c, suite = "fast") => JSON.stringify({ t: new Date(t).toISOString(), suite, region: "eastus", c });

// Runs every `every` minutes from `from` up to and including `to`. `shape(t, i)`
// returns the options for checks(), so a test can fail some of them.
function series({ from, to, every = 5, shape = () => ({}) }) {
  const out = [];
  let i = 0;
  for (let t = from; t <= to; t += every * MIN, i += 1) out.push(line(t, checks(shape(t, i))));
  return out;
}

const runsOf = (lines) => parseHistory(lines.join("\n")).runs;
const find = (doc, id) => doc.slos.find((s) => s.id === id);

async function stateDirWith(lines, extraFiles = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "slo-calc-"));
  await mkdir(path.join(dir, "history"));
  const byDay = new Map();
  for (const text of lines) {
    const day = JSON.parse(text).t.slice(0, 10);
    byDay.set(day, `${byDay.get(day) || ""}${text}\n`);
  }
  for (const [day, text] of byDay) await writeFile(path.join(dir, "history", `${day}.jsonl`), text);
  for (const [name, text] of Object.entries(extraFiles)) await writeFile(path.join(dir, "history", name), text);
  return dir;
}

// ---- parsing --------------------------------------------------------------

test("a history line is read as the contract writes it", () => {
  const parsed = parseHistoryLine('{"t":"2026-11-13T00:00:00.000Z","suite":"fast","region":"eastus","c":{"public-home":[1,212,["public-availability","public-latency"]]}}');
  assert.deepEqual(parsed, {
    t: Date.parse("2026-11-13T00:00:00.000Z"), suite: "fast", region: "eastus",
    checks: [{ id: "public-home", ok: true, latency_ms: 212, slis: ["public-availability", "public-latency"] }],
  });
});

test("damaged lines cost one line, never the calculation", () => {
  for (const bad of ["{", "[]", "null", '"text"', '{"t":"yesterday","c":{}}', '{"c":{}}', '{"t":"2026-11-13T00:00:00Z","c":[]}']) {
    assert.equal(parseHistoryLine(bad), null, bad);
  }
  // Inside a good line, an unreadable check entry is dropped and the rest kept.
  const parsed = parseHistoryLine('{"t":"2026-11-13T00:00:00Z","c":{"a":[2,1,[]],"b":"x","c":[0,-5,"nope"],"d":[1,"fast",["public-availability",7]]}}');
  assert.deepEqual(parsed.checks, [
    { id: "c", ok: false, latency_ms: null, slis: [] },
    { id: "d", ok: true, latency_ms: null, slis: ["public-availability"] },
  ]);
});

test("parseHistory sorts, skips blank lines, counts bad ones and files a repeated run once", () => {
  const a = line(NOW - 10 * MIN, checks());
  const b = line(NOW - 5 * MIN, checks());
  const slowSuite = line(NOW - 5 * MIN, checks(), "slow");
  const parsed = parseHistory([b, "", "garbage", a, b, slowSuite, '{"t":"2026-11-13T11:5'].join("\n"));
  assert.equal(parsed.lines, 6);
  assert.equal(parsed.skipped, 2);
  assert.deepEqual(parsed.runs.map((r) => [r.t, r.suite]), [[NOW - 10 * MIN, "fast"], [NOW - 5 * MIN, "fast"], [NOW - 5 * MIN, "slow"]]);
});

// ---- empty and sparse -----------------------------------------------------

test("empty history: every SLO says no data, nothing alerts", () => {
  const doc = computeSlo({ runs: [], now: NOW });
  assert.equal(doc.schema, 1);
  assert.equal(doc.window_days, 28);
  assert.equal(doc.generated_at, "2026-11-13T12:00:00.000Z");
  assert.equal(doc.slos.length, 7);
  for (const s of doc.slos) {
    assert.equal(s.good, 0);
    assert.equal(s.total, 0);
    assert.equal(s.attainment, null);
    assert.equal(s.budget_remaining, null);
    assert.equal(s.enough_data, false);
    assert.equal(s.budget_state, "unknown");
    assert.deepEqual(s.burn, { "1h": null, "6h": null, "3d": null });
  }
  assert.deepEqual(doc.burn_alerts, []);
});

test("main with no history folder writes a no-data slo.json", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "slo-calc-empty-"));
  try {
    const out = path.join(dir, "out", "slo.json");
    const lines = [];
    await main(["--state-dir", path.join(dir, "missing"), "--window-days", "28", "--out", out], { env: { SRE_NOW: "2026-11-13T12:00:00Z" }, log: (l) => lines.push(l) });
    const doc = JSON.parse(await readFile(out, "utf8"));
    assert.equal(doc.slos.every((s) => s.total === 0), true);
    assert.equal(doc.inputs.history_files, 0);
    assert.match(lines[0], /0 runs from 0 day files/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sparse history: counted honestly, judged only where there is enough of it", () => {
  // One run every two hours for 28 days: 336 runs.
  const runs = runsOf(series({ from: NOW - 28 * DAY + 2 * HOUR, to: NOW, every: 120 }));
  const doc = computeSlo({ runs, now: NOW });
  const pub = find(doc, "public-availability");
  assert.equal(pub.runs, 336);
  assert.equal(pub.attainment, 1);
  assert.equal(pub.enough_data, false, "99.9% needs 1,000 probes before one failure cannot break it");
  assert.equal(pub.budget_state, "unknown");
  assert.equal(find(doc, "api-availability").enough_data, true);
  assert.equal(find(doc, "api-latency").enough_data, true);
  assert.equal(pub.coverage, Math.round((336 / 8064) * 1e4) / 1e4);
  // A run every two hours never fills a burn window's minimum: no alerts.
  assert.deepEqual(doc.burn_alerts, []);
});

// ---- full window, outages and burns --------------------------------------

test("a healthy full window: everything met, budget untouched", () => {
  const runs = runsOf(series({ from: NOW - 28 * DAY + 5 * MIN, to: NOW }));
  const doc = computeSlo({ runs, now: NOW });
  for (const s of doc.slos) {
    assert.equal(s.total, 8064, s.id);
    assert.equal(s.attainment, 1, s.id);
    assert.equal(s.budget_remaining, 1, s.id);
    assert.equal(s.enough_data, true, s.id);
    assert.equal(s.budget_state, "ok", s.id);
    assert.equal(s.coverage, 1, s.id);
    assert.deepEqual(s.burn, { "1h": 0, "6h": 0, "3d": 0 }, s.id);
  }
  assert.deepEqual(doc.burn_alerts, []);
});

test("full outage of the website for the last two hours: budget overspent, fast alert at sev2", () => {
  const runs = runsOf(series({
    from: NOW - 28 * DAY + 5 * MIN, to: NOW,
    shape: (t) => (t > NOW - 2 * HOUR ? { bad: ["public-availability"] } : {}),
  }));
  const doc = computeSlo({ runs, now: NOW });
  const pub = find(doc, "public-availability");
  assert.equal(pub.total - pub.good, 24);
  // 24 bad of 8,064 is 0.298% against a 0.1% budget: about twice overspent.
  assert.equal(pub.budget_remaining, Math.round((1 - (24 / 8064) / 0.001) * 1e4) / 1e4);
  assert.ok(pub.budget_remaining < 0);
  assert.equal(pub.budget_state, "exhausted");
  assert.equal(pub.burn["1h"], 1000);
  // The latency SLI does not count failed probes: the outage is charged once.
  assert.equal(find(doc, "public-latency").total, 8064 - 24);
  assert.equal(find(doc, "public-latency").attainment, 1);
  assert.equal(doc.burn_alerts.length, 1);
  const [alert] = doc.burn_alerts;
  assert.equal(alert.slo, "public-availability");
  assert.equal(alert.component, "public-site");
  assert.equal(alert.severity, "sev2");
  assert.equal(alert.window, "1h");
  assert.equal(alert.burn_rate, 1000);
  assert.equal(alert.rule, "fast");
  assert.match(alert.text, /Website availability is using its error budget 1000 times faster than the 99\.9% target \(a proposed target, not yet accepted\) allows: 12 of 12 probes/);
  // Other SLOs are untouched.
  assert.equal(find(doc, "api-availability").budget_remaining, 1);
});

// The fast rule and how many failed probes it takes. Runs at NOW-55 ... NOW.
function lastHour(badAt) {
  return runsOf(series({ from: NOW - 3 * HOUR, to: NOW, shape: (t) => (badAt.includes((NOW - t) / MIN) ? { bad: ["public-availability"] } : {}) }));
}

test("one failed probe in an hour does not alert; neither do two", () => {
  assert.equal(burnAlertFor(lastHour([0]), slo("public-availability"), NOW), null);
  assert.equal(burnAlertFor(lastHour([0, 30]), slo("public-availability"), NOW), null);
});

test("three failed probes in an hour, the latest within 15 minutes, alert at sev2", () => {
  const alert = burnAlertFor(lastHour([10, 30, 50]), slo("public-availability"), NOW);
  assert.equal(alert.rule, "fast");
  assert.equal(alert.severity, "sev2");
  assert.equal(alert.bad_runs, 3);
  assert.equal(alert.runs, 12);
  assert.equal(alert.burn_rate, 250);
});

test("an outage that has stopped stops alerting (the short window is clean)", () => {
  assert.equal(burnAlertFor(lastHour([20, 25, 30]), slo("public-availability"), NOW), null);
});

test("a window the monitor mostly missed proves nothing: no burn alert", () => {
  // Three runs in the hour, all failed: below min_runs (4). The alert engine's
  // own streak rule (alert.mjs) is what catches a hard outage like this.
  const runs = runsOf([NOW - 40 * MIN, NOW - 20 * MIN, NOW].map((t) => line(t, checks({ bad: ["public-availability"] }))));
  assert.equal(burnAlertFor(runs, slo("public-availability"), NOW), null);
});

test("medium burn: every third API probe slow for six hours is a sev3 6h alert", () => {
  const runs = runsOf(series({ from: NOW - 8 * HOUR, to: NOW, shape: (t, i) => (i % 3 === 0 ? { slow: ["api-latency"] } : {}) }));
  const alert = burnAlertFor(runs, slo("api-latency"), NOW);
  assert.equal(alert.rule, "medium");
  assert.equal(alert.window, "6h");
  assert.equal(alert.severity, "sev3");
  assert.ok(alert.burn_rate >= 6 && alert.burn_rate < 14.4);
});

test("slow burn: one API probe in ten slow for three days is a sev4 3d notice", () => {
  const runs = runsOf(series({ from: NOW - 4 * DAY, to: NOW, shape: (t, i) => (i % 10 === 0 ? { slow: ["api-latency"] } : {}) }));
  const alert = burnAlertFor(runs, slo("api-latency"), NOW);
  assert.equal(alert.rule, "slow");
  assert.equal(alert.window, "3d");
  assert.equal(alert.severity, "sev4");
  // About one probe in ten over the 864 runs of three days: a burn rate near 2.
  assert.ok(Math.abs(alert.burn_rate - 2) < 0.05, String(alert.burn_rate));
  const doc = computeSlo({ runs, now: NOW });
  assert.equal(find(doc, "api-latency").burn["3d"], alert.burn_rate);
});

test("a severity cap holds: the staff site never alerts above sev3", () => {
  const runs = runsOf(series({ from: NOW - 3 * HOUR, to: NOW, shape: () => ({ bad: ["staff-availability"] }) }));
  const alert = burnAlertFor(runs, slo("staff-availability"), NOW);
  assert.equal(alert.rule, "fast");
  assert.equal(alert.severity, "sev3");
});

// ---- latency counting -----------------------------------------------------

test("latency: only answered probes with a timing count, and the threshold itself is slow", () => {
  const api = slo("api-latency");
  const at = (n) => NOW - n * MIN;
  const runs = runsOf([
    line(at(4), { a: [1, api.threshold_ms - 1, ["api-latency"]] }),
    line(at(3), { a: [1, api.threshold_ms, ["api-latency"]] }),
    line(at(2), { a: [0, null, ["api-latency"]] }),
    line(at(1), { a: [1, null, ["api-latency"]] }),
  ]);
  const counts = tally(runs, api, NOW - HOUR, NOW);
  assert.equal(counts.total, 2);
  assert.equal(counts.good, 1);
  assert.ok(Math.abs(burnRate(counts, api.target) - 10) < 1e-9);
});

test("several checks failing in one run count as one failed probe for the alert rules", () => {
  const runs = runsOf([line(NOW, {
    a: [0, null, ["public-availability"]], b: [0, null, ["public-availability"]], c: [1, 10, ["public-availability"]],
  })]);
  const counts = tally(runs, slo("public-availability"), NOW - HOUR, NOW);
  assert.deepEqual([counts.good, counts.total, counts.runs, counts.bad_runs], [1, 3, 1, 1]);
});

// ---- window edges ---------------------------------------------------------

test("window edges: the start is outside, now is inside, the future is ignored", () => {
  const runs = runsOf([
    line(NOW - 28 * DAY, checks({ bad: ["public-availability"] })),
    line(NOW - 28 * DAY + 1, checks()),
    line(NOW, checks()),
    line(NOW + 1, checks({ bad: ["public-availability"] })),
  ]);
  const pub = find(computeSlo({ runs, now: NOW }), "public-availability");
  assert.equal(pub.total, 2);
  assert.equal(pub.good, 2);
  assert.equal(pub.first_event_at, new Date(NOW - 28 * DAY + 1).toISOString());
  assert.equal(pub.last_event_at, new Date(NOW).toISOString());
});

test("readHistory reads only the day files that can hold the window, and tolerates a damaged file", async () => {
  const lines = series({ from: NOW - 2 * DAY, to: NOW, every: 60 });
  const dir = await stateDirWith(lines, {
    "2026-10-01.jsonl": `${line(NOW, checks({ bad: ["public-availability"] }))}\n`,
    "notes.txt": "not history\n",
    "2026-11-12.jsonl.tmp": "half written\n",
  });
  try {
    // Damage today's file: a truncated last line and some garbage.
    const today = path.join(dir, "history", "2026-11-13.jsonl");
    await writeFile(today, `${await readFile(today, "utf8")}not json\n{"t":"2026-11-13T12:0`);
    const history = await readHistory(dir, { fromMs: NOW - DAY, toMs: NOW });
    assert.equal(history.files, 2, "2026-11-12 and 2026-11-13 only");
    assert.equal(history.skipped, 2);
    assert.ok(history.runs.every((r) => r.checks.every((c) => c.ok)), "the October file was not read");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a missing day in the middle is simply no data", async () => {
  const lines = series({ from: NOW - 3 * DAY, to: NOW, every: 60 }).filter((l) => !JSON.parse(l).t.startsWith("2026-11-11"));
  const dir = await stateDirWith(lines);
  try {
    const out = path.join(dir, "slo.json");
    const doc = await main(["--state-dir", dir, "--out", out], { env: { SRE_NOW: new Date(NOW).toISOString() }, log: () => {} });
    assert.equal(find(doc, "api-availability").runs, lines.length);
    assert.equal(find(doc, "api-availability").attainment, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("unknown SLI names in history are reported, not counted", () => {
  const runs = runsOf([line(NOW, { a: [1, 10, ["public-availabilty"]] })]);
  const doc = computeSlo({ runs, now: NOW });
  assert.deepEqual(doc.inputs.unknown_slis, ["public-availabilty"]);
  assert.equal(find(doc, "public-availability").total, 0);
});

// ---- small helpers --------------------------------------------------------

test("budget states follow the policy thresholds", () => {
  assert.equal(budgetState(0.51, true), "ok");
  assert.equal(budgetState(0.5, true), "caution");
  assert.equal(budgetState(0.25, true), "restricted");
  assert.equal(budgetState(0, true), "exhausted");
  assert.equal(budgetState(-3, true), "exhausted");
  assert.equal(budgetState(null, true), "unknown");
  assert.equal(budgetState(0.9, false), "unknown");
});

test("percent prints targets the way people say them", () => {
  assert.equal(percent(0.999), "99.9%");
  assert.equal(percent(0.95), "95%");
  assert.equal(percent(0.995), "99.5%");
});

test("the burn windows always have history, even with a short --window-days", () => {
  assert.equal(historyStart(NOW, 1), NOW - 3 * DAY);
  assert.equal(historyStart(NOW, 28), NOW - 28 * DAY);
});

// ---- the clock and the command line --------------------------------------

test("the clock: --now, then SRE_NOW, then the real time", () => {
  assert.equal(resolveNow(5, { SRE_NOW: "2026-11-13T00:00:00Z" }, () => 9), 5);
  assert.equal(resolveNow(null, { SRE_NOW: "2026-11-13T00:00:00Z" }, () => 9), Date.parse("2026-11-13T00:00:00Z"));
  assert.equal(resolveNow(null, {}, () => 9), 9);
  assert.throws(() => resolveNow(null, { SRE_NOW: "soon" }), /SRE_NOW must be an ISO time/);
});

test("arguments are checked", () => {
  assert.throws(() => parseArgs(["--out", "x"]), /--state-dir is required/);
  assert.throws(() => parseArgs(["--state-dir", "d"]), /--out is required/);
  assert.throws(() => parseArgs(["--state-dir", "d", "--out", "x", "--window-days", "0"]), /--window-days/);
  assert.throws(() => parseArgs(["--state-dir", "--out", "x"]), /needs a value/);
  assert.throws(() => parseArgs(["--state-dir", "d", "--out", "x", "--apply"]), /unknown option/);
});

test("the command honours SRE_NOW and exits 2 when it cannot do its job", async () => {
  const lines = series({ from: NOW - 2 * HOUR, to: NOW });
  const dir = await stateDirWith(lines);
  try {
    const out = path.join(dir, "slo.json");
    await run(process.execPath, [SCRIPT, "--state-dir", dir, "--window-days", "28", "--out", out], { env: { ...process.env, SRE_NOW: "2026-11-13T12:00:00.000Z" } });
    const doc = JSON.parse(await readFile(out, "utf8"));
    assert.equal(doc.generated_at, "2026-11-13T12:00:00.000Z");
    assert.equal(find(doc, "public-availability").total, lines.length);
    await assert.rejects(run(process.execPath, [SCRIPT, "--state-dir", dir]), (error) => error.code === 2 && /--out is required/.test(error.stderr));
    await assert.rejects(run(process.execPath, [SCRIPT, "--state-dir", dir, "--out", out], { env: { ...process.env, SRE_NOW: "later" } }), (error) => error.code === 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("slo.json carries every field the contract names", () => {
  const doc = computeSlo({ runs: runsOf(series({ from: NOW - HOUR, to: NOW })), now: NOW });
  for (const key of ["schema", "generated_at", "window_days", "slos", "burn_alerts"]) assert.ok(key in doc, key);
  for (const s of doc.slos) {
    for (const key of ["id", "name", "component", "target", "accepted", "good", "total", "attainment", "budget_remaining", "burn", "enough_data"]) assert.ok(key in s, `${s.id}.${key}`);
    assert.deepEqual(Object.keys(s.burn), ["1h", "6h", "3d"]);
  }
});
