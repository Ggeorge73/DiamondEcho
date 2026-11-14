#!/usr/bin/env node
// The offline fire drill: replays made-up hours of monitor runs through the
// real pipeline and checks that it does the right thing.
//
//   node scripts/sre/fire-drill.mjs [--only id,id] [--out drill.json] [--keep DIR] [--strict] [--list]
//
// Each scenario gets its own empty state directory in a temporary folder.
// For every simulated run the drill writes a run document with the shared
// builders (lib/schema.mjs), then calls the same commands, in the same order,
// as .github/workflows/sre-monitor.yml:
//
//   state.mjs record -> slo-calc.mjs -> alert.mjs --slo -> remediate.mjs
//
// with SRE_NOW set to the simulated time, so hours replay in seconds. It then
// reads what they wrote and checks the expected outcome: one incident and not
// five, none for a single blip, severity raised, resolved on recovery, a
// rollback proposed only after a deploy and only as a dry run, nothing done
// when the monitor's own network fails. It also checks every file the
// commands write against the shapes in scripts/sre/README.md and lists each
// disagreement.
//
// Nothing here can change anything outside the temporary folder:
// - alert.mjs and remediate.mjs run without --apply, with an environment
//   built from nothing (no GitHub token, no webhook, no Google sign-in).
// - remediate.mjs reads Cloud Run through scripts/sre/cloudrun/status.sh,
//   and the only `gcloud` it can find is the release role's fake
//   (cloudrun/fakes/gcloud.mjs), which answers from a JSON file and logs
//   every call. The drill fails if anything but a read was ever asked of it.
// - SRE_NOW is set, which on its own keeps remediate.mjs from acting.
//
// A command that is missing or breaks (exit 2) makes its scenario "not run",
// with the reason, instead of stopping the drill. Exit codes: 0 every
// scenario that ran passed (with --strict: and all of them ran); 1 an
// expectation failed (or, with --strict, a scenario did not run); 2 the drill
// itself broke or was used wrongly.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { COMPONENTS, SEVERITIES, makeCheck, makeRun } from "./lib/schema.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "..", "..");
export const COMMANDS = {
  state: "scripts/sre/state.mjs",
  slo: "scripts/sre/slo-calc.mjs",
  alert: "scripts/sre/alert.mjs",
  remediate: "scripts/sre/remediate.mjs",
};
const FAKE_GCLOUD = "scripts/sre/cloudrun/fakes/gcloud.mjs";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const iso = (ms) => new Date(ms).toISOString();

// ------------------------------------------------------------------ checks

// The checks of the real suites (scripts/sre/checks/), as data. The drill
// builds its runs from these so the engines meet the same ids, components,
// severities and SLIs as in production. fire-drill.test.mjs fails when an id
// here is no longer in checks/.
const PUBLIC = ["public-availability", "public-latency"];
const API = ["api-availability", "api-latency"];
const page = (id, name, component, severity, slis) => ({ id, name, component, severity, slis });
export const FAST_CHECKS = [
  page("public-home", "Home page", "public-site", "sev1", PUBLIC),
  page("public-page-agents", "Advisory page", "public-site", "sev2", PUBLIC),
  page("public-page-about", "About page", "public-site", "sev2", PUBLIC),
  page("public-page-podcast", "Podcast page", "public-site", "sev3", PUBLIC),
  page("public-page-privacy", "Privacy page", "public-site", "sev3", PUBLIC),
  page("public-page-terms", "Terms of use page", "public-site", "sev3", PUBLIC),
  page("public-not-found", "Unknown address answers Page not found", "public-site", "sev3", []),
  page("public-www-redirect", "www address redirects to the site", "public-site", "sev2", []),
  page("public-asset-js", "Site script loads", "public-site", "sev1", ["public-availability"]),
  page("public-asset-css", "Site stylesheet loads", "public-site", "sev2", ["public-availability"]),
  page("search-page", "Property search page", "search", "sev2", PUBLIC),
  page("search-idx-provider", "Georgia MLS search (outside provider)", "search", "sev3", []),
  page("outside-dns-probe", "Monitor can reach the internet", "dns", "sev4", []),
  page("calculators-deal-page", "Deal Studio page", "calculators", "sev2", ["calculators-availability"]),
  page("calculators-mortgage-page", "Mortgage simulator page", "calculators", "sev2", ["calculators-availability"]),
  page("calculators-net-sheet-page", "Seller net sheet page", "calculators", "sev2", ["calculators-availability"]),
  page("calculators-api-analyze", "Deal analysis service returns the reference figures", "calculators", "sev2", ["api-availability"]),
  page("inquiry-page", "Contact page", "inquiry", "sev2", ["inquiry-availability"]),
  page("inquiry-preflight", "Inquiry form is allowed to send from the website", "inquiry", "sev2", ["inquiry-availability"]),
  page("inquiry-route", "Inquiry route exists", "inquiry", "sev2", ["inquiry-availability"]),
  page("inquiry-queue", "Inquiry queue is switched on", "inquiry", "sev2", ["inquiry-availability"]),
  page("api-health", "API is up", "api", "sev2", API),
  page("api-identity", "API identity", "api", "sev2", API),
  page("api-cors-allowed", "API accepts calls from the website", "api", "sev2", []),
  page("api-cors-refused", "API refuses calls from other sites", "api", "sev3", []),
  page("api-docs-off", "API route list is not published", "api", "sev3", []),
  page("staff-home", "Staff site loads with its protections", "staff-site", "sev2", ["staff-availability"]),
  page("staff-api-auth", "Staff API asks for sign-in", "staff-site", "sev2", ["staff-availability"]),
];
export const SLOW_CHECKS = [
  page("dns-apex-resolves", "Website address resolves", "dns", "sev1", []),
  page("dns-staff-resolves", "Staff site address resolves", "dns", "sev2", []),
  page("dns-nameservers", "Nameservers are the two on record", "dns", "sev2", []),
  page("dns-mail-mx", "Mail delivery records (MX)", "dns", "sev2", []),
  page("domain-delegation", "Domain delegation", "domain", "sev2", []),
  page("tls-public", "Website certificate", "tls", "sev3", []),
  page("tls-api", "API certificate", "tls", "sev3", []),
  page("search-idx-provider", "Georgia MLS search (outside provider)", "search", "sev3", []),
  page("api-health", "API is up", "api", "sev2", API),
];

