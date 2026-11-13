#!/usr/bin/env node
// Look at the live site the way a visitor would, and write down what was seen.
//
//   node scripts/sre/synthetic-checks.mjs --suite fast|slow|post-deploy --out run.json [--fail-on-failure]
//
// Each check module in checks/ is asked in turn (never at the same time, so
// the site sees one visitor at a human pace). Their results go into one run
// document (the shape is in lib/schema.mjs and scripts/sre/README.md).
// Everything here is read-only: the modules only GET, HEAD and OPTIONS, plus
// the one reference calculation described in checks/calculators.mjs.
//
// Exit codes: 0 the run was written (failed checks are data, not an error);
// 1 with --fail-on-failure when any check failed; 2 when this command itself
// broke (bad arguments, a file it could not write).
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { makeCheck, makeRun, SUITES } from "./lib/schema.mjs";
import { TARGETS } from "./targets.mjs";

// The fixed list from the contract. tls, dns, domain and edge belong to the
// edge security role; they are loaded the same way, and a module that is
// missing or breaks is reported, never skipped in silence.
export const MODULES = Object.freeze(["pages", "api", "calculators", "inquiry", "search", "staff", "tls", "dns", "domain", "edge"]);

// Where a module's own breakdown is filed, and how it is named, when its
// checks could not be run at all.
const MODULE_INFO = Object.freeze({
  pages: { component: "public-site", label: "website page" },
  api: { component: "api", label: "API" },
  calculators: { component: "calculators", label: "calculator" },
  inquiry: { component: "inquiry", label: "inquiry form" },
  search: { component: "search", label: "property search" },
  staff: { component: "staff-site", label: "staff site" },
  tls: { component: "tls", label: "TLS certificate" },
  dns: { component: "dns", label: "DNS" },
  domain: { component: "domain", label: "domain registration" },
  edge: { component: "public-site", label: "edge" },
});

// No module may hold a run longer than this, and no run longer than the
// second figure: the workflow job stops at 10 minutes, and a run that is cut
// off there files nothing at all. The slowest honest case is the pages module
// against a site that swallows every connection: three 10 s attempts on the
// home page, then one 5 s attempt for each of the other nine requests, about
// 85 s (see lib/http.mjs, "quiet origins").
export const MODULE_TIME_LIMIT_MS = 90_000;
export const RUN_TIME_LIMIT_MS = 420_000;

// GitHub's hosted runners are Azure machines. Azure's instance metadata
// service says which region the machine is in; it answers only from inside
// Azure, so it is asked only on GitHub, and given one second.
export const AZURE_REGION_URL = "http://169.254.169.254/metadata/instance/compute/location?api-version=2021-02-01&format=text";
const REGION = /^[a-z0-9]{2,40}$/;
const COMMIT = /^[0-9a-f]{7,40}$/;

const realSleep = (ms) => new Promise((done) => setTimeout(done, ms));

// The clock. With SRE_NOW set (an ISO time, used by tests and the fire drill)
// time starts there and moves at the real pace, so latencies stay real.
export function makeClock(env = process.env, realNow = Date.now) {
  if (!env.SRE_NOW) return realNow;
  const base = Date.parse(env.SRE_NOW);
  if (Number.isNaN(base)) throw new UsageError(`SRE_NOW is not an ISO time: ${String(env.SRE_NOW).slice(0, 40)}`);
  const start = realNow();
  return () => base + (realNow() - start);
}

export async function detectVantage(env = process.env, fetcher = fetch) {
  if (env.GITHUB_ACTIONS !== "true") return { provider: "local", region: null };
  let region = null;
  try {
    const response = await fetcher(AZURE_REGION_URL, { headers: { Metadata: "true" }, signal: AbortSignal.timeout(1000) });
    const text = response.ok ? (await response.text()).trim().toLowerCase() : "";
    if (REGION.test(text)) region = text;
  } catch {
    // Not on Azure, or the service did not answer in time: the region is unknown.
  }
  return { provider: "github-actions", region };
}

// An error message that is safe to put in a public result: no addresses, one
// line, short.
export function safeMessage(error) {
  const text = `${error?.name || "Error"}: ${error?.message ?? String(error)}`;
  return text.split("\n")[0].replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "an address").slice(0, 160);
}

function moduleFailure(name, reason) {
  const info = MODULE_INFO[name] || { component: "public-site", label: name };
  return makeCheck({
    id: `monitor-${name}`, name: `Monitor could run the ${info.label} checks`, component: info.component,
    severity: "sev3", ok: false, status: null, latency_ms: null, attempts: 1, slis: [],
    detail: `The ${info.label} checks did not run: ${reason}. The monitor cannot see this part of the site until it is fixed.`,
  });
}

function withTimeLimit(promise, ms) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`it did not finish within ${Math.round(ms / 1000)} s`), { name: "TimeLimit" })), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

const defaultLoad = (name) => import(new URL(`./checks/${name}.mjs`, import.meta.url).href);

