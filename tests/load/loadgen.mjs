#!/usr/bin/env node
// DiamondEcho load generator. Plain Node, no packages.
//
//   node tests/load/loadgen.mjs                      the standard set against http://127.0.0.1:8080
//   node tests/load/loadgen.mjs --list               what scenarios exist
//   node tests/load/loadgen.mjs --scenario spike --target http://127.0.0.1:8080 --out result.json
//
// It never runs against production: see safety.mjs. How to run it and how to
// read the result: docs/sre/load-testing.md.
//
// Exit codes: 0 the run finished and met its thresholds; 1 a threshold was
// missed; 2 the run was refused or the tool itself broke.
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { cpus, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkTarget, SafetyError, scenarioProblems, STAGING_CAPS, STAGING_FLAG, verifyIdentity } from "./safety.mjs";
import { realIo, runScenario } from "./runner.mjs";
import { evaluateThresholds } from "./stats.mjs";
import { SCENARIOS, STANDARD, findScenario } from "./scenarios.mjs";

export const DEFAULT_TARGET = "http://127.0.0.1:8080";
const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_OUT = resolve(here, "results", "load-result.json");

export class UsageError extends Error {}

/**
 * The wall clock for the result's timestamps. When SRE_NOW (an ISO time) is
 * set, as in the fire drill and tests, time starts there and runs on at the
 * real pace. Request latencies never use this: they are timed with the
 * monotonic clock in runner.mjs.
 */
export function makeClock(env = process.env, perfNow = () => performance.now()) {
  const raw = env.SRE_NOW;
  if (raw === undefined || raw === "") return () => new Date();
  const base = Date.parse(raw);
  if (!Number.isFinite(base)) throw new UsageError(`SRE_NOW must be an ISO time, got "${raw}".`);
  const origin = perfNow();
  return () => new Date(base + (perfNow() - origin));
}

const VALUE_FLAGS = {
  "--target": "target",
  "--scenario": "scenario",
  "--out": "out",
  "--summary": "summary",
  "--label": "label",
  "--duration": "durationSeconds",
  "--warmup": "warmupSeconds",
  "--concurrency": "concurrency",
  "--rate": "ratePerSecond",
  "--timeout-ms": "timeoutMs",
  "--think-ms": "thinkTimeMs",
  "--max-requests": "maxRequests",
};
const NUMBER_OPTIONS = new Set(["durationSeconds", "warmupSeconds", "concurrency", "ratePerSecond", "timeoutMs", "thinkTimeMs", "maxRequests"]);
const SWITCHES = {
  "--list": "list",
  "--help": "help",
  "--no-thresholds": "noThresholds",
  [STAGING_FLAG]: "stagingApproved",
};

/**
 * Read the command line. Every flag is listed above; anything else is an
 * error, so there is no hidden way to say "yes, production".
 */
export function parseArgs(argv) {
  const options = { target: DEFAULT_TARGET, scenario: null, out: DEFAULT_OUT, overrides: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag in SWITCHES) {
      options[SWITCHES[flag]] = true;
    } else if (flag in VALUE_FLAGS) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new UsageError(`${flag} needs a value.`);
      index += 1;
      const name = VALUE_FLAGS[flag];
      if (NUMBER_OPTIONS.has(name)) {
        const number = Number(value);
        if (!Number.isFinite(number) || number < 0) throw new UsageError(`${flag} needs a number, got "${value}".`);
        options.overrides[name] = number;
      } else {
        options[name] = value;
      }
    } else {
      throw new UsageError(`Unknown option "${flag}". Run with --help for the list.`);
    }
  }
  return options;
}

/** The scenarios a run will use, with any command-line overrides applied. */
export function selectScenarios(names, overrides = {}) {
  const ids = names ? String(names).split(",").map((name) => name.trim()).filter(Boolean) : STANDARD;
  const wanted = ids.flatMap((id) => (id === "standard" || id === "all" ? STANDARD : [id]));
  return wanted.map((id) => {
    const scenario = findScenario(id);
    if (!scenario) throw new UsageError(`No scenario named "${id}". Run with --list to see them.`);
    const changed = { ...scenario };
    for (const [name, value] of Object.entries(overrides)) {
      if (scenario.stages && (name === "ratePerSecond" || name === "durationSeconds")) {
        throw new UsageError(`Scenario "${id}" is made of stages; its rate and duration are set in tests/load/scenarios.mjs.`);
      }
      if (name === "ratePerSecond" && scenario.mode !== "open") {
        throw new UsageError(`Scenario "${id}" is closed-loop; --rate applies to open-loop scenarios only.`);
      }
      changed[name] = value;
    }
    return changed;
  });
}

