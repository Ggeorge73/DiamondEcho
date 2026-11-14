#!/usr/bin/env node
// Files one monitor run in the state directory (a checkout of the sre-status
// branch) and works out what the status page shows.
//
//   node scripts/sre/state.mjs record --run run.json --state-dir DIR
//
// Writes, and is the only writer of:
//   status.json               current state of every check and component
//   history/YYYY-MM-DD.jsonl  one compact line per run (UTC day of the run)
//   uptime/daily.json         runs and failed runs per component per day
//   deploys.jsonl             a line each time an observed revision or commit changes
//
// The shapes are in scripts/sre/README.md. The rules for component states are
// in docs/sre/observability.md. SRE_NOW (an ISO time) replaces the clock, so
// the fire drill and the tests can replay hours in seconds.
//
// Exit codes: 0 filed (or already filed); 2 this command broke or the run
// document is not valid (nothing is written then).

import { mkdir, readFile, readdir, rename, unlink, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { COMPONENTS, SCHEMA_VERSION, runProblems } from "./lib/schema.mjs";
import { OPEN_AFTER, FORGET_CHECK_DAYS, isBlindRun, measuredChecks, staleLimitMinutes } from "./alert-policy.mjs";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// History and day-by-day uptime are kept this long: a year plus room for a
// year-on-year look. Older day files are deleted, so the branch stays small.
export const KEEP_DAYS = 400;
// Facts that mean "a different build is serving" when they change.
export const DEPLOY_FACTS = ["revision", "commit"];

const STATE_ORDER = ["outage", "degraded", "unknown", "operational"];
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const time = (value) => (typeof value === "string" ? Date.parse(value) : NaN);
const dayOf = (iso) => iso.slice(0, 10);

export function nowFrom(env = process.env) {
  if (env.SRE_NOW) {
    const at = Date.parse(env.SRE_NOW);
    if (Number.isNaN(at)) throw new Error("SRE_NOW must be an ISO time");
    return at;
  }
  return Date.now();
}

// A check counts as failing for the status page only once the alert engine
// would also call it failing: OPEN_AFTER runs in a row for its severity. A
// single unconfirmed failure never changes what the page says.
export function isConfirmedFailure(check) {
  return check.ok === false && (check.consecutive_failures ?? 0) >= (OPEN_AFTER[check.severity] ?? OPEN_AFTER.sev4);
}

export function isStale(check, now) {
  const at = time(check.checked_at);
  return !Number.isFinite(at) || now - at > staleLimitMinutes(check.suites || [check.suite]) * MINUTE;
}

// The rule for one component, from its checks that are not stale:
//   no fresh check                                     -> unknown
//   a confirmed failing sev1 check, or every fresh
//   sev1/sev2 check confirmed failing                  -> outage
//   a confirmed failing sev2 or sev3 check             -> degraded
//   otherwise (sev4 failures are notices only)         -> operational
export function componentState(checks, now) {
  const fresh = checks.filter((check) => !isStale(check, now));
  if (fresh.length === 0) return "unknown";
  const confirmed = fresh.filter(isConfirmedFailure);
  const major = fresh.filter((check) => check.severity === "sev1" || check.severity === "sev2");
  if (confirmed.some((check) => check.severity === "sev1")) return "outage";
  if (major.length > 0 && major.every(isConfirmedFailure)) return "outage";
  if (confirmed.some((check) => check.severity === "sev2" || check.severity === "sev3")) return "degraded";
  return "operational";
}

// The page's headline: the worst real problem; "unknown" when some part has
// no fresh data and nothing is known to be broken; "operational" only when
// every part was seen working.
export function overallState(states) {
  if (states.length === 0) return "unknown";
  return STATE_ORDER.find((state) => states.includes(state)) ?? "unknown";
}

// The earliest start of the failures that put a component in its state.
function failingSince(checks, now) {
  const starts = checks.filter((check) => !isStale(check, now) && isConfirmedFailure(check))
    .map((check) => time(check.failing_since)).filter(Number.isFinite);
  return starts.length ? new Date(Math.min(...starts)).toISOString() : null;
}

export function emptyStatus() {
  return { schema: SCHEMA_VERSION, updated_at: null, overall: "unknown", components: {}, checks: {}, last_runs: {} };
}

// The pure core. Takes the previous status.json and uptime/daily.json (or
// null), the run and the time; returns everything to write. Nothing here
// touches a file or the clock.
export function recordRun({ status: before, uptime: uptimeBefore, run, now }) {
  const problems = runProblems(run);
  if (problems.length) throw new Error(`run.json is not valid: ${problems.join("; ")}`);
  const status = isObject(before) && before.schema === SCHEMA_VERSION ? structuredClone(before) : emptyStatus();
  for (const key of ["components", "checks", "last_runs"]) if (!isObject(status[key])) status[key] = {};
  const uptime = isObject(uptimeBefore) ? structuredClone(uptimeBefore) : {};

  // The same run filed twice (a re-run of the workflow step) is filed once,
  // or every streak would count it twice.
  if (status.last_runs[run.suite]?.at === run.started_at) {
    return { status: before, uptime: uptimeBefore, history: null, deploys: [], skipped: "already filed" };
  }

  const at = run.finished_at;
  const blind = isBlindRun(run);
  // When Cloudflare refused the monitor (alert-policy.mjs cloudflareRefusal),
  // the refused checks measured the monitor's access, not the site: they are
  // left out of streaks, history results and uptime, like a blind run.
  const measured = blind ? [] : measuredChecks(run);
  const refused = blind ? 0 : run.checks.length - measured.length;
  status.last_runs[run.suite] = { at: run.started_at, region: run.vantage?.region ?? null, ...(blind ? { blind: true } : {}), ...(refused ? { cloudflare_refused: refused } : {}) };

  // One compact history line. A blind run (the monitor reached nothing, not
  // even outside services) measured nothing about the site: it is kept as a
  // line with no results, so the SLO calculator does not count it as the
  // site failing.
  const history = {
    day: dayOf(run.started_at),
    line: { t: run.started_at, suite: run.suite, region: run.vantage?.region ?? null, c: {} },
  };
  if (blind) history.line.blind = run.checks.length;
  if (refused) history.line.refused = refused;

  const deploys = [];
  if (!blind) {
    for (const check of measured) {
      history.line.c[check.id] = [check.ok ? 1 : 0, check.latency_ms ?? null, check.slis];
      const previous = isObject(status.checks[check.id]) ? status.checks[check.id] : null;
      const observedBefore = isObject(previous?.observed) ? previous.observed : {};
      for (const fact of DEPLOY_FACTS) {
        const from = observedBefore[fact];
        const to = check.observed?.[fact];
        // Only a change counts: the first sighting of a fact is not a deploy.
        if (typeof from === "string" && from && typeof to === "string" && to && from !== to
          && !deploys.some((line) => line.what === check.component && line.fact === fact && line.to === to)) {
          deploys.push({ at, what: check.component, check: check.id, fact, from, to });
        }
      }
      const failures = check.ok ? 0 : (previous?.consecutive_failures ?? 0) + 1;
      status.checks[check.id] = {
        name: check.name,
        component: check.component,
        severity: check.severity,
        suite: run.suite,
        ok: check.ok,
        status: check.status,
        latency_ms: check.latency_ms,
        detail: check.detail,
        checked_at: at,
        consecutive_failures: failures,
        consecutive_successes: check.ok ? (previous?.consecutive_successes ?? 0) + 1 : 0,
        last_ok_at: check.ok ? at : previous?.last_ok_at ?? null,
        last_failure_at: check.ok ? previous?.last_failure_at ?? null : at,
        failing_since: check.ok ? null : failures > 1 && previous?.failing_since ? previous.failing_since : at,
        suites: [...new Set([...(Array.isArray(previous?.suites) ? previous.suites : []), run.suite])].sort(),
        // Last known facts: a failed check that could not read them does not
        // erase them, so the next good read is not mistaken for a deploy.
        observed: { ...observedBefore, ...check.observed },
      };
    }

    // Day-by-day bars: a run counts for every component it looked at, and as
    // failed for a component when one of its sev1 or sev2 checks failed.
    const day = dayOf(run.started_at);
    for (const component of new Set(measured.map((check) => check.component))) {
      const mine = measured.filter((check) => check.component === component);
      const failed = mine.some((check) => !check.ok && (check.severity === "sev1" || check.severity === "sev2"));
      const days = isObject(uptime[component]) ? uptime[component] : (uptime[component] = {});
      const entry = isObject(days[day]) ? days[day] : (days[day] = { runs: 0, failed: 0 });
      entry.runs += 1;
      if (failed) entry.failed += 1;
    }
  }

  // A check that has not been seen for a week was removed from the monitor.
  for (const [id, check] of Object.entries(status.checks)) {
    if (!isObject(check) || !(now - time(check.checked_at) <= FORGET_CHECK_DAYS * DAY)) delete status.checks[id];
  }
  pruneUptime(uptime, now);

  // Components, in the order of COMPONENTS, each with the checks seen for it.
  const components = {};
  for (const [key, name] of Object.entries(COMPONENTS)) {
    const ids = Object.keys(status.checks).filter((id) => status.checks[id].component === key).sort();
    if (ids.length === 0) continue;
    const checks = ids.map((id) => status.checks[id]);
    const state = componentState(checks, now);
    const old = isObject(status.components[key]) ? status.components[key] : null;
    let since = old?.state === state && old.since ? old.since : new Date(now).toISOString();
    if (state === "outage" || state === "degraded") {
      if (old?.state !== state) since = failingSince(checks, now) ?? since;
    }
    components[key] = { name, state, since, checks: ids };
  }
  status.components = components;
  status.overall = overallState(Object.values(components).map((component) => component.state));
  status.updated_at = new Date(now).toISOString();

  return { status, uptime, history, deploys, skipped: null };
}

export function pruneUptime(uptime, now) {
  const oldest = dayOf(new Date(now - KEEP_DAYS * DAY).toISOString());
  for (const days of Object.values(uptime)) {
    if (!isObject(days)) continue;
    for (const day of Object.keys(days)) if (day < oldest) delete days[day];
  }
}

// History day files older than KEEP_DAYS, by name.
export function expiredHistoryFiles(names, now) {
  const oldest = dayOf(new Date(now - KEEP_DAYS * DAY).toISOString());
  return names.filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name) && name.slice(0, 10) < oldest);
}

