// Tests for weekly-report.mjs with generated state directories. Nothing here
// touches the network; every clock is fixed. Every incident text is marked
// TEST DATA. Run: node --test scripts/sre/weekly-report.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  buildReport, code, isoWeek, issueBody, loadState, main, minutesText, parseArgs, readJsonLines, reportPeriod, safeText,
} from "./weekly-report.mjs";

const run = promisify(execFile);
const SCRIPT = fileURLToPath(new URL("./weekly-report.mjs", import.meta.url));
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// A Monday morning, as the workflow runs. The week is 2026-11-09 .. 2026-11-15.
const NOW = Date.parse("2026-11-16T07:23:00.000Z");
const END = Date.parse("2026-11-16T00:00:00.000Z");
const START = END - 7 * DAY;

// ---- fixtures -------------------------------------------------------------

const line = (t, c, suite = "fast") => JSON.stringify({ t: new Date(t).toISOString(), suite, region: "eastus", c });
const good = () => ({
  "public-home": [1, 240, ["public-availability", "public-latency"]],
  "api-health": [1, 180, ["api-availability", "api-latency"]],
  "calculators-deal-page": [1, 260, ["calculators-availability"]],
  "inquiry-route": [1, 150, ["inquiry-availability"]],
  "staff-home": [1, 210, ["staff-availability"]],
});

function series({ from, to, every = 5, suite = "fast", shape = (c) => c }) {
  const out = [];
  for (let t = from; t <= to; t += every * MIN) out.push(line(t, shape(good(), t), suite));
  return out;
}

async function stateDir({ history = [], files = {} } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "weekly-report-"));
  await mkdir(path.join(dir, "history"));
  const byDay = new Map();
  for (const text of history) {
    const day = JSON.parse(text).t.slice(0, 10);
    byDay.set(day, `${byDay.get(day) || ""}${text}\n`);
  }
  for (const [day, text] of byDay) await writeFile(path.join(dir, "history", `${day}.jsonl`), text);
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(dir, name), typeof text === "string" ? text : JSON.stringify(text));
  return dir;
}

