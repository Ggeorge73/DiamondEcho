#!/usr/bin/env node
// The automatic-fix engine. Runs once per monitor run, after the alert engine.
//
//   node scripts/sre/remediate.mjs --state-dir DIR --out decision.json [--apply]
//
// It reads the state directory (status.json, incidents.json, deploys.jsonl,
// remediation-log.jsonl), asks remediation-policy.mjs what to do about each
// open incident, and writes every decision to remediation-log.jsonl and to
// decision.json. The rules themselves are in remediation-policy.mjs; the
// plain-language version is docs/sre/auto-remediation.md.
//
// It changes production only when BOTH are true: --apply is given, and the
// environment variable SRE_AUTOREMEDIATE is exactly "enabled". Otherwise it
// is a dry run and writes down exactly what it would have done. When SRE_NOW
// is set (a replay or a drill) it never acts, whatever the switch says.
//
// Every process it starts goes through one `exec` function, so the tests
// replace it and never touch Google Cloud. Only the two commands in
// remediation-policy.mjs can be run, and each is checked again just before.
//
// Exit 0: the engine did its job (whatever it decided). Exit 2: it could not
// (bad arguments, unreadable state directory, a bug).

import { readFile, writeFile, rename, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  plan, verify, summarize, fingerprint, mayAct, sameIncident, rollbackCommand, isAllowedCommand,
  isServiceName, STATUS_COMMAND, DEFAULT_SERVICE, ROLLBACK, LIMITS,
} from "./remediation-policy.mjs";
import { COMPONENTS } from "./lib/schema.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOG_FILE = "remediation-log.jsonl";
// status.sh makes two read-only calls; rollback.sh makes three and up to three
// health requests with a pause between. Generous limits, so a slow Google
// answer is not mistaken for a failure, but a hung call cannot hold the run.
const STATUS_TIMEOUT_MS = 90_000;
const ROLLBACK_TIMEOUT_MS = 240_000;

export const USAGE = "Usage: node scripts/sre/remediate.mjs --state-dir DIR --out decision.json [--apply]";

export function parseArgs(argv) {
  const options = { stateDir: null, out: null, apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--state-dir" || arg === "--out") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} needs a value. ${USAGE}`);
      options[arg === "--out" ? "out" : "stateDir"] = value;
      i += 1;
    } else throw new Error(`Unknown argument: ${arg}. ${USAGE}`);
  }
  if (!options.stateDir || !options.out) throw new Error(USAGE);
  return options;
}

// The clock: SRE_NOW when set (replays, drills, tests), the real time otherwise.
export function clock(env) {
  if (env.SRE_NOW === undefined || env.SRE_NOW === "") return { now: Date.now(), fixed: false };
  const now = Date.parse(env.SRE_NOW);
  if (!Number.isFinite(now)) throw new Error(`SRE_NOW is not an ISO time: ${String(env.SRE_NOW).slice(0, 40)}`);
  return { now, fixed: true };
}

async function readText(file) {
  try { return await readFile(file, "utf8"); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// A JSON file: { value } or { value: null, unreadable: true }. Missing is null.
async function readJson(file) {
  const text = await readText(file);
  if (text === null) return { value: null, unreadable: false };
  try { return { value: JSON.parse(text), unreadable: false }; } catch { return { value: null, unreadable: true }; }
}

// A JSON-lines file. Keeps the raw lines so the log can be rewritten without
// touching lines this run does not change. Any line that is not a JSON object
// marks the file unreadable: the engine then refuses to act (it cannot tell
// what it has done) and never rewrites the file.
async function readJsonl(file) {
  const text = await readText(file);
  if (text === null) return { lines: [], raw: [], unreadable: false };
  const raw = text.split("\n").filter((line) => line.trim() !== "");
  const lines = [];
  let unreadable = false;
  for (const line of raw) {
    try {
      const value = JSON.parse(line);
      if (value && typeof value === "object" && !Array.isArray(value)) lines.push(value);
      else unreadable = true;
    } catch { unreadable = true; }
  }
  return { lines, raw, unreadable };
}

// Write a whole file so that a reader never sees half of it.
async function writeAtomic(file, text) {
  const temp = `${file}.tmp-${process.pid}`;
  await writeFile(temp, text, "utf8");
  await rename(temp, file);
}

// The default way to start a process. Never throws: a command that cannot be
// started, times out or fails is an answer with a code, which the engine
// judges. The environment is passed through because the cloudrun scripts read
// GCP_PROJECT_ID, GCP_REGION and CLOUD_RUN_SERVICE, and gcloud reads the
// workflow's short-lived sign-in from it.
export function defaultExec(file, args, { timeoutMs, env } = {}) {
  return new Promise((done) => {
    execFile(file, args, { cwd: REPO_ROOT, env, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, encoding: "utf8" },
      (error, stdout, stderr) => {
        let code = 0;
        if (error) code = Number.isInteger(error.code) ? error.code : null;
        done({ code, stdout: stdout ?? "", stderr: stderr ?? "", timedOut: Boolean(error?.killed) });
      });
  });
}

function lastJsonLine(text) {
  const lines = String(text ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i].startsWith("{")) continue;
    try { return JSON.parse(lines[i]); } catch { return null; }
  }
  return null;
}