// ----------------------------------------------------------------- files

async function readJson(file) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { value: null };
    throw error;
  }
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { value: null, damaged: true };
  }
}

// Write to a temporary file, then rename: a run cut off half-way never
// leaves a half-written file for the status page to choke on.
async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, file);
}

export async function record({ runFile, stateDir, now, log = (line) => console.log(line) }) {
  const run = JSON.parse(await readFile(runFile, "utf8"));
  const problems = runProblems(run);
  if (problems.length) throw new UsageError(`run.json is not valid: ${problems.join("; ")}`);

  const statusFile = path.join(stateDir, "status.json");
  const uptimeFile = path.join(stateDir, "uptime", "daily.json");
  const status = await readJson(statusFile);
  const uptime = await readJson(uptimeFile);
  // A damaged file is replaced, not trusted, and the old copy is kept beside
  // it for a person to look at. Streaks restart from zero.
  for (const [file, read] of [[statusFile, status], [uptimeFile, uptime]]) {
    if (read.damaged) {
      log(`state: ${path.basename(file)} could not be read; starting it again (old copy kept as ${path.basename(file)}.damaged).`);
      await rename(file, `${file}.damaged`);
    }
  }

  const result = recordRun({ status: status.value, uptime: uptime.value, run, now });
  if (result.skipped) {
    log(`state: the ${run.suite} run of ${run.started_at} was already filed; nothing changed.`);
    return result;
  }

  const historyDir = path.join(stateDir, "history");
  await mkdir(historyDir, { recursive: true });
  await appendFile(path.join(historyDir, `${result.history.day}.jsonl`), `${JSON.stringify(result.history.line)}\n`);
  for (const name of expiredHistoryFiles(await readdir(historyDir), now)) await unlink(path.join(historyDir, name));
  if (result.deploys.length) {
    await appendFile(path.join(stateDir, "deploys.jsonl"), result.deploys.map((line) => `${JSON.stringify(line)}\n`).join(""));
  }
  await writeJson(uptimeFile, result.uptime);
  await writeJson(statusFile, result.status);

  const failed = run.checks.filter((check) => !check.ok).length;
  const states = Object.entries(result.status.components).map(([key, value]) => `${key} ${value.state}`).join(", ");
  log(`state: filed the ${run.suite} run (${run.checks.length} checks, ${failed} failed${result.history.line.blind ? "; the monitor reached nothing, so nothing was counted" : ""}). Overall ${result.status.overall}: ${states}.`);
  for (const line of result.deploys) log(`state: new ${line.what} ${line.fact} seen: ${line.from} -> ${line.to}.`);
  return result;
}

class UsageError extends Error {}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== "record") throw new UsageError("usage: node scripts/sre/state.mjs record --run run.json --state-dir DIR");
  const args = {};
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (flag === "--run" || flag === "--state-dir") {
      if (!rest[i + 1]) throw new UsageError(`${flag} needs a value`);
      args[flag === "--run" ? "runFile" : "stateDir"] = rest[(i += 1)];
    } else throw new UsageError(`unknown option ${flag}`);
  }
  if (!args.runFile || !args.stateDir) throw new UsageError("--run and --state-dir are both required");
  return args;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    await record({ ...args, now: nowFrom() });
  } catch (error) {
    console.error(`state: ${error.message}`);
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
