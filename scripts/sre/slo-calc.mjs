#!/usr/bin/env node
// Turns the probe history into SLO figures: how much of each target was met
// over the window, how much error budget is left, and how fast it is burning.
//
//   node scripts/sre/slo-calc.mjs --state-dir DIR --window-days 28 --out slo.json
//
// The clock is SRE_NOW when that is set (an ISO time), or --now, so a test or
// the fire drill can stand anywhere in time. Exit 0: slo.json written (bad
// news in it is data, not an error). Exit 2: the command itself broke.
//
// Reads DIR/history/*.jsonl (written by state.mjs) and writes slo.json in the
// shape fixed by scripts/sre/README.md. It only reads files and writes one
// file. The targets and the alert thresholds live in slo.config.mjs; the
// reasons for them are in docs/sre/slo.md.
//
// The numbers come from probes, one every five minutes from one place. They
// are an outside view of the site, not a count of real visitors' requests.

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUDGET_STATES, BURN_POLICY, BURN_WINDOWS, PROBE_INTERVAL_MINUTES, SLOS, WINDOW_DAYS,
  budgetMinutes, expectedRuns, minRunsFor,
} from "./slo.config.mjs";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const HISTORY_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
const SEVERITIES = ["sev1", "sev2", "sev3", "sev4"];

// One history line becomes { t, suite, region, checks: [{ id, ok, latency_ms, slis }], blind, refused },
// with `t` in milliseconds. A line that cannot be read returns null: a damaged
// line must cost one probe, not the whole calculation.
// `blind` (state.mjs) is how many checks ran in a run that reached nothing at
// all, not even outside services: such a line has no results and measured
// nothing about the site. `refused` is how many checks Cloudflare refused to
// the monitor; they were left out of `c`. Both are 0 when absent.
export function parseHistoryLine(line) {
  let doc;
  try {
    doc = JSON.parse(line);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const t = typeof doc.t === "string" ? Date.parse(doc.t) : NaN;
  if (Number.isNaN(t)) return null;
  if (!doc.c || typeof doc.c !== "object" || Array.isArray(doc.c)) return null;
  const checks = [];
  for (const [id, entry] of Object.entries(doc.c)) {
    if (!Array.isArray(entry)) continue;
    const [ok, latency, slis] = entry;
    if (ok !== 0 && ok !== 1) continue;
    checks.push({
      id,
      ok: ok === 1,
      latency_ms: typeof latency === "number" && Number.isFinite(latency) && latency >= 0 ? latency : null,
      slis: Array.isArray(slis) ? slis.filter((sli) => typeof sli === "string") : [],
    });
  }
  const count = (value) => (Number.isInteger(value) && value > 0 ? value : 0);
  return {
    t,
    suite: typeof doc.suite === "string" ? doc.suite : null,
    region: typeof doc.region === "string" ? doc.region : null,
    checks,
    blind: count(doc.blind),
    refused: count(doc.refused),
  };
}

// Reads many lines. Returns the runs in time order and how many lines were
// unreadable. The same run filed twice (same time and suite) counts once.
export function parseHistory(text) {
  const runs = [];
  let lines = 0;
  let skipped = 0;
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    lines += 1;
    const run = parseHistoryLine(line);
    if (run) runs.push(run);
    else skipped += 1;
  }
  return { runs: sortAndDedupe(runs), lines, skipped };
}

