// The runner, driven by a pretend network and clock (fake-io.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { errorKind, plan, runScenario, sendOnce } from "./runner.mjs";
import { SafetyError } from "./safety.mjs";
import { fakeIo } from "./fake-io.mjs";

const LOCAL = "http://127.0.0.1:8080";
const health = { name: "health", method: "GET", path: "/health", bodyIncludes: '"ok"' };
const analyze = { name: "analyze", method: "POST", path: "/api/v1/deals/analyze", body: { strategy: "rental" } };
const okBody = (ms) => () => ({ status: 200, body: '{"status":"ok"}', ms });

const closed = (changes = {}) => ({
  id: "t",
  mode: "closed",
  concurrency: 1,
  durationSeconds: 1,
  warmupSeconds: 0,
  timeoutMs: 1000,
  steps: [health],
  ...changes,
});

test("production is refused inside the runner too, before any request", async () => {
  for (const target of ["https://diamondecho.com", "https://diamondecho-api-180189726732.us-east1.run.app"]) {
    const io = fakeIo();
    await assert.rejects(io.drive(runScenario(closed(), target, { io, stagingApproved: true })), (error) => error instanceof SafetyError && error.code === "production");
    assert.equal(io.calls.length, 0);
  }
});

test("a scenario that breaks the rules is refused before any request", async () => {
  const io = fakeIo();
  const bad = closed({ steps: [{ method: "POST", path: "/api/v1/inquiries", body: {} }] });
  await assert.rejects(io.drive(runScenario(bad, LOCAL, { io })), (error) => error.code === "scenario-refused" && /inquiry/.test(error.message));
  assert.equal(io.calls.length, 0);
});

test("a step changed after the check is caught at the point of use", async () => {
  const io = fakeIo();
  const scenario = closed();
  // A getter that answers "/health" to the check and something else later
  // would be a bug in a scenario; the runner copies and checks each step.
  let reads = 0;
  const sneaky = { name: "sneaky", method: "GET", get path() { reads += 1; return reads <= 1 ? "/health" : "/api/v1/inquiries"; } };
  scenario.steps = [sneaky];
  await assert.rejects(io.drive(runScenario(scenario, LOCAL, { io })), (error) => error instanceof SafetyError);
  assert.equal(io.calls.length, 0);
});

test("the path that was checked is the path that is sent", async () => {
  // Answers "/health" to the scenario check and to the runner's copy, then
  // the inquiry route to anyone who reads it again. If the runner checked one
  // read and sent another, a request would reach the inquiry route.
  let reads = 0;
  const shifty = { name: "shifty", method: "GET", get path() { reads += 1; return reads <= 2 ? "/health" : "/api/v1/inquiries"; } };
  const io = fakeIo({ respond: okBody(10) });
  await io.drive(runScenario(closed({ steps: [shifty], maxRequests: 3 }), LOCAL, { io }));
  assert.equal(io.calls.length, 3);
  for (const call of io.calls) assert.equal(call.url, `${LOCAL}/health`);
});

test("closed loop: one visitor, 20 ms answers, one second -> about 50 requests", async () => {
  const io = fakeIo({ respond: okBody(20) });
  const result = await io.drive(runScenario(closed(), LOCAL, { io }));
  assert.ok(result.report.requests >= 50 && result.report.requests <= 51, String(result.report.requests));
  assert.equal(result.report.failed, 0);
  assert.equal(result.report.latency_ms.p50, 20);
  assert.equal(result.report.latency_ms.max, 20);
  for (const call of io.calls) {
    assert.equal(call.url, `${LOCAL}/health`);
    assert.equal(call.redirect, "manual");
    assert.match(call.headers["User-Agent"], /never production/);
  }
});

test("closed loop: four visitors at once get four times the requests", async () => {
  const io = fakeIo({ respond: okBody(20) });
  const result = await io.drive(runScenario(closed({ concurrency: 4 }), LOCAL, { io }));
  assert.ok(result.report.requests >= 200 && result.report.requests <= 204, String(result.report.requests));
  assert.ok(result.report.throughput_rps >= 195 && result.report.throughput_rps <= 205, String(result.report.throughput_rps));
});

