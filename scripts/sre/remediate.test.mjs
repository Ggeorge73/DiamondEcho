// The engine around the policy: files in, files out, and the one place a
// process is started. Every process is a fake (`exec`); no test touches
// Google Cloud or the network. Temporary state directories only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { remediate, main, parseArgs, clock, gcloudCommandFor } from "./remediate.mjs";

const NOW = Date.parse("2026-11-13T12:00:00.000Z");
const at = (minutesAgo, now = NOW) => new Date(now - minutesAgo * 60_000).toISOString();
const OLD = "diamondecho-api-00028-zin";
const NEW = "diamondecho-api-00031-abc";
const ENABLED = { SRE_AUTOREMEDIATE: "enabled" };

function check(id, component, severity, ok, extra = {}) {
  return { name: id, component, severity, suite: "fast", ok, status: ok ? 200 : 500, latency_ms: 100, detail: "",
    checked_at: at(1), consecutive_failures: ok ? 0 : 3, observed: {}, ...extra };
}

function statusDoc(now = NOW, { healthy = false, revision = NEW } = {}) {
  return {
    schema: 1, updated_at: at(0.5, now), overall: healthy ? "operational" : "degraded",
    components: { "public-site": { state: "operational" }, dns: { state: "operational" }, api: { state: healthy ? "operational" : "outage" } },
    checks: {
      "public-home": check("public-home", "public-site", "sev1", true, { checked_at: at(1, now) }),
      "dns-apex-resolves": check("dns-apex-resolves", "dns", "sev1", true, { checked_at: at(30, now) }),
      "api-health": check("api-health", "api", "sev2", healthy, { checked_at: at(1, now) }),
      "api-identity": check("api-identity", "api", "sev2", true, { checked_at: at(1, now), observed: { revision, commit: revision === NEW ? "d728ded" : "90739bd" } }),
    },
  };
}

const INCIDENT = { key: "api", component: "api", severity: "sev2", title: "API is down", opened_at: at(20), failing_checks: ["api-health"], issue_number: 41 };
const DEPLOYS = [
  { at: at(29), what: "api", check: "api-identity", fact: "revision", from: OLD, to: NEW },
  { at: at(29), what: "api", check: "api-identity", fact: "commit", from: "90739bd", to: "d728ded" },
];
const CLOUD_RUN = {
  serving: [{ revision: NEW, percent: 100 }],
  revisions: [{ name: NEW, created: at(40), ready: true }, { name: OLD, created: "2026-10-26T13:45:00.000Z", ready: true }],
};

async function stateDir({ status = statusDoc(), open = [INCIDENT], deploys = DEPLOYS, log = null } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "sre-remediate-"));
  if (status) await writeFile(join(dir, "status.json"), JSON.stringify(status));
  await writeFile(join(dir, "incidents.json"), JSON.stringify({ schema: 1, engine: {}, open, recent: [] }));
  await writeFile(join(dir, "deploys.jsonl"), deploys.map((line) => JSON.stringify(line)).join("\n") + "\n");
  if (log !== null) await writeFile(join(dir, "remediation-log.jsonl"), log);
  return dir;
}

// A fake process runner that records every call and answers like the
// release role's scripts.
function fakeExec({ status = { code: 0, stdout: JSON.stringify(CLOUD_RUN) }, rollback } = {}) {
  const calls = [];
  const exec = async (file, args) => {
    calls.push([file, ...args]);
    if (args[0] === "scripts/sre/cloudrun/status.sh") return { stderr: "", ...status };
    if (args[0] === "scripts/sre/cloudrun/rollback.sh") {
      return rollback ?? { code: 0, stderr: "Rolled back.", stdout: `Traffic: ${args[2]}, 100 percent.\n${JSON.stringify({ action: "cloud-run-rollback", applied: true, service: "diamondecho-api", from: [{ revision: NEW, percent: 100 }], to: args[2], command: "gcloud …", verified: true })}\n` };
    }
    throw new Error(`unexpected command ${file} ${args.join(" ")}`);
  };
  return { exec, calls };
}