async function reportFor(options) {
  const dir = await stateDir(options);
  try {
    return buildReport(await loadState(dir, NOW), NOW);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const section = (report, heading) => {
  const start = report.indexOf(`## ${heading}`);
  assert.ok(start >= 0, `missing section ${heading}`);
  const next = report.indexOf("\n## ", start + 3);
  return report.slice(start, next < 0 ? undefined : next);
};

const fullMonth = () => [
  ...series({ from: END - 28 * DAY + 5 * MIN, to: NOW }),
  ...series({ from: END - 28 * DAY + HOUR, to: NOW, every: 60, suite: "slow", shape: () => ({ "tls-public": [1, 90, []] }) }),
];
const noIncidents = { schema: 1, engine: {}, open: [], recent: [] };

// ---- time -----------------------------------------------------------------

test("the week is the seven whole UTC days before today, labelled like date +%G-W%V", () => {
  assert.deepEqual(reportPeriod(NOW), { start: START, end: END, week: "2026-W46" });
  // Run mid-week, it previews the current week (and Monday's run replaces it).
  assert.equal(reportPeriod(Date.parse("2026-11-19T10:00:00Z")).week, "2026-W47");
  assert.equal(isoWeek(Date.parse("2027-01-01T12:00:00Z")), "2026-W53");
  assert.equal(isoWeek(Date.parse("2024-12-30T12:00:00Z")), "2025-W01");
  assert.equal(isoWeek(Date.parse("2021-01-03T12:00:00Z")), "2020-W53");
  assert.equal(isoWeek(Date.parse("2026-01-01T00:00:00Z")), "2026-W01");
});

test("minutes read the way people say them", () => {
  assert.equal(minutesText(40.32), "40 min");
  assert.equal(minutesText(201.6), "3 h 22 min");
  assert.equal(minutesText(120), "2 h");
});

// ---- no data --------------------------------------------------------------

test("an empty state directory: every section says there is no data, and nothing is made up", async () => {
  const report = await reportFor({});
  assert.match(report, /^# Reliability report 2026-W46\n/);
  assert.match(report, /Week: 2026-11-09 to 2026-11-15 \(UTC\)/);
  assert.match(section(report, "Service level objectives"), /No probe results were recorded in the last 28 days/);
  assert.match(section(report, "Incidents"), /`incidents\.json` is missing/);
  assert.match(section(report, "Deploys"), /No deploy record yet/);
  assert.match(section(report, "Automatic fixes"), /No automatic-fix record yet/);
  assert.match(section(report, "Slowest checks"), /No timings were recorded this week/);
  assert.match(section(report, "Monitoring gaps"), /No five-minute probe ran this week/);
  assert.match(section(report, "What to look at this week"), /did not record a single five-minute run/);
  assert.doesNotMatch(report, /\d+(\.\d+)?%/, "no percentage can come out of no data");
});

test("a missing state directory is a broken command (exit 2), not a quiet week", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "weekly-report-missing-"));
  try {
    await assert.rejects(
      run(process.execPath, [SCRIPT, "--state-dir", path.join(dir, "nope"), "--out", path.join(dir, "r.md")]),
      (error) => error.code === 2 && /does not exist/.test(error.stderr),
    );
    await assert.rejects(run(process.execPath, [SCRIPT, "--state-dir", dir]), (error) => error.code === 2 && /--out is required/.test(error.stderr));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- a quiet, healthy week ------------------------------------------------

test("a healthy month: targets met, nothing to look at", async () => {
  const report = await reportFor({ history: fullMonth(), files: { "incidents.json": noIncidents, "deploys.jsonl": "", "remediation-log.jsonl": "" } });
  // The only thing to look at in a healthy, fully measured month: the targets
  // are still proposals, and now there is history to decide them on.
  const look = section(report, "What to look at this week").trim().split("\n").filter((l) => l.startsWith("- "));
  assert.equal(look.length, 1);
  assert.match(look[0], /There are now 28 days of measured history\. 7 targets are still proposals/);
  const table = section(report, "Service level objectives");
  assert.match(table, /\| Website availability \| 99\.9% \(proposed\), 40 min \| 100% \| 100% \| 100% \| Healthy \|/);
  assert.match(table, /\| API speed \(under 1,000 ms\) \| 95% \(proposed\), 1 in 20 may be slow \| 100% \| 100% \| 100% \| Healthy \|/);
  assert.doesNotMatch(table, /covers only the time since/);
  assert.match(section(report, "Incidents"), /No incidents were open at any time this week/);
  assert.match(section(report, "Deploys"), /No deploys were seen this week/);
  assert.match(section(report, "Automatic fixes"), /No automatic-fix decisions were made this week/);
  assert.match(section(report, "Monitoring gaps"), /Five-minute probes: 2016 of the 2016 scheduled \(100%\)\. Hourly probes: 168 of 168/);
  assert.match(section(report, "Monitoring gaps"), /No gap longer than 20 minutes/);
});

test("a quiet week with nothing at all to flag says so", async () => {
  // One healthy, fully probed week (both suites): too little history for the
  // proposals prompt, and nothing else to flag.
  const history = [
    ...series({ from: START, to: NOW }),
    ...series({ from: START + HOUR, to: NOW, every: 60, suite: "slow", shape: () => ({ "tls-public": [1, 90, []] }) }),
  ];
  const report = await reportFor({ history, files: { "incidents.json": noIncidents } });
  assert.match(section(report, "What to look at this week"), /- Nothing in this week's data needs attention\./);
});

// ---- a bad week -----------------------------------------------------------

test("a spent budget is said plainly, with what the policy asks for", async () => {
  // The website down for three hours on Saturday.
  const outage = (c, t) => (t > END - 2 * DAY && t <= END - 2 * DAY + 3 * HOUR ? { ...c, "public-home": [0, null, c["public-home"][2]] } : c);
  const history = series({ from: END - 28 * DAY + 5 * MIN, to: NOW, shape: outage });
  const report = await reportFor({ history, files: { "incidents.json": noIncidents } });
  const look = section(report, "What to look at this week");
  assert.match(look, /\*\*Website availability has spent its error budget\*\* \(-?\d+(\.\d)?% left\)/);
  assert.match(look, /The error-budget policy asks to stop merging and deploying feature changes/);
  assert.match(look, /Gbenga decides/);
  assert.match(look, /a proposal Gbenga has not accepted yet, so the policy is advice/);
  assert.match(section(report, "Service level objectives"), /\| Website availability \|[^\n]*\| Spent \|/);
  // The burn is over by the end of the week: no burn alert is claimed.
  assert.doesNotMatch(report, /still burning/);
});

test("a spent speed budget asks for performance work, not a freeze", async () => {
  // One API probe in five slow all month: 20% slow against a 5% allowance.
  let i = 0;
  const slow = (c) => ((i += 1) % 5 === 0 ? { ...c, "api-health": [1, 7700, c["api-health"][2]] } : c);
  const report = await reportFor({ history: series({ from: END - 28 * DAY + 5 * MIN, to: NOW, shape: slow }), files: { "incidents.json": noIncidents } });
  const finding = section(report, "What to look at this week").split("\n").find((l) => l.includes("API speed has spent"));
  assert.ok(finding, "the spent speed budget is named");
  assert.match(finding, /put performance work on the slow part/);
  assert.doesNotMatch(finding, /stop merging/);
});

test("a burn still going at the end of the week is listed with its severity", async () => {
  // Every API probe slow for the last two hours of Sunday.
  const slow = (c, t) => (t > END - 2 * HOUR && t <= END ? { ...c, "api-health": [1, 7700, c["api-health"][2]] } : c);
  const report = await reportFor({ history: series({ from: END - 28 * DAY + 5 * MIN, to: NOW, shape: slow }), files: { "incidents.json": noIncidents } });
  assert.match(section(report, "Service level objectives"), /Burning fast at the end of the week:\n\n- sev3: API speed is using its error budget/);
  assert.match(section(report, "What to look at this week"), /still burning at the end of the week \(a sev3 burn alert\)/);
  assert.match(section(report, "Slowest checks"), /\| API is up|`api-health`/);
});

test("incidents: counted with durations, open ones flagged, texts made safe", async () => {
  const incidents = {
    schema: 1, engine: {},
    open: [{ key: "api", component: "api", severity: "sev2", title: "TEST DATA: API is down", opened_at: new Date(END - 3 * HOUR).toISOString(), issue_number: 41, updates: [] }],
    recent: [
      { key: "public-site", component: "public-site", severity: "sev1", title: "TEST DATA: Website is down | ping @someone <b>", opened_at: new Date(START + DAY).toISOString(), resolved_at: new Date(START + DAY + 50 * MIN).toISOString(), duration_minutes: 50 },
      { key: "staff-site", component: "staff-site", severity: "sev3", title: "TEST DATA: Staff site slow", opened_at: new Date(START - HOUR).toISOString(), resolved_at: new Date(START + 30 * MIN).toISOString(), duration_minutes: 90 },
      { key: "old", component: "api", severity: "sev2", title: "TEST DATA: last month", opened_at: new Date(START - 20 * DAY).toISOString(), resolved_at: new Date(START - 20 * DAY + HOUR).toISOString(), duration_minutes: 60 },
      { title: "damaged entry" },
    ],
  };
  const report = await reportFor({ history: series({ from: START, to: NOW }), files: { "incidents.json": incidents } });
  const part = section(report, "Incidents");
  assert.match(part, /3 incidents this week \(1 sev1, 1 sev2, 1 sev3\): 2 resolved, 1 still open at the end of the week\. The resolved ones lasted 2 h 20 min in all\./);
  assert.match(part, /TEST DATA: Website is down \\\| ping \(at\)someone b \| 50 min \|/);
  assert.match(part, /still open \(3 h so far\)/);
  assert.doesNotMatch(part, /last month|damaged entry/);
  assert.doesNotMatch(report, /@someone|<b>/);
  const look = section(report, "What to look at this week");
  assert.match(look, /Incident "TEST DATA: API is down" \(sev2\) has been open for 3 h\. Issue #41\./);
  assert.match(look, /postmortem/);
});

test("an unreadable incidents.json is reported, not ignored", async () => {
  const report = await reportFor({ history: series({ from: START, to: NOW }), files: { "incidents.json": "{ not json" } });
  assert.match(section(report, "Incidents"), /could not be read/);
  assert.match(section(report, "What to look at this week"), /could not be read/);
});

test("deploys and automatic fixes from the week only, damaged lines counted", async () => {
  const deploys = [
    { at: new Date(START + DAY).toISOString(), what: "api", check: "api-identity", fact: "revision", from: "diamondecho-api-00028-zin", to: "diamondecho-api-00029-abc" },
    { at: new Date(START - DAY).toISOString(), what: "api", check: "api-identity", fact: "revision", from: "a", to: "b" },
    { at: new Date(START + 2 * DAY).toISOString(), what: "site", check: "public-home", fact: "commit", from: "59f8d46", to: "`evil|`" },
  ].map((row) => JSON.stringify(row)).join("\n");
  const fixes = [
    { at: new Date(START + DAY).toISOString(), trigger: "api", action: "cloud-run-rollback", decision: "dry-run", reason: "API failing 3 runs after a new revision.", from_revision: "r2", to_revision: "r1", verified: null },
    { at: new Date(START + 2 * DAY).toISOString(), trigger: "api", action: "cloud-run-rollback", decision: "skipped", reason: "Not a deploy problem.", verified: null },
    { at: new Date(START + 3 * DAY).toISOString(), trigger: "api", action: "cloud-run-rollback", decision: "failed", reason: "Rollback command failed.", verified: false },
  ].map((row) => JSON.stringify(row)).join("\n");
  const report = await reportFor({
    history: series({ from: START, to: NOW }),
    files: { "incidents.json": noIncidents, "deploys.jsonl": `${deploys}\nnot json\n`, "remediation-log.jsonl": `${fixes}\n[1]\n` },
  });
  const dep = section(report, "Deploys");
  assert.match(dep, /2 changes of build seen by the probes this week/);
  assert.match(dep, /api revision `diamondecho-api-00028-zin` to `diamondecho-api-00029-abc`/);
  assert.match(dep, /site commit `59f8d46` to `evil`/);
  assert.match(dep, /1 line of `deploys\.jsonl` could not be read/);
  const fix = section(report, "Automatic fixes");
  assert.match(fix, /3 decisions this week: 1 failed, 1 dry-run, 1 skipped\./);
  assert.match(fix, /dry-run cloud-run-rollback for api \(`r2` to `r1`\)/);
  assert.match(fix, /NOT verified afterwards/);
  assert.match(fix, /1 line of `remediation-log\.jsonl` could not be read/);
  assert.match(section(report, "What to look at this week"), /An automatic fix failed/);
});

// ---- monitoring gaps and sparse data --------------------------------------

test("monitoring gaps: missing hours and whole days are listed, low coverage is flagged", async () => {
  // Probes only on four of the seven days, and a two-hour hole on one of them.
  const keep = (t) => {
    const d = new Date(t).toISOString().slice(0, 10);
    if (["2026-11-10", "2026-11-11", "2026-11-12"].includes(d)) return false;
    return !(t > START + 5 * DAY && t < START + 5 * DAY + 2 * HOUR);
  };
  const history = series({ from: END - 28 * DAY + 5 * MIN, to: NOW }).filter((l) => keep(Date.parse(JSON.parse(l).t)));
  const report = await reportFor({ history, files: { "incidents.json": noIncidents } });
  const gaps = section(report, "Monitoring gaps");
  assert.match(gaps, /Days with no five-minute probe at all: 2026-11-10, 2026-11-11, 2026-11-12\./);
  assert.match(gaps, /2026-11-14 00:00 UTC to 2026-11-14 02:00 UTC: 2 h/);
  assert.match(gaps, /Hourly probes: 0 of 168/);
  const look = section(report, "What to look at this week");
  assert.match(look, /The monitor ran only 56% of its scheduled five-minute probes/);
  assert.match(look, /No hourly probe ran this week/);
});

test("monitoring that started mid-window: the 28-day figure says it covers less, and is not judged yet", async () => {
  const report = await reportFor({ history: series({ from: END - 2 * DAY, to: NOW }), files: { "incidents.json": noIncidents } });
  const table = section(report, "Service level objectives");
  assert.match(table, /"Last 28 days" covers only the time since then/);
  assert.match(table, /\| Website availability \|[^\n]*\| 100% \(early\) \| Not judged yet: \d+ of 1000 probes needed \|/);
  assert.doesNotMatch(report, /still proposals/);
});

test("check names come from status.json when it has them", async () => {
  const report = await reportFor({ history: series({ from: START, to: NOW }), files: { "status.json": { checks: { "public-home": { name: "Home page" } } } } });
  assert.match(section(report, "Slowest checks"), /\| Home page \(`public-home`\) \| 2016 \| 240 ms \| 240 ms \| 240 ms \|/);
  assert.match(section(report, "Slowest checks"), /\| `api-health` \|/);
});

test("damaged history lines and unknown SLI names are reported", async () => {
  const history = [...series({ from: START, to: NOW }), line(START + HOUR + 1, { x: [1, 5, ["made-up-sli"]] })];
  const dir = await stateDir({ history });
  try {
    await writeFile(path.join(dir, "history", "2026-11-12.jsonl"), "garbage\n{\"t\":\n", { flag: "a" });
    const report = buildReport(await loadState(dir, NOW), NOW);
    const look = section(report, "What to look at this week");
    assert.match(look, /2 lines of probe history could not be read/);
    assert.match(look, /`made-up-sli`/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- helpers and the command line ----------------------------------------

test("public text is made safe for a Markdown issue", () => {
  assert.equal(safeText("a|b\n@c <script>"), "a\\|b (at)c script");
  // A backslash in the input cannot cancel the escape of a table bar.
  assert.equal(safeText("a\\|b"), "a\\\\\\|b");
  assert.equal(safeText("x".repeat(300), 10).length, 10);
  assert.equal(code("r1`|x"), "`r1x`");
  assert.equal(code(""), "(none)");
});

test("readJsonLines keeps rows with a time and counts the rest", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "weekly-report-jsonl-"));
  try {
    const file = path.join(dir, "x.jsonl");
    await writeFile(file, '{"at":"2026-11-10T00:00:00Z"}\n\n{"at":"never"}\nnope\n');
    assert.deepEqual(await readJsonLines(file), { state: "ok", rows: [{ at: "2026-11-10T00:00:00Z" }], skipped: 2 });
    assert.deepEqual(await readJsonLines(path.join(dir, "none.jsonl")), { state: "missing", rows: [], skipped: 0 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("arguments are checked", () => {
  assert.deepEqual(parseArgs(["--state-dir", "d", "--out", "r.md"]), { stateDir: "d", out: "r.md", apply: false });
  assert.deepEqual(parseArgs(["--apply", "--state-dir", "d", "--out", "r.md"]), { stateDir: "d", out: "r.md", apply: true });
  assert.throws(() => parseArgs(["--state-dir", "d"]), /--out is required/);
  assert.throws(() => parseArgs(["--out", "r.md"]), /--state-dir is required/);
  assert.throws(() => parseArgs(["--state-dir", "d", "--out", "r.md", "--force"]), /unknown option/);
});

// A stand-in for lib/github.mjs that records what it was asked to do.
function fakeGithub(openIssues = []) {
  const calls = [];
  return {
    calls,
    async ensureLabel(name, color, description) { calls.push(["ensureLabel", name]); },
    async listOpenIssues(label) { calls.push(["listOpenIssues", label]); return openIssues; },
    async createIssue({ title, body, labels }) { calls.push(["createIssue", title, labels, body]); return { number: 7, html_url: "https://github.invalid/7" }; },
    async comment(number, body) { calls.push(["comment", number, body]); },
  };
}

test("without --apply no issue is opened; with it, one issue per week, labelled sre-report", async () => {
  const dir = await stateDir({ history: series({ from: START, to: NOW }), files: { "incidents.json": noIncidents } });
  try {
    const out = path.join(dir, "r.md");
    const env = { SRE_NOW: "2026-11-16T07:23:00Z" };
    const quiet = fakeGithub();
    const dry = await main(["--state-dir", dir, "--out", out], { env, log: () => {}, github: quiet });
    assert.equal(dry.issue, null);
    assert.deepEqual(quiet.calls, []);

    const first = fakeGithub([{ number: 3, title: "Reliability report 2026-W45", html_url: "x" }]);
    const opened = await main(["--state-dir", dir, "--out", out, "--apply"], { env, log: () => {}, github: first });
    assert.deepEqual(opened.issue, { action: "opened", number: 7, html_url: "https://github.invalid/7" });
    const create = first.calls.find((c) => c[0] === "createIssue");
    assert.equal(create[1], "Reliability report 2026-W46");
    assert.deepEqual(create[2], ["sre-report"]);
    assert.match(create[3], /^# Reliability report 2026-W46/);
    assert.match(create[3], /saved as `reports\/2026-W46\.md` on the `sre-status` branch/);

    const again = fakeGithub([{ number: 9, title: "Reliability report 2026-W46", html_url: "y" }]);
    const commented = await main(["--state-dir", dir, "--out", out, "--apply"], { env, log: () => {}, github: again });
    assert.equal(commented.issue.action, "commented");
    assert.equal(again.calls.filter((c) => c[0] === "createIssue").length, 0);
    assert.match(again.calls.find((c) => c[0] === "comment")[2], /written again/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an over-long report is cut to fit an issue, and says so", () => {
  const body = issueBody("x".repeat(70_000), "2026-W46");
  assert.ok(body.length < 65_536);
  assert.match(body, /was cut here/);
});

test("the command honours SRE_NOW and writes the report where it is told", async () => {
  const dir = await stateDir({ history: series({ from: START, to: NOW }), files: { "incidents.json": noIncidents } });
  try {
    const out = path.join(dir, "reports", "2026-W46.md");
    await run(process.execPath, [SCRIPT, "--state-dir", dir, "--out", out], { env: { ...process.env, SRE_NOW: "2026-11-16T07:23:00Z" } });
    const report = await readFile(out, "utf8");
    assert.match(report, /^# Reliability report 2026-W46/);
    assert.match(report, /Generated 2026-11-16T07:23:00\.000Z/);
    const result = await main(["--state-dir", dir, "--out", out], { env: { SRE_NOW: "2026-11-19T10:00:00Z" }, log: () => {} });
    assert.equal(result.period.week, "2026-W47");
    await assert.rejects(main(["--state-dir", dir, "--out", out], { env: { SRE_NOW: "next week" }, log: () => {} }), /SRE_NOW/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
