#!/usr/bin/env node
// The weekly reliability report: what the last seven days actually looked
// like, from the files on the sre-status branch, in plain words.
//
//   node scripts/sre/weekly-report.mjs --state-dir DIR --out report.md [--apply]
//
// With --apply it also opens a GitHub issue labelled "sre-report" holding the
// report (through lib/github.mjs; a dry run without GITHUB_TOKEN). If that
// week's issue is already open, it adds a comment instead of a second issue.
//
// The week is the seven whole UTC days before today (on a Monday, the ISO
// week that just ended). It reads history/, incidents.json, deploys.jsonl,
// remediation-log.jsonl and status.json, and writes one Markdown file. Where a
// file is missing or holds nothing for the week, the report says so; it never
// fills a gap with a guess. The SLO figures are worked out with the same code
// as slo-calc.mjs, at the end of the week, so the two always agree.
//
// The clock is SRE_NOW when that is set (an ISO time). Exit 0: the report was
// written (bad news in it is data). Exit 2: the command itself broke.
//
// Everything in the report is public (it is committed to the sre-status
// branch and posted as an issue). It holds only check names, counts, times,
// revision names and the public incident texts: no visitor data, no secrets.

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { githubClient } from "./lib/github.mjs";
import { computeSlo, historyStart, percent, readHistory, resolveNow, tally } from "./slo-calc.mjs";
import { BUDGET_STATES, PROBE_INTERVAL_MINUTES, SLOS, WINDOW_DAYS, budgetMinutes, minRunsFor } from "./slo.config.mjs";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
export const PERIOD_DAYS = 7;
// A pause between fast runs longer than this is a gap: three runs missed.
export const GAP_MINUTES = 20;
// Below this share of the scheduled fast runs, the week's figures are thin.
export const COVERAGE_WARNING = 0.9;
const SLOWEST = 5;
const LIST_LIMIT = 10;

// ---- time -----------------------------------------------------------------