const quiet = { write() {} };
const readLog = async (dir) => {
  const text = await readFile(join(dir, "remediation-log.jsonl"), "utf8").catch(() => "");
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
};
const run = (dir, options = {}) => remediate({ stateDir: dir, out: join(dir, "decision.json"), now: NOW, stderr: quiet, ...options });

test("no open incident: an empty decision, nothing logged, nothing run", async () => {
  const dir = await stateDir({ open: [] });
  const { exec, calls } = fakeExec();
  const doc = await run(dir, { exec, apply: true, env: ENABLED });
  assert.deepEqual(doc.decisions, []);
  assert.match(doc.summary, /Nothing to decide/);
  assert.deepEqual(calls, []);
  assert.deepEqual(await readLog(dir), []);
  const written = JSON.parse(await readFile(join(dir, "decision.json"), "utf8"));
  assert.equal(written.schema, 1);
  assert.equal(written.at, "2026-11-13T12:00:00.000Z");
  await rm(dir, { recursive: true });
});

test("first sighting, then a dry run that writes down the exact command and never runs it", async () => {
  const dir = await stateDir();
  const { exec, calls } = fakeExec();
  let doc = await run(dir, { exec });
  assert.equal(doc.decisions[0].code, "pending-confirmation");
  assert.deepEqual(calls, [["bash", "scripts/sre/cloudrun/status.sh"]]);

  // Next run, five minutes later, the check failed again.
  const later = NOW + 5 * 60_000;
  await writeFile(join(dir, "status.json"), JSON.stringify(statusDoc(later)));
  doc = await run(dir, { exec, now: later });
  const decision = doc.decisions[0];
  assert.equal(doc.mode, "dry-run");
  assert.equal(decision.decision, "dry-run");
  assert.equal(decision.command, `bash scripts/sre/cloudrun/rollback.sh --to ${OLD} --apply`);
  assert.equal(decision.gcloud_command, `gcloud run services update-traffic diamondecho-api --to-revisions=${OLD}=100 --project diamondecho-prod --region us-east1`);
  assert.match(decision.summary, /^Dry run, nothing was changed/);
  assert.match(decision.reason, /without --apply/);
  assert.equal(calls.filter((call) => call[1].includes("rollback.sh")).length, 0, "a dry run never runs rollback.sh");

  const log = await readLog(dir);
  assert.deepEqual(log.map((line) => line.decision), ["skipped", "dry-run"]);
  for (const key of ["at", "trigger", "action", "decision", "reason", "from_revision", "to_revision", "verified"]) assert.ok(key in log[1], key);
  assert.equal(log[1].trigger, "api");
  assert.equal(log[1].action, "cloud-run-rollback");
  assert.equal(log[1].issue_number, 41);
  assert.ok(log[1].summary);

  // The same dry run again is not logged again.
  const later2 = later + 5 * 60_000;
  await writeFile(join(dir, "status.json"), JSON.stringify(statusDoc(later2)));
  doc = await run(dir, { exec, now: later2 });
  assert.equal(doc.decisions[0].decision, "dry-run");
  assert.equal(doc.logged, 0);
  assert.equal((await readLog(dir)).length, 2);
  await rm(dir, { recursive: true });
});

// A state directory where the plan was written down five minutes ago.
async function readyToAct() {
  const pending = { at: at(5.5), trigger: "api", action: "cloud-run-rollback", decision: "skipped", code: "pending-confirmation", reason: "…",
    from_revision: NEW, to_revision: OLD, verified: null, incident_key: "api", incident_opened_at: INCIDENT.opened_at };
  return stateDir({ log: `${JSON.stringify(pending)}\n` });
}

test("--apply without the switch is still a dry run", async () => {
  for (const env of [{}, { SRE_AUTOREMEDIATE: "true" }, { SRE_AUTOREMEDIATE: "Enabled" }]) {
    const dir = await readyToAct();
    const { exec, calls } = fakeExec();
    const doc = await run(dir, { exec, apply: true, env });
    assert.equal(doc.mode, "dry-run");
    assert.equal(doc.decisions[0].decision, "dry-run");
    assert.match(doc.decisions[0].reason, /switched off/);
    assert.equal(calls.some((call) => call[1].includes("rollback.sh")), false);
    await rm(dir, { recursive: true });
  }
});

