#!/usr/bin/env node
// Run the chaos experiments against the real API started on this machine.
//
//   node tests/chaos/run.mjs [--python PATH] [--only id,id] [--out results.json] [--list]
//   node tests/chaos/run.mjs --staging https://STAGING-ADDRESS --approved-by-gbenga [--out …]
//
// Local by default: each experiment starts its own API process from
// backend/ (tests/chaos/serve.py) on 127.0.0.1 with outbound connections
// refused, breaks something on purpose and checks its hypothesis. Production
// is never a target: a production address is refused even with approval.
// A staging run needs both the address and the approval flag, and runs only
// the experiments marked remote_safe.
//
// Python: --python, else CHAOS_PYTHON, else python3. It needs
// backend/requirements.txt installed.
//
// Exit codes: 0 every hypothesis held; 1 a hypothesis failed, an experiment
// was aborted, or a known weakness is no longer seen (remove its mark);
// 2 the runner itself broke or was used wrongly.
// SRE_NOW (an ISO time) sets the clock the result timestamps are read from.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { EXPERIMENTS } from "./experiments.mjs";
import {
  AbortCondition, isProductionUrl, makeRequester, sleep, startBlackhole, startServer,
} from "./lib.mjs";

export function parseArgs(argv, env = process.env) {
  const options = { python: env.CHAOS_PYTHON || "python3", only: null, out: null, list: false, staging: null, approved: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) throw new UsageError(`${arg} needs a value`);
      i += 1;
      return next;
    };
    if (arg === "--python") options.python = value();
    else if (arg === "--only") options.only = value().split(",").map((id) => id.trim()).filter(Boolean);
    else if (arg === "--out") options.out = value();
    else if (arg === "--list") options.list = true;
    else if (arg === "--staging") options.staging = value();
    else if (arg === "--approved-by-gbenga") options.approved = true;
    else throw new UsageError(`unknown option ${arg}`);
  }
  return options;
}

export class UsageError extends Error {}

// Where the experiments may send requests. Local unless a staging run is
// asked for with approval; production never.
export function chooseTarget({ staging, approved }) {
  if (!staging) return { kind: "local", allowed: "loopback" };
  let url;
  try { url = new URL(staging); } catch { throw new UsageError("--staging needs a full https address"); }
  if (isProductionUrl(staging)) throw new UsageError(`refusing ${url.host}: that is production. Chaos experiments never run against production.`);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.username || url.password) {
    throw new UsageError("--staging needs a bare https origin, like https://staging-api.example.run.app");
  }
  if (!approved) {
    throw new UsageError("a staging run needs --approved-by-gbenga, given only after Gbenga said yes for this run (docs/sre/chaos-and-game-days.md)");
  }
  return { kind: "staging", allowed: url.origin, origin: url.origin };
}

export function selectExperiments(all, { only, target }) {
  const known = new Set(all.map((e) => e.id));
  for (const id of only || []) if (!known.has(id)) throw new UsageError(`no experiment called ${id}`);
  return all.filter((e) => (!only || only.includes(e.id)) && (target.kind === "local" || e.remote_safe));
}

export function clockFrom(env = process.env, now = Date.now) {
  const base = env.SRE_NOW ? Date.parse(env.SRE_NOW) : now();
  if (Number.isNaN(base)) throw new UsageError("SRE_NOW is not an ISO time");
  const started = performance.now();
  return () => new Date(base + (performance.now() - started)).toISOString();
}

