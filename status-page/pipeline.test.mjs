// Proves the status page reads what the monitoring scripts really write, not
// only the hand-made fixtures. It replays two and a half hours of made-up
// monitor runs through the real commands (state.mjs, slo-calc.mjs and
// alert.mjs, as the monitor workflow runs them) into a temporary folder, then
// loads that folder the way the browser does and checks what the page says.
//
// No network: alert.mjs runs without --apply and without a GitHub token or
// webhook, so it only writes files. SRE_NOW stands in for the clock.
//
//   node --test status-page/pipeline.test.mjs

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { makeCheck, makeRun, COMPONENTS } from "../scripts/sre/lib/schema.mjs";
import { buildView, loadData, renderSections } from "./render.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SRE = join(here, "..", "scripts", "sre");
const MINUTE = 60 * 1000;
const START = Date.parse("2026-11-13T08:00:00.000Z");
const RUNS = 30; // every 5 minutes: 08:00 to 10:25 UTC
const LAST = START + (RUNS - 1) * 5 * MINUTE;

// The made-up story, by fast-run number:
//   6 to 10   the home page fails (a sev1 outage that later resolves)
//   26 to 27  the API fails (a sev1 outage still open at the end)
//   28 to 29  the monitor reaches nothing at all (a "blind" run, twice)
const homeFails = (i) => i >= 6 && i <= 10;
const apiFails = (i) => i >= 26 && i <= 27;
const blind = (i) => i >= 28;

function fastRun(i, at) {
  const check = (id, name, component, severity, slis, failing) => makeCheck({
    id, name, component, severity, slis,
    ok: !(failing || blind(i)),
    status: blind(i) ? null : failing ? 503 : 200,
    latency_ms: blind(i) ? null : 180,
    detail: blind(i) ? "No answer." : failing ? "Answered 503." : "",
  });
  return makeRun({
    suite: "fast", vantage: { provider: "test", region: "test" },
    started_at: new Date(at).toISOString(), finished_at: new Date(at + 4000).toISOString(),
    checks: [
      check("public-home", "Home page", "public-site", "sev1", ["public-availability", "public-latency"], homeFails(i)),
      check("search-page", "Search page", "search", "sev2", [], false),
      check("calculators-deal-page", "Deal Studio page", "calculators", "sev2", ["calculators-availability"], false),
      check("inquiry-page", "Contact page", "inquiry", "sev2", ["inquiry-availability"], false),
      check("api-health", "API health", "api", "sev1", ["api-availability", "api-latency"], apiFails(i)),
      check("staff-home", "Staff site", "staff-site", "sev2", ["staff-availability"], false),
    ],
  });
}

function slowRun(at) {
  const check = (id, name, component, severity) => makeCheck({ id, name, component, severity, ok: true, status: 200, latency_ms: 90, slis: [] });
  return makeRun({
    suite: "slow", vantage: { provider: "test", region: "test" },
    started_at: new Date(at).toISOString(), finished_at: new Date(at + 4000).toISOString(),
    checks: [
      check("dns-apex", "DNS for diamondecho.com", "dns", "sev1"),
      check("tls-public", "Website certificate", "tls", "sev3"),
      check("domain-registration", "Domain registration", "domain", "sev3"),
    ],
  });
}

let work;
let stateDir;

// Only PATH is passed on: no GitHub token, repository or webhook can leak in
// from the shell running the tests, so nothing can leave this machine.
function sre(script, args, at) {
  execFileSync(process.execPath, [join(SRE, script), ...args], {
    env: { PATH: process.env.PATH, SRE_NOW: new Date(at).toISOString() },
    stdio: "pipe",
  });
}

before(() => {
  work = mkdtempSync(join(tmpdir(), "status-page-pipeline-"));
  stateDir = join(work, "state");
  const runFile = join(work, "run.json");
  const sloFile = join(stateDir, "slo.json");
  const actions = join(work, "actions.json");
  for (let i = 0; i < RUNS; i += 1) {
    const at = START + i * 5 * MINUTE;
    writeFileSync(runFile, JSON.stringify(fastRun(i, at)));
    sre("state.mjs", ["record", "--run", runFile, "--state-dir", stateDir], at + 5000);
    sre("slo-calc.mjs", ["--state-dir", stateDir, "--window-days", "28", "--out", sloFile], at + 6000);
    sre("alert.mjs", ["--run", runFile, "--state-dir", stateDir, "--out", actions, "--slo", sloFile], at + 7000);
    if (i % 12 === 0) {
      writeFileSync(runFile, JSON.stringify(slowRun(at + MINUTE)));
      sre("state.mjs", ["record", "--run", runFile, "--state-dir", stateDir], at + MINUTE + 5000);
      sre("alert.mjs", ["--run", runFile, "--state-dir", stateDir, "--out", actions], at + MINUTE + 7000);
    }
  }
});