// Run every module that belongs to the suite and return the run document.
export async function runSuite({
  suite, env = process.env, fetch: fetcher = globalThis.fetch, now = makeClock(env), sleep = realSleep,
  loadModule = defaultLoad, modules = MODULES, timeLimitMs = MODULE_TIME_LIMIT_MS, runLimitMs = RUN_TIME_LIMIT_MS, targets = TARGETS.production,
  log = () => {}, vantage,
}) {
  if (!SUITES.includes(suite)) throw new UsageError(`--suite must be one of ${SUITES.join(", ")}`);
  const started_at = new Date(now()).toISOString();
  const ctx = { fetch: fetcher, now, targets, env, suite, sleep };
  const checks = [];
  const seen = new Set();

  for (const name of modules) {
    let module;
    try {
      module = await loadModule(name);
    } catch (error) {
      const missing = error?.code === "ERR_MODULE_NOT_FOUND" && String(error.message).includes(`${name}.mjs`);
      log(`checks/${name}.mjs could not be loaded: ${safeMessage(error)}`);
      checks.push(moduleFailure(name, missing ? "its file is missing" : `it could not be loaded (${safeMessage(error)})`));
      continue;
    }
    if (!Array.isArray(module?.suites) || typeof module?.run !== "function") {
      checks.push(moduleFailure(name, "it does not export suites and run"));
      continue;
    }
    if (!module.suites.includes(suite)) continue;

    const left = runLimitMs - (now() - Date.parse(started_at));
    if (left <= 0) {
      checks.push(moduleFailure(name, `the run had used its ${Math.round(runLimitMs / 1000)} s before these checks could start`));
      continue;
    }

    let results;
    try {
      results = await withTimeLimit(Promise.resolve().then(() => module.run(ctx)), Math.min(timeLimitMs, left));
    } catch (error) {
      log(`checks/${name}.mjs broke: ${safeMessage(error)}`);
      if (error?.stack) log(error.stack.split("\n").filter((line) => line.trim().startsWith("at ")).slice(0, 5).join("\n"));
      checks.push(moduleFailure(name, error?.name === "TimeLimit" ? error.message : `it stopped with an error (${safeMessage(error)})`));
      continue;
    }

    // A module's results are checked against the contract here, so one
    // module's mistake costs only its own checks, not the whole run.
    let accepted;
    try {
      if (!Array.isArray(results)) throw new Error("it returned something other than a list");
      accepted = results.map((check) => makeCheck(check));
      const ids = accepted.map((check) => check.id);
      const clash = ids.find((id, index) => seen.has(id) || ids.indexOf(id) !== index);
      if (clash) throw new Error(`it reused the check id ${clash}`);
    } catch (error) {
      log(`checks/${name}.mjs returned results outside the contract: ${safeMessage(error)}`);
      checks.push(moduleFailure(name, `it returned results outside the contract (${safeMessage(error)})`));
      continue;
    }
    for (const check of accepted) {
      seen.add(check.id);
      checks.push(check);
    }
  }

  const commit = COMMIT.test(env.GITHUB_SHA || "") ? env.GITHUB_SHA : null;
  return makeRun({
    suite, started_at, finished_at: new Date(now()).toISOString(),
    vantage: vantage || await detectVantage(env, fetcher), commit, checks,
  });
}

// A short table for the person reading the workflow log. Details are already
// safe to publish (see lib/http.mjs).
export function summary(run) {
  const rows = run.checks.map((check) => [
    check.ok ? "ok" : "FAIL", check.severity, check.id, check.status === null ? "-" : String(check.status),
    check.latency_ms === null ? "-" : `${check.latency_ms} ms`, check.detail,
  ]);
  const widths = [4, 4, Math.max(...rows.map((row) => row[2].length)), 3, Math.max(4, ...rows.map((row) => row[4].length))];
  const lines = rows.map((row) => row.slice(0, 5).map((cell, i) => cell.padEnd(widths[i])).join("  ") + (row[5] ? `  ${row[5]}` : ""));
  const failed = run.checks.filter((check) => !check.ok).length;
  const where = [run.vantage.provider, run.vantage.region].filter(Boolean).join(" ");
  lines.push(`${run.suite} run from ${where}: ${run.checks.length} checks, ${run.checks.length - failed} passed, ${failed} failed.`);
  return lines.join("\n");
}

class UsageError extends Error {
  constructor(message) { super(message); this.name = "UsageError"; }
}

const USAGE = "Usage: node scripts/sre/synthetic-checks.mjs --suite fast|slow|post-deploy --out run.json [--fail-on-failure]";

export async function main(argv = process.argv.slice(2), deps = {}) {
  const out = deps.stdout || ((text) => process.stdout.write(`${text}\n`));
  const err = deps.stderr || ((text) => process.stderr.write(`${text}\n`));
  let args;
  try {
    ({ values: args } = parseArgs({ args: argv, options: {
      suite: { type: "string" }, out: { type: "string" }, "fail-on-failure": { type: "boolean", default: false }, help: { type: "boolean", default: false },
    } }));
  } catch (error) {
    err(`${error.message}\n${USAGE}`);
    return 2;
  }
  if (args.help) { out(USAGE); return 0; }
  if (!args.suite || !SUITES.includes(args.suite) || !args.out) {
    err(USAGE);
    return 2;
  }

  let run;
  try {
    run = await runSuite({ suite: args.suite, env: deps.env || process.env, log: err, ...deps.run });
  } catch (error) {
    err(`The run could not be completed: ${safeMessage(error)}`);
    return 2;
  }

  try {
    const target = resolve(args.out);
    mkdirSync(dirname(target), { recursive: true });
    // Written beside the target, then renamed, so a reader never sees half a file.
    writeFileSync(`${target}.partial`, `${JSON.stringify(run, null, 2)}\n`);
    renameSync(`${target}.partial`, target);
  } catch (error) {
    err(`Could not write ${args.out}: ${safeMessage(error)}`);
    return 2;
  }

  out(summary(run));
  return args["fail-on-failure"] && run.checks.some((check) => !check.ok) ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // process.exit, not a natural end: a module that ran past its time limit may
  // still hold a timer, and the run is already written.
  main().then((code) => process.exit(code), (error) => {
    process.stderr.write(`synthetic-checks broke: ${safeMessage(error)}\n`);
    process.exit(2);
  });
}