// The live facts the monitor reads from the API and the home page.
export const OLD = { revision: "diamondecho-api-00028-zin", commit: "59f8d46" };
export const NEW = { revision: "diamondecho-api-00031-kel", commit: "a1b2c3d" };

// One run document. `failing` maps a check id to how it fails
// ({ status, severity, detail, observed }); everything else passes.
// `blind` is the monitor's own network failing: no check got any answer.
// Latencies are fixed drill values, never measurements.
export function buildRun({ suite, at, failing = {}, blind = false, api = OLD, extra = {} }) {
  const specs = suite === "slow" ? SLOW_CHECKS : FAST_CHECKS;
  const checks = specs.map((spec) => {
    const base = { id: spec.id, name: spec.name, component: spec.component, severity: spec.severity, slis: spec.slis };
    if (blind) {
      return makeCheck({ ...base, ok: false, status: null, latency_ms: null, attempts: 2, detail: "Drill: the request could not be sent (fetch failed)." });
    }
    const observed = spec.id === "api-identity" ? { revision: api.revision, commit: api.commit }
      : spec.id === "public-home" ? { commit: "f0e1d2c" } : {};
    const fault = failing[spec.id];
    if (!fault) {
      return makeCheck({ ...base, ok: true, status: 200, latency_ms: 150, observed: { ...observed, ...(extra[spec.id] || {}) },
        ...(spec.component === "tls" ? { detail: "Drill: valid, 60 days left." } : {}) });
    }
    const status = fault.status === undefined ? 503 : fault.status;
    return makeCheck({
      ...base, ok: false, severity: fault.severity || spec.severity, status, latency_ms: status === null ? null : 900, attempts: 2,
      detail: fault.detail || `Drill: answered ${status ?? "nothing"}.`, observed: fault.observed ?? observed,
    });
  });
  return makeRun({ suite, started_at: iso(at), finished_at: iso(at + 4_000), vantage: { provider: "fire-drill", region: "drill" }, checks });
}

// ------------------------------------------------------------- Cloud Run

// The fake Cloud Run service the release role's fake gcloud answers from:
// `revisions` newest first, all traffic on `serving`.
export function cloudRunModel({ serving, revisions }) {
  const template = (image, commit) => ({
    metadata: { annotations: { "autoscaling.knative.dev/maxScale": "3" } },
    spec: {
      containerConcurrency: 1, timeoutSeconds: 30, serviceAccountName: "runtime@example.iam.gserviceaccount.com",
      containers: [{
        image, env: [{ name: "INQUIRY_STAFF_QUEUE_ENABLED", value: "true" }, { name: "APP_COMMIT", value: commit }],
        ports: [{ containerPort: 8080, name: "http1" }], resources: { limits: { cpu: "1", memory: "1Gi" } },
      }],
    },
  });
  const current = revisions.find((item) => item.name === serving);
  return {
    project: "diamondecho-prod", region: "us-east1", counter: 40, original: serving, formula: "drill",
    service: {
      metadata: { name: "diamondecho-api", annotations: {} },
      spec: { template: template(current.image, current.commit) },
      status: {
        url: "https://diamondecho-api-drill.a.run.app", latestCreatedRevisionName: revisions[0].name,
        latestReadyRevisionName: serving, traffic: [{ revisionName: serving, percent: 100, latestRevision: serving === revisions[0].name }],
      },
    },
    revisions: revisions.map((item) => ({
      metadata: { name: item.name, creationTimestamp: item.created, annotations: { "autoscaling.knative.dev/maxScale": "3" } },
      spec: template(item.image, item.commit).spec,
      status: { conditions: [{ type: "Ready", status: "True" }] },
    })),
  };
}

const OLD_REVISION = { name: OLD.revision, created: "2026-10-26T13:50:00Z", image: "us-east1-docker.pkg.dev/p/api@sha256:old", commit: OLD.commit };

// ---------------------------------------------------------------- running

export class NotRun extends Error {}

function runNode(script, args, { env, cwd = REPO, timeoutMs = 60_000 }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
    child.on("error", (error) => { clearTimeout(timer); resolve({ code: null, signal: null, stdout, stderr: error.message }); });
  });
}

async function readJsonFile(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
}
async function readLines(file) {
  let text;
  try { text = await readFile(file, "utf8"); } catch { return []; }
  return text.split("\n").filter((line) => line.trim()).map((line) => { try { return JSON.parse(line); } catch { return { unreadable: line.slice(0, 80) }; } });
}

// The environment every command gets: built from nothing, so no token, key or
// webhook of whoever runs the drill can reach the commands.
export function drillEnv({ root, now, fakeBin }) {
  return {
    PATH: [fakeBin, path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter),
    HOME: root, TMPDIR: root, LANG: "C.UTF-8", SRE_NOW: iso(now),
    CLOUDSDK_CONFIG: path.join(root, "no-gcloud-config"),
    FAKE_STATE: path.join(root, "cloudrun.json"), FAKE_LOG: path.join(root, "gcloud-calls.log"),
  };
}

export async function makeSandbox(keepDir = null) {
  const root = keepDir ? path.resolve(keepDir) : await mkdtemp(path.join(os.tmpdir(), "sre-fire-drill-"));
  await mkdir(root, { recursive: true });
  const stateDir = path.join(root, "state");
  const fakeBin = path.join(root, "bin");
  await mkdir(stateDir, { recursive: true });
  await mkdir(fakeBin, { recursive: true });
  await mkdir(path.join(root, "no-gcloud-config"), { recursive: true });
  // The only gcloud on PATH: the release role's fake.
  await writeFile(path.join(fakeBin, "gcloud"), `#!/bin/sh\nexec "${process.execPath}" "${path.join(REPO, FAKE_GCLOUD)}" "$@"\n`);
  await chmod(path.join(fakeBin, "gcloud"), 0o755);
  await writeFile(path.join(root, "gcloud-calls.log"), "");
  return { root, stateDir, fakeBin };
}