// Run one experiment with its own servers, silent ports and clock file, and
// clean all of them up whatever happens.
export async function runExperiment(experiment, { python, target, request, clock = () => new Date().toISOString(),
  startServerImpl = startServer, startBlackholeImpl = startBlackhole } = {}) {
  const result = {
    id: experiment.id, title: experiment.title, hypothesis: experiment.hypothesis,
    blast_radius: experiment.blast_radius, abort_condition: experiment.abort_condition,
    target: target.kind, started_at: clock(), finished_at: null, duration_ms: null,
    outcome: null, reason: "", checks: [], measurements: {}, notes: [],
  };
  const started = performance.now();
  const servers = [];
  const holes = [];
  let home = null;
  let clockFile = null;
  let offset = 0;
  const ctx = {
    request, sleep, AbortCondition,
    remote: target.kind === "local" ? null : { url: (route) => `${target.origin}${route}` },
    canTimeTravel: target.kind === "local",
    async start({ env = {}, flags = [], clock: needsClock = false } = {}) {
      if (target.kind !== "local") throw new Error("only a local run may start processes");
      if (!home) home = await mkdtemp(path.join(os.tmpdir(), "diamondecho-chaos-"));
      if (needsClock && !clockFile) clockFile = path.join(home, "limiter-clock-offset");
      const server = await startServerImpl({ python, home, env, flags, request, clockFile: needsClock ? clockFile : null });
      servers.push(server);
      return server;
    },
    async blackhole() {
      const hole = await startBlackholeImpl();
      holes.push(hole);
      return hole;
    },
    async advanceClock(seconds) {
      if (!clockFile) throw new Error("advanceClock needs a server started with clock: true");
      offset += seconds;
      await writeFile(clockFile, String(offset));
    },
    check(name, ok, { expected = null, observed = null, known } = {}) {
      result.checks.push({ name, ok: Boolean(ok), expected, observed, ...(known ? { known_weakness: known } : {}) });
    },
    measure(name, value) { result.measurements[name] = value; },
    note(text) { result.notes.push(text); },
  };

  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new AbortCondition(`ran past its ${experiment.deadline_ms / 1000} s limit`)), experiment.deadline_ms);
  });
  try {
    await Promise.race([experiment.run(ctx), deadline]);
    const failing = result.checks.filter((c) => (c.known_weakness ? c.ok : !c.ok));
    result.outcome = failing.length ? "failed" : "held";
    result.reason = failing.map((c) => (c.known_weakness ? `known weakness no longer seen, remove its mark: ${c.name}` : c.name)).join("; ");
  } catch (error) {
    result.outcome = error instanceof AbortCondition ? "aborted" : "error";
    result.reason = error instanceof AbortCondition ? error.message : `${error.name}: ${error.message}`;
  } finally {
    clearTimeout(timer);
    for (const server of servers) {
      server.kill("SIGKILL");
      await Promise.race([server.exited, sleep(5_000)]);
    }
    for (const hole of holes) await hole.close();
    if (home) await rm(home, { recursive: true, force: true });
    result.finished_at = clock();
    result.duration_ms = Math.round(performance.now() - started);
  }
  result.known_weaknesses_confirmed = result.checks.filter((c) => c.known_weakness && !c.ok).map((c) => c.known_weakness);
  return result;
}

export function summarise(results) {
  const count = (outcome) => results.filter((r) => r.outcome === outcome).length;
  const summary = { held: count("held"), failed: count("failed"), aborted: count("aborted"), error: count("error") };
  const exitCode = summary.error ? 2 : summary.failed || summary.aborted ? 1 : 0;
  return { summary, exitCode };
}

function printResult(result) {
  console.log(`${result.outcome.toUpperCase().padEnd(7)} ${result.id} (${(result.duration_ms / 1000).toFixed(1)} s)${result.reason ? ": " + result.reason : ""}`);
  for (const check of result.checks) {
    const mark = check.known_weakness ? (check.ok ? "FIXED?" : "known ") : check.ok ? "  ok  " : " FAIL ";
    console.log(`  [${mark}] ${check.name}${check.ok && !check.known_weakness ? "" : ` (expected ${JSON.stringify(check.expected)}, saw ${JSON.stringify(check.observed)})`}`);
  }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  let options;
  let target;
  let chosen;
  let clock;
  try {
    options = parseArgs(argv, env);
    target = chooseTarget(options);
    chosen = selectExperiments(EXPERIMENTS, { only: options.only, target });
    clock = clockFrom(env);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`chaos: ${error.message}`);
    return 2;
  }
  if (options.list) {
    for (const e of EXPERIMENTS) console.log(`${e.id}${e.remote_safe ? " (remote safe)" : ""}: ${e.title}`);
    return 0;
  }
  const request = makeRequester({ allowed: target.allowed });
  const record = {
    schema: 1, kind: "chaos-run", target: target.kind, started_at: clock(), finished_at: null,
    environment: { node: process.version, platform: `${process.platform}-${process.arch}`, cpus: os.cpus().length },
    experiments: [], summary: null,
  };
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  for (const experiment of chosen) {
    if (stopping) break;
    const result = await runExperiment(experiment, { python: options.python, target, request, clock });
    record.experiments.push(result);
    printResult(result);
  }
  record.finished_at = clock();
  const { summary, exitCode } = summarise(record.experiments);
  record.summary = { ...summary, stopped_early: stopping };
  if (options.out) await writeFile(options.out, JSON.stringify(record, null, 2) + "\n");
  console.log(`chaos: ${summary.held} held, ${summary.failed} failed, ${summary.aborted} aborted, ${summary.error} broke${stopping ? " (stopped early)" : ""}`);
  return stopping && exitCode === 0 ? 1 : exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().then((code) => { process.exitCode = code; }, (error) => {
    console.error(`chaos: the runner broke: ${error.stack || error}`);
    process.exitCode = 2;
  });
}