function sortAndDedupe(runs) {
  const seen = new Set();
  const out = [];
  for (const run of [...runs].sort((a, b) => a.t - b.t)) {
    const key = `${run.t}|${run.suite}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(run);
  }
  return out;
}

// Reads the day files that can hold runs between fromMs and toMs. A missing
// folder or a missing day is not an error: it is simply no data.
export async function readHistory(stateDir, { fromMs, toMs }) {
  const dir = path.join(stateDir, "history");
  let names;
  try {
    names = await readdir(dir);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return { runs: [], files: 0, lines: 0, skipped: 0 };
    throw error;
  }
  const firstDay = new Date(fromMs).toISOString().slice(0, 10);
  const lastDay = new Date(toMs).toISOString().slice(0, 10);
  const wanted = names
    .map((name) => HISTORY_FILE.exec(name))
    .filter((match) => match && match[1] >= firstDay && match[1] <= lastDay)
    .map((match) => match[0])
    .sort();
  const all = [];
  let lines = 0;
  let skipped = 0;
  for (const name of wanted) {
    const parsed = parseHistory(await readFile(path.join(dir, name), "utf8"));
    all.push(...parsed.runs);
    lines += parsed.lines;
    skipped += parsed.skipped;
  }
  return { runs: sortAndDedupe(all), files: wanted.length, lines, skipped };
}

// Counts one SLO's events among runs with fromMs < t <= toMs.
// `runs` is how many separate probe runs had an event for this SLO and
// `bad_runs` how many of those saw at least one bad event. The alert rules
// use the run counts, so that five page checks failing in one run still
// count as one failed probe. `bad_checks` names every check that had a bad
// event (failed, or slow for a speed SLO), sorted.
export function tally(runs, slo, fromMs, toMs) {
  const out = { good: 0, total: 0, runs: 0, bad_runs: 0, first: null, last: null, bad_checks: [] };
  const badChecks = new Set();
  for (const run of runs) {
    if (!(run.t > fromMs && run.t <= toMs)) continue;
    let seen = false;
    let bad = false;
    for (const check of run.checks) {
      if (!check.slis.includes(slo.id)) continue;
      let good;
      if (slo.kind === "latency") {
        // A failed probe, or one with no timing, says nothing about speed.
        if (!check.ok || check.latency_ms === null) continue;
        good = check.latency_ms < slo.threshold_ms;
      } else {
        good = check.ok;
      }
      seen = true;
      out.total += 1;
      if (good) out.good += 1;
      else {
        bad = true;
        badChecks.add(check.id);
      }
    }
    if (!seen) continue;
    out.runs += 1;
    if (bad) out.bad_runs += 1;
    if (out.first === null) out.first = run.t;
    out.last = run.t;
  }
  out.bad_checks = [...badChecks].sort();
  return out;
}

// How many times faster than "on course" the budget is being spent, or null
// when the window holds no events.
export function burnRate(counts, target) {
  if (!counts.total) return null;
  return (counts.total - counts.good) / counts.total / (1 - target);
}

export function budgetState(budgetRemaining, enoughData) {
  if (budgetRemaining === null || !enoughData) return "unknown";
  for (const { state, at_or_below } of BUDGET_STATES) {
    if (budgetRemaining <= at_or_below) return state;
  }
  return "ok";
}

function round(value, places) {
  if (value === null) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function lessSevere(a, b) {
  return SEVERITIES.indexOf(a) >= SEVERITIES.indexOf(b) ? a : b;
}

// 0.999 -> "99.9%", 0.95 -> "95%".
export function percent(share, places = 3) {
  const text = (share * 100).toFixed(places);
  return `${text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text}%`;
}

// The first rule (most serious first) that fires for this SLO, or null.
// A rule fires only when all of these hold:
//   - the long window holds at least min_runs runs (the monitor was awake),
//   - at least min_bad_runs separate runs in it saw a failure,
//   - the burn rate over the long window is at or above the rule's rate,
//   - and so is the burn rate over the short window (it is still happening).
export function burnAlertFor(runs, slo, now, policy = BURN_POLICY) {
  for (const rule of policy) {
    const long = tally(runs, slo, now - rule.long_minutes * MINUTE, now);
    if (long.runs < rule.min_runs || long.bad_runs < rule.min_bad_runs) continue;
    const longRate = burnRate(long, slo.target);
    if (longRate === null || longRate + 1e-9 < rule.burn_rate) continue;
    const short = tally(runs, slo, now - rule.short_minutes * MINUTE, now);
    const shortRate = burnRate(short, slo.target);
    if (shortRate === null || shortRate + 1e-9 < rule.burn_rate) continue;
    const proposed = slo.accepted ? "" : " (a proposed target, not yet accepted)";
    return {
      slo: slo.id,
      component: slo.component,
      severity: lessSevere(rule.severity, slo.severity_cap ?? rule.severity),
      window: rule.window,
      burn_rate: round(longRate, 2),
      rule: rule.name,
      short_window_minutes: rule.short_minutes,
      short_burn_rate: round(shortRate, 2),
      bad_runs: long.bad_runs,
      runs: long.runs,
      // The checks that were bad in the long window. A check can belong to
      // another component than the SLO (the /search page counts toward the
      // website; the deal analysis toward the API), so the alert engine
      // matches these against an open incident's failing_checks to avoid
      // opening a second incident for the same failure.
      checks: long.bad_checks,
      accepted: slo.accepted,
      text: `${slo.name} is using its error budget ${round(longRate, 1)} times faster than the ${percent(slo.target)} target${proposed} allows: ${long.bad_runs} of ${long.runs} probes in the last ${rule.window} were bad.`,
    };
  }
  return null;
}

// The whole slo.json document. Pure: `runs` come from parseHistory or
// readHistory and `now` is milliseconds, so a test can stand anywhere in time.
export function computeSlo({ runs, now, windowDays = WINDOW_DAYS, slos = SLOS, policy = BURN_POLICY, inputs = {} }) {
  const windowStart = now - windowDays * DAY;
  const known = new Set(slos.map((slo) => slo.id));
  const unknown = new Set();
  for (const run of runs) {
    if (!(run.t > windowStart && run.t <= now)) continue;
    for (const check of run.checks) for (const sli of check.slis) if (!known.has(sli)) unknown.add(sli);
  }

  const out = [];
  const alerts = [];
  for (const slo of slos) {
    const counts = tally(runs, slo, windowStart, now);
    const attainment = counts.total ? counts.good / counts.total : null;
    const budgetRemaining = counts.total ? 1 - (1 - attainment) / (1 - slo.target) : null;
    const enough = counts.runs >= minRunsFor(slo.target);
    const burn = {};
    for (const [label, minutes] of Object.entries(BURN_WINDOWS)) {
      burn[label] = round(burnRate(tally(runs, slo, now - minutes * MINUTE, now), slo.target), 2);
    }
    out.push({
      id: slo.id,
      name: slo.name,
      component: slo.component,
      target: slo.target,
      accepted: slo.accepted,
      good: counts.good,
      total: counts.total,
      attainment: round(attainment, 6),
      budget_remaining: round(budgetRemaining, 4),
      burn,
      enough_data: enough,
      // Beyond the contract's fields: context for the status page and report.
      kind: slo.kind,
      threshold_ms: slo.threshold_ms,
      runs: counts.runs,
      bad_runs: counts.bad_runs,
      coverage: round(Math.min(1, counts.runs / expectedRuns(windowDays * 24 * 60)), 4),
      budget_minutes: round(budgetMinutes(slo.target, windowDays), 1),
      budget_state: budgetState(budgetRemaining, enough),
      first_event_at: counts.first === null ? null : new Date(counts.first).toISOString(),
      last_event_at: counts.last === null ? null : new Date(counts.last).toISOString(),
    });
    const alert = burnAlertFor(runs, slo, now, policy);
    if (alert) alerts.push(alert);
  }

  return {
    schema: 1,
    generated_at: new Date(now).toISOString(),
    window_days: windowDays,
    slos: out,
    burn_alerts: alerts,
    burn_policy: policy,
    probe_interval_minutes: PROBE_INTERVAL_MINUTES,
    inputs: { history_files: 0, lines: 0, skipped_lines: 0, ...inputs, unknown_slis: [...unknown].sort() },
  };
}

export function parseArgs(argv) {
  const args = { stateDir: null, windowDays: WINDOW_DAYS, out: null, now: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    const need = () => {
      if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value`);
      i += 1;
      return value;
    };
    if (flag === "--state-dir") args.stateDir = need();
    else if (flag === "--window-days") args.windowDays = Number(need());
    else if (flag === "--out") args.out = need();
    else if (flag === "--now") args.now = Date.parse(need());
    else throw new Error(`unknown option ${flag}`);
  }
  if (!args.stateDir) throw new Error("--state-dir is required");
  if (!args.out) throw new Error("--out is required");
  if (!(Number.isFinite(args.windowDays) && args.windowDays > 0 && args.windowDays <= 366)) throw new Error("--window-days must be a number of days between 1 and 366");
  if (args.now !== null && Number.isNaN(args.now)) throw new Error("--now must be an ISO time");
  return args;
}