test("think time slows a visitor down", async () => {
  const io = fakeIo({ respond: okBody(0) });
  const result = await io.drive(runScenario(closed({ thinkTimeMs: 100 }), LOCAL, { io }));
  assert.ok(result.report.requests >= 10 && result.report.requests <= 11, String(result.report.requests));
});

test("warm-up requests are sent but not counted", async () => {
  const io = fakeIo({ respond: okBody(100) });
  const result = await io.drive(runScenario(closed({ warmupSeconds: 1 }), LOCAL, { io }));
  assert.equal(result.warmupRequests, 10);
  assert.equal(result.report.requests, 10);
  assert.equal(io.calls.length, 20);
  assert.equal(result.measuredSeconds, 1);
});

test("maxRequests stops the run, and throughput uses the time really spent", async () => {
  const io = fakeIo({ respond: okBody(100) });
  const result = await io.drive(runScenario(closed({ durationSeconds: 60, maxRequests: 3 }), LOCAL, { io }));
  assert.equal(io.calls.length, 3);
  assert.equal(result.measuredSeconds, 0.3);
  assert.equal(result.report.throughput_rps, 10);
});

test("steps rotate, and session order starts every visitor at the first step", async () => {
  const io = fakeIo({ respond: (url) => ({ status: 200, body: '{"status":"ok"}', ms: url.endsWith("/health") ? 10 : 30 }) });
  await io.drive(runScenario(closed({ steps: [health, { ...analyze, bodyIncludes: undefined }], maxRequests: 4 }), LOCAL, { io }));
  assert.deepEqual(io.calls.map((call) => call.method), ["GET", "POST", "GET", "POST"]);
  assert.equal(io.calls[1].headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(io.calls[1].body), { strategy: "rental" });

  const spread = fakeIo({ respond: okBody(10) });
  await spread.drive(runScenario(closed({ concurrency: 2, steps: [health, { ...health, name: "two", path: "/api/" }], maxRequests: 2 }), LOCAL, { io: spread }));
  assert.deepEqual(spread.calls.map((call) => call.url.slice(LOCAL.length)).sort(), ["/api/", "/health"]);

  const session = fakeIo({ respond: okBody(10) });
  await session.drive(runScenario(closed({ concurrency: 2, order: "session", steps: [health, { ...health, name: "two", path: "/api/" }], maxRequests: 2 }), LOCAL, { io: session }));
  assert.deepEqual(session.calls.map((call) => call.url.slice(LOCAL.length)), ["/health", "/health"]);
});

test("errors are classified: status, wrong body, timeout, connection", async () => {
  const cases = [
    [() => ({ status: 429, body: "slow down", ms: 5 }), "http_429"],
    [() => ({ status: 503, body: "", ms: 5 }), "http_503"],
    [() => ({ status: 302, body: "", ms: 5 }), "http_302"],
    [() => ({ status: 200, body: '{"status":"broken"}', ms: 5 }), "body"],
    [() => ({ status: 200, body: '{"status":"ok"}', ms: 5000 }), "timeout"],
    [() => ({ throws: new TypeError("fetch failed") }), "connection"],
  ];
  for (const [respond, kind] of cases) {
    const io = fakeIo({ respond });
    const result = await io.drive(runScenario(closed({ maxRequests: 2, timeoutMs: 200 }), LOCAL, { io }));
    assert.deepEqual(result.report.errors, { [kind]: 2 }, kind);
    assert.equal(result.report.ok, 0, kind);
    assert.equal(result.report.error_rate, 1, kind);
  }
});

test("a timeout is counted at the timeout, not at the slow answer", async () => {
  const io = fakeIo({ respond: () => ({ status: 200, body: '{"status":"ok"}', ms: 10_000 }) });
  const result = await io.drive(runScenario(closed({ maxRequests: 1, timeoutMs: 250 }), LOCAL, { io }));
  assert.deepEqual(result.report.errors, { timeout: 1 });
  assert.equal(result.measuredSeconds, 0.25);
});