// Run a command only if the policy allows exactly that command. The check is
// repeated here, at the last moment, so that no path through this file can
// start anything else.
async function runAllowed(exec, command, service, options, stderr) {
  if (!isAllowedCommand(command.file, command.args, service)) {
    throw new Error(`Refused to run a command that is not on the allowlist: ${command.file} ${command.args.join(" ")}`);
  }
  const result = await exec(command.file, [...command.args], options);
  // gcloud's own messages go to the workflow log for a person to read. They
  // are never copied into the log file or decision.json, which are public.
  if (result?.stderr) stderr.write(String(result.stderr).slice(-4000));
  return result ?? { code: null, stdout: "", stderr: "" };
}

async function readCloudRun(exec, service, env, stderr) {
  const result = await runAllowed(exec, STATUS_COMMAND, service, { timeoutMs: STATUS_TIMEOUT_MS, env }, stderr);
  if (result.timedOut) return { ok: false, error: "status.sh did not answer in time" };
  if (result.code !== 0) return { ok: false, error: `status.sh exited with code ${result.code ?? "none"}; the workflow log has gcloud's message` };
  const data = lastJsonLine(result.stdout);
  if (!data || !Array.isArray(data.serving) || !Array.isArray(data.revisions)) {
    return { ok: false, error: "status.sh did not print the expected JSON" };
  }
  return { ok: true, data };
}

// The exact production command rollback.sh would run, for the record. It is
// built the way scripts/sre/cloudrun/rollback.sh builds it.
export function gcloudCommandFor(revision, env) {
  const project = env.GCP_PROJECT_ID || "diamondecho-prod";
  const region = env.GCP_REGION || "us-east1";
  const service = env.CLOUD_RUN_SERVICE || DEFAULT_SERVICE;
  return `gcloud run services update-traffic ${service} --to-revisions=${revision}=100 --project ${project} --region ${region}`;
}

// Turn the policy's "proceed" into a dry run or an action.
async function carryOut(decision, { act, why, exec, service, env, stderr, now }) {
  const command = rollbackCommand(decision.to_revision, service);
  const shown = `${command.file} ${command.args.join(" ")}`;
  const verifyPlan = { checks: decision.verify_checks ?? [], by: new Date(now + LIMITS.verifyMinutes * 60_000).toISOString() };
  const common = { ...decision, verify_checks: undefined, command: shown, gcloud_command: gcloudCommandFor(decision.to_revision, env) };

  if (!act) {
    return { ...common, decision: "dry-run", code: "would-roll-back", reason: `${decision.reason} ${why}`, verified: null };
  }

  const result = await runAllowed(exec, command, service, { timeoutMs: ROLLBACK_TIMEOUT_MS, env }, stderr);
  const answer = lastJsonLine(result.stdout);
  const movedTo = answer && answer.applied === true && answer.to === decision.to_revision;
  if (result.code === 0 && answer && answer.applied === false) {
    // rollback.sh found the target already serving: someone else moved the
    // traffic between the engine's look and its action.
    return { ...common, decision: "skipped", code: "already-serving", reason: `${decision.to_revision} already had all the traffic when the engine went to move it. Someone else changed the traffic; the engine did nothing.`, verified: null };
  }
  if (result.code === 0 && movedTo) {
    return { ...common, decision: "acted", code: "roll-back", verify: verifyPlan, verified: null, health_after: answer.verified === true };
  }
  if (result.code === 1 && movedTo) {
    return {
      ...common, decision: "acted", code: "roll-back", verify: verifyPlan, verified: null, health_after: false,
      reason: `${decision.reason} The traffic moved, but ${decision.to_revision} did not answer /health right after; a person should look now.`,
    };
  }
  const how = result.timedOut ? "did not finish in time" : `exited with code ${result.code ?? "none"}`;
  return {
    ...common, decision: "failed", code: "rollback-failed", verified: false,
    reason: `rollback.sh ${how}, and the traffic was not confirmed on ${decision.to_revision}. The workflow log has the details.`,
  };
}

const partName = (component) => COMPONENTS[component] ?? String(component);

// What goes into the log: the contract's fields first, then the details.
function logLine(at, entry) {
  const { at: _ignored, verify_checks: _plan, ...rest } = entry;
  return {
    at, trigger: entry.trigger, action: entry.action, decision: entry.decision, reason: entry.reason,
    from_revision: entry.from_revision ?? null, to_revision: entry.to_revision ?? null, verified: entry.verified ?? null,
    ...rest, summary: summarize(entry),
  };
}