const HELP = `DiamondEcho load generator (never runs against production)

  node tests/load/loadgen.mjs [options]

  --target ORIGIN        where to send load. Default ${DEFAULT_TARGET}
  --scenario a,b         scenarios to run. Default: ${STANDARD.join(", ")}
  --out FILE             JSON result. Default tests/load/results/load-result.json
  --summary FILE         also append a Markdown summary to FILE
  --label TEXT           where this ran, recorded in the result ("sandbox", "CI runner")
  --duration SECONDS     override the measured time of each scenario
  --warmup SECONDS       override the warm-up
  --concurrency N        override visitors at once (closed) or the in-flight cap (open)
  --rate N               override arrivals per second (open-loop scenarios without stages)
  --timeout-ms N         override the per-request timeout
  --think-ms N           override the pause between a visitor's requests
  --max-requests N       stop each scenario after N requests
  --no-thresholds        report only; never exit 1
  --list                 print the scenarios and exit
  ${STAGING_FLAG}
                         required for a staging address, and only after Gbenga's yes.
                         Staging ceilings: ${STAGING_CAPS.ratePerSecond} requests a second, ${STAGING_CAPS.concurrency} at once,
                         ${STAGING_CAPS.totalSeconds} seconds, ${STAGING_CAPS.requests} requests.

There is no option that allows production.`;

const cell = (value, unit = "") => (value === null || value === undefined ? "no data" : `${value}${unit}`);