// The ISO week (YYYY-Www) that holds the moment `ms`, in UTC. The same label
// as `date -u +%G-W%V`.
export function isoWeek(ms) {
  const d = new Date(ms);
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday); // the Thursday of this week
  const year = day.getUTCFullYear();
  const week = Math.ceil(((day - Date.UTC(year, 0, 1)) / DAY + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

// The seven whole UTC days before the day `now` falls in. The label is the
// ISO week of the last of them: run on a Monday, that is the week just ended.
export function reportPeriod(now) {
  const end = Math.floor(now / DAY) * DAY;
  const start = end - PERIOD_DAYS * DAY;
  return { start, end, week: isoWeek(end - 1) };
}

const iso = (ms) => new Date(ms).toISOString();
const day = (ms) => iso(ms).slice(0, 10);
const when = (ms) => `${iso(ms).slice(0, 16).replace("T", " ")} UTC`;
const inPeriod = (ms, period) => ms > period.start && ms <= period.end;

// A run counts as a probe only when it measured something: a blind run (the
// monitor reached nothing) is filed with no results and is reported on its
// own, never as coverage.
const measured = (r) => r.checks.length > 0;

export function minutesText(minutes) {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

// ---- making text safe for a public Markdown page --------------------------

// Texts that came from a file go into a table cell or a list item: one line,
// no table breaks, no HTML, no @mentions (GitHub would notify someone).
export function safeText(value, max = 200) {
  const text = String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/@/g, "(at)")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Short machine names (revisions, commits, check ids) as code.
export function code(value, max = 80) {
  const text = String(value ?? "").replace(/[`\r\n|]/g, "").slice(0, max);
  return text ? `\`${text}\`` : "(none)";
}

// ---- reading the state directory ------------------------------------------

async function readText(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// A JSON file: { state: "missing" | "unreadable" | "ok", data }.
export async function readJsonFile(file) {
  const text = await readText(file);
  if (text === null) return { state: "missing", data: null };
  try {
    return { state: "ok", data: JSON.parse(text) };
  } catch {
    return { state: "unreadable", data: null };
  }
}

// A JSONL file: { state, rows, skipped }. Unreadable lines are counted, not fatal.
export async function readJsonLines(file) {
  const text = await readText(file);
  if (text === null) return { state: "missing", rows: [], skipped: 0 };
  const rows = [];
  let skipped = 0;
  for (const raw of text.split("\n")) {
    const lineText = raw.trim();
    if (!lineText) continue;
    try {
      const row = JSON.parse(lineText);
      if (row && typeof row === "object" && !Array.isArray(row) && !Number.isNaN(Date.parse(row.at))) rows.push(row);
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  return { state: "ok", rows, skipped };
}

export async function loadState(stateDir, now) {
  const period = reportPeriod(now);
  const history = await readHistory(stateDir, { fromMs: Math.min(period.start, historyStart(period.end, WINDOW_DAYS)), toMs: period.end });
  return {
    period,
    history,
    status: await readJsonFile(path.join(stateDir, "status.json")),
    incidents: await readJsonFile(path.join(stateDir, "incidents.json")),
    deploys: await readJsonLines(path.join(stateDir, "deploys.jsonl")),
    remediations: await readJsonLines(path.join(stateDir, "remediation-log.jsonl")),
  };
}

// ---- the pieces of the report ---------------------------------------------

const STATE_LABEL = Object.fromEntries(BUDGET_STATES.map((s) => [s.state, s.label]));
const STATE_ASKS = Object.fromEntries(BUDGET_STATES.map((s) => [s.state, s.asks]));
const STATE_ASKS_SPEED = Object.fromEntries(BUDGET_STATES.map((s) => [s.state, s.asks_speed]));
const share = (good, total) => (total ? percent(good / total, 3) : "no data");

export function sloSection({ runs, period, weekDoc }) {
  const lines = [];
  const findings = [];
  lines.push("## Service level objectives");
  lines.push("");
  if (!weekDoc.slos.some((s) => s.total > 0) && !runs.some((r) => measured(r) && inPeriod(r.t, period))) {
    lines.push("No probe results were recorded in the last 28 days, so there is nothing to measure the targets against.");
    lines.push("");
    return { lines, findings };
  }
  lines.push(`Targets are measured over a rolling ${WINDOW_DAYS} days, ending at the end of this report's week. "This week" is the same measure over the seven days alone.`);
  lines.push("");
  lines.push("| Measure | Target (budget per 28 days) | This week | Last 28 days | Budget left | State |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const s of weekDoc.slos) {
    const config = SLOS.find((c) => c.id === s.id);
    const week = tally(runs, config, period.start, period.end);
    const budget = config.kind === "latency"
      ? `1 in ${Math.round(1 / (1 - s.target))} may be slow`
      : minutesText(budgetMinutes(s.target, WINDOW_DAYS));
    const target = `${percent(s.target)}${s.accepted ? "" : " (proposed)"}, ${budget}`;
    const name = config.kind === "latency" ? `${s.name} (under ${config.threshold_ms.toLocaleString("en-US")} ms)` : s.name;
    let left = "no data";
    let state = "No data";
    if (s.total) {
      left = s.enough_data ? percent(s.budget_remaining, 1) : `${percent(s.budget_remaining, 1)} (early)`;
      state = s.enough_data ? (STATE_LABEL[s.budget_state] || "Healthy") : `Not judged yet: ${s.runs} of ${minRunsFor(s.target)} probes needed`;
    }
    lines.push(`| ${name} | ${target} | ${share(week.good, week.total)} | ${share(s.good, s.total)} | ${left} | ${state} |`);

    if (s.enough_data && STATE_ASKS[s.budget_state]) {
      const advisory = s.accepted ? "" : " This target is a proposal Gbenga has not accepted yet, so the policy is advice, not a rule.";
      const opening = s.budget_state === "exhausted"
        ? `**${s.name} has spent its error budget** (${percent(s.budget_remaining, 1)} left).`
        : `${s.name} has ${percent(s.budget_remaining, 1)} of its error budget left (${STATE_LABEL[s.budget_state].toLowerCase()}).`;
      const asks = config.kind === "latency" ? STATE_ASKS_SPEED[s.budget_state] : STATE_ASKS[s.budget_state];
      findings.push(`${opening} The error-budget policy asks to ${asks} Gbenga decides; an exception is recorded as \`docs/sre/error-budget-policy.md\` describes.${advisory}`);
    }
  }
  lines.push("");
  // Say so when the "28 days" are really fewer: monitoring started later.
  const firsts = weekDoc.slos.map((s) => s.first_event_at).filter(Boolean).map(Date.parse);
  const windowStart = period.end - WINDOW_DAYS * DAY;
  if (firsts.length && Math.min(...firsts) > windowStart + DAY) {
    lines.push(`The first probe result in the window is from ${when(Math.min(...firsts))}, so "Last 28 days" covers only the time since then.`);
    lines.push("");
  }
  const alerts = weekDoc.burn_alerts;
  if (alerts.length) {
    lines.push("Burning fast at the end of the week:");
    lines.push("");
    for (const alert of alerts) {
      lines.push(`- ${alert.severity}: ${safeText(alert.text, 300)}`);
      findings.push(`${safeText(alert.text, 300)} It was still burning at the end of the week (a ${alert.severity} burn alert): check whether it still is.`);
    }
    lines.push("");
  }
  return { lines, findings };
}

export function incidentSection(incidents, period) {
  const lines = ["## Incidents", ""];
  const findings = [];
  if (incidents.state === "missing") {
    lines.push("No incident record was found (`incidents.json` is missing), so this section cannot say whether there were any.", "");
    findings.push("`incidents.json` is missing from the status branch: the alert engine has not saved its record.");
    return { lines, findings, count: null };
  }
  const data = incidents.data;
  if (incidents.state === "unreadable" || !data || typeof data !== "object" || !Array.isArray(data.open) || !Array.isArray(data.recent)) {
    lines.push("The incident record (`incidents.json`) could not be read, so this section cannot say whether there were any.", "");
    findings.push("`incidents.json` could not be read. The alert engine's memory may be damaged; see `docs/sre/runbooks/monitoring-is-blind.md`.");
    return { lines, findings, count: null };
  }
  const rows = [];
  for (const item of data.recent) {
    const opened = Date.parse(item?.opened_at);
    const resolved = Date.parse(item?.resolved_at);
    if (Number.isNaN(opened) || Number.isNaN(resolved)) continue;
    // Resolved incidents that overlapped the week.
    if (resolved <= period.start || opened > period.end) continue;
    const minutes = Number.isFinite(item.duration_minutes) ? item.duration_minutes : (resolved - opened) / MINUTE;
    rows.push({ item, opened, minutes, open: false });
  }
  for (const item of data.open) {
    const opened = Date.parse(item?.opened_at);
    if (Number.isNaN(opened) || opened > period.end) continue;
    rows.push({ item, opened, minutes: (period.end - opened) / MINUTE, open: true });
  }
  rows.sort((a, b) => a.opened - b.opened);
  if (!rows.length) {
    lines.push("No incidents were open at any time this week.", "");
    return { lines, findings, count: 0 };
  }
  const resolved = rows.filter((r) => !r.open);
  const open = rows.filter((r) => r.open);
  const total = resolved.reduce((sum, r) => sum + r.minutes, 0);
  const bySeverity = {};
  for (const r of rows) bySeverity[r.item.severity] = (bySeverity[r.item.severity] || 0) + 1;
  const severities = Object.entries(bySeverity).sort().map(([s, n]) => `${n} ${safeText(s, 10)}`).join(", ");
  lines.push(`${rows.length} incident${rows.length === 1 ? "" : "s"} this week (${severities}): ${resolved.length} resolved, ${open.length} still open at the end of the week.${resolved.length ? ` The resolved ones lasted ${minutesText(total)} in all.` : ""}`);
  lines.push("");
  lines.push("| Opened | Severity | Part | What | Lasted |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const r of rows) {
    const lasted = r.open ? `still open (${minutesText(r.minutes)} so far)` : minutesText(r.minutes);
    lines.push(`| ${when(r.opened)} | ${safeText(r.item.severity, 10)} | ${safeText(r.item.component, 40)} | ${safeText(r.item.title)} | ${lasted} |`);
  }
  lines.push("");
  for (const r of open) {
    findings.push(`Incident "${safeText(r.item.title)}" (${safeText(r.item.severity, 10)}) has been open for ${minutesText(r.minutes)}.${r.item.issue_number ? ` Issue #${Number(r.item.issue_number)}.` : ""}`);
  }
  if (resolved.some((r) => ["sev1", "sev2"].includes(r.item.severity))) {
    findings.push("A sev1 or sev2 incident was resolved this week: check that its postmortem is written (`docs/sre/postmortem-template.md`).");
  }
  return { lines, findings, count: rows.length };
}

export function deploySection(deploys, period) {
  const lines = ["## Deploys", ""];
  if (deploys.state === "missing") {
    lines.push("No deploy record yet (`deploys.jsonl` is missing). Deploys are recorded when a probe sees a new API revision or a new website build.", "");
    return { lines, findings: [] };
  }
  const rows = deploys.rows.filter((row) => inPeriod(Date.parse(row.at), period)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (!rows.length) lines.push("No deploys were seen this week.");
  else {
    lines.push(`${rows.length} change${rows.length === 1 ? "" : "s"} of build seen by the probes this week:`);
    lines.push("");
    for (const row of rows.slice(0, LIST_LIMIT * 2)) {
      lines.push(`- ${when(Date.parse(row.at))}: ${safeText(row.what, 20)} ${safeText(row.fact, 20)} ${code(row.from)} to ${code(row.to)}`);
    }
    if (rows.length > LIST_LIMIT * 2) lines.push(`- and ${rows.length - LIST_LIMIT * 2} more`);
  }
  if (deploys.skipped) lines.push("", `${deploys.skipped} line${deploys.skipped === 1 ? "" : "s"} of \`deploys.jsonl\` could not be read.`);
  lines.push("");
  return { lines, findings: [] };
}

export function remediationSection(log, period) {
  const lines = ["## Automatic fixes", ""];
  const findings = [];
  if (log.state === "missing") {
    lines.push("No automatic-fix record yet (`remediation-log.jsonl` is missing). The automatic rollback stays off until Gbenga switches it on (`docs/sre/auto-remediation.md`).", "");
    return { lines, findings };
  }
  const rows = log.rows.filter((row) => inPeriod(Date.parse(row.at), period)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (!rows.length) lines.push("No automatic-fix decisions were made this week.");
  else {
    const counts = {};
    for (const row of rows) counts[row.decision] = (counts[row.decision] || 0) + 1;
    const order = ["acted", "failed", "dry-run", "skipped"];
    const summary = [...order, ...Object.keys(counts).filter((k) => !order.includes(k))]
      .filter((k) => counts[k]).map((k) => `${counts[k]} ${safeText(k, 20)}`).join(", ");
    lines.push(`${rows.length} decision${rows.length === 1 ? "" : "s"} this week: ${summary}.`);
    const notable = rows.filter((row) => row.decision === "acted" || row.decision === "failed" || row.decision === "dry-run");
    if (notable.length) {
      lines.push("");
      for (const row of notable.slice(0, LIST_LIMIT)) {
        const revisions = row.from_revision || row.to_revision ? ` (${code(row.from_revision)} to ${code(row.to_revision)})` : "";
        const verified = row.verified === true ? ", verified afterwards" : row.verified === false ? ", NOT verified afterwards" : "";
        lines.push(`- ${when(Date.parse(row.at))}: ${safeText(row.decision, 20)} ${safeText(row.action, 40)} for ${safeText(row.trigger, 40)}${revisions}${verified}. ${safeText(row.reason)}`);
      }
      if (notable.length > LIST_LIMIT) lines.push(`- and ${notable.length - LIST_LIMIT} more`);
    }
    for (const row of rows.filter((r) => r.decision === "failed")) {
      findings.push(`An automatic fix failed at ${when(Date.parse(row.at))} (${safeText(row.action, 40)}): check the service by hand.`);
    }
    for (const row of rows.filter((r) => r.decision === "acted")) {
      findings.push(`An automatic fix acted at ${when(Date.parse(row.at))} (${safeText(row.action, 40)}): the change it undid still needs a person to look at it.`);
    }
  }
  if (log.skipped) lines.push("", `${log.skipped} line${log.skipped === 1 ? "" : "s"} of \`remediation-log.jsonl\` could not be read.`);
  lines.push("");
  return { lines, findings };
}

function nearestRank(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

export function slowestSection(runs, period, names = {}) {
  const lines = ["## Slowest checks", ""];
  const byCheck = new Map();
  for (const r of runs) {
    if (!inPeriod(r.t, period)) continue;
    for (const c of r.checks) {
      if (!c.ok || c.latency_ms === null) continue;
      if (!byCheck.has(c.id)) byCheck.set(c.id, []);
      byCheck.get(c.id).push(c.latency_ms);
    }
  }
  if (!byCheck.size) {
    lines.push("No timings were recorded this week.", "");
    return { lines, findings: [] };
  }
  const rows = [...byCheck.entries()].map(([id, values]) => {
    const sorted = values.sort((a, b) => a - b);
    return { id, n: sorted.length, median: nearestRank(sorted, 0.5), p95: nearestRank(sorted, 0.95), max: sorted[sorted.length - 1] };
  }).sort((a, b) => b.p95 - a.p95 || b.max - a.max).slice(0, SLOWEST);
  lines.push("Answered checks only, timed from the probe's side (one place, through the internet). The 95th percentile is the time 19 of 20 answers beat.");
  lines.push("");
  lines.push("| Check | Answers | Median | 95th percentile | Slowest |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const row of rows) {
    const label = names[row.id] ? `${safeText(names[row.id], 60)} (${code(row.id)})` : code(row.id);
    lines.push(`| ${label} | ${row.n} | ${row.median} ms | ${row.p95} ms | ${row.max} ms |`);
  }
  lines.push("");
  return { lines, findings: [] };
}

export function blindFindings(runs, period) {
  const week = runs.filter((r) => inPeriod(r.t, period));
  const blind = week.filter((r) => r.blind > 0 && !measured(r));
  const refusedRuns = week.filter((r) => r.refused > 0);
  const refused = refusedRuns.reduce((sum, r) => sum + r.refused, 0);
  const findings = [];
  if (blind.length) {
    findings.push(`${blind.length} monitor run${blind.length === 1 ? " was" : "s were"} blind this week (the first at ${when(blind[0].t)}, the last at ${when(blind[blind.length - 1].t)}): the monitor reached nothing, not even outside services, so ${blind.length === 1 ? "it" : "they"} measured nothing about the site and ${blind.length === 1 ? "is" : "are"} not counted as probes. See \`docs/sre/runbooks/monitoring-is-blind.md\`.`);
  }
  if (refused) {
    findings.push(`Cloudflare refused ${refused} of the monitor's checks in ${refusedRuns.length} run${refusedRuns.length === 1 ? "" : "s"} this week. Those checks measured the monitor's access, not the site, and were left out of the figures.`);
  }
  return { blind: blind.length, refusedRuns: refusedRuns.length, refused, findings };
}

export function gapSection(runs, period) {
  const lines = ["## Monitoring gaps", ""];
  const findings = [];
  const fast = runs.filter((r) => r.suite === "fast" && measured(r) && inPeriod(r.t, period)).map((r) => r.t);
  const slow = runs.filter((r) => r.suite === "slow" && measured(r) && inPeriod(r.t, period)).length;
  const postDeploy = runs.filter((r) => r.suite === "post-deploy" && measured(r) && inPeriod(r.t, period)).length;
  const blindRuns = runs.filter((r) => !measured(r) && r.blind > 0 && inPeriod(r.t, period)).length;
  const blindText = blindRuns ? ` ${blindRuns} more run${blindRuns === 1 ? " was" : "s were"} blind (reached nothing) and ${blindRuns === 1 ? "is" : "are"} not counted.` : "";
  const expected = (PERIOD_DAYS * 24 * 60) / PROBE_INTERVAL_MINUTES;
  if (!fast.length) {
    if (blindRuns) {
      lines.push(`**No five-minute probe measured anything this week.** All ${blindRuns} run${blindRuns === 1 ? " that happened was" : "s that happened were"} blind (reached nothing). The site was not watched, and every figure above that depends on probes is missing for that reason.`, "");
      findings.push("Not one five-minute run measured the site this week: every run that happened was blind. Check the monitor's network first (`docs/sre/runbooks/monitoring-is-blind.md`).");
    } else {
      lines.push("**No five-minute probe ran this week.** The site was not watched, and every figure above that depends on probes is missing for that reason.", "");
      findings.push("The monitor did not record a single five-minute run this week. Check the SRE monitor workflow first (`docs/sre/runbooks/monitoring-is-blind.md`).");
    }
    return { lines, findings, coverage: 0 };
  }
  const coverage = Math.min(1, fast.length / expected);
  lines.push(`Five-minute probes: ${fast.length} of the ${expected} scheduled (${percent(coverage, 1)}). Hourly probes: ${slow} of ${PERIOD_DAYS * 24}. After-deploy checks: ${postDeploy}.${blindText}`);
  // Gaps: from the start of the week to the first run, between runs, and from
  // the last run to the end of the week.
  const points = [period.start, ...fast, period.end];
  const gaps = [];
  for (let i = 1; i < points.length; i += 1) {
    const minutes = (points[i] - points[i - 1]) / MINUTE;
    if (minutes > GAP_MINUTES) gaps.push({ from: points[i - 1], to: points[i], minutes });
  }
  if (gaps.length) {
    const total = gaps.reduce((sum, g) => sum + g.minutes, 0);
    lines.push("");
    lines.push(`${gaps.length} gap${gaps.length === 1 ? "" : "s"} longer than ${GAP_MINUTES} minutes without a five-minute probe, ${minutesText(total)} in all. The longest:`);
    lines.push("");
    for (const g of [...gaps].sort((a, b) => b.minutes - a.minutes).slice(0, SLOWEST)) {
      lines.push(`- ${when(g.from)} to ${when(g.to)}: ${minutesText(g.minutes)}`);
    }
  } else {
    lines.push("", `No gap longer than ${GAP_MINUTES} minutes.`);
  }
  const days = [];
  // Calendar days, as the history files are: from 00:00 up to (not including) the next 00:00.
  for (let d = period.start; d < period.end; d += DAY) if (!fast.some((t) => t >= d && t < d + DAY)) days.push(day(d));
  if (days.length) lines.push("", `Days with no five-minute probe at all: ${days.join(", ")}.`);
  lines.push("");
  if (!slow) {
    findings.push("No hourly probe ran this week, so the certificate, DNS and domain-registration checks were not done.");
  }
  if (coverage < COVERAGE_WARNING) {
    findings.push(`The monitor ran only ${percent(coverage, 1)} of its scheduled five-minute probes. GitHub's scheduler delays and drops runs; if this stays low, the figures above see less than they seem to.`);
  }
  return { lines, findings, coverage };
}

// ---- the whole report -----------------------------------------------------

export function buildReport(state, generatedAt) {
  const { period, history } = state;
  const runs = history.runs;
  const weekDoc = computeSlo({ runs, now: period.end });
  const names = {};
  const checks = state.status.state === "ok" && state.status.data && typeof state.status.data.checks === "object" ? state.status.data.checks : {};
  for (const [id, check] of Object.entries(checks || {})) if (check && typeof check.name === "string") names[id] = check.name;

  const slo = sloSection({ runs, period, weekDoc });
  const incidents = incidentSection(state.incidents, period);
  const deploys = deploySection(state.deploys, period);
  const fixes = remediationSection(state.remediations, period);
  const slowest = slowestSection(runs, period, names);
  const gaps = gapSection(runs, period);

  const blind = blindFindings(runs, period);
  const findings = [...gaps.findings, ...blind.findings, ...slo.findings, ...incidents.findings, ...fixes.findings];
  if (history.skipped) findings.push(`${history.skipped} line${history.skipped === 1 ? "" : "s"} of probe history could not be read and were left out.`);
  if (weekDoc.inputs.unknown_slis.length) findings.push(`The probe history names measures that \`slo.config.mjs\` does not define: ${weekDoc.inputs.unknown_slis.map((s) => code(s)).join(", ")}. A check and the configuration disagree.`);
  const unaccepted = weekDoc.slos.filter((s) => !s.accepted);
  const judged = weekDoc.slos.filter((s) => s.enough_data);
  if (unaccepted.length && judged.length === weekDoc.slos.length && judged.every((s) => s.coverage >= COVERAGE_WARNING)) {
    findings.push(`There are now ${WINDOW_DAYS} days of measured history. ${unaccepted.length} target${unaccepted.length === 1 ? " is" : "s are"} still proposals: Gbenga can accept or change them (\`docs/sre/slo.md\`, "Changing a target").`);
  }

  const out = [];
  out.push(`# Reliability report ${period.week}`);
  out.push("");
  out.push(`Week: ${day(period.start)} to ${day(period.end - 1)} (UTC). Generated ${iso(generatedAt)} by \`scripts/sre/weekly-report.mjs\` from the \`sre-status\` branch.`);
  out.push("");
  out.push(`These figures come from probes: automated visits from one place (GitHub Actions) every ${PROBE_INTERVAL_MINUTES} minutes when GitHub's scheduler keeps time. They show what a visitor could have done, not a count of real visitors. No visitor data is used.`);
  out.push("");
  out.push("## What to look at this week");
  out.push("");
  if (findings.length) for (const f of findings) out.push(`- ${f}`);
  else out.push("- Nothing in this week's data needs attention.");
  out.push("");
  for (const section of [slo, incidents, deploys, fixes, slowest, gaps]) out.push(...section.lines);
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

// ---- the issue -------------------------------------------------------------

export const REPORT_LABEL = "sre-report";
// GitHub refuses an issue body over 65,536 characters.
export const ISSUE_LIMIT = 60_000;

export function issueBody(report, week) {
  const footer = `\n\n---\nThe report is saved as \`reports/${week}.md\` on the \`sre-status\` branch. Do not paste visitor data, secrets or tokens into this issue.\n`;
  const text = report.length > ISSUE_LIMIT
    ? `${report.slice(0, ISSUE_LIMIT)}\n\n(The report is longer than an issue allows and was cut here; the saved file has all of it.)`
    : report.trimEnd();
  return `${text}${footer}`;
}

// Opens the week's issue, or comments on it when it is already open (a
// report written again for the same week). `client` is lib/github.mjs's.
export async function publishIssue(client, { week, report }) {
  await client.ensureLabel(REPORT_LABEL, "0e8a16", "Weekly reliability report from the SRE automation");
  const title = `Reliability report ${week}`;
  const body = issueBody(report, week);
  const same = (await client.listOpenIssues(REPORT_LABEL)).find((issue) => issue.title === title);
  if (same) {
    await client.comment(same.number, `The report for ${week} was written again.\n\n${body}`);
    return { action: "commented", number: same.number, html_url: same.html_url };
  }
  const issue = await client.createIssue({ title, body, labels: [REPORT_LABEL] });
  return { action: "opened", number: issue.number, html_url: issue.html_url };
}

// ---- command line ---------------------------------------------------------

export function parseArgs(argv) {
  const args = { stateDir: null, out: null, apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--apply") {
      args.apply = true;
      continue;
    }
    if (flag !== "--state-dir" && flag !== "--out") throw new Error(`unknown option ${flag}`);
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value`);
    if (flag === "--state-dir") args.stateDir = value;
    else args.out = value;
    i += 1;
  }
  if (!args.stateDir) throw new Error("--state-dir is required");
  if (!args.out) throw new Error("--out is required");
  return args;
}

export async function main(argv, { now = () => Date.now(), env = process.env, log = console.log, github = null } = {}) {
  const args = parseArgs(argv);
  const at = resolveNow(null, env, now);
  // A missing state directory means the checkout failed: that is a broken
  // command, not a quiet week.
  const info = await stat(args.stateDir).catch(() => null);
  if (!info || !info.isDirectory()) throw new Error(`state directory ${args.stateDir} does not exist`);
  const state = await loadState(args.stateDir, at);
  const report = buildReport(state, at);
  await mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
  await writeFile(args.out, report);
  log(`weekly-report: week ${state.period.week}, ${state.history.runs.length} runs read. Wrote ${args.out}.`);
  let issue = null;
  if (args.apply) {
    issue = await publishIssue(github ?? githubClient({ log }), { week: state.period.week, report });
    log(`weekly-report: issue ${issue.action}${issue.number ? ` #${issue.number}` : " (dry run)"}.`);
  } else {
    log(`weekly-report: without --apply, no issue was opened (it would be "Reliability report ${state.period.week}", label ${REPORT_LABEL}).`);
  }
  return { report, period: state.period, issue };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`weekly-report: ${error.message}`);
    process.exit(2);
  });
}