// One run of the engine. Returns the decision document. Throws only when it
// cannot do its job (the caller exits 2).
export async function remediate({ stateDir, out, apply = false, env = {}, exec = defaultExec, now, fixedClock = false, stderr = process.stderr }) {
  const info = await stat(stateDir).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`The state directory does not exist: ${stateDir}`);
  const at = new Date(now).toISOString();
  const service = env.CLOUD_RUN_SERVICE || DEFAULT_SERVICE;
  if (!isServiceName(service)) throw new Error("CLOUD_RUN_SERVICE is not a Cloud Run service name.");

  const switchOn = mayAct({ apply, env });
  const act = switchOn && !fixedClock;
  const why = !apply
    ? "Dry run: the engine was run without --apply."
    : !switchOn
      ? "Dry run: automatic rollback is switched off (SRE_AUTOREMEDIATE is not \"enabled\")."
      : "Dry run: SRE_NOW is set, so this is a replay or a drill and nothing is changed.";

  const status = await readJson(join(stateDir, "status.json"));
  const incidents = await readJson(join(stateDir, "incidents.json"));
  const deploys = await readJsonl(join(stateDir, "deploys.jsonl"));
  const logPath = join(stateDir, LOG_FILE);
  const log = await readJsonl(logPath);

  // 1. Verify earlier actions that are still waiting for an answer.
  const updates = new Map();
  const verifications = [];
  log.lines.forEach((line, index) => {
    if (line.decision !== "acted" || line.action !== ROLLBACK) return;
    if (line.verified !== null && line.verified !== undefined) return;
    const result = verify({ line, status: status.value, now });
    verifications.push({
      incident_key: line.incident_key ?? null, issue_number: line.issue_number ?? null,
      from_revision: line.from_revision ?? null, to_revision: line.to_revision ?? null,
      verified: result.verified, summary: result.text,
    });
    if (result.verified !== null) updates.set(index, { ...line, verified: result.verified, verified_at: at, verify_result: result.text });
  });

  // 2. Decide about every open incident.
  const inputs = {
    now, status: status.unreadable ? null : status.value, incidents: incidents.unreadable ? null : incidents.value,
    deploys: deploys.lines, deploysUnreadable: deploys.unreadable, log: log.lines, logUnreadable: log.unreadable, service,
  };
  let result = plan(inputs);
  if (result.needsCloudRun) result = plan({ ...inputs, cloudrun: await readCloudRun(exec, service, env, stderr) });
  if (result.needsCloudRun) throw new Error("The policy asked for Cloud Run twice.");

  const decisions = [];
  for (const decision of result.decisions) {
    const final = decision.decision === "proceed"
      ? await carryOut(decision, { act, why, exec, service, env, stderr, now })
      : { ...decision, verified: null };
    decisions.push(logLine(at, final));
  }

  // 3. Write the log: earlier lines unchanged except the verified ones, then
  // this run's decisions, each once. A decision the same as the last one
  // logged for its incident is not repeated every five minutes.
  const newLines = decisions.filter((entry) => {
    const previous = [...log.lines, ...decisions.slice(0, decisions.indexOf(entry))].filter((line) => sameIncident(line, entry)).at(-1);
    return !previous || fingerprint(previous) !== fingerprint(entry);
  });
  if (updates.size || newLines.length) {
    let raw = log.raw;
    if (updates.size && !log.unreadable) {
      // log.lines and log.raw line up only when every raw line parsed.
      raw = log.raw.map((text, index) => (updates.has(index) ? JSON.stringify(updates.get(index)) : text));
    }
    const text = [...raw, ...newLines.map((line) => JSON.stringify(line))].join("\n");
    await writeAtomic(logPath, `${text}\n`);
  }

  // 4. The decision document, with one sentence for people.
  const sentences = [
    ...verifications.map((item) => item.summary),
    ...decisions.map((item) => `${partName(item.trigger)}: ${item.summary}`),
  ];
  const document = {
    schema: 1,
    at,
    mode: act ? "apply" : "dry-run",
    switch: { apply_flag: apply === true, autoremediate: switchOn ? "enabled" : "not enabled", fixed_clock: fixedClock },
    inputs: {
      status: status.unreadable ? "unreadable" : status.value ? "read" : "missing",
      incidents: incidents.unreadable ? "unreadable" : incidents.value ? "read" : "missing",
      deploys: deploys.unreadable ? "unreadable" : `${deploys.lines.length} lines`,
      log: log.unreadable ? "unreadable" : `${log.lines.length} lines`,
    },
    decisions,
    verifications,
    logged: newLines.length,
    summary: sentences.length ? sentences.join(" ") : "No open incident and no rollback waiting to be verified. Nothing to decide.",
  };
  await writeAtomic(resolve(out), `${JSON.stringify(document, null, 2)}\n`);
  return document;
}

export async function main(argv = process.argv.slice(2), { env = process.env, exec = defaultExec, stdout = process.stdout, stderr = process.stderr } = {}) {
  let options;
  let time;
  try {
    options = parseArgs(argv);
    time = clock(env);
  } catch (error) {
    stderr.write(`remediate.mjs: ${error.message}\n`);
    return 2;
  }
  try {
    const document = await remediate({ ...options, env, exec, now: time.now, fixedClock: time.fixed, stderr });
    stdout.write(`${document.summary}\n`);
    return 0;
  } catch (error) {
    stderr.write(`remediate.mjs: ${error.message}\n`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then((code) => { process.exitCode = code; });
}
