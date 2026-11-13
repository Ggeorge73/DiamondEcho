// Tests for the SLO configuration and for the Cloud Monitoring SLO files that
// must agree with it. Run: node --test scripts/sre/slo.config.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COMPONENTS } from "./lib/schema.mjs";
import {
  BUDGET_STATES, BURN_POLICY, BURN_WINDOWS, SLOS, WINDOW_DAYS,
  budgetMinutes, configProblems, expectedRuns, minRunsFor,
} from "./slo.config.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SLO_DIR = path.join(here, "..", "..", "deploy", "monitoring", "slos");

test("the seven SLIs of the contract, no more and no fewer", () => {
  assert.deepEqual(SLOS.map((slo) => slo.id).sort(), [
    "api-availability", "api-latency", "calculators-availability", "inquiry-availability",
    "public-availability", "public-latency", "staff-availability",
  ]);
});

test("the shipped configuration has no problems", () => {
  assert.deepEqual(configProblems(COMPONENTS), []);
});

test("every target is a proposal until Gbenga accepts it", () => {
  // When he accepts one, this test changes in the same pull request as the
  // record (accepted_on, accepted_record and the table in docs/sre/slo.md).
  for (const slo of SLOS) assert.equal(slo.accepted, false, slo.id);
});

test("an accepted target without its record is refused", () => {
  const base = { ...SLOS[0], accepted: true };
  assert.match(configProblems(COMPONENTS, [base], []).join("\n"), /accepted_on/);
  assert.match(configProblems(COMPONENTS, [base], []).join("\n"), /accepted_record/);
  const recorded = { ...base, accepted_on: "2026-12-14", accepted_record: "DE-35" };
  assert.deepEqual(configProblems(COMPONENTS, [recorded], []), []);
});

test("configProblems catches the mistakes that would break the calculator", () => {
  const good = SLOS[0];
  const latency = SLOS.find((slo) => slo.kind === "latency");
  const problems = configProblems(COMPONENTS, [
    good, { ...good },
    { ...good, id: "x-1", component: "nowhere" },
    { ...good, id: "x-2", target: 1 },
    { ...latency, id: "x-3", threshold_ms: null },
    { ...good, id: "x-4", threshold_ms: 500 },
    { ...good, id: "x-5", window_days: 30 },
    { ...good, id: "x-6", severity_cap: "sev9" },
    { ...good, id: "x-7", definition: "" },
  ], [
    { ...BURN_POLICY[0], min_bad_runs: 1 },
    { ...BURN_POLICY[1], short_minutes: 400 },
    { ...BURN_POLICY[2], long_minutes: 100 },
  ]).join("\n");
  for (const expected of [
    /duplicate SLO id public-availability/, /x-1: unknown component/, /x-2: target/, /x-3: a latency SLO needs threshold_ms/,
    /x-4: an availability SLO has no threshold/, /x-5: window/, /x-6: unknown severity_cap/, /x-7: definition/,
    /fast: min_bad_runs must be 2 or more/, /medium: short window/, /slow: window and long_minutes disagree/,
  ]) assert.match(problems, expected);
});

test("error budgets in minutes per 28 days", () => {
  assert.equal(WINDOW_DAYS, 28);
  assert.ok(Math.abs(budgetMinutes(0.999) - 40.32) < 1e-9);
  assert.ok(Math.abs(budgetMinutes(0.995) - 201.6) < 1e-9);
  assert.ok(Math.abs(budgetMinutes(0.99) - 403.2) < 1e-9);
  assert.ok(Math.abs(budgetMinutes(0.95) - 2016) < 1e-9);
  assert.equal(expectedRuns(28 * 24 * 60), 8064);
});

test("enough data means a day of probes, and enough that one failure cannot break the target", () => {
  assert.equal(minRunsFor(0.999), 1000);
  assert.equal(minRunsFor(0.995), 288);
  assert.equal(minRunsFor(0.99), 288);
  assert.equal(minRunsFor(0.95), 288);
});