after(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

// The browser's fetch, answered from the state folder.
function folderFetch(url) {
  try {
    const body = readFileSync(join(stateDir, url), "utf8");
    return Promise.resolve({ status: 200, ok: true, json: async () => JSON.parse(body) });
  } catch {
    return Promise.resolve({ status: 404, ok: false, json: async () => null });
  }
}

async function page(now) {
  const loaded = await loadData(folderFetch);
  const view = buildView(loaded, { now, timeZone: "UTC" });
  return { loaded, view, html: Object.values(renderSections(view)).join("\n") };
}

test("all four files the page reads were written by the real commands and load cleanly", async () => {
  const { loaded } = await page(LAST + 10 * 1000);
  for (const [key, file] of Object.entries(loaded)) assert.equal(file.state, "ok", `${key} did not load`);
});

test("banner and services follow status.json from state.mjs, in schema order", async () => {
  const { view } = await page(LAST + 10 * 1000);
  assert.equal(view.mode, "live");
  assert.equal(view.banner.tone, "outage");
  assert.equal(view.banner.title, "There is an outage");
  assert.ok(view.banner.lines.includes("Down: API."), view.banner.lines.join(" | "));
  // The last two runs reached nothing, and the page says so instead of
  // passing them off as fresh results.
  assert.ok(view.banner.lines.some((line) => line.startsWith("The latest automatic check could not reach anything")));
  assert.deepEqual(view.components.map((component) => component.name), Object.values(COMPONENTS));
  const state = Object.fromEntries(view.components.map((component) => [component.key, component.state]));
  assert.equal(state.api, "outage");
  assert.equal(state["public-site"], "operational");
  assert.equal(state.tls, "operational");
});

test("day bars come from uptime/daily.json as state.mjs counts it", async () => {
  const { view } = await page(LAST + 10 * 1000);
  const website = view.components.find((component) => component.key === "public-site").history;
  assert.equal(website.state, "ok");
  assert.equal(website.days.at(-1).day, "2026-11-13");
  // Blind runs are not counted, so 28 runs were filed, 5 of them failed.
  assert.equal(website.days.at(-1).level, "major");
  assert.match(website.summary, /^23 of 28 monitoring runs passed \(82\.14%\) on 1 day with data/);
  const dns = view.components.find((component) => component.key === "dns").history;
  assert.match(dns.summary, /^3 of 3 monitoring runs passed \(100%\)/);
});

test("incidents opened and resolved by alert.mjs appear with their public wording", async () => {
  const { view, html } = await page(LAST + 10 * 1000);
  const open = Object.fromEntries(view.incidents.open.map((incident) => [incident.title, incident]));
  assert.deepEqual(Object.keys(open).sort(), ["API is down", "Monitoring cannot see the site"]);
  assert.equal(open["API is down"].severity, "Major outage");
  assert.equal(open["API is down"].component, "API");
  assert.equal(open["Monitoring cannot see the site"].component, "Monitoring");
  assert.equal(open["Monitoring cannot see the site"].severity, "Minor problem");
  assert.match(html, /class="incident incident--open incident--sev1"/);

  assert.equal(view.incidents.recent.length, 1);
  const [resolved] = view.incidents.recent;
  assert.equal(resolved.title, "Website is down");
  assert.equal(resolved.duration, "30 minutes");
  assert.ok(resolved.updates.some((update) => update.text.startsWith("Resolved:")));
});

test("reliability from slo-calc.mjs: too little data shows no figure and no unaccepted target", async () => {
  const { view, html } = await page(LAST + 10 * 1000);
  assert.equal(view.reliability.state, "ok");
  assert.equal(view.reliability.windowDays, 28);
  assert.ok(view.reliability.items.length > 0);
  for (const item of view.reliability.items) {
    assert.equal(item.share, null, `${item.name} has only hours of data`);
    assert.equal(item.target, null, `${item.name} target is not accepted yet`);
  }
  assert.doesNotMatch(html, /Target:/);
});

test("nothing internal from the real files reaches the page", async () => {
  const { html } = await page(LAST + 10 * 1000);
  // Check ids, the engine's memory, issue links and undefined values.
  assert.doesNotMatch(html, /api-health|public-home|failing_checks|engine|issue|undefined|NaN|null|burn/i);
});

test("an hour after the last run the same real files read as stale", async () => {
  const { view } = await page(LAST + 60 * MINUTE);
  assert.equal(view.mode, "stale");
  assert.ok(view.components.every((component) => component.state === "unknown"));
});
