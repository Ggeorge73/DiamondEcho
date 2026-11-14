// Runs one scenario against one target and returns its raw samples.
//
// Two ways to apply load:
// - closed loop: a fixed number of pretend visitors, each sending its next
//   request only after the previous answer (plus an optional think time).
//   Good for "how fast is it with N at once".
// - open loop: requests arrive at a set rate whether or not earlier ones were
//   answered, the way real visitors do. Good for spikes. If more than
//   `concurrency` requests are already waiting, the arrival is not sent and is
//   counted as "shed", so the generator never hides a queue it caused.
//
// Everything that touches the network or the clock comes in through `io`, so
// the tests run this file without either.
import { checkRoute, checkTarget, LOADGEN_USER_AGENT, scenarioProblems, SafetyError } from "./safety.mjs";
import { buildReport } from "./stats.mjs";

export const realIo = () => ({
  fetch: globalThis.fetch,
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
});

const USER_AGENT = LOADGEN_USER_AGENT;

/** Classify a thrown fetch error into a short kind. */
export function errorKind(error) {
  if (error?.name === "AbortError" || error?.name === "TimeoutError") return "timeout";
  return "connection";
}

/**
 * Send one request and time it to the last byte of the answer.
 * Returns { ok, kind, ms, bytes, status }.
 */
export async function sendOnce(io, origin, step, timeoutMs) {
  const controller = new AbortController();
  const started = io.now();
  const timer = io.setTimeout(() => controller.abort(), timeoutMs);
  const init = {
    method: step.method,
    // Never follow a redirect: the answer could point at another host.
    redirect: "manual",
    signal: controller.signal,
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  };
  if (step.body !== undefined) {
    init.body = typeof step.body === "string" ? step.body : JSON.stringify(step.body);
    init.headers["Content-Type"] = "application/json";
  }
  try {
    const response = await io.fetch(origin + step.path, init);
    const buffer = await response.arrayBuffer();
    const ms = io.now() - started;
    const expected = step.expectStatus ?? 200;
    if (response.status !== expected) {
      return { ok: false, kind: `http_${response.status}`, ms, bytes: buffer.byteLength, status: response.status };
    }
    if (step.bodyIncludes && !Buffer.from(buffer).toString("utf8").includes(step.bodyIncludes)) {
      // The right status with the wrong body is not a success.
      return { ok: false, kind: "body", ms, bytes: buffer.byteLength, status: response.status };
    }
    return { ok: true, kind: "ok", ms, bytes: buffer.byteLength, status: response.status };
  } catch (error) {
    return { ok: false, kind: errorKind(error), ms: io.now() - started, bytes: 0, status: null };
  } finally {
    io.clearTimeout(timer);
  }
}

const sleep = (io, ms) => new Promise((resolve) => io.setTimeout(resolve, Math.max(0, ms)));

/** Stage plan for a scenario: [{ name, seconds, ratePerSecond }], warm-up first. */
export function plan(scenario) {
  const stages = scenario.stages?.length
    ? scenario.stages.map((stage, index) => ({ name: stage.name ?? `stage-${index + 1}`, seconds: stage.seconds, ratePerSecond: stage.ratePerSecond }))
    : [{ name: null, seconds: scenario.durationSeconds, ratePerSecond: scenario.ratePerSecond ?? 0 }];
  const warm = scenario.warmupSeconds > 0
    ? [{ name: "warm-up", seconds: scenario.warmupSeconds, ratePerSecond: stages[0].ratePerSecond, warmup: true }]
    : [];
  let at = 0;
  return [...warm, ...stages].map((stage) => {
    const entry = { ...stage, startMs: at, endMs: at + stage.seconds * 1000 };
    at = entry.endMs;
    return entry;
  });
}

/**
 * Run a scenario. `target` is the address as typed; it is checked again here,
 * so this function cannot be handed production by a caller that forgot to.
 * Returns { samples, warmupRequests, measuredSeconds, report }.
 */