/** A Markdown table for the job summary, one row per scenario. */
export function markdownSummary(result) {
  const lines = [
    `### Load test: ${result.passed ? "thresholds met" : "THRESHOLD MISSED"}`,
    "",
    `Target: \`${result.target.origin}\` (${result.target.kind}). ${result.note}`,
    "",
    "| Scenario | Requests | Failed | Per second | p50 ms | p90 ms | p95 ms | p99 ms | Max ms | Result |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];
  for (const scenario of result.scenarios) {
    const l = scenario.latency_ms;
    const errors = Object.entries(scenario.errors).map(([kind, count]) => `${kind}: ${count}`).join(", ");
    lines.push(
      `| ${scenario.id} | ${scenario.requests} | ${scenario.failed}${errors ? ` (${errors})` : ""} | ${scenario.throughput_rps} | ${cell(l.p50)} | ${cell(l.p90)} | ${cell(l.p95)} | ${cell(l.p99)} | ${cell(l.max)} | ${scenario.passed ? "ok" : "missed"} |`,
    );
  }
  const missed = result.scenarios.flatMap((scenario) =>
    scenario.thresholds.filter((item) => !item.ok).map((item) => `- \`${scenario.id}\`: ${item.name} is ${cell(item.actual)}, the limit is ${item.limit}`),
  );
  if (missed.length) lines.push("", "Missed thresholds:", ...missed);
  return `${lines.join("\n")}\n`;
}

function printScenario(scenario, log) {
  const l = scenario.latency_ms;
  log(`\n${scenario.id}: ${scenario.requests} requests in ${scenario.measured_seconds}s, ${scenario.throughput_rps} ok/s, ${scenario.failed} failed`);
  log(`  latency ms  p50 ${cell(l.p50)}  p90 ${cell(l.p90)}  p95 ${cell(l.p95)}  p99 ${cell(l.p99)}  max ${cell(l.max)}`);
  for (const [kind, count] of Object.entries(scenario.errors)) log(`  error ${kind}: ${count}`);
  for (const [name, part] of Object.entries(scenario.by_stage)) {
    log(`  stage ${name}: ${part.requests} requests, ${part.failed} failed, p50 ${cell(part.latency_ms.p50)}  p95 ${cell(part.latency_ms.p95)}  max ${cell(part.latency_ms.max)}`);
  }
  for (const [name, part] of Object.entries(scenario.by_step)) {
    log(`  step ${name}: ${part.requests} requests, ${part.failed} failed, p50 ${cell(part.latency_ms.p50)}  p95 ${cell(part.latency_ms.p95)}  max ${cell(part.latency_ms.max)}`);
  }
  for (const item of scenario.thresholds) {
    log(`  ${item.ok ? "ok    " : "MISSED"} ${item.name}: ${cell(item.actual)} (limit ${item.limit})`);
  }
}

/**
 * Run the selected scenarios and build the result document. `io` is passed to
 * the runner (tests replace it); `log` prints progress.
 */
export async function run(options, { io, log = console.log, clock = () => new Date() } = {}) {
  // Refuse before anything is selected, printed or sent.
  const stagingApproved = options.stagingApproved === true;
  const checked = checkTarget(options.target, { stagingApproved });
  const scenarios = selectScenarios(options.scenario, options.overrides);
  // Every scenario is checked before anything is sent, the identity request
  // included, so a refused run sends nothing at all.
  for (const scenario of scenarios) {
    const problems = scenarioProblems(scenario, checked.kind);
    if (problems.length) throw new SafetyError("scenario-refused", `Scenario "${scenario.id}" refused:\n- ${problems.join("\n- ")}`);
  }
  // Then ask the target who it is, before any load: a port on this machine
  // may be forwarded to a deployed service (safety.mjs, verifyIdentity).
  const network = io ?? realIo();
  const identity = await verifyIdentity(checked, { stagingApproved, io: network });
  const target = { ...checked, kind: identity.kind };
  const where = options.label ?? (target.kind === "staging" ? "staging" : "this machine");
  const note = `Measured on ${where}; not a production measurement.`;
  log(`Target ${target.origin} (${target.kind}). ${note}`);

  const started = clock();
  const results = [];
  for (const scenario of scenarios) {
    log(`\nRunning ${scenario.id}: ${scenario.description}`);
    const outcome = await runScenario(scenario, options.target, { stagingApproved, io: network, verifiedKind: target.kind });
    const stated = options.noThresholds ? {} : scenario.thresholds?.[target.kind] ?? {};
    const thresholds = evaluateThresholds(outcome.report, stated);
    const entry = {
      id: scenario.id,
      description: scenario.description,
      settings: {
        mode: scenario.mode,
        concurrency: scenario.concurrency,
        rate_per_second: scenario.ratePerSecond ?? null,
        stages: scenario.stages ?? null,
        duration_seconds: scenario.durationSeconds ?? null,
        warmup_seconds: scenario.warmupSeconds ?? 0,
        timeout_ms: scenario.timeoutMs,
        think_time_ms: scenario.thinkTimeMs ?? 0,
        max_requests: scenario.maxRequests ?? null,
      },
      warmup_requests: outcome.warmupRequests,
      ...outcome.report,
      thresholds,
      passed: thresholds.every((item) => item.ok),
    };
    printScenario(entry, log);
    results.push(entry);
  }
  return {
    schema: 1,
    tool: "diamondecho-loadgen",
    production: false,
    label: where,
    note,
    target: { origin: target.origin, kind: target.kind, revision: identity.revision },
    started_at: started.toISOString(),
    finished_at: clock().toISOString(),
    environment: {
      node: process.version,
      platform: `${platform()} ${release()}`,
      cpus: cpus().length,
      cpu_model: cpus()[0]?.model ?? null,
    },
    scenarios: results,
    passed: results.every((entry) => entry.passed),
  };
}

export async function main(argv, { log = console.log, error = console.error, env = process.env, io } = {}) {
  let options;
  let clock;
  try {
    options = parseArgs(argv);
    clock = makeClock(env);
  } catch (problem) {
    error(problem.message);
    return 2;
  }
  if (options.help) {
    log(HELP);
    return 0;
  }
  if (options.list) {
    for (const scenario of SCENARIOS) log(`${scenario.id.padEnd(16)} ${scenario.description}`);
    log(`\nDefault set: ${STANDARD.join(", ")}`);
    return 0;
  }
  let result;
  try {
    result = await run(options, { log, clock, ...(io ? { io } : {}) });
  } catch (problem) {
    if (problem instanceof SafetyError || problem instanceof UsageError) {
      error(problem.message);
      return 2;
    }
    error(`Load generator failed: ${problem.stack ?? problem}`);
    return 2;
  }
  try {
    mkdirSync(dirname(resolve(options.out)), { recursive: true });
    writeFileSync(resolve(options.out), `${JSON.stringify(result, null, 2)}\n`);
    log(`\nResult written to ${options.out}`);
    if (options.summary) appendFileSync(resolve(options.summary), markdownSummary(result));
  } catch (problem) {
    error(`Could not write the result: ${problem.message}`);
    return 2;
  }
  if (!result.passed) {
    error("\nOne or more thresholds were missed (see MISSED above).");
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