test("expectStatus lets a step expect something other than 200", async () => {
  const io = fakeIo({ respond: () => ({ status: 204, body: "", ms: 1 }) });
  const result = await io.drive(runScenario(closed({ maxRequests: 1, steps: [{ method: "GET", path: "/health", expectStatus: 204 }] }), LOCAL, { io }));
  assert.equal(result.report.ok, 1);
});

const open = (changes = {}) => ({
  id: "o",
  mode: "open",
  concurrency: 10,
  ratePerSecond: 10,
  durationSeconds: 2,
  warmupSeconds: 0,
  timeoutMs: 1000,
  steps: [health],
  ...changes,
});

test("open loop: arrivals keep their rate whatever the answer time", async () => {
  const io = fakeIo({ respond: okBody(50) });
  const result = await io.drive(runScenario(open(), LOCAL, { io }));
  assert.equal(result.report.requests, 20);
  assert.equal(result.report.failed, 0);

  const slow = fakeIo({ respond: okBody(400) });
  const slowResult = await slow.drive(runScenario(open(), LOCAL, { io: slow }));
  assert.equal(slowResult.report.requests, 20); // still 20 arrivals: a slow server does not slow the arrivals
  assert.equal(slowResult.report.failed, 0);
});

test("open loop: arrivals beyond the in-flight cap are counted as shed, not hidden", async () => {
  const io = fakeIo({ respond: okBody(1000) });
  const result = await io.drive(runScenario(open({ concurrency: 2, timeoutMs: 5000 }), LOCAL, { io }));
  assert.equal(result.report.requests, 20);
  assert.ok(result.report.errors.shed >= 14, JSON.stringify(result.report.errors));
  assert.equal(result.report.ok + result.report.errors.shed, 20);
  assert.ok(io.calls.length <= 6, String(io.calls.length));
});

test("open loop with stages reports each stage", async () => {
  const io = fakeIo({ respond: okBody(5) });
  const stages = [
    { name: "steady", seconds: 2, ratePerSecond: 2 },
    { name: "spike", seconds: 2, ratePerSecond: 20 },
    { name: "recovery", seconds: 2, ratePerSecond: 2 },
  ];
  const result = await io.drive(runScenario(open({ stages, warmupSeconds: 1 }), LOCAL, { io }));
  assert.equal(result.warmupRequests, 2);
  assert.equal(result.report.by_stage.steady.requests, 4);
  assert.equal(result.report.by_stage.spike.requests, 40);
  assert.equal(result.report.by_stage.recovery.requests, 4);
  assert.equal(result.report.requests, 48);
  assert.ok(!("warm-up" in result.report.by_stage));
});

test("plan lays the stages end to end, warm-up first", () => {
  assert.deepEqual(
    plan({ warmupSeconds: 2, stages: [{ name: "a", seconds: 3, ratePerSecond: 1 }, { seconds: 1, ratePerSecond: 4 }] }),
    [
      { name: "warm-up", seconds: 2, ratePerSecond: 1, warmup: true, startMs: 0, endMs: 2000 },
      { name: "a", seconds: 3, ratePerSecond: 1, startMs: 2000, endMs: 5000 },
      { name: "stage-2", seconds: 1, ratePerSecond: 4, startMs: 5000, endMs: 6000 },
    ],
  );
  assert.deepEqual(plan({ durationSeconds: 5 }), [{ name: null, seconds: 5, ratePerSecond: 0, startMs: 0, endMs: 5000 }]);
});

test("sendOnce times to the last byte and never follows redirects", async () => {
  const io = fakeIo({ respond: () => ({ status: 200, body: "12345", ms: 42 }) });
  const result = await io.drive(sendOnce(io, LOCAL, { method: "GET", path: "/health" }, 1000));
  assert.deepEqual(result, { ok: true, kind: "ok", ms: 42, bytes: 5, status: 200 });
  assert.equal(io.calls[0].redirect, "manual");
});

test("errorKind", () => {
  assert.equal(errorKind({ name: "AbortError" }), "timeout");
  assert.equal(errorKind({ name: "TimeoutError" }), "timeout");
  assert.equal(errorKind(new TypeError("fetch failed")), "connection");
  assert.equal(errorKind(undefined), "connection");
});
