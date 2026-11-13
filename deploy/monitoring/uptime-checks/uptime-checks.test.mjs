// The Cloud Monitoring uptime checks in this folder: shape, coverage, and how
// many executions a month they cost. docs/sre/synthetic-monitoring.md explains
// them; Gbenga applies them (deploy/monitoring/apply.sh).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { TARGETS } from "../../../scripts/sre/targets.mjs";
import { PAGES } from "../../../scripts/sre/checks/pages.mjs";
import { COMPONENTS } from "../../../scripts/sre/lib/schema.mjs";

const dir = new URL("./", import.meta.url);
const files = readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
const configs = files.map((name) => [name, JSON.parse(readFileSync(new URL(name, dir), "utf8"))]);

// Checker locations per region, from Google's uptime check documentation as
// read on 2026-11-13 (USA has three: Iowa, Oregon, Virginia). Re-check it
// with the price before applying: both can change.
const LOCATIONS = { USA: 3, EUROPE: 1, SOUTH_AMERICA: 1, ASIA_PACIFIC: 1, USA_IOWA: 1, USA_OREGON: 1, USA_VIRGINIA: 1 };
// The free monthly allowance Google published for uptime check executions
// when this was written. A budget, not a promise: re-check before applying.
const FREE_EXECUTIONS_PER_MONTH = 1_000_000;

const hostsWeOwn = new Set(Object.entries(TARGETS.production)
  .filter(([key]) => key.endsWith("Origin") && key !== "idxOrigin" && key !== "wwwOrigin")
  .map(([, origin]) => new URL(origin).host));

test("the six checks named in the synthetic monitoring guide are here", () => {
  assert.deepEqual(files, ["api-health.json", "calculators-deal-page.json", "inquiry-page.json", "public-home.json", "search-page.json", "staff-home.json"]);
});

test("each check is a read-only HTTPS GET of our own hosts, from several continents", () => {
  for (const [name, config] of configs) {
    assert.match(config.displayName, /^DiamondEcho SRE: /, name);
    assert.equal(config.monitoredResource.type, "uptime_url", name);
    assert.equal(config.monitoredResource.labels.project_id, "${PROJECT_ID}", name);
    assert.ok(hostsWeOwn.has(config.monitoredResource.labels.host), `${name}: not our host (Georgia MLS is never checked from here)`);
    const http = config.httpCheck;
    assert.equal(http.requestMethod, "GET", name);
    assert.equal(http.useSsl, true, name);
    assert.equal(http.validateSsl, true, name);
    assert.equal(http.body, undefined, name);
    assert.equal(http.authInfo, undefined, name);
    assert.doesNotMatch(http.path, /inquiries|properties|scenarios|sensitivity|monte-carlo|\?/, name);
    assert.ok(config.selectedRegions.length >= 3, `${name}: Google needs at least three regions`);
    assert.ok(config.selectedRegions.includes("USA"), name);
    assert.ok(config.selectedRegions.some((region) => !region.startsWith("USA")), `${name}: needs a vantage outside the USA`);
    assert.ok(config.contentMatchers?.length === 1 && config.contentMatchers[0].content, `${name}: a status alone does not prove the page`);
    assert.ok(Object.hasOwn(COMPONENTS, config.userLabels.component), name);
    assert.equal(`${config.userLabels.check}.json`, name);
    for (const [key, value] of Object.entries(config.userLabels)) assert.match(`${key}=${value}`, /^[a-z][a-z0-9_-]*=[a-z0-9_-]+$/, name);
  }
});

test("page checks look for the page's own canonical address, as the GitHub checks do", () => {
  for (const [name, config] of configs) {
    if (config.monitoredResource.labels.host !== new URL(TARGETS.production.publicOrigin).host) continue;
    const path = config.httpCheck.path;
    assert.ok(PAGES.some((page) => page.path === path), `${name}: ${path} is not a public page`);
    assert.equal(config.contentMatchers[0].content, `rel="canonical" href="${TARGETS.production.publicOrigin}${path}"`, name);
  }
});

test("all checks together stay inside the free monthly allowance, in a 31-day month", () => {
  const perMonth = configs.reduce((sum, [, config]) => {
    const periodSeconds = Number(config.period.replace(/s$/, ""));
    const locations = config.selectedRegions.reduce((n, region) => n + LOCATIONS[region], 0);
    return sum + Math.ceil((31 * 86_400) / periodSeconds) * locations;
  }, 0);
  // 6 checks x 6 locations x 8,928 runs = 321,408.
  assert.equal(perMonth, 321_408);
  assert.ok(perMonth < FREE_EXECUTIONS_PER_MONTH / 2, "leave room for anything else in the billing account");
});