test("the switch without --apply is still a dry run", async () => {
  const dir = await readyToAct();
  const { exec, calls } = fakeExec();
  const doc = await run(dir, { exec, apply: false, env: ENABLED });
  assert.equal(doc.decisions[0].decision, "dry-run");
  assert.equal(calls.some((call) => call[1].includes("rollback.sh")), false);
  await rm(dir, { recursive: true });
});

test("a fixed clock (SRE_NOW) never acts, even with --apply and the switch on", async () => {
  const dir = await readyToAct();
  const { exec, calls } = fakeExec();
  const doc = await run(dir, { exec, apply: true, env: ENABLED, fixedClock: true });
  assert.equal(doc.decisions[0].decision, "dry-run");
  assert.match(doc.decisions[0].reason, /SRE_NOW/);
  assert.equal(calls.some((call) => call[1].includes("rollback.sh")), false);
  await rm(dir, { recursive: true });
});

test("switched on: runs exactly the rollback command, logs it, and verifies it on a later run", async () => {
  const dir = await readyToAct();
  const { exec, calls } = fakeExec();
  let doc = await run(dir, { exec, apply: true, env: ENABLED });
  assert.equal(doc.mode, "apply");
  assert.deepEqual(calls, [["bash", "scripts/sre/cloudrun/status.sh"], ["bash", "scripts/sre/cloudrun/rollback.sh", "--to", OLD, "--apply"]]);
  const acted = doc.decisions[0];
  assert.equal(acted.decision, "acted");
  assert.equal(acted.verified, null);
  assert.deepEqual(acted.verify.checks, ["api-health"]);
  assert.equal(acted.health_after, true);
  assert.match(acted.summary, /^Automatic rollback done/);

  // Next run: the incident is still open, nothing is run again; the failing
  // check passes now and the API reports the old revision.
  const later = NOW + 6 * 60_000;
  await writeFile(join(dir, "status.json"), JSON.stringify(statusDoc(later, { healthy: true, revision: OLD })));
  const second = fakeExec();
  doc = await run(dir, { exec: second.exec, apply: true, env: ENABLED, now: later });
  assert.deepEqual(second.calls, [], "an incident already acted on is not judged again");
  assert.equal(doc.verifications.length, 1);
  assert.equal(doc.verifications[0].verified, true);
  assert.match(doc.summary, /^Verified/);
  const log = await readLog(dir);
  const line = log.find((entry) => entry.decision === "acted");
  assert.equal(line.verified, true);
  assert.equal(line.verified_at, new Date(later).toISOString());
  assert.equal(log.length, 2, "verification updates the acted line; it adds none");

  // Once verified it is not looked at again.
  doc = await run(dir, { exec: second.exec, now: later + 5 * 60_000, apply: true, env: ENABLED });
  assert.equal(doc.verifications.length, 0);
  await rm(dir, { recursive: true });
});

test("a rollback that did not fix it is recorded as not verified; no second attempt", async () => {
  const dir = await readyToAct();
  await run(dir, { exec: fakeExec().exec, apply: true, env: ENABLED });
  const later = NOW + 40 * 60_000;
  await writeFile(join(dir, "status.json"), JSON.stringify(statusDoc(later, { revision: OLD })));
  const { exec, calls } = fakeExec();
  const doc = await run(dir, { exec, apply: true, env: ENABLED, now: later });
  assert.equal(doc.verifications[0].verified, false);
  assert.match(doc.verifications[0].summary, /did not fix it/);
  assert.equal(calls.some((call) => call[1].includes("rollback.sh")), false);
  await rm(dir, { recursive: true });
});

