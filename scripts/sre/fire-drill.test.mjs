// Tests of the fire drill itself. Two of them run real scenarios through the
// real commands; nothing touches the network (Cloud Run is the release role's
// fake gcloud, GitHub is never called without --apply).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { runProblems } from "./lib/schema.mjs";
import { isBlindRun } from "./alert-policy.mjs";
import {
  FAST_CHECKS, SLOW_CHECKS, REPO, SCENARIOS, buildRun, contractProblems, drillEnv, exitCode, parseArgs, runScenario,
} from "./fire-drill.mjs";

const checkSources = readdirSync(path.join(REPO, "scripts/sre/checks"))
  .filter((name) => name.endsWith(".mjs") && !name.endsWith(".test.mjs"))
  .map((name) => readFileSync(path.join(REPO, "scripts/sre/checks", name), "utf8")).join("\n");

test("every check the drill uses is a real check, with the same component and severity where the source says", () => {
  for (const spec of [...FAST_CHECKS, ...SLOW_CHECKS]) {
    const line = checkSources.split("\n").find((text) => text.includes(`id: "${spec.id}"`) || text.includes(`"${spec.id}"`));
    assert.ok(line, `${spec.id} is not in scripts/sre/checks/`);
    const component = /component: "([a-z-]+)"/.exec(line)?.[1];
    const severity = /severity: "(sev\d)"/.exec(line)?.[1];
    if (component) assert.equal(component, spec.component, `${spec.id} component`);
    if (severity) assert.equal(severity, spec.severity, `${spec.id} severity`);
  }
});

test("every check of the real fast-suite modules is in the drill's fast suite", () => {
  const fastModules = ["pages", "api", "calculators", "inquiry", "search", "staff"];
  const drill = new Set(FAST_CHECKS.map((spec) => spec.id));
  for (const name of fastModules) {
    const source = readFileSync(path.join(REPO, "scripts/sre/checks", `${name}.mjs`), "utf8");
    for (const [, id] of source.matchAll(/\bid: "([a-z0-9-]+)"/g)) assert.ok(drill.has(id), `${id} (checks/${name}.mjs) is missing from FAST_CHECKS`);
  }
});

test("the drill's runs are valid run documents", () => {
  const at = Date.parse("2026-11-02T13:00:00Z");
  for (const run of [
    buildRun({ suite: "fast", at }),
    buildRun({ suite: "slow", at }),
    buildRun({ suite: "fast", at, failing: { "api-health": { status: 500 }, "public-home": { status: null } } }),
    buildRun({ suite: "slow", at, failing: { "tls-public": { status: null, severity: "sev1", observed: { expires: "2026-11-03" } } } }),
    buildRun({ suite: "fast", at, blind: true }),
  ]) assert.deepEqual(runProblems(run), []);
});

test("a blind drill run is what the alert engine calls blind, and an ordinary failure is not", () => {
  const at = Date.parse("2026-11-02T13:00:00Z");
  assert.equal(isBlindRun(buildRun({ suite: "fast", at, blind: true })), true);
  assert.equal(isBlindRun(buildRun({ suite: "fast", at, failing: { "api-health": { status: null } } })), false);
});

test("the commands get an environment built from nothing, with the fake gcloud first", () => {
  const saved = { ...process.env };
  process.env.GITHUB_TOKEN = "ghs_not_a_real_token";
  process.env.SRE_ALERT_WEBHOOK_URL = "https://example.invalid/hook";
  process.env.SRE_AUTOREMEDIATE = "enabled";
  try {
    const env = drillEnv({ root: "/tmp/drill", now: Date.parse("2026-11-02T13:00:00Z"), fakeBin: "/tmp/drill/bin" });
    for (const name of ["GITHUB_TOKEN", "GITHUB_REPOSITORY", "SRE_ALERT_WEBHOOK_URL", "SRE_AUTOREMEDIATE", "GOOGLE_APPLICATION_CREDENTIALS"]) {
      assert.equal(env[name], undefined, name);
    }
    assert.equal(env.PATH.split(path.delimiter)[0], "/tmp/drill/bin");
    assert.equal(env.SRE_NOW, "2026-11-02T13:00:00.000Z");
    assert.equal(env.CLOUDSDK_CONFIG, path.join("/tmp/drill", "no-gcloud-config"));
  } finally {
    process.env = saved;
  }
});

