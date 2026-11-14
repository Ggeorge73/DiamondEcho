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
const RUNS = 30; // fast runs every 5 minutes: 08:00 to 10:25 UTC
const LAST = START + (RUNS - 1) * 5 * MINUTE;
// After the last fast run, two hourly-suite runs reach nothing at all (a
// "blind" run, as a manual re-run would make them back to back). Only the
// hourly suite has outside services, so only it can be blind, and the
// streak counts only blind runs with no other run between them.
const BLIND_AT = [LAST + MINUTE, LAST + 2 * MINUTE];
const NOW = LAST + 2 * MINUTE + 10 * 1000;

// The made-up story, by fast-run number:
//   6 to 10   the home page fails (a sev1 outage that later resolves)
//   26 to 29  the API fails (a sev1 outage still open at the end)
const homeFails = (i) => i >= 6 && i <= 10;
const apiFails = (i) => i >= 26;

// The fast suite's checks; `fail(id)` says how a check failed, or null.
function fastRun(at, fail = () => null) {
  const check = (id, name, component, severity, slis) => {
    const how = fail(id);
    return makeCheck({
      id, name, component, severity, slis, ok: !how,
      status: how ? how.status : 200, latency_ms: 180, detail: how ? how.detail : "",
    });
  };
  return makeRun({
    suite: "fast", vantage: { provider: "test", region: "test" },
    started_at: new Date(at).toISOString(), finished_at: new Date(at + 4000).toISOString(),
    checks: [
      check("public-home", "Home page", "public-site", "sev1", ["public-availability", "public-latency"]),
      check("search-page", "Property search page", "search", "sev2", []),
      check("calculators-deal-page", "Deal Studio page", "calculators", "sev2", ["calculators-availability"]),
      check("inquiry-page", "Contact page", "inquiry", "sev2", ["inquiry-availability"]),
      check("api-health", "API is up", "api", "sev1", ["api-availability", "api-latency"]),
      check("staff-home", "Staff site loads with its protections", "staff-site", "sev2", ["staff-availability"]),
    ],
  });
}

// The hourly suite, with the real ids of outside checks (DNS resolvers and
// the domain registry). Blind: no answer from anything.
function slowRun(at, { blind = false } = {}) {
  const check = (id, name, component, severity) => makeCheck({
    id, name, component, severity, slis: [], ok: !blind,
    status: blind ? null : 200, latency_ms: blind ? null : 90, detail: blind ? "No answer." : "",
  });
  return makeRun({
    suite: "slow", vantage: { provider: "test", region: "test" },
    started_at: new Date(at).toISOString(), finished_at: new Date(at + 4000).toISOString(),
    checks: [
      check("dns-apex-resolves", "Website address resolves", "dns", "sev1"),
      check("tls-public", "Website certificate", "tls", "sev3"),
      check("domain-expiry", "Domain registration", "domain", "sev3"),
    ],
  });
}

const failWith503 = (ids) => (id) => (ids.includes(id) ? { status: 503, detail: "Answered 503." } : null);
// The words lib/http.mjs uses when Cloudflare turns the monitor away.
const REFUSED = { status: 403, detail: "Cloudflare refused the request (403, error 1010): a Cloudflare security setting is blocking the monitor, and perhaps visitors too. See docs/sre/runbooks/cloudflare-outage.md." };
const refusedUnlessApi = (id) => (id === "api-health" ? null : REFUSED);

let work;
let stateDir;
let cloudflareDir;

// Only PATH is passed on: no GitHub token, repository or webhook can leak in
// from the shell running the tests, so nothing can leave this machine.
function sre(script, args, at) {
  execFileSync(process.execPath, [join(SRE, script), ...args], {
    env: { PATH: process.env.PATH, SRE_NOW: new Date(at).toISOString() },
    stdio: "pipe",
  });
}

// One monitor run as the workflow does it: file, measure SLOs, alert.
function monitor(dir, run, at) {
  const runFile = join(work, "run.json");
  const sloFile = join(dir, "slo.json");
  writeFileSync(runFile, JSON.stringify(run));
  sre("state.mjs", ["record", "--run", runFile, "--state-dir", dir], at + 5000);
  sre("slo-calc.mjs", ["--state-dir", dir, "--window-days", "28", "--out", sloFile], at + 6000);
  sre("alert.mjs", ["--run", runFile, "--state-dir", dir, "--out", join(work, "actions.json"), "--slo", sloFile], at + 7000);
}