// The context a scenario uses: send a run through the pipeline, set what
// Cloud Run serves, record expectations.
function scenarioContext(sandbox, result) {
  const { root, stateDir, fakeBin } = sandbox;
  const runFile = path.join(root, "run.json");
  const actionsFile = path.join(root, "actions.json");
  const decisionFile = path.join(root, "decision.json");
  const sloFile = path.join(stateDir, "slo.json");
  const ctx = {
    steps: 0,
    allActions: [],
    allDecisions: [],
    async cloudrun(model) {
      await writeFile(path.join(root, "cloudrun.json"), JSON.stringify(cloudRunModel(model), null, 2));
    },
    async pipeline(run, { remediate = true } = {}) {
      const now = Date.parse(run.finished_at) + 20_000;
      const env = drillEnv({ root, now, fakeBin });
      await writeFile(runFile, JSON.stringify(run));
      const call = async (name, args) => {
        const script = COMMANDS[name];
        if (!existsSync(path.join(REPO, script))) throw new NotRun(`${script} does not exist yet`);
        const answer = await runNode(script, args, { env });
        if (answer.code !== 0) {
          const said = `${answer.stderr}${answer.stdout}`.trim().split("\n").slice(-3).join(" | ").slice(0, 400);
          throw new NotRun(`${script} ${args[0] || ""} exited ${answer.code ?? answer.signal} at ${iso(now)}: ${said}`);
        }
        return answer;
      };
      await call("state", ["record", "--run", runFile, "--state-dir", stateDir]);
      await call("slo", ["--state-dir", stateDir, "--window-days", "28", "--out", sloFile]);
      await call("alert", ["--run", runFile, "--state-dir", stateDir, "--slo", sloFile, "--out", actionsFile]);
      if (remediate) await call("remediate", ["--state-dir", stateDir, "--out", decisionFile]);
      ctx.steps += 1;
      const snapshot = await ctx.read();
      const actions = (await readJsonFile(actionsFile)) || {};
      const decision = remediate ? (await readJsonFile(decisionFile)) || {} : {};
      snapshot.actions = Array.isArray(actions.actions) ? actions.actions : [];
      snapshot.actionsDoc = actions;
      snapshot.decision = decision;
      ctx.allActions.push(...snapshot.actions.map((a) => ({ at: iso(now), ...a })));
      ctx.allDecisions.push(...(Array.isArray(decision.decisions) ? decision.decisions : []).map((d) => ({ at: iso(now), ...d })));
      audit(result, snapshot);
      return snapshot;
    },
    async read() {
      return {
        status: await readJsonFile(path.join(stateDir, "status.json")),
        incidents: await readJsonFile(path.join(stateDir, "incidents.json")),
        slo: await readJsonFile(sloFile),
        uptime: await readJsonFile(path.join(stateDir, "uptime", "daily.json")),
        deploys: await readLines(path.join(stateDir, "deploys.jsonl")),
        remediation: await readLines(path.join(stateDir, "remediation-log.jsonl")),
        history: await readHistory(stateDir),
      };
    },
    async gcloudCalls() {
      return (await readFile(path.join(root, "gcloud-calls.log"), "utf8")).split("\n").filter(Boolean);
    },
    expect(name, ok, { expected = null, observed = null } = {}) {
      result.expectations.push({ name, ok: Boolean(ok), expected, observed });
    },
    measure(name, value) { result.observations[name] = value; },
    note(text) { result.notes.push(text); },
  };
  return ctx;
}

async function readHistory(stateDir) {
  const dir = path.join(stateDir, "history");
  let names = [];
  try { names = (await readdir(dir)).filter((name) => name.endsWith(".jsonl")).sort(); } catch { return []; }
  const lines = [];
  for (const name of names) lines.push(...await readLines(path.join(dir, name)));
  return lines;
}

// --------------------------------------------------------- contract audit

// Every difference between what a command wrote and the shapes in
// scripts/sre/README.md. Extra fields are allowed; missing or mistyped
// contract fields are not.
const STATES = ["operational", "degraded", "outage", "unknown"];
const isIso = (value) => typeof value === "string" && !Number.isNaN(Date.parse(value));
const isObj = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function contractProblems(snapshot) {
  const problems = [];
  const add = (file, text) => problems.push({ file, text });
  const { status, incidents, slo, uptime, deploys, remediation, history } = snapshot;

  if (status) {
    if (status.schema !== 1) add("status.json", "schema is not 1");
    if (!isIso(status.updated_at)) add("status.json", "updated_at is not an ISO time");
    if (!STATES.includes(status.overall)) add("status.json", `overall "${status.overall}" is not one of ${STATES.join(", ")}`);
    for (const [key, component] of Object.entries(status.components || {})) {
      if (!Object.hasOwn(COMPONENTS, key)) add("status.json", `component key "${key}" is not in COMPONENTS`);
      if (!STATES.includes(component?.state)) add("status.json", `components.${key}.state "${component?.state}" is not a known state`);
      if (typeof component?.name !== "string" || !isIso(component?.since) || !Array.isArray(component?.checks)) add("status.json", `components.${key} lacks name, since or checks`);
    }
    for (const [id, check] of Object.entries(status.checks || {})) {
      for (const field of ["name", "component", "severity", "suite", "ok", "status", "latency_ms", "detail", "checked_at", "consecutive_failures", "last_ok_at", "last_failure_at", "observed"]) {
        if (!Object.hasOwn(check || {}, field)) add("status.json", `checks.${id} has no "${field}"`);
      }
    }
    if (!isObj(status.last_runs)) add("status.json", "last_runs is missing");
  }
  for (const line of history || []) {
    if (!isIso(line.t) || typeof line.suite !== "string" || !isObj(line.c)) { add("history/*.jsonl", "a line lacks t, suite or c"); break; }
    const bad = Object.entries(line.c).find(([, v]) => !Array.isArray(v) || v.length !== 3 || ![0, 1].includes(v[0]) || !(v[1] === null || Number.isFinite(v[1])) || !Array.isArray(v[2]));
    if (bad) { add("history/*.jsonl", `c.${bad[0]} is not [ok as 1 or 0, latency_ms or null, slis]`); break; }
  }
  if (uptime) {
    for (const [component, days] of Object.entries(uptime)) {
      for (const [day, entry] of Object.entries(days || {})) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isInteger(entry?.runs) || !Number.isInteger(entry?.failed)) {
          add("uptime/daily.json", `${component}.${day} is not { runs, failed }`);
        }
      }
    }
  }
  for (const line of deploys || []) {
    for (const field of ["at", "what", "check", "fact", "from", "to"]) if (!Object.hasOwn(line, field)) add("deploys.jsonl", `a line has no "${field}"`);
  }
  if (incidents) {
    if (incidents.schema !== 1) add("incidents.json", "schema is not 1");
    if (!Array.isArray(incidents.open) || !Array.isArray(incidents.recent)) add("incidents.json", "open or recent is not a list");
    for (const item of incidents.open || []) {
      for (const field of ["key", "component", "severity", "title", "opened_at", "failing_checks", "issue_number", "issue_url", "updates"]) {
        if (!Object.hasOwn(item, field)) add("incidents.json", `an open incident has no "${field}"`);
      }
      if (!SEVERITIES.includes(item.severity)) add("incidents.json", `severity "${item.severity}" is not sev1 to sev4`);
      if (item.component !== "monitoring" && !Object.hasOwn(COMPONENTS, item.component)) add("incidents.json", `component "${item.component}" is not in COMPONENTS (nor "monitoring")`);
      if (item.component === "monitoring") add("incidents.json", 'component "monitoring" is not a key of COMPONENTS; the contract says incidents are per component (the status page must know this name)');
      for (const update of item.updates || []) if (!isIso(update?.at) || typeof update?.text !== "string") { add("incidents.json", "an update is not { at, text }"); break; }
    }
    for (const item of incidents.recent || []) {
      if (!isIso(item.resolved_at) || !Number.isFinite(item.duration_minutes)) add("incidents.json", "a recent incident lacks resolved_at or duration_minutes");
    }
    for (const text of publicTexts(incidents)) {
      if (/Bearer |token=|key=|\?[a-z_]+=/i.test(text)) add("incidents.json", `a public text may carry a secret or a query string: "${text.slice(0, 80)}"`);
    }
  }
  for (const line of remediation || []) {
    for (const field of ["at", "trigger", "action", "decision", "reason", "from_revision", "to_revision", "verified"]) {
      if (!Object.hasOwn(line, field)) add("remediation-log.jsonl", `a line has no "${field}"`);
    }
    if (!["acted", "dry-run", "skipped", "failed"].includes(line.decision)) add("remediation-log.jsonl", `decision "${line.decision}" is not acted, dry-run, skipped or failed`);
  }
  if (slo) {
    if (slo.schema !== 1 || !isIso(slo.generated_at) || !Number.isFinite(slo.window_days)) add("slo.json", "schema, generated_at or window_days is missing");
    for (const item of slo.slos || []) {
      for (const field of ["id", "name", "component", "target", "accepted", "good", "total", "attainment", "budget_remaining", "burn", "enough_data"]) {
        if (!Object.hasOwn(item, field)) add("slo.json", `slos[${item.id}] has no "${field}"`);
      }
      if (item.burn && !["1h", "6h", "3d"].every((w) => Object.hasOwn(item.burn, w))) add("slo.json", `slos[${item.id}].burn lacks 1h, 6h or 3d`);
    }
    for (const alert of slo.burn_alerts || []) {
      for (const field of ["slo", "component", "severity", "window", "burn_rate", "text"]) if (!Object.hasOwn(alert, field)) add("slo.json", `a burn alert has no "${field}"`);
    }
  }
  return problems;
}

