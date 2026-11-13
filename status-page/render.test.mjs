// Tests for the status page's logic. Run with:
//   node --test status-page/render.test.mjs
// They read the made-up data in test-fixtures/ and never touch the network.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  COMPONENT_NAMES, DATA_FILES, DAYS_SHOWN, RECENT_INCIDENT_DAYS, STALE_AFTER_MINUTES,
  buildView, dayLevel, escapeHtml, formatAge, formatDateTime, formatDuration, formatShare,
  loadData, renderSections,
} from "./render.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const MINUTE = 60 * 1000;
// The moment the fixtures describe (see test-fixtures/README.md).
const FIXTURE_NOW = Date.parse("2026-11-12T15:05:00.000Z");
const UTC = { timeZone: "UTC" };

function fixture(scenario) {
  const loaded = {};
  for (const [key, file] of Object.entries(DATA_FILES)) {
    const path = join(here, "test-fixtures", scenario, file);
    loaded[key] = existsSync(path) ? { state: "ok", data: JSON.parse(readFileSync(path, "utf8")) } : { state: "missing" };
  }
  return loaded;
}

function page(loaded, now = FIXTURE_NOW) {
  const view = buildView(loaded, { now, ...UTC });
  return { view, html: renderSections(view) };
}

const allMissing = () => ({ status: { state: "missing" }, uptime: { state: "missing" }, incidents: { state: "missing" }, slo: { state: "missing" } });

// ------------------------------------------------------------ the contract

test("the component names match the shared schema", async () => {
  const { COMPONENTS } = await import("../scripts/sre/lib/schema.mjs");
  assert.deepEqual(COMPONENT_NAMES, COMPONENTS);
  assert.deepEqual(Object.keys(COMPONENT_NAMES), Object.keys(COMPONENTS));
});

test("every file the page loads is in the publish list, and no test data is", () => {
  const manifest = readFileSync(join(here, "publish-manifest.txt"), "utf8")
    .split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  for (const file of manifest) assert.ok(existsSync(join(here, file)), `${file} is listed but does not exist`);
  assert.ok(!manifest.some((file) => file.includes("test")), "test files must not be published");

  const html = readFileSync(join(here, "index.html"), "utf8");
  const referenced = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]).filter((url) => !/^[a-z]+:/i.test(url));
  for (const file of referenced) assert.ok(manifest.includes(file), `index.html uses ${file}, which is not in publish-manifest.txt`);
  const script = readFileSync(join(here, "status.js"), "utf8");
  for (const match of script.matchAll(/from "\.\/([^"]+)"/g)) assert.ok(manifest.includes(match[1]), `status.js imports ${match[1]}`);
});