export async function runScenario(scenario, target, { stagingApproved = false, io = realIo(), verifiedKind = null } = {}) {
  const host = checkTarget(target, { stagingApproved });
  // The identity check (verifyIdentity, run once by loadgen.mjs) can only
  // make the rules stricter: a local port that turned out to lead to staging
  // is held to the staging ceilings.
  const checked = verifiedKind === "staging" ? { ...host, kind: "staging" } : host;
  const problems = scenarioProblems(scenario, checked.kind);
  if (problems.length) {
    throw new SafetyError("scenario-refused", `Scenario "${scenario.id}" refused:\n- ${problems.join("\n- ")}`);
  }
  // Checked a third time at the point of use. Each step is copied once and
  // the copy is what is checked and what is sent, so no later edit to the
  // scenario object (or a step whose path changes when read) can matter.
  const steps = scenario.steps.map((original) => {
    const { method, path } = original;
    const step = Object.freeze({ ...original, method, path, name: original.name ?? `${method} ${path}` });
    checkRoute(step.method, step.path, checked.kind);
    return step;
  });

  const stages = plan(scenario);
  const endMs = stages[stages.length - 1].endMs;
  const measuredStartMs = stages.find((stage) => !stage.warmup).startMs;
  const stageAt = (elapsed) => stages.find((stage) => elapsed < stage.endMs) ?? stages[stages.length - 1];
  const limit = scenario.maxRequests ?? Infinity;

  const samples = [];
  let warmupRequests = 0;
  let sent = 0;
  const start = io.now();
  const elapsed = () => io.now() - start;

  const record = (step, stage, result) => {
    if (stage.warmup) {
      warmupRequests += 1;
      return;
    }
    samples.push({ step: step.name, stage: stage.name, ok: result.ok, kind: result.kind, ms: result.ms, bytes: result.bytes });
  };

  if (scenario.mode === "closed") {
    // Each pretend visitor walks the steps in order. By default they start
    // one step apart, so the mix of routes on the wire is even from the first
    // second; with order "session" every visitor starts at the first step,
    // as a person arriving on the site does.
    const visitor = async (index) => {
      let position = scenario.order === "session" ? 0 : index;
      while (elapsed() < endMs && sent < limit) {
        sent += 1;
        const step = steps[position % steps.length];
        position += 1;
        const stage = stageAt(elapsed());
        record(step, stage, await sendOnce(io, checked.origin, step, scenario.timeoutMs));
        if (scenario.thinkTimeMs > 0) await sleep(io, scenario.thinkTimeMs);
      }
    };
    await Promise.all(Array.from({ length: scenario.concurrency }, (_, index) => visitor(index)));
  } else {
    // Arrivals are evenly spaced at each stage's rate. Sends are scheduled
    // from the stage's start time, not from "now", so a late timer does not
    // slow the arrival rate down (that would hide exactly what a spike shows).
    const pending = new Set();
    let inFlight = 0;
    let position = 0;
    for (const stage of stages) {
      if (!(stage.ratePerSecond > 0)) {
        await sleep(io, stage.endMs - elapsed());
        continue;
      }
      const gapMs = 1000 / stage.ratePerSecond;
      const arrivals = Math.floor((stage.seconds * 1000) / gapMs);
      for (let n = 0; n < arrivals && sent < limit; n += 1) {
        const dueMs = stage.startMs + n * gapMs;
        const wait = dueMs - elapsed();
        if (wait > 0) await sleep(io, wait);
        sent += 1;
        const step = steps[position % steps.length];
        position += 1;
        if (inFlight >= scenario.concurrency) {
          record(step, stage, { ok: false, kind: "shed", ms: 0, bytes: 0 });
          continue;
        }
        inFlight += 1;
        const job = sendOnce(io, checked.origin, step, scenario.timeoutMs).then((result) => {
          inFlight -= 1;
          pending.delete(job);
          record(step, stage, result);
        });
        pending.add(job);
      }
      const rest = stage.endMs - elapsed();
      if (rest > 0) await sleep(io, rest);
    }
    await Promise.all(pending);
  }

  // No new request starts after the planned end, but one started just before
  // it may run on for up to timeoutMs. On staging, safety.mjs requires the
  // planned time plus that timeout to fit the staging ceiling.
  // Throughput is measured over the time load was really applied: a scenario
  // that stops early at maxRequests is not averaged over its unused time.
  const measuredSeconds = Math.max(0, (elapsed() - measuredStartMs) / 1000);
  return {
    target: checked,
    samples,
    warmupRequests,
    measuredSeconds,
    report: buildReport(samples, measuredSeconds),
  };
}
