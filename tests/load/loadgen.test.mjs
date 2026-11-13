// The command line: options, refusals, exit codes and the result document.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_TARGET, main, makeClock, markdownSummary, parseArgs, selectScenarios, UsageError } from "./loadgen.mjs";
import { STANDARD } from "./scenarios.mjs";
import { fakeIo } from "./fake-io.mjs";

const quiet = () => {
  const lines = [];
  return { lines, log: (line) => lines.push(String(line)), error: (line) => lines.push(String(line)) };
};

const withTempDir = async (fn) => {
  const dir = mkdtempSync(join(tmpdir(), "loadgen-test-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// Runs main() on the pretend network and clock. Returns the exit code,
// the printed lines, the requests made and the JSON written.
async function runMain(args, { respond, env = {} } = {}) {
  return withTempDir(async (dir) => {
    const out = join(dir, "result.json");
    const summary = join(dir, "summary.md");
    const io = fakeIo({ respond });
    const printed = quiet();
    const code = await io.drive(main([...args, "--out", out, "--summary", summary], { ...printed, env, io }));
    let result = null;
    let markdown = null;
    try {
      result = JSON.parse(readFileSync(out, "utf8"));
      markdown = readFileSync(summary, "utf8");
    } catch {
      // nothing written
    }
    return { code, lines: printed.lines, calls: io.calls, result, markdown };
  });
}

const LOCAL_IDENTITY = '{"service":"DiamondEcho API","revision":null,"commit":null}';
const okRoutes = (ms) => (url) => ({
  status: 200,
  ms,
  body: url.endsWith("/assumption-profiles") ? '{"profiles":[]}' : url.endsWith("/api/") ? LOCAL_IDENTITY : '{"status":"ok"}',
});
// The API answers its identity, and `status` on every other route.
const failingRoutes = (status) => (url) => (url.endsWith("/api/") ? { status: 200, body: LOCAL_IDENTITY, ms: 1 } : { status, body: "", ms: 2 });

test("the default target is this machine", () => {
  assert.equal(DEFAULT_TARGET, "http://127.0.0.1:8080");
  assert.equal(parseArgs([]).target, DEFAULT_TARGET);
});

test("there is no option that allows production", () => {
  for (const flag of ["--allow-production", "--production", "--force", "--yes", "--i-have-approval-for-production", "--unsafe"]) {
    assert.throws(() => parseArgs([flag]), UsageError, flag);
  }
});

test("production on the command line exits 2 without a single request", async () => {
  for (const target of ["https://diamondecho.com", "https://www.diamondecho.com", "https://diamondecho-api-180189726732.us-east1.run.app"]) {
    for (const extra of [[], ["--i-have-approval-for-staging"]]) {
      const { code, calls, result, lines } = await runMain(["--target", target, ...extra], { respond: okRoutes(1) });
      assert.equal(code, 2, target);
      assert.equal(calls.length, 0, target);
      assert.equal(result, null, target);
      assert.ok(lines.some((line) => /never load-tested/.test(line)), target);
    }
  }
});

test("staging without the flag exits 2 without a request", async () => {
  const { code, calls } = await runMain(["--target", "https://diamondecho-api-staging-299705773978.us-east1.run.app", "--scenario", "staging-gentle"]);
  assert.equal(code, 2);
  assert.equal(calls.length, 0);
});

test("an ordinary scenario aimed at staging is refused even with the flag", async () => {
  const { code, calls, lines } = await runMain([
    "--target", "https://diamondecho-api-staging-299705773978.us-east1.run.app",
    "--i-have-approval-for-staging",
    "--scenario", "spike",
  ]);
  assert.equal(code, 2);
  assert.equal(calls.length, 0);
  assert.ok(lines.some((line) => /over the ceiling/.test(line)));
});

test("option parsing", () => {
  const options = parseArgs(["--target", "http://localhost:9000", "--scenario", "analyze,spike", "--duration", "5", "--concurrency", "3", "--no-thresholds", "--label", "CI runner"]);
  assert.equal(options.target, "http://localhost:9000");
  assert.equal(options.scenario, "analyze,spike");
  assert.deepEqual(options.overrides, { durationSeconds: 5, concurrency: 3 });
  assert.equal(options.noThresholds, true);
  assert.equal(options.label, "CI runner");
  assert.throws(() => parseArgs(["--duration"]), /needs a value/);
  assert.throws(() => parseArgs(["--duration", "--list"]), /needs a value/);
  assert.throws(() => parseArgs(["--duration", "soon"]), /needs a number/);
  assert.throws(() => parseArgs(["--rate", "-1"]), /needs a number/);
});

test("scenario selection and overrides", () => {
  assert.deepEqual(selectScenarios(null).map((scenario) => scenario.id), STANDARD);
  assert.deepEqual(selectScenarios("standard").map((scenario) => scenario.id), STANDARD);
  assert.equal(selectScenarios("analyze", { durationSeconds: 2 })[0].durationSeconds, 2);
  assert.throws(() => selectScenarios("nope"), /No scenario named/);
  assert.throws(() => selectScenarios("spike", { durationSeconds: 2 }), /stages/);
  assert.throws(() => selectScenarios("analyze", { ratePerSecond: 2 }), /closed-loop/);
  // The shared scenario list is not changed by an override.
  assert.equal(selectScenarios("analyze")[0].durationSeconds, 15);
});

test("a run that meets its thresholds exits 0 and writes the result", async () => {
  const { code, result, markdown, calls } = await runMain(["--scenario", "read-routes", "--duration", "1", "--warmup", "0", "--label", "unit test"], { respond: okRoutes(5) });
  assert.equal(code, 0);
  assert.ok(calls.length > 0);
  for (const call of calls) assert.ok(call.url.startsWith("http://127.0.0.1:8080/"), call.url);
  assert.equal(result.schema, 1);
  assert.equal(result.production, false);
  assert.equal(result.label, "unit test");
  assert.match(result.note, /Measured on unit test; not a production measurement/);
  assert.deepEqual(result.target, { origin: "http://127.0.0.1:8080", kind: "local", revision: null });
  assert.equal(calls[0].url, "http://127.0.0.1:8080/api/"); // the identity check comes first
  assert.equal(result.passed, true);
  const [scenario] = result.scenarios;
  assert.equal(scenario.id, "read-routes");
  assert.equal(scenario.failed, 0);
  assert.equal(scenario.latency_ms.p95, 5);
  assert.ok(scenario.thresholds.every((item) => item.ok));
  assert.ok(Object.keys(scenario.by_step).includes("assumption profiles"));
  assert.match(markdown, /### Load test: thresholds met/);
  assert.match(markdown, /\| read-routes \|/);
});

test("a missed threshold exits 1 and says which", async () => {
  const { code, result, markdown, lines } = await runMain(["--scenario", "read-routes", "--duration", "1", "--warmup", "0"], { respond: okRoutes(300) });
  assert.equal(code, 1);
  assert.equal(result.passed, false);
  const missed = result.scenarios[0].thresholds.filter((item) => !item.ok).map((item) => item.name);
  assert.ok(missed.includes("p95_ms"));
  assert.match(markdown, /THRESHOLD MISSED/);
  assert.match(markdown, /`read-routes`: p95_ms is 300, the limit is 100/);
  assert.ok(lines.some((line) => /MISSED p95_ms/.test(line)));
});

test("--no-thresholds reports without failing", async () => {
  const { code, result } = await runMain(["--scenario", "read-routes", "--duration", "1", "--warmup", "0", "--no-thresholds"], { respond: okRoutes(300) });
  assert.equal(code, 0);
  assert.deepEqual(result.scenarios[0].thresholds, []);
});

test("failures are counted by kind in the result", async () => {
  const { code, result } = await runMain(["--scenario", "analyze", "--duration", "1", "--warmup", "0"], { respond: failingRoutes(503) });
  assert.equal(code, 1);
  assert.equal(result.scenarios[0].errors.http_503, result.scenarios[0].requests);
  assert.equal(result.scenarios[0].latency_ms.p50, null);
});

test("SRE_NOW sets the result's clock", async () => {
  const { code, result } = await runMain(["--scenario", "read-routes", "--duration", "1", "--warmup", "0"], { respond: okRoutes(5), env: { SRE_NOW: "2026-11-13T09:00:00.000Z" } });
  assert.equal(code, 0);
  // Time starts at SRE_NOW and runs on at the real pace (the identity check comes first).
  assert.ok(result.started_at >= "2026-11-13T09:00:00.000Z" && result.started_at < "2026-11-13T09:00:01.000Z", result.started_at);
  assert.ok(result.finished_at >= result.started_at);
  assert.ok(result.finished_at < "2026-11-13T09:01:00.000Z");
});

test("a bad SRE_NOW is a usage error", async () => {
  const { code, calls } = await runMain(["--scenario", "read-routes"], { env: { SRE_NOW: "yesterday" } });
  assert.equal(code, 2);
  assert.equal(calls.length, 0);
});

test("makeClock runs on from SRE_NOW at the real pace", () => {
  let fake = 1000;
  const clock = makeClock({ SRE_NOW: "2026-11-13T00:00:00.000Z" }, () => fake);
  assert.equal(clock().toISOString(), "2026-11-13T00:00:00.000Z");
  fake += 1500;
  assert.equal(clock().toISOString(), "2026-11-13T00:00:01.500Z");
  const real = makeClock({});
  assert.ok(Math.abs(real().getTime() - Date.now()) < 1000);
});

test("--list and --help exit 0 and send nothing", async () => {
  for (const flag of ["--list", "--help"]) {
    const printed = quiet();
    const code = await main([flag], { ...printed, env: {} });
    assert.equal(code, 0);
    assert.ok(printed.lines.join("\n").length > 0);
  }
  const printed = quiet();
  await main(["--help"], { ...printed, env: {} });
  assert.match(printed.lines.join("\n"), /There is no option that allows production/);
});

test("markdownSummary says 'no data' rather than inventing a number", () => {
  const text = markdownSummary({
    passed: false,
    note: "Measured on this machine; not a production measurement.",
    target: { origin: "http://127.0.0.1:8080", kind: "local" },
    scenarios: [{
      id: "x", requests: 2, failed: 2, errors: { connection: 2 }, throughput_rps: 0, passed: false,
      latency_ms: { p50: null, p90: null, p95: null, p99: null, max: null },
      thresholds: [{ name: "p95_ms", limit: 100, actual: null, ok: false }],
    }],
  });
  assert.match(text, /\| x \| 2 \| 2 \(connection: 2\) \| 0 \| no data \| no data/);
  assert.match(text, /p95_ms is no data, the limit is 100/);
});

test("a local port that answers as a production revision is refused before any load", async () => {
  // As if `gcloud run services proxy` or `ssh -L` forwarded 127.0.0.1:8080 to production.
  for (const body of ['{"revision":"diamondecho-api-00028-zin"}', '{"service":"DiamondEcho API","revision":"diamondecho-api-00028-zin","commit":"59f8d46"}']) {
    const { code, calls, result, lines } = await runMain(["--scenario", "read-routes", "--duration", "1", "--warmup", "0"], {
      respond: () => ({ status: 200, body, ms: 5 }),
    });
    assert.equal(code, 2, body);
    assert.equal(calls.length, 1, body); // the identity request only
    assert.equal(calls[0].url, "http://127.0.0.1:8080/api/");
    assert.equal(result, null);
    assert.ok(lines.some((line) => /deployed revision "diamondecho-api-00028-zin"/.test(line)), body);
  }
});

test("a local port that leads to staging needs the flag and is held to staging ceilings", async () => {
  const staging = () => ({ status: 200, body: '{"service":"DiamondEcho API","revision":"diamondecho-api-staging-00003-gdl"}', ms: 5 });
  const without = await runMain(["--scenario", "read-routes"], { respond: staging });
  assert.equal(without.code, 2);
  assert.equal(without.calls.length, 1);
  // With the flag, read-routes (a closed loop with no pause) breaks the staging ceilings.
  const flagged = await runMain(["--scenario", "read-routes", "--i-have-approval-for-staging"], { respond: staging });
  assert.equal(flagged.code, 2);
  assert.equal(flagged.calls.length, 1);
  assert.ok(flagged.lines.some((line) => /think time/.test(line)));
});

test("a target that does not answer its identity is refused", async () => {
  for (const respond of [
    () => ({ throws: new TypeError("fetch failed") }),
    () => ({ status: 404, body: "", ms: 1 }),
    () => ({ status: 200, body: "<html>", ms: 1 }),
    () => ({ status: 200, body: '{"service":"Something else"}', ms: 1 }),
  ]) {
    const { code, calls, result } = await runMain(["--scenario", "read-routes"], { respond });
    assert.equal(code, 2);
    assert.equal(calls.length, 1);
    assert.equal(result, null);
  }
});

test("a run that measured nothing does not pass", async () => {
  const { code, result } = await runMain(["--scenario", "read-routes", "--max-requests", "0"], { respond: okRoutes(5) });
  assert.equal(code, 1);
  assert.equal(result.scenarios[0].requests, 0);
  assert.ok(result.scenarios[0].thresholds.some((item) => item.name === "min_requests" && !item.ok));
});