test("the page loads nothing from another site and runs no inline code", () => {
  const html = readFileSync(join(here, "index.html"), "utf8");
  const css = readFileSync(join(here, "status.css"), "utf8");
  assert.match(html, /Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'/);
  const loads = [...html.matchAll(/<(?:script|link|img|iframe)\b[^>]*?(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(loads.length >= 3);
  for (const url of loads) assert.ok(!/^(?:[a-z]+:)?\/\//i.test(url), `${url} is loaded from another site`);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/, "no inline script");
  assert.doesNotMatch(html, /<style|\sstyle="|\son[a-z]+="/, "no inline style or handler");
  assert.doesNotMatch(css, /@import|url\(/, "the stylesheet loads nothing");
  // Data files are asked for next to the page, wherever the page is served.
  for (const file of Object.values(DATA_FILES)) assert.doesNotMatch(file, /^\/|:/);
});

// ----------------------------------------------------------------- loading

test("loadData tells a missing file from a broken one and never throws", async () => {
  const answers = {
    "status.json": { status: 200, ok: true, json: async () => ({ schema: 1 }) },
    "uptime/daily.json": { status: 404, ok: false, json: async () => ({}) },
    "incidents.json": { status: 500, ok: false, json: async () => ({}) },
    "slo.json": { status: 200, ok: true, json: async () => { throw new SyntaxError("not JSON"); } },
  };
  const asked = [];
  const loaded = await loadData(async (url, options) => { asked.push([url, options]); return answers[url]; });
  assert.deepEqual(loaded, {
    status: { state: "ok", data: { schema: 1 } },
    uptime: { state: "missing" },
    incidents: { state: "error" },
    slo: { state: "error" },
  });
  assert.deepEqual(asked.map(([url]) => url).sort(), Object.values(DATA_FILES).sort());
  assert.ok(asked.every(([, options]) => options.cache === "no-store"));

  const offline = await loadData(async () => { throw new TypeError("Failed to fetch"); });
  assert.ok(Object.values(offline).every((file) => file.state === "error"));
  const notAnObject = await loadData(async () => ({ status: 200, ok: true, json: async () => [1, 2] }));
  assert.ok(Object.values(notAnObject).every((file) => file.state === "error"));
});

// -------------------------------------------------------------- formatting

test("formatting helpers", () => {
  assert.equal(escapeHtml(`<img src=x onerror="a('b')">&`), "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
  assert.equal(escapeHtml(null), "");
  assert.equal(formatDateTime(Date.parse("2026-11-13T00:05:00Z"), UTC), "Nov 13, 2026, 12:05 AM UTC");
  assert.match(formatDateTime(Date.parse("2026-11-13T00:05:00Z"), { timeZone: "America/New_York" }), /^Nov 12, 2026, 7:05 PM (EST|GMT-5)$/);
  assert.equal(formatAge(20 * 1000), "less than a minute ago");
  assert.equal(formatAge(-5 * MINUTE), "less than a minute ago");
  assert.equal(formatAge(MINUTE), "1 minute ago");
  assert.equal(formatAge(59 * MINUTE), "59 minutes ago");
  assert.equal(formatAge(3 * 60 * MINUTE), "3 hours ago");
  assert.equal(formatAge(50 * 60 * MINUTE), "2 days ago");
  assert.equal(formatDuration(0.2), "less than a minute");
  assert.equal(formatDuration(42), "42 minutes");
  assert.equal(formatDuration(60), "1 hour");
  assert.equal(formatDuration(70), "1 hour 10 minutes");
  assert.equal(formatDuration(26 * 60 + 5), "1 day 2 hours");
  assert.equal(formatDuration(undefined), null);
});

test("a share never rounds a failure away", () => {
  assert.equal(formatShare(288, 288), "100%");
  assert.equal(formatShare(99999, 100000), "99.99%");
  assert.equal(formatShare(8417, 8418), "99.98%");
  assert.equal(formatShare(0, 24), "0.00%");
  assert.equal(formatShare(0, 0), null);
  assert.equal(formatShare(5, 4), null);
  assert.equal(formatShare(undefined, 10), null);
});

test("a day's level comes only from its counts", () => {
  assert.equal(dayLevel(undefined), "none");
  assert.equal(dayLevel({ runs: 0, failed: 0 }), "none");
  assert.equal(dayLevel({ runs: 288, failed: 300 }), "none");
  assert.equal(dayLevel({ runs: "288", failed: 0 }), "none");
  assert.equal(dayLevel({ runs: 288, failed: 0 }), "ok");
  assert.equal(dayLevel({ runs: 288, failed: 5 }), "minor");
  assert.equal(dayLevel({ runs: 288, failed: 6 }), "major");
  assert.equal(dayLevel({ runs: 24, failed: 1 }), "major");
});

// ----------------------------------------------------------- no data, errors

test("with no files at all the page says there is no data yet and shows no numbers", () => {
  const { view, html } = page(allMissing());
  assert.equal(view.mode, "no-data");
  assert.equal(view.banner.title, "No monitoring data yet");
  assert.equal(view.banner.tone, "unknown");
  assert.equal(view.updated, null);
  assert.deepEqual(view.components, []);
  assert.equal(html.updated, "");
  assert.match(html.components, /No services to show yet/);
  assert.match(html.incidents, /No incident data yet/);
  assert.match(html.history, /No incident data yet/);
  assert.match(html.reliability, /Not measured yet/);
  const everything = Object.values(html).join("").replace(/<[^>]*>/g, " ");
  assert.doesNotMatch(everything, /\d/, "nothing that looks like a measurement");
  assert.doesNotMatch(everything, /Operational|working/i);
});

test("a missing incidents file is not reported as 'no incidents'", () => {
  const loaded = { ...fixture("healthy"), incidents: { state: "missing" } };
  const { html } = page(loaded);
  assert.match(html.incidents, /No incident data yet/);
  assert.doesNotMatch(html.incidents + html.history, /No open incidents|No resolved incidents/);
  const broken = page({ ...fixture("healthy"), incidents: { state: "error" } }).html;
  assert.match(broken.incidents, /could not be loaded/);
});

test("a status file that cannot be loaded or understood is an error, not a state", () => {
  const failed = page({ ...allMissing(), status: { state: "error" } });
  assert.equal(failed.view.mode, "error");
  assert.equal(failed.view.banner.title, "Status data could not be loaded");
  assert.match(failed.html.banner, /says nothing about whether the website itself is working/);

  for (const data of [{ schema: 2, updated_at: "2026-11-12T15:00:00Z", components: {} }, { schema: 1, updated_at: "2026-11-12T15:00:00Z" }, { schema: 1, updated_at: "yesterday", components: {} }]) {
    const { view } = page({ ...allMissing(), status: { state: "ok", data } });
    assert.equal(view.mode, "error");
    assert.match(view.banner.lines[0], /does not understand/);
    assert.deepEqual(view.components, []);
  }
  assert.throws(() => buildView(allMissing(), {}), /current time/);
});

// ------------------------------------------------------------------ healthy

test("healthy: the banner, every component and the last result time come from status.json", () => {
  const { view, html } = page(fixture("healthy"));
  assert.equal(view.mode, "live");
  assert.equal(view.banner.tone, "operational");
  assert.equal(view.banner.title, "All services are working");
  assert.deepEqual(view.banner.lines, []);
  assert.deepEqual(view.components.map((component) => component.name), Object.values(COMPONENT_NAMES));
  assert.ok(view.components.every((component) => component.state === "operational" && component.label === "Operational"));
  assert.equal(view.updated.iso, "2026-11-12T15:01:00.000Z");
  assert.equal(view.updated.age, "4 minutes ago");
  assert.match(html.updated, /<time datetime="2026-11-12T15:01:00.000Z">Nov 12, 2026, 3:01 PM UTC<\/time> <span class="updated__age">\(4 minutes ago\)/);
  assert.match(html.banner, /banner--operational/);
  assert.equal((html.components.match(/<li class="component /g) ?? []).length, 9);
  assert.match(html.components, /Since <time datetime="2026-10-03T12:00:00.000Z">Oct 3, 2026, 12:00 PM UTC<\/time>/);
});

test("healthy: each bar has 90 days and is drawn from uptime/daily.json alone", () => {
  const { view, html } = page(fixture("healthy"));
  const api = view.components.find((component) => component.key === "api");
  assert.equal(api.history.days.length, DAYS_SHOWN);
  assert.equal(api.history.days.at(-1).day, "2026-11-12");
  assert.equal(api.history.days[0].day, "2026-08-15");
  const level = (day) => api.history.days.find((entry) => entry.day === day).level;
  assert.equal(level("2026-10-02"), "none", "before monitoring began");
  assert.equal(level("2026-10-04"), "ok");
  assert.equal(level("2026-10-20"), "minor");
  assert.equal(level("2026-11-02"), "major");
  assert.equal(level("2026-11-05"), "none", "a day the monitor did not run");
  assert.deepEqual(api.history.problemDays.map((day) => day.day), ["2026-11-02", "2026-10-20"]);
  assert.equal(api.history.problemDays[0].text, "Nov 2, 2026: 14 of 288 runs failed");

  // The summary is arithmetic on the file: check it against the file.
  const days = Object.entries(fixture("healthy").uptime.data.api);
  const runs = days.reduce((sum, [, entry]) => sum + entry.runs, 0);
  const failed = days.reduce((sum, [, entry]) => sum + entry.failed, 0);
  assert.equal(failed, 16);
  assert.equal(api.history.summary, `${(runs - failed).toLocaleString("en-US")} of ${runs.toLocaleString("en-US")} monitoring runs passed (${formatShare(runs - failed, runs)}) on ${days.length} days with data in the last 90 days.`);
  assert.equal(api.history.label, `Last 90 days: ${days.length} days with data, 2 days with failed runs, most recently Nov 2, 2026.`);

  const website = view.components.find((component) => component.key === "public-site");
  assert.match(website.history.label, /1 day with failed runs, most recently Oct 28, 2026\.$/);
  const staff = view.components.find((component) => component.key === "staff-site");
  assert.match(staff.history.summary, /\(100%\)/);
  assert.match(staff.history.label, /no days with failed runs\.$/);
  assert.deepEqual(staff.history.problemDays, []);

  assert.equal((html.components.match(/class="day day--/g) ?? []).length, 9 * DAYS_SHOWN + 4, "90 days per component, plus the legend");
  assert.match(html.components, /role="img" aria-label="Last 90 days: \d+ days with data/);
  assert.match(html.components, /<summary>Days with failed runs \(2\)<\/summary>/);
  assert.match(html.components, /title="Nov 5, 2026: no data"/);
  assert.match(html.components, /Monitoring records begin on Oct 3, 2026\./);
});

test("healthy: resolved incidents of the last 30 days are listed, older ones are not", () => {
  const { view, html } = page(fixture("healthy"));
  assert.deepEqual(view.incidents.open, []);
  assert.match(html.incidents, /No open incidents\./);
  assert.equal(view.incidents.recent.length, 1);
  assert.equal(RECENT_INCIDENT_DAYS, 30);
  const [incident] = view.incidents.recent;
  assert.equal(incident.title, "TEST DATA: API is not answering");
  assert.equal(incident.component, "API");
  assert.equal(incident.severity, "Partial outage");
  assert.equal(incident.duration, "1 hour 10 minutes");
  assert.deepEqual(incident.updates.map((update) => update.iso), ["2026-11-02T15:20:00.000Z", "2026-11-02T14:40:00.000Z", "2026-11-02T14:10:00.000Z"], "newest update first");
  assert.match(html.history, /Resolved <time datetime="2026-11-02T15:20:00.000Z">Nov 2, 2026, 3:20 PM UTC<\/time> · lasted 1 hour 10 minutes/);
  assert.match(html.history, /<summary>Updates \(3\)<\/summary>/);
  assert.doesNotMatch(html.history, /older than 30 days/);
});

test("incidents never show the issue link, the check ids or the engine's memory", () => {
  for (const scenario of ["healthy", "incident"]) {
    const everything = Object.values(page(fixture(scenario)).html).join("");
    assert.doesNotMatch(everything, /example\.invalid|issues\/|9001|9002|api-health|public-home|streaks/);
  }
});

test("healthy: reliability shows measured shares, and a target only once it is accepted", () => {
  const { view, html } = page(fixture("healthy"));
  assert.equal(view.reliability.windowDays, 28);
  const byName = Object.fromEntries(view.reliability.items.map((item) => [item.name, item]));
  assert.equal(byName["Website availability"].share, "99.96%");
  assert.equal(byName["Website availability"].counts, "7,745 of 7,748 measurements were good");
  assert.equal(byName["Website availability"].target, null, "the target is not accepted, so it is not published");
  assert.equal(byName["API availability"].target, "99.5%");
  assert.equal(byName["Inquiry form availability"].share, null);
  assert.match(html.reliability, /Measured over the last 28 days\./);
  assert.match(html.reliability, /Inquiry form availability<\/span><span class="measure__value measure__value--none">Not enough data yet/);
  assert.doesNotMatch(html.reliability, /99\.9%/);
  assert.doesNotMatch(html.reliability, /budget|burn/i);
});

// ----------------------------------------------------------------- incident

test("incident: the banner names what is down, and open incidents show their updates", () => {
  const { view, html } = page(fixture("incident"));
  assert.equal(view.mode, "live");
  assert.equal(view.banner.tone, "outage");
  assert.equal(view.banner.title, "There is an outage");
  assert.deepEqual(view.banner.lines, ["Down: Website.", "Degraded: Intelligence calculators."]);
  assert.match(html.banner, /banner--outage/);

  const states = Object.fromEntries(view.components.map((component) => [component.key, component.label]));
  assert.equal(states["public-site"], "Outage");
  assert.equal(states.calculators, "Degraded");
  assert.equal(states.api, "Operational");
  assert.match(html.components, /component--outage[\s\S]*?Since <time datetime="2026-11-12T14:50:00.000Z">/);

  assert.deepEqual(view.incidents.open.map((incident) => incident.title), ["TEST DATA: Website is down", "TEST DATA: Calculators are answering slowly"]);
  assert.equal(view.incidents.open[0].severity, "Major outage");
  assert.equal(view.incidents.open[1].severity, "Minor problem");
  assert.equal(view.incidents.open[0].updates[0].text, "TEST DATA. The previous version of the site is being restored.");
  assert.equal((html.incidents.match(/<article class="incident incident--open[ "]/g) ?? []).length, 2);
  // The major outage is marked in the outage colour, the minor one is not.
  assert.match(html.incidents, /<article class="incident incident--open incident--sev1">/);
  assert.match(html.incidents, /<article class="incident incident--open incident--sev3">/);
  assert.match(html.incidents, /Major outage · Website/);
  assert.match(html.incidents, /Started <time datetime="2026-11-12T14:50:00.000Z">Nov 12, 2026, 2:50 PM UTC<\/time>/);
  assert.match(html.history, /No resolved incidents on record in the last 30 days\./);
  assert.doesNotMatch(Object.values(html).join(""), /error budget|16 times/, "burn alerts are internal");
});

test("a monitoring incident from the alert engine is named in words", () => {
  const loaded = fixture("healthy");
  loaded.incidents.data.open = [{
    key: "monitoring", component: "monitoring", severity: "sev3", title: "TEST DATA: Monitoring cannot see the site",
    opened_at: "2026-11-12T15:00:00.000Z", updates: [{ at: "2026-11-12T15:00:00.000Z", text: "TEST DATA. Opened." }],
  }];
  const { view, html } = page(loaded);
  assert.equal(view.incidents.open[0].component, "Monitoring");
  assert.match(html.incidents, /Minor problem · Monitoring/);
});

test("an unknown severity never becomes a class name", () => {
  const loaded = fixture("incident");
  loaded.incidents.data.open[0].severity = 'sev1" onclick="x';
  const { html } = page(loaded);
  assert.doesNotMatch(html.incidents, /onclick/);
  assert.match(html.incidents, /<article class="incident incident--open">/);
});

test("a blind run in either suite is said plainly, and only then", () => {
  assert.ok(!page(fixture("incident")).view.banner.lines.some((line) => /could not reach anything|turned away/.test(line)));
  for (const suite of ["fast", "slow"]) {
    const loaded = fixture("incident");
    loaded.status.data.last_runs[suite] = { ...(loaded.status.data.last_runs[suite] ?? { at: "2026-11-12T15:01:00.000Z" }), blind: true };
    const { view } = page(loaded);
    assert.equal(view.banner.tone, "outage", "the states still come from earlier checks");
    assert.match(view.banner.lines.at(-1), /^A recent automatic check could not reach anything, including outside services/, suite);
  }
});

test("checks Cloudflare turned away are said plainly, and a zero count is not", () => {
  const loaded = fixture("healthy");
  loaded.status.data.last_runs.fast.cloudflare_refused = 0;
  assert.ok(!page(loaded).view.banner.lines.some((line) => /turned away/.test(line)));
  loaded.status.data.last_runs.fast.cloudflare_refused = 7;
  assert.match(page(loaded).view.banner.lines.at(-1), /^A recent automatic check was turned away before it reached some pages/);
  loaded.status.data.last_runs.fast.cloudflare_refused = "7";
  assert.ok(!page(loaded).view.banner.lines.some((line) => /turned away/.test(line)), "only a whole number counts");
});

test("an open incident is never hidden behind an all-clear banner", () => {
  // Every part operational, as with a failure that comes and goes or a
  // spent error budget, but an incident is open.
  const loaded = fixture("healthy");
  assert.equal(page(loaded).view.banner.title, "All services are working");
  loaded.incidents.data.open = [{
    key: "budget:public-availability", component: "public-site", severity: "sev2",
    title: "TEST DATA: Website availability: failing more often than its target allows",
    opened_at: "2026-11-12T14:00:00.000Z", updates: [],
  }];
  let { view, html } = page(loaded);
  assert.equal(view.banner.title, "Most services are working");
  assert.equal(view.banner.tone, "degraded");
  assert.equal(view.banner.lines[0], "1 open incident: TEST DATA: Website availability: failing more often than its target allows.");
  assert.doesNotMatch(html.banner, /All services are working/);
  loaded.incidents.data.open.push({ key: "monitoring", component: "monitoring", severity: "sev3", title: "TEST DATA: Monitoring cannot see the site", opened_at: "2026-11-12T15:00:00.000Z" });
  ({ view } = page(loaded));
  assert.match(view.banner.lines[0], /^2 open incidents: /);
  // When incidents cannot be read, the page does not pretend to know there are none.
  const broken = fixture("healthy");
  broken.incidents = { state: "error" };
  assert.ok(page(broken).view.banner.lines.includes("Incident information could not be loaded."));
});


test("a summary that disagrees with the components cannot read as 'all working'", () => {
  const loaded = fixture("incident");
  loaded.status.data.overall = "fine";
  assert.equal(page(loaded).view.banner.tone, "outage");
  loaded.status.data.components["public-site"].state = "on fire";
  const { view } = page(loaded);
  assert.equal(view.banner.tone, "degraded");
  assert.equal(view.components.find((component) => component.key === "public-site").label, "Unknown");
});

// -------------------------------------------------------------------- stale

test("data older than the threshold is shown as stale, with last known states only", () => {
  const fresh = page(fixture("healthy"), Date.parse("2026-11-12T15:01:00.000Z") + STALE_AFTER_MINUTES * MINUTE);
  assert.equal(fresh.view.mode, "live", "exactly at the threshold is still live");

  const { view, html } = page(fixture("incident"), FIXTURE_NOW + 3 * 60 * MINUTE);
  assert.equal(view.mode, "stale");
  assert.equal(view.banner.tone, "unknown");
  assert.equal(view.banner.title, "Monitoring data is stale");
  assert.match(view.banner.lines[0], /^The last monitoring result arrived on Nov 12, 2026, 3:01 PM UTC\./);
  assert.match(view.banner.lines[1], /may be out of date/);
  assert.equal(view.updated.age, "3 hours ago");
  assert.ok(view.components.every((component) => component.state === "unknown" && component.label === "Unknown"));
  assert.equal(view.components.find((component) => component.key === "public-site").note, "Last known state: Outage");
  assert.equal(view.components.find((component) => component.key === "api").note, "Last known state: Operational");
  assert.doesNotMatch(html.banner, /outage|working/i);
  assert.doesNotMatch(html.components, /state--operational|state--outage|state--degraded/);
  assert.doesNotMatch(html.components, /Since </, "a stale state has no trustworthy 'since'");
  assert.equal(page(fixture("healthy"), FIXTURE_NOW + 3 * 60 * MINUTE).html.incidents, '<p class="empty">No open incidents in the last data received.</p>');
});

test("freshness follows the last fast run, not a later hourly one", () => {
  const loaded = fixture("healthy");
  loaded.status.data.last_runs.fast.at = "2026-11-12T13:00:00.000Z";
  loaded.status.data.updated_at = "2026-11-12T15:04:00.000Z";
  assert.equal(page(loaded).view.mode, "stale");
  delete loaded.status.data.last_runs;
  const { view } = page(loaded);
  assert.equal(view.mode, "live");
  assert.equal(view.updated.iso, "2026-11-12T15:04:00.000Z");
});

// ---------------------------------------------------------------- first day

test("first day: unknown components, one day of history and no reliability figure", () => {
  const { view, html } = page(fixture("first-day"));
  assert.equal(view.mode, "live");
  assert.equal(view.banner.title, "All services are working");
  assert.deepEqual(view.banner.lines, ["No current result for: DNS, TLS certificates, Domain registration."]);
  const dns = view.components.find((component) => component.key === "dns");
  assert.equal(dns.label, "Unknown");
  assert.equal(dns.note, "No monitoring result yet");
  assert.equal(dns.history.state, "empty");
  assert.equal(dns.history.label, "Last 90 days: no data yet.");
  const website = view.components.find((component) => component.key === "public-site");
  assert.equal(website.history.summary, "37 of 37 monitoring runs passed (100%) on 1 day with data in the last 90 days.");
  assert.equal(website.history.days.filter((day) => day.level !== "none").length, 1);
  assert.match(html.components, /Monitoring records begin on Nov 12, 2026\./);
  assert.match(html.reliability, /Not enough data yet/);
  assert.doesNotMatch(html.reliability, /100%|36/);
  assert.match(html.incidents, /No open incidents\./);
});

test("status without history says so and draws no bar", () => {
  const { view, html } = page({ ...fixture("healthy"), uptime: { state: "missing" } });
  assert.ok(view.components.every((component) => component.history.state === "missing"));
  assert.doesNotMatch(html.components, /class="day |class="legend"/);
  assert.equal((html.components.match(/No day-by-day history yet\./g) ?? []).length, 9);
  const broken = page({ ...fixture("healthy"), uptime: { state: "error" } }).html;
  assert.match(broken.components, /Day-by-day history could not be loaded\./);
});

test("malformed history entries are ignored, not drawn", () => {
  const loaded = fixture("healthy");
  loaded.uptime.data = {
    schema: 1,
    "public-site": { "2026-11-11": { runs: 288, failed: 1 }, "2026-11-10": { runs: -1, failed: 0 }, yesterday: { runs: 10, failed: 0 }, "2026-11-09": "fine" },
    api: "broken",
  };
  const { view } = page(loaded);
  const website = view.components.find((component) => component.key === "public-site");
  assert.equal(website.history.days.filter((day) => day.level !== "none").length, 1);
  assert.match(website.history.summary, /^287 of 288 monitoring runs passed \(99\.65%\) on 1 day with data/);
  assert.equal(view.components.find((component) => component.key === "api").history.state, "empty");
});

// ------------------------------------------------------------------- safety

test("text from the data files is escaped everywhere it is shown", () => {
  const attack = `"><script>alert(1)</script><img src=x onerror=alert(2)>`;
  const loaded = fixture("incident");
  loaded.status.data.components["public-site"].name = attack;
  loaded.status.data.components[attack] = { name: attack, state: "outage", since: "2026-11-12T14:00:00.000Z", checks: [] };
  loaded.incidents.data.open[0].title = attack;
  loaded.incidents.data.open[0].updates[0].text = attack;
  loaded.incidents.data.open[1].component = attack;
  loaded.incidents.data.recent = [{ ...loaded.incidents.data.open[0], resolved_at: "2026-11-12T15:00:00.000Z", duration_minutes: 10 }];
  loaded.slo.data.slos[0].name = attack;
  loaded.uptime.data[attack] = { "2026-11-12": { runs: 10, failed: 1 } };
  const everything = Object.values(page(loaded).html).join("");
  assert.ok(everything.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.doesNotMatch(everything, /<script|<img|onerror=alert\(2\)>/);
  assert.doesNotMatch(everything, /="[^"]*"><script/);
});

test("odd shapes in the data do not break the page", () => {
  const loaded = {
    status: { state: "ok", data: { schema: 1, updated_at: "2026-11-12T15:01:00.000Z", overall: "operational", components: { "public-site": null, api: { state: "operational" }, extra: { name: "Extra", state: "degraded", since: 7 } } } },
    uptime: { state: "ok", data: { components: { api: { "2026-11-12": { runs: 12, failed: 0 } } } } },
    incidents: { state: "ok", data: { open: [null, { updates: "none" }, { title: "T", updates: [{ at: "x", text: "dropped" }, { at: "2026-11-12T15:00:00Z", text: "kept" }] }], recent: [{ title: "No end" }, 5] } },
    slo: { state: "ok", data: { slos: [null, { enough_data: true, good: 5, total: 0 }, { id: "x", enough_data: true, good: 9, total: 10, accepted: true, target: 7 }] } },
  };
  const { view, html } = page(loaded);
  assert.deepEqual(view.components.map((component) => component.name), ["API", "Extra"]);
  assert.match(view.components[0].history.summary, /^12 of 12 monitoring runs passed/);
  assert.equal(view.incidents.open.length, 2);
  assert.equal(view.incidents.open[0].title, "Incident");
  assert.deepEqual(view.incidents.open[1].updates.map((update) => update.text), ["kept"]);
  assert.deepEqual(view.incidents.recent, []);
  assert.deepEqual(view.reliability.items.map((item) => [item.name, item.share, item.target]), [["Measure", null, null], ["x", "90.00%", null]]);
  assert.equal(typeof Object.values(html).join(""), "string");
});