test("rollback.sh refuses or fails: a failed decision, never retried", async () => {
  const dir = await readyToAct();
  const { exec } = fakeExec({ rollback: { code: 2, stdout: "", stderr: "ERROR: Refused" } });
  let doc = await run(dir, { exec, apply: true, env: ENABLED });
  assert.equal(doc.decisions[0].decision, "failed");
  assert.equal(doc.decisions[0].verified, false);
  assert.match(doc.decisions[0].summary, /FAILED.*will not retry/);
  const again = fakeExec();
  doc = await run(dir, { exec: again.exec, apply: true, env: ENABLED, now: NOW + 5 * 60_000 });
  assert.equal(again.calls.some((call) => call[1].includes("rollback.sh")), false);
  await rm(dir, { recursive: true });
});

test("traffic moved but /health did not answer: acted, with a warning for a person", async () => {
  const dir = await readyToAct();
  const stdout = JSON.stringify({ action: "cloud-run-rollback", applied: true, service: "diamondecho-api", from: [], to: OLD, command: "gcloud …", verified: false });
  const { exec } = fakeExec({ rollback: { code: 1, stdout, stderr: "" } });
  const doc = await run(dir, { exec, apply: true, env: ENABLED });
  assert.equal(doc.decisions[0].decision, "acted");
  assert.equal(doc.decisions[0].health_after, false);
  assert.match(doc.decisions[0].reason, /did not answer \/health/);
  await rm(dir, { recursive: true });
});

test("someone else moved the traffic first: nothing done", async () => {
  const dir = await readyToAct();
  const stdout = JSON.stringify({ action: "cloud-run-rollback", applied: false, to: OLD, verified: null });
  const { exec } = fakeExec({ rollback: { code: 0, stdout, stderr: "" } });
  const doc = await run(dir, { exec, apply: true, env: ENABLED });
  assert.equal(doc.decisions[0].decision, "skipped");
  assert.equal(doc.decisions[0].code, "already-serving");
  await rm(dir, { recursive: true });
});

test("Cloud Run cannot be read: skipped, and gcloud's message stays out of the files", async () => {
  for (const status of [
    { code: 2, stdout: "", stderr: "ERROR: token ya29.SECRET-LOOKING-VALUE denied" },
    { code: 0, stdout: "not json", stderr: "" },
    { code: null, stdout: "", stderr: "", timedOut: true },
  ]) {
    const dir = await readyToAct();
    const { exec } = fakeExec({ status });
    const doc = await run(dir, { exec, apply: true, env: ENABLED });
    assert.equal(doc.decisions[0].code, "cloud-run-unreadable");
    const files = (await readFile(join(dir, "decision.json"), "utf8")) + (await readFile(join(dir, "remediation-log.jsonl"), "utf8"));
    assert.doesNotMatch(files, /ya29|SECRET/);
    await rm(dir, { recursive: true });
  }
});

test("a damaged log blocks acting, is kept as it was, and gets the new line appended", async () => {
  const dir = await stateDir({ log: "{\"at\":\"2026-11-13T10:00:00.000Z\",\"decision\":\"acted\"\nnot json at all\n" });
  const { exec, calls } = fakeExec();
  const doc = await run(dir, { exec, apply: true, env: ENABLED });
  assert.equal(doc.decisions[0].code, "log-unreadable");
  assert.equal(doc.inputs.log, "unreadable");
  assert.deepEqual(calls, []);
  const text = await readFile(join(dir, "remediation-log.jsonl"), "utf8");
  assert.ok(text.startsWith("{\"at\":\"2026-11-13T10:00:00.000Z\",\"decision\":\"acted\"\nnot json at all\n"));
  await rm(dir, { recursive: true });
});

test("missing or damaged state files are reported, not fatal", async () => {
  const dir = await stateDir({ status: null });
  await writeFile(join(dir, "incidents.json"), "{ broken");
  const doc = await run(dir, { exec: fakeExec().exec });
  assert.equal(doc.inputs.status, "missing");
  assert.equal(doc.inputs.incidents, "unreadable");
  assert.deepEqual(doc.decisions, []);
  await rm(dir, { recursive: true });
});

