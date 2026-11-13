import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCheck, makeRun, runProblems, COMPONENTS, SEVERITIES } from "./schema.mjs";

const check = (over = {}) => makeCheck({ id: "public-home", name: "Home page", component: "public-site", severity: "sev1", ok: true, status: 200, latency_ms: 120.6, ...over });
const run = (over = {}) => ({ schema: 1, suite: "fast", started_at: "2026-11-13T00:00:00Z", finished_at: "2026-11-13T00:00:05Z", vantage: { provider: "local", region: null }, commit: null, checks: [check()], ...over });

test("a check is rounded, defaulted and accepted", () => {
  assert.deepEqual(check(), { id: "public-home", name: "Home page", component: "public-site", severity: "sev1", ok: true, status: 200, latency_ms: 121, detail: "", attempts: 1, slis: [], observed: {} });
});

test("a long detail is cut rather than refused", () => {
  assert.equal(check({ detail: "x".repeat(1000) }).detail.length, 300);
});

test("a check outside the contract is refused", () => {
  assert.throws(() => check({ id: "Public Home" }), /kebab-case/);
  assert.throws(() => check({ component: "billing" }), /unknown component/);
  assert.throws(() => check({ severity: "critical" }), /unknown severity/);
  assert.throws(() => check({ status: "200" }), /status/);
  assert.throws(() => check({ observed: { revision: 31 } }), /observed/);
  assert.throws(() => check({ observed: ["a"] }), /observed/);
  assert.deepEqual(check({ observed: { revision: "diamondecho-api-00028-zin" } }).observed, { revision: "diamondecho-api-00028-zin" });
});

test("anything but true counts as a failed check", () => {
  assert.equal(check({ ok: "yes" }).ok, false);
});

test("a well-formed run has no problems", () => {
  assert.deepEqual(runProblems(run()), []);
  assert.doesNotThrow(() => makeRun(run()));
});

test("a run's problems are all named", () => {
  assert.match(runProblems(run({ suite: "nightly" })).join(), /unknown suite/);
  assert.match(runProblems(run({ started_at: "yesterday" })).join(), /started_at/);
  assert.match(runProblems(run({ checks: [] })).join(), /non-empty/);
  assert.match(runProblems(run({ checks: [check(), check()] })).join(), /duplicate check id/);
  assert.match(runProblems(run({ schema: 2 })).join(), /schema must be 1/);
  assert.deepEqual(runProblems(null), ["run must be an object"]);
});

test("every component has a public name and there are four severities", () => {
  for (const name of Object.values(COMPONENTS)) assert.ok(name.length > 2);
  assert.deepEqual(SEVERITIES, ["sev1", "sev2", "sev3", "sev4"]);
});