function publicTexts(incidents) {
  const texts = [];
  for (const item of [...(incidents.open || []), ...(incidents.recent || [])]) {
    texts.push(String(item.title || ""));
    for (const update of item.updates || []) texts.push(String(update?.text || ""));
  }
  return texts;
}

function audit(result, snapshot) {
  for (const problem of contractProblems(snapshot)) {
    const key = `${problem.file}: ${problem.text}`;
    if (!result.contract.includes(key)) result.contract.push(key);
  }
}

// ---------------------------------------------------------------- helpers

const openKeys = (snap) => (snap.incidents?.open || []).map((item) => item.key);
const findOpen = (snap, key) => (snap.incidents?.open || []).find((item) => item.key === key);
const recentKeys = (snap) => (snap.incidents?.recent || []).map((item) => item.key);
const opened = (ctx, key) => ctx.allActions.filter((a) => a.kind === "open-issue" && a.key === key).length;
const rollbacks = (ctx) => ctx.allDecisions.filter((d) => d.action === "cloud-run-rollback" && ["dry-run", "acted", "failed"].includes(d.decision));
const writes = (calls) => calls.filter((line) => !/^gcloud run (services describe|revisions (list|describe))\b/.test(line));

// Fast runs every five minutes from `from` (inclusive) for `count` runs.
async function fastRuns(ctx, from, count, make = () => ({})) {
  let last = null;
  for (let i = 0; i < count; i += 1) {
    const at = from + i * 5 * MINUTE;
    last = await ctx.pipeline(buildRun({ suite: "fast", at, ...make(i, at) }));
  }
  return last;
}

// The website, as when Cloudflare Pages serves errors: every page check of
// the public site fails.
const SITE_DOWN = Object.fromEntries(FAST_CHECKS.filter((c) => c.component === "public-site").map((c) => [c.id, { status: 503, detail: "Drill: answered 503." }]));
const START = Date.parse("2026-11-02T13:00:00.000Z");

// ---------------------------------------------------------------- scenarios