// The clock: --now, else SRE_NOW (the fire drill and tests replay history
// with it; production never sets it), else the real time.
export function resolveNow(argsNow, env = process.env, clock = () => Date.now()) {
  if (argsNow !== null && argsNow !== undefined) return argsNow;
  if (env.SRE_NOW) {
    const at = Date.parse(env.SRE_NOW);
    if (Number.isNaN(at)) throw new Error("SRE_NOW must be an ISO time");
    return at;
  }
  return clock();
}

// The burn windows need history too, even when --window-days is shorter.
export function historyStart(at, windowDays) {
  const longestBurn = Math.max(...Object.values(BURN_WINDOWS)) * MINUTE;
  return at - Math.max(windowDays * DAY, longestBurn);
}

export async function main(argv, { now = () => Date.now(), env = process.env, log = console.log } = {}) {
  const args = parseArgs(argv);
  const at = resolveNow(args.now, env, now);
  const history = await readHistory(args.stateDir, { fromMs: historyStart(at, args.windowDays), toMs: at });
  const doc = computeSlo({
    runs: history.runs,
    now: at,
    windowDays: args.windowDays,
    inputs: { history_files: history.files, lines: history.lines, skipped_lines: history.skipped },
  });
  await mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
  await writeFile(args.out, `${JSON.stringify(doc, null, 2)}\n`);
  const judged = doc.slos.filter((slo) => slo.enough_data).length;
  log(`slo-calc: ${history.runs.length} runs from ${history.files} day files (${history.skipped} unreadable lines); ${judged} of ${doc.slos.length} SLOs have enough data; ${doc.burn_alerts.length} burn alerts. Wrote ${args.out}.`);
  if (doc.inputs.unknown_slis.length) log(`slo-calc: history names SLIs that slo.config.mjs does not define: ${doc.inputs.unknown_slis.join(", ")}`);
  return doc;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`slo-calc: ${error.message}`);
    process.exit(2);
  });
}