test("burn rules: most serious first, and none can fire on one failed probe", () => {
  assert.deepEqual(BURN_POLICY.map((rule) => rule.window), ["1h", "6h", "3d"]);
  for (const rule of BURN_POLICY) {
    assert.equal(BURN_WINDOWS[rule.window], rule.long_minutes);
    assert.ok(rule.min_bad_runs >= 2, rule.name);
    // The minimum number of runs is at most a third of the schedule, so a
    // GitHub scheduler that skips some runs does not silence the rule.
    assert.ok(rule.min_runs <= expectedRuns(rule.long_minutes) / 3, rule.name);
  }
  // A burn rate above 1 / (1 - target) cannot happen; every rule must be reachable.
  for (const slo of SLOS) for (const rule of BURN_POLICY) assert.ok(rule.burn_rate < 1 / (1 - slo.target), `${slo.id} ${rule.name}`);
});

test("budget states run from spent to caution, each with the policy's words", () => {
  assert.deepEqual(BUDGET_STATES.map((state) => state.at_or_below), [0, 0.25, 0.5]);
  for (const state of BUDGET_STATES) {
    assert.ok(state.label && state.asks && state.asks_speed, state.state);
    assert.doesNotMatch(state.asks_speed, /stop merging/, "a speed budget never freezes other work");
  }
});

test("latency SLIs never page as an outage", () => {
  for (const slo of SLOS.filter((s) => s.kind === "latency")) assert.equal(slo.severity_cap, "sev3", slo.id);
});

test("the Cloud Monitoring SLO files agree with the configuration", async () => {
  const names = (await readdir(SLO_DIR)).filter((name) => name.endsWith(".json")).sort();
  assert.deepEqual(names, ["api-availability.json", "api-latency.json", "service.json"]);
  const service = JSON.parse(await readFile(path.join(SLO_DIR, "service.json"), "utf8"));
  assert.deepEqual(service.custom, {});
  for (const name of names.filter((n) => n !== "service.json")) {
    const text = await readFile(path.join(SLO_DIR, name), "utf8");
    const doc = JSON.parse(text);
    const id = name.replace(/\.json$/, "");
    const slo = SLOS.find((s) => s.id === id);
    assert.ok(slo, `${name} names an SLO that slo.config.mjs defines`);
    assert.equal(doc.goal, slo.target, `${name} goal`);
    assert.equal(doc.rollingPeriod, `${WINDOW_DAYS * 86400}s`);
    assert.equal(doc.userLabels.sli, id);
    // apply.sh matches an SLO by userLabels.sli, so the name may change (a
    // new target) without a second SLO being created. Whether the target is
    // accepted lives in a label, not in the name.
    assert.equal(doc.userLabels.status, slo.accepted ? "accepted" : "proposed");
    assert.doesNotMatch(doc.displayName, /proposed|accepted/i);
    for (const [key, value] of Object.entries(doc.userLabels)) assert.match(`${key}=${value}`, /^[a-z][a-z0-9_-]{0,62}=[a-z0-9_-]{0,63}$/, "Cloud Monitoring label rules");
    // The only placeholder is the project id; apply.sh fills it in.
    assert.deepEqual([...new Set(text.match(/\$\{[^}]*\}/g))], ["${PROJECT_ID}"]);
    assert.match(text, /resource\.labels\.service_name=\\"diamondecho-api\\"/);
    assert.match(text, /resource\.type=\\"cloud_run_revision\\"/);
    const sli = doc.serviceLevelIndicator.requestBased;
    if (slo.kind === "latency") {
      assert.match(sli.distributionCut.distributionFilter, /run\.googleapis\.com\/request_latencies/);
      assert.equal(sli.distributionCut.range.max, slo.threshold_ms);
    } else {
      assert.match(sli.goodTotalRatio.totalServiceFilter, /run\.googleapis\.com\/request_count/);
      assert.match(sli.goodTotalRatio.badServiceFilter, /response_code_class="5xx"/);
    }
  }
});