export const SCENARIOS = [
  {
    id: "site-down-and-recovers",
    title: "The website goes down for 30 minutes and comes back",
    expected: "No incident on the first failed run; one sev1 Website incident from the second; still one while it lasts; resolved after three good runs; never a rollback.",
    async run(ctx) {
      await ctx.cloudrun({ serving: OLD.revision, revisions: [OLD_REVISION] });
      await fastRuns(ctx, START, 3);
      const first = await ctx.pipeline(buildRun({ suite: "fast", at: START + 15 * MINUTE, failing: SITE_DOWN }));
      ctx.expect("no incident after the first failed run", !openKeys(first).includes("public-site"), { expected: "none", observed: openKeys(first) });
      const second = await ctx.pipeline(buildRun({ suite: "fast", at: START + 20 * MINUTE, failing: SITE_DOWN }));
      const incident = findOpen(second, "public-site");
      ctx.expect("a Website incident opens on the second failed run", Boolean(incident), { expected: "public-site open", observed: openKeys(second) });
      ctx.expect("it is sev1", incident?.severity === "sev1", { expected: "sev1", observed: incident?.severity });
      ctx.expect("the status page says outage", second.status?.components?.["public-site"]?.state === "outage" && second.status?.overall === "outage",
        { expected: "outage", observed: `${second.status?.components?.["public-site"]?.state}/${second.status?.overall}` });
      const during = await fastRuns(ctx, START + 25 * MINUTE, 4, () => ({ failing: SITE_DOWN }));
      ctx.expect("still exactly one incident while it lasts", openKeys(during).filter((k) => k === "public-site").length === 1 && opened(ctx, "public-site") === 1,
        { expected: "1 open, 1 opened", observed: `${openKeys(during).join(",")}; opened ${opened(ctx, "public-site")} times` });
      const back1 = await ctx.pipeline(buildRun({ suite: "fast", at: START + 45 * MINUTE }));
      ctx.expect("one good run is not yet a recovery", openKeys(back1).includes("public-site"), { expected: "still open", observed: openKeys(back1) });
      const back = await fastRuns(ctx, START + 50 * MINUTE, 3);
      ctx.expect("resolved after three good runs in a row", !openKeys(back).includes("public-site") && recentKeys(back).includes("public-site"),
        { expected: "in recent, not open", observed: { open: openKeys(back), recent: recentKeys(back) } });
      const closed = (back.incidents?.recent || []).find((item) => item.key === "public-site");
      ctx.measure("incident_duration_minutes", closed?.duration_minutes ?? null);
      ctx.expect("the status page is operational again", back.status?.overall === "operational", { expected: "operational", observed: back.status?.overall });
      ctx.expect("no rollback was proposed for a website outage", rollbacks(ctx).length === 0, { expected: 0, observed: rollbacks(ctx).length });
      const other = new Set(ctx.allActions.filter((a) => a.kind === "open-issue").map((a) => a.key));
      ctx.measure("incidents_opened", [...other]);
      ctx.expect("nothing but the Website incident was opened", [...other].every((key) => key === "public-site"), { expected: ["public-site"], observed: [...other] });
      const day = back.uptime?.["public-site"]?.["2026-11-02"];
      ctx.measure("uptime_public_site_2026_11_02", day ?? null);
      ctx.expect("the day's bar counts the six failed runs and no more", day?.failed === 6, { expected: 6, observed: day?.failed });
    },
  },

  {
    id: "single-blip",
    title: "One failed run among good ones",
    expected: "No incident, the status page never leaves operational, no rollback.",
    async run(ctx) {
      await ctx.cloudrun({ serving: OLD.revision, revisions: [OLD_REVISION] });
      await fastRuns(ctx, START, 3);
      const blip = await ctx.pipeline(buildRun({ suite: "fast", at: START + 15 * MINUTE, failing: { "api-health": { status: 502 } } }));
      ctx.expect("the status page stays operational on one failure", blip.status?.overall === "operational", { expected: "operational", observed: blip.status?.overall });
      const after = await fastRuns(ctx, START + 20 * MINUTE, 4);
      ctx.expect("no incident was ever opened", ctx.allActions.filter((a) => a.kind === "open-issue").length === 0,
        { expected: 0, observed: ctx.allActions.filter((a) => a.kind === "open-issue").map((a) => a.key) });
      ctx.expect("nothing open at the end", openKeys(after).length === 0, { expected: [], observed: openKeys(after) });
      ctx.expect("no rollback was proposed", rollbacks(ctx).length === 0, { expected: 0, observed: rollbacks(ctx).length });
    },
  },

  {
    id: "flapping",
    title: "The API check fails every other run for an hour, then settles",
    expected: "Never two failures in a row, yet the on-and-off rule opens one incident, one severity lower (sev3), that stays open while it flaps and closes once it settles. Opened once, not over and over.",
    async run(ctx) {
      await ctx.cloudrun({ serving: OLD.revision, revisions: [OLD_REVISION] });
      await fastRuns(ctx, START, 2);
      const flapping = await fastRuns(ctx, START + 10 * MINUTE, 12, (i) => ({ failing: i % 2 === 0 ? { "api-health": { status: 502 } } : {} }));
      const incident = findOpen(flapping, "api");
      ctx.expect("an API incident is open while it flaps", Boolean(incident), { expected: "api open", observed: openKeys(flapping) });
      ctx.expect("one severity lower than the check (sev3)", incident?.severity === "sev3", { expected: "sev3", observed: incident?.severity });
      const issues = ctx.allActions.filter((a) => a.kind === "open-issue");
      ctx.expect("one issue for the whole episode, not one per flap", issues.length === 1,
        { expected: 1, observed: issues.map((a) => a.key) });
      const settled = await fastRuns(ctx, START + 70 * MINUTE, 14);
      ctx.expect("closed once it settled", !openKeys(settled).includes("api") && recentKeys(settled).includes("api"),
        { expected: "api in recent", observed: { open: openKeys(settled), recent: recentKeys(settled) } });
      ctx.expect("one API incident, not one per flap", recentKeys(settled).filter((key) => key === "api").length === 1,
        { expected: 1, observed: recentKeys(settled) });
      ctx.expect("no rollback for a flapping check with no deploy", rollbacks(ctx).length === 0, { expected: 0, observed: rollbacks(ctx).length });
      // The burn rule can fire before the on-and-off rule; the budget
      // incident is then folded into the API incident. Recorded, not judged.
      ctx.measure("incidents_in_order", [...(settled.incidents?.recent || [])].reverse().map((item) => `${item.opened_at} ${item.key} ${item.severity}`));
      ctx.measure("issues_opened", issues.map((a) => `${a.at} ${a.key}`));
    },
  },

  {
    id: "api-fails-after-deploy",
    title: "A new API revision starts serving and the API fails at once",
    expected: "The monitor records the deploy; an API incident opens; the engine first writes a plan and waits one more failed run, then proposes rolling back to the revision it saw serving before, as a dry run only. Cloud Run is only read.",
    async run(ctx) {
      await ctx.cloudrun({ serving: OLD.revision, revisions: [OLD_REVISION] });
      await ctx.pipeline(buildRun({ suite: "slow", at: START }));
      await fastRuns(ctx, START + 5 * MINUTE, 6);
      // The deploy: a new image at 13:37, all traffic on it.
      const created = START + 37 * MINUTE;
      await ctx.cloudrun({
        serving: NEW.revision,
        revisions: [{ name: NEW.revision, created: iso(created), image: "us-east1-docker.pkg.dev/p/api@sha256:new", commit: NEW.commit }, OLD_REVISION],
      });
      const broken = { "api-health": { status: 500 }, "calculators-api-analyze": { status: 500 } };
      const first = await ctx.pipeline(buildRun({ suite: "fast", at: START + 40 * MINUTE, api: NEW, failing: broken }));
      ctx.expect("the deploy is recorded", first.deploys.some((line) => line.fact === "revision" && line.from === OLD.revision && line.to === NEW.revision),
        { expected: `${OLD.revision} -> ${NEW.revision}`, observed: first.deploys });
      const second = await ctx.pipeline(buildRun({ suite: "fast", at: START + 45 * MINUTE, api: NEW, failing: broken }));
      ctx.expect("an API incident opens", Boolean(findOpen(second, "api")), { expected: "api open", observed: openKeys(second) });
      const firstLook = (second.decision?.decisions || []).find((d) => d.trigger === "api");
      ctx.measure("first_decision", firstLook ? `${firstLook.decision} ${firstLook.code}` : null);
      ctx.expect("the first look only writes a plan", firstLook?.decision === "skipped" && firstLook?.code === "pending-confirmation",
        { expected: "skipped pending-confirmation", observed: firstLook ? `${firstLook.decision} ${firstLook.code}: ${firstLook.reason}` : "no decision" });
      const third = await ctx.pipeline(buildRun({ suite: "fast", at: START + 50 * MINUTE, api: NEW, failing: broken }));
      const proposal = (third.decision?.decisions || []).find((d) => d.trigger === "api");
      ctx.measure("second_decision", proposal ? `${proposal.decision} ${proposal.code}` : null);
      ctx.expect("a rollback to the previous revision is proposed, as a dry run",
        proposal?.decision === "dry-run" && proposal?.from_revision === NEW.revision && proposal?.to_revision === OLD.revision,
        { expected: `dry-run ${NEW.revision} -> ${OLD.revision}`, observed: proposal ? `${proposal.decision} ${proposal.code} ${proposal.from_revision} -> ${proposal.to_revision}: ${proposal.reason}` : "no decision" });
      ctx.expect("the decision document says dry run", third.decision?.mode === "dry-run", { expected: "dry-run", observed: third.decision?.mode });
      ctx.expect("the remediation log holds a dry-run line and no action", third.remediation.some((l) => l.decision === "dry-run") && !third.remediation.some((l) => l.decision === "acted"),
        { expected: "dry-run, never acted", observed: third.remediation.map((l) => l.decision) });
      const calls = await ctx.gcloudCalls();
      ctx.measure("gcloud_calls", calls.length);
      ctx.expect("Cloud Run was only read", writes(calls).length === 0, { expected: "describe/list only", observed: writes(calls) });
      ctx.expect("alert actions were dry runs", ctx.allActions.every((a) => a.result !== "done"), { expected: "none done", observed: [...new Set(ctx.allActions.map((a) => a.result))] });
    },
  },

  {
    id: "api-fails-without-deploy",
    title: "The API fails with no deploy in the last week",
    expected: "An API incident opens and no rollback is proposed: the serving revision is days old.",
    async run(ctx) {
      await ctx.cloudrun({ serving: OLD.revision, revisions: [OLD_REVISION] });
      await ctx.pipeline(buildRun({ suite: "slow", at: START }));
      await fastRuns(ctx, START + 5 * MINUTE, 6);
      const broken = { "api-health": { status: 500 }, "calculators-api-analyze": { status: 500 } };
      const last = await fastRuns(ctx, START + 35 * MINUTE, 5, () => ({ failing: broken }));
      ctx.expect("an API incident is open", Boolean(findOpen(last, "api")), { expected: "api open", observed: openKeys(last) });
      ctx.measure("incidents_open_for_one_cause", (last.incidents?.open || []).map((item) => `${item.key} ${item.severity}`));
      ctx.expect("no rollback is proposed", rollbacks(ctx).length === 0, { expected: 0, observed: rollbacks(ctx).map((d) => `${d.decision} ${d.code}`) });
      const codes = [...new Set(ctx.allDecisions.filter((d) => d.trigger === "api").map((d) => d.code))];
      ctx.measure("decision_codes", codes);
      ctx.expect("the reason given is that there was no recent deploy", codes.includes("no-recent-deploy"), { expected: "no-recent-deploy", observed: codes });
      ctx.expect("Cloud Run was only read", writes(await ctx.gcloudCalls()).length === 0, { expected: "reads only", observed: writes(await ctx.gcloudCalls()) });
    },
  },

  {
    id: "monitor-network-fails",
    title: "Every check fails at once with no answer: the monitor's own network",
    expected: "No incident for any part of the site, the history counts nothing against the site, no rollback; after two such runs one sev3 'monitoring' incident; it closes when the monitor can see again.",
    async run(ctx) {
      await ctx.cloudrun({ serving: OLD.revision, revisions: [OLD_REVISION] });
      await fastRuns(ctx, START, 3);
      const blind = await fastRuns(ctx, START + 15 * MINUTE, 3, () => ({ blind: true }));
      const siteKeys = openKeys(blind).filter((key) => key !== "monitoring");
      ctx.expect("no incident for any part of the site", siteKeys.length === 0, { expected: [], observed: siteKeys });
      const monitoring = findOpen(blind, "monitoring");
      ctx.expect("one monitoring incident after two blind runs", Boolean(monitoring) && opened(ctx, "monitoring") === 1, { expected: "monitoring open once", observed: openKeys(blind) });
      ctx.expect("it is sev3", monitoring?.severity === "sev3", { expected: "sev3", observed: monitoring?.severity });
      const counted = blind.history.slice(-3).filter((line) => Object.keys(line.c || {}).length > 0).length;
      ctx.expect("the blind runs count nothing for the SLOs", counted === 0, { expected: 0, observed: counted });
      ctx.expect("no rollback", rollbacks(ctx).length === 0, { expected: 0, observed: rollbacks(ctx).length });
      const back = await fastRuns(ctx, START + 30 * MINUTE, 3);
      ctx.expect("the monitoring incident closes when the monitor sees again", !openKeys(back).includes("monitoring"), { expected: "closed", observed: openKeys(back) });
      ctx.expect("the site was never reported down", ctx.allActions.filter((a) => a.kind === "open-issue" && a.key !== "monitoring").length === 0,
        { expected: 0, observed: ctx.allActions.filter((a) => a.kind === "open-issue").map((a) => a.key) });
    },
  },

  {
    id: "cloudflare-refuses-monitor",
    title: "Cloudflare refuses the monitor's requests to the website while the API answers",
    expected: "Seen for real on the first run from GitHub's runners. No Website, search, calculator, inquiry or staff incident and no outage on the status page; nothing counted against the SLOs; after two such runs one sev2 'monitoring' incident; it closes once the pages answer again.",
    async run(ctx) {
      await ctx.cloudrun({ serving: OLD.revision, revisions: [OLD_REVISION] });
      await fastRuns(ctx, START, 3);
      const refused = Object.fromEntries(FAST_CHECKS
        .filter((c) => ["public-site", "search", "calculators", "inquiry", "staff-site"].includes(c.component) && !["search-idx-provider", "calculators-api-analyze", "inquiry-preflight", "inquiry-route", "inquiry-queue", "staff-api-auth"].includes(c.id))
        .map((c) => [c.id, { status: 403, detail: "Cloudflare refused the request (403, a Cloudflare challenge page)." }]));
      const during = await fastRuns(ctx, START + 15 * MINUTE, 3, () => ({ failing: refused }));
      const site = openKeys(during).filter((key) => key !== "monitoring");
      ctx.expect("no incident for any part of the site", site.length === 0, { expected: [], observed: site });
      const monitoring = findOpen(during, "monitoring");
      ctx.expect("one sev2 monitoring incident", monitoring?.severity === "sev2", { expected: "monitoring sev2", observed: (during.incidents?.open || []).map((i) => `${i.key} ${i.severity}`) });
      ctx.expect("the status page shows no outage", during.status?.overall !== "outage", { expected: "not outage", observed: during.status?.overall });
      const counted = during.history.slice(-3).flatMap((line) => Object.keys(line.c || {})).filter((id) => refused[id]);
      ctx.expect("the refused checks count nothing for the SLOs", counted.length === 0, { expected: 0, observed: [...new Set(counted)] });
      const back = await fastRuns(ctx, START + 30 * MINUTE, 3);
      ctx.expect("closed once the pages answer again", !openKeys(back).includes("monitoring"), { expected: "closed", observed: openKeys(back) });
    },
  },

  {
    id: "slow-burn",
    title: "The API fails one run in six for three hours",
    expected: "Never two in a row, so no ordinary incident; the SLO calculator reports a burn and the alert engine opens one budget incident for the API's availability. Nothing is rolled back.",
    async run(ctx) {
      await ctx.cloudrun({ serving: OLD.revision, revisions: [OLD_REVISION] });
      const last = await fastRuns(ctx, START, 36, (i) => ({ failing: i % 6 === 5 ? { "api-health": { status: 502 } } : {} }));
      const burns = (last.slo?.burn_alerts || []).filter((a) => a.slo === "api-availability");
      ctx.measure("api_burn_alerts", burns.map((a) => `${a.window} ${a.severity} ${a.burn_rate}`));
      ctx.measure("open_at_end", openKeys(last));
      ctx.expect("the SLO calculator reports the burn", burns.length > 0, { expected: "a burn alert for api-availability", observed: last.slo?.burn_alerts ?? null });
      const budget = (last.incidents?.open || []).filter((item) => item.key.startsWith("budget:"));
      ctx.expect("one budget incident is open (or the burn is noted on an open API incident)",
        budget.length === 1 || (findOpen(last, "api") && budget.length === 0),
        { expected: "budget:api-availability", observed: openKeys(last) });
      ctx.expect("no rollback for a slow burn", rollbacks(ctx).length === 0, { expected: 0, observed: rollbacks(ctx).length });
    },
  },

  {
    id: "fast-suite-stops",
    title: "The five-minute checks stop for three hours while the hourly checks go on",
    expected: "The next hourly run notices and opens one sev3 'monitoring' incident; no part of the site is reported down; it closes once the five-minute checks are back.",
    async run(ctx) {
      await ctx.cloudrun({ serving: OLD.revision, revisions: [OLD_REVISION] });
      await ctx.pipeline(buildRun({ suite: "slow", at: START }));
      await fastRuns(ctx, START + 5 * MINUTE, 3);
      let snap = null;
      for (let hour = 1; hour <= 3; hour += 1) snap = await ctx.pipeline(buildRun({ suite: "slow", at: START + hour * HOUR }));
      const monitoring = findOpen(snap, "monitoring");
      ctx.expect("an hourly run opens a monitoring incident", Boolean(monitoring), { expected: "monitoring open", observed: openKeys(snap) });
      ctx.expect("nothing about the site is reported", openKeys(snap).every((key) => key === "monitoring"), { expected: ["monitoring"], observed: openKeys(snap) });
      ctx.measure("status_overall_while_stopped", snap.status?.overall);
      const back = await fastRuns(ctx, START + 3 * HOUR + 5 * MINUTE, 3);
      ctx.expect("it closes once the five-minute checks run again", !openKeys(back).includes("monitoring"), { expected: "closed", observed: openKeys(back) });
    },
  },

  {
    id: "monitor-stops-six-hours",
    title: "The whole monitor stops for six hours, then resumes",
    expected: "While nothing runs nothing can be filed: status.json keeps its old time, which is how the status page knows to say stale. On resuming, no incident is invented for the gap, nothing is counted for the hours not measured, and the page is operational again. (Telling a person during the gap is the Google Cloud uptime checks' job: docs/sre/alerting.md.)",
    async run(ctx) {
      await ctx.cloudrun({ serving: OLD.revision, revisions: [OLD_REVISION] });
      const before = await fastRuns(ctx, START, 6);
      const lastUpdate = before.status?.updated_at;
      const resumeAt = START + 25 * MINUTE + 6 * HOUR;
      const idle = await ctx.read();
      ctx.expect("nothing is written while the monitor is stopped", idle.status?.updated_at === lastUpdate, { expected: lastUpdate, observed: idle.status?.updated_at });
      const after = await fastRuns(ctx, resumeAt, 3);
      ctx.expect("no incident is opened for the gap", ctx.allActions.filter((a) => a.kind === "open-issue").length === 0,
        { expected: 0, observed: ctx.allActions.filter((a) => a.kind === "open-issue").map((a) => a.key) });
      ctx.expect("the history holds only the nine measured runs", after.history.length === 9, { expected: 9, observed: after.history.length });
      const api = (after.slo?.slos || []).find((item) => item.id === "api-availability");
      ctx.measure("api_availability_after_gap", api ? { good: api.good, total: api.total, enough_data: api.enough_data } : null);
      ctx.expect("the SLO counts only what was measured", !api || api.total <= 9 * 3, { expected: "<= 27 measurements", observed: api?.total });
      ctx.expect("operational again", after.status?.overall === "operational", { expected: "operational", observed: after.status?.overall });
      ctx.note("Nothing inside the pipeline notices that the whole monitor stopped; that is by design and is covered only once Gbenga applies the Google Cloud uptime checks.");
    },
  },

  {
    id: "certificate-nearing-expiry",
    title: "The website certificate stops renewing and runs down to its last day",
    expected: "Hourly checks: an incident opens at sev3 once 'under 21 days' has failed three hourly runs, is raised to sev2 under 7 days and to sev1 under 2 days (one incident, raised, not new ones), and closes after renewal. No rollback.",
    async run(ctx) {
      await ctx.cloudrun({ serving: OLD.revision, revisions: [OLD_REVISION] });
      // Time is compressed: each hourly run stands for a later day of the
      // countdown. The engine sees the severity each check reports.
      const tls = (severity, days) => ({ "tls-public": { status: null, severity, detail: `Drill: diamondecho.com: the certificate expires in ${days} days and has not been renewed.`, observed: { expires: "2026-11-20" } } });
      const plan = [null, null, tls("sev3", 20), tls("sev3", 15), tls("sev3", 10), tls("sev2", 6), tls("sev2", 4), tls("sev1", 1), tls("sev1", 1), null, null, null];
      const severities = [];
      let snap = null;
      for (const [hour, failing] of plan.entries()) {
        snap = await ctx.pipeline(buildRun({ suite: "slow", at: START + hour * HOUR, failing: failing || {} }));
        severities.push(findOpen(snap, "tls")?.severity ?? "-");
      }
      ctx.measure("tls_incident_severity_by_hour", severities.join(" "));
      ctx.expect("opens at sev3 on the third failing hourly run", severities[3] === "-" && severities[4] === "sev3", { expected: "- at hour 3, sev3 at hour 4", observed: severities.join(" ") });
      ctx.expect("raised to sev2 under 7 days", severities.slice(5, 7).includes("sev2"), { expected: "sev2 at hours 5-6", observed: severities.join(" ") });
      ctx.expect("raised to sev1 under 2 days", severities.slice(7, 9).includes("sev1"), { expected: "sev1 at hours 7-8", observed: severities.join(" ") });
      ctx.expect("one incident, raised rather than reopened", opened(ctx, "tls") === 1, { expected: 1, observed: opened(ctx, "tls") });
      ctx.measure("severity_changes", ctx.allActions.filter((a) => a.kind === "set-severity" && a.key === "tls").map((a) => `${a.from}->${a.to}`));
      ctx.expect("closed after the renewal", !openKeys(snap).includes("tls") && recentKeys(snap).includes("tls"), { expected: "tls in recent", observed: { open: openKeys(snap), recent: recentKeys(snap) } });
      ctx.expect("no rollback", rollbacks(ctx).length === 0, { expected: 0, observed: rollbacks(ctx).length });
    },
  },
];