test("other parts are logged once as 'no automatic fix', with their runbook", async () => {
  const dir = await stateDir({ open: [{ key: "public-site", component: "public-site", severity: "sev1", opened_at: at(10), issue_number: 7 }] });
  const { exec, calls } = fakeExec();
  let doc = await run(dir, { exec, apply: true, env: ENABLED });
  assert.equal(doc.decisions[0].code, "no-automatic-fix");
  assert.match(doc.summary, /^Website: No automatic action\..*site-down\.md/);
  doc = await run(dir, { exec, apply: true, env: ENABLED, now: NOW + 5 * 60_000 });
  assert.deepEqual(calls, []);
  assert.equal((await readLog(dir)).length, 1);
  await rm(dir, { recursive: true });
});

test("arguments, clock and exit codes", async () => {
  assert.deepEqual(parseArgs(["--state-dir", "s", "--out", "o", "--apply"]), { stateDir: "s", out: "o", apply: true });
  assert.throws(() => parseArgs(["--state-dir", "s"]));
  assert.throws(() => parseArgs(["--state-dir", "--out", "o"]));
  assert.throws(() => parseArgs(["--state-dir", "s", "--out", "o", "--force"]));
  assert.deepEqual(clock({ SRE_NOW: "2026-11-13T12:00:00Z" }), { now: NOW, fixed: true });
  assert.equal(clock({}).fixed, false);
  assert.throws(() => clock({ SRE_NOW: "yesterday" }));
  assert.equal(gcloudCommandFor(OLD, { GCP_PROJECT_ID: "diamondecho-staging", GCP_REGION: "us-east1", CLOUD_RUN_SERVICE: "diamondecho-api" }),
    `gcloud run services update-traffic diamondecho-api --to-revisions=${OLD}=100 --project diamondecho-staging --region us-east1`);

  const err = { text: "", write(chunk) { this.text += chunk; } };
  assert.equal(await main(["--bogus"], { env: {}, stderr: err, stdout: quiet }), 2);
  assert.equal(await main(["--state-dir", "/nonexistent/sre", "--out", "/nonexistent/d.json"], { env: {}, stderr: err, stdout: quiet }), 2);
  assert.equal(await main(["--state-dir", "/tmp", "--out", "x"], { env: { SRE_NOW: "nope" }, stderr: err, stdout: quiet }), 2);
  const dir = await stateDir({ open: [] });
  assert.equal(await main(["--state-dir", dir, "--out", join(dir, "d.json")], { env: { CLOUD_RUN_SERVICE: "Bad Name" }, stderr: err, stdout: quiet }), 2);
  await rm(dir, { recursive: true });
});

test("main() with SRE_NOW and --apply plus the switch never runs rollback.sh", async () => {
  const dir = await readyToAct();
  const { exec, calls } = fakeExec();
  const out = { text: "", write(chunk) { this.text += chunk; } };
  const code = await main(["--state-dir", dir, "--out", join(dir, "decision.json"), "--apply"],
    { env: { ...ENABLED, SRE_NOW: new Date(NOW).toISOString() }, exec, stdout: out, stderr: quiet });
  assert.equal(code, 0);
  assert.match(out.text, /Dry run/);
  assert.equal(calls.some((call) => call[1].includes("rollback.sh")), false);
  await rm(dir, { recursive: true });
});

test("the command line works end to end (no incident, so no process is started)", async () => {
  const dir = await stateDir({ open: [] });
  const script = fileURLToPath(new URL("./remediate.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script, "--state-dir", dir, "--out", join(dir, "decision.json")],
    { env: { PATH: process.env.PATH, SRE_NOW: "2026-11-13T12:00:00.000Z" }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Nothing to decide/);
  const doc = JSON.parse(await readFile(join(dir, "decision.json"), "utf8"));
  assert.equal(doc.at, "2026-11-13T12:00:00.000Z");
  assert.equal(doc.switch.fixed_clock, true);
  await rm(dir, { recursive: true });
});