const GOOD = {
  status: {
    schema: 1, updated_at: "2026-11-02T13:00:24.000Z", overall: "operational", last_runs: {},
    components: { api: { name: "API", state: "operational", since: "2026-11-02T13:00:24.000Z", checks: ["api-health"] } },
    checks: { "api-health": { name: "API is up", component: "api", severity: "sev2", suite: "fast", ok: true, status: 200, latency_ms: 150, detail: "", checked_at: "2026-11-02T13:00:04.000Z", consecutive_failures: 0, last_ok_at: "2026-11-02T13:00:04.000Z", last_failure_at: null, observed: {} } },
  },
  incidents: { schema: 1, engine: {}, open: [], recent: [] },
  slo: { schema: 1, generated_at: "2026-11-02T13:00:24.000Z", window_days: 28, slos: [], burn_alerts: [] },
  uptime: { api: { "2026-11-02": { runs: 1, failed: 0 } } },
  deploys: [{ at: "x", what: "api", check: "api-identity", fact: "revision", from: "a", to: "b" }],
  remediation: [{ at: "x", trigger: "api", action: "cloud-run-rollback", decision: "dry-run", reason: "r", from_revision: "a", to_revision: "b", verified: null }],
  history: [{ t: "2026-11-02T13:00:00.000Z", suite: "fast", region: "drill", c: { "api-health": [1, 150, ["api-availability"]] } }],
};

test("files in the contract's shapes raise no difference", () => {
  assert.deepEqual(contractProblems(GOOD), []);
});

test("each kind of difference from the contract is named with its file", () => {
  const bad = structuredClone(GOOD);
  bad.status.overall = "fine";
  delete bad.status.checks["api-health"].last_ok_at;
  bad.history[0].c["api-health"] = [true, 150, []];
  bad.remediation[0].decision = "rolled-back";
  bad.incidents.open.push({ key: "api", component: "api", severity: "sev2", title: "API is down", opened_at: "x", failing_checks: [], issue_number: null, issue_url: null, updates: [{ at: "2026-11-02T13:00:00Z", text: "see ?token=abc" }] });
  bad.slo.slos.push({ id: "api-availability" });
  const files = contractProblems(bad).map((problem) => problem.file);
  for (const file of ["status.json", "history/*.jsonl", "remediation-log.jsonl", "incidents.json", "slo.json"]) assert.ok(files.includes(file), file);
});

test("exit codes: a failure is 1, a broken drill is 2, a scenario not run fails only with --strict", () => {
  assert.equal(exitCode([{ outcome: "passed" }]), 0);
  assert.equal(exitCode([{ outcome: "passed" }, { outcome: "not-run" }]), 0);
  assert.equal(exitCode([{ outcome: "not-run" }], { strict: true }), 1);
  assert.equal(exitCode([{ outcome: "failed" }, { outcome: "not-run" }]), 1);
  assert.equal(exitCode([{ outcome: "failed" }, { outcome: "error" }]), 2);
});

test("arguments are checked", () => {
  assert.deepEqual(parseArgs(["--only", "single-blip", "--strict"]).only, ["single-blip"]);
  assert.throws(() => parseArgs(["--only", "no-such-scenario"]), /no scenario called/);
  assert.throws(() => parseArgs(["--apply"]), /unknown option/);
  assert.throws(() => parseArgs(["--out"]), /needs a value/);
});

test("every scenario says what it expects", () => {
  const ids = new Set();
  for (const scenario of SCENARIOS) {
    assert.match(scenario.id, /^[a-z0-9-]+$/);
    assert.ok(!ids.has(scenario.id));
    ids.add(scenario.id);
    assert.ok(scenario.title && scenario.expected, scenario.id);
  }
});

const pipelineReady = ["state.mjs", "alert.mjs", "remediate.mjs", "slo-calc.mjs", "cloudrun/status.sh", "cloudrun/fakes/gcloud.mjs"]
  .every((file) => existsSync(path.join(REPO, "scripts/sre", file)));

test("a single blip runs through the real pipeline and opens nothing", { skip: !pipelineReady && "a pipeline command is missing" }, async () => {
  const result = await runScenario(SCENARIOS.find((s) => s.id === "single-blip"));
  assert.equal(result.outcome, "passed", `${result.reason} ${JSON.stringify(result.expectations.filter((e) => !e.ok))}`);
});

test("after a bad deploy the real pipeline proposes a rollback only as a dry run and only reads Cloud Run", { skip: !pipelineReady && "a pipeline command is missing" }, async () => {
  const result = await runScenario(SCENARIOS.find((s) => s.id === "api-fails-after-deploy"));
  assert.equal(result.outcome, "passed", `${result.reason} ${JSON.stringify(result.expectations.filter((e) => !e.ok))}`);
  assert.equal(result.observations.second_decision, "dry-run would-roll-back");
});