// ------------------------------------------------------------------ runner

export async function runScenario(scenario, { keepDir = null } = {}) {
  const result = {
    id: scenario.id, title: scenario.title, expected: scenario.expected,
    outcome: null, reason: "", steps: 0, expectations: [], observations: {}, notes: [], contract: [],
  };
  const sandbox = await makeSandbox(keepDir ? path.join(keepDir, scenario.id) : null);
  const ctx = scenarioContext(sandbox, result);
  try {
    await scenario.run(ctx);
    const failed = result.expectations.filter((item) => !item.ok);
    result.outcome = failed.length ? "failed" : "passed";
    result.reason = failed.map((item) => item.name).join("; ");
  } catch (error) {
    if (error instanceof NotRun) {
      result.outcome = "not-run";
      result.reason = error.message;
    } else {
      result.outcome = "error";
      result.reason = `${error.name}: ${error.message}`;
    }
  } finally {
    result.steps = ctx.steps;
    if (!keepDir) await rm(sandbox.root, { recursive: true, force: true });
  }
  return result;
}

export function parseArgs(argv) {
  const options = { only: null, out: null, keep: null, strict: false, list: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`${arg} needs a value`);
      return argv[++i];
    };
    if (arg === "--only") options.only = value().split(",").filter(Boolean);
    else if (arg === "--out") options.out = value();
    else if (arg === "--keep") options.keep = value();
    else if (arg === "--strict") options.strict = true;
    else if (arg === "--list") options.list = true;
    else throw new Error(`unknown option ${arg}. Usage: node scripts/sre/fire-drill.mjs [--only id,id] [--out drill.json] [--keep DIR] [--strict] [--list]`);
  }
  for (const id of options.only || []) if (!SCENARIOS.some((s) => s.id === id)) throw new Error(`no scenario called ${id}`);
  return options;
}