before(() => {
  work = mkdtempSync(join(tmpdir(), "status-page-pipeline-"));
  stateDir = join(work, "state");
  for (let i = 0; i < RUNS; i += 1) {
    const at = START + i * 5 * MINUTE;
    const failing = [...(homeFails(i) ? ["public-home"] : []), ...(apiFails(i) ? ["api-health"] : [])];
    monitor(stateDir, fastRun(at, failWith503(failing)), at);
    if (i % 12 === 0) monitor(stateDir, slowRun(at + MINUTE), at + MINUTE);
  }
  for (const at of BLIND_AT) monitor(stateDir, slowRun(at, { blind: true }), at);

  // A second state folder: four good runs, then Cloudflare turns the monitor
  // away from every page it serves for three runs while the API answers.
  cloudflareDir = join(work, "cloudflare");
  for (let i = 0; i < 7; i += 1) {
    const at = START + i * 5 * MINUTE;
    monitor(cloudflareDir, fastRun(at, i >= 4 ? refusedUnlessApi : () => null), at);
  }
});

after(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

// The browser's fetch, answered from a state folder.
const folderFetch = (dir) => (url) => {
  try {
    const body = readFileSync(join(dir, url), "utf8");
    return Promise.resolve({ status: 200, ok: true, json: async () => JSON.parse(body) });
  } catch {
    return Promise.resolve({ status: 404, ok: false, json: async () => null });
  }
};

async function page(now = NOW, dir = stateDir) {
  const loaded = await loadData(folderFetch(dir));
  const view = buildView(loaded, { now, timeZone: "UTC" });
  return { loaded, view, html: Object.values(renderSections(view)).join("\n") };
}

test("all four files the page reads were written by the real commands and load cleanly", async () => {
  const { loaded } = await page();
  for (const [key, file] of Object.entries(loaded)) assert.equal(file.state, "ok", `${key} did not load`);
});

test("banner and services follow status.json from state.mjs, in schema order", async () => {
  const { view } = await page();
  assert.equal(view.mode, "live");
  assert.equal(view.banner.tone, "outage");
  assert.equal(view.banner.title, "There is an outage");
  assert.ok(view.banner.lines.includes("Down: API."), view.banner.lines.join(" | "));
  // The last two hourly runs reached nothing, and the page says so instead
  // of passing them off as fresh results.
  assert.ok(view.banner.lines.some((line) => line.startsWith("A recent automatic check could not reach anything")));
  assert.deepEqual(view.components.map((component) => component.name), Object.values(COMPONENTS));
  const state = Object.fromEntries(view.components.map((component) => [component.key, component.state]));
  assert.equal(state.api, "outage");
  assert.equal(state["public-site"], "operational");
  assert.equal(state.tls, "operational");
});

test("day bars come from uptime/daily.json as state.mjs counts it", async () => {
  const { view } = await page();
  const website = view.components.find((component) => component.key === "public-site").history;
  assert.equal(website.state, "ok");
  assert.equal(website.days.at(-1).day, "2026-11-13");
  // 30 fast runs, 5 with the home page failing.
  assert.equal(website.days.at(-1).level, "major");
  assert.match(website.summary, /^25 of 30 monitoring runs passed \(83\.33%\) on 1 day with data/);
  const dns = view.components.find((component) => component.key === "dns").history;
  // The blind hourly runs are not counted against DNS.
  assert.match(dns.summary, /^3 of 3 monitoring runs passed \(100%\)/);
});

test("incidents opened and resolved by alert.mjs appear with their public wording", async () => {
  const { view, html } = await page();
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
  const { view, html } = await page();
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
  const { html } = await page();
  // Check ids, the engine's memory, issue links and undefined values.
  assert.doesNotMatch(html, /api-health|public-home|failing_checks|engine|issue|undefined|NaN|null|burn/i);
});

test("an hour after the last run the same real files read as stale", async () => {
  const { view } = await page(NOW + 60 * MINUTE);
  assert.equal(view.mode, "stale");
  assert.ok(view.components.every((component) => component.state === "unknown"));
});

test("Cloudflare turning the monitor away: one incident, no false outage, no all-clear", async () => {
  const { view, html } = await page(START + 6 * 5 * MINUTE + 10 * 1000, cloudflareDir);
  // The refused checks were left out, so every part keeps its last measured
  // state; the banner must still not read as an all-clear.
  assert.ok(view.components.every((component) => component.state === "operational"));
  assert.deepEqual(view.incidents.open.map((incident) => [incident.title, incident.component, incident.severity]),
    [["Cloudflare is refusing the monitor", "Monitoring", "Partial outage"]]);
  assert.equal(view.banner.title, "Most services are working");
  assert.equal(view.banner.lines[0], "1 open incident: Cloudflare is refusing the monitor.");
  assert.ok(view.banner.lines.some((line) => line.startsWith("A recent automatic check was turned away")));
  assert.doesNotMatch(html, /All services are working|error 1010|cloudflare-outage\.md/);
  const website = view.components.find((component) => component.key === "public-site").history;
  assert.match(website.summary, /^4 of 4 monitoring runs passed/, "refused runs count neither way");
});