export function exitCode(results, { strict = false } = {}) {
  if (results.some((r) => r.outcome === "error")) return 2;
  if (results.some((r) => r.outcome === "failed")) return 1;
  if (strict && results.some((r) => r.outcome === "not-run")) return 1;
  return 0;
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`fire-drill: ${error.message}`);
    return 2;
  }
  if (options.list) {
    for (const s of SCENARIOS) console.log(`${s.id}: ${s.title}`);
    return 0;
  }
  const chosen = SCENARIOS.filter((s) => !options.only || options.only.includes(s.id));
  const results = [];
  for (const scenario of chosen) {
    const result = await runScenario(scenario, { keepDir: options.keep });
    results.push(result);
    console.log(`${result.outcome.toUpperCase().padEnd(7)} ${result.id} (${result.steps} runs)${result.reason ? `: ${result.reason}` : ""}`);
    for (const item of result.expectations) {
      if (!item.ok) console.log(`  [FAIL] ${item.name}: expected ${JSON.stringify(item.expected)}, saw ${JSON.stringify(item.observed)}`);
    }
  }
  const contract = [...new Set(results.flatMap((r) => r.contract))].sort();
  if (contract.length) {
    console.log("Differences from scripts/sre/README.md:");
    for (const line of contract) console.log(`  - ${line}`);
  }
  const count = (outcome) => results.filter((r) => r.outcome === outcome).length;
  console.log(`fire-drill: ${count("passed")} passed, ${count("failed")} failed, ${count("not-run")} not run, ${count("error")} broke; ${contract.length} contract differences.`);
  if (options.out) {
    const generatedAt = process.env.SRE_NOW ? iso(Date.parse(process.env.SRE_NOW)) : new Date().toISOString();
    await writeFile(options.out, `${JSON.stringify({ schema: 1, kind: "fire-drill", generated_at: generatedAt, scenarios: results, contract_differences: contract }, null, 2)}\n`);
  }
  return exitCode(results, { strict: options.strict });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then((code) => { process.exitCode = code; }, (error) => {
    console.error(`fire-drill: the drill broke: ${error.stack || error}`);
    process.exitCode = 2;
  });
}
