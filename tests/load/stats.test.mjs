import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport, evaluateThresholds, percentile, summarize } from "./stats.mjs";

const oneToHundred = Array.from({ length: 100 }, (_, index) => index + 1);

test("nearest-rank percentiles are values that were measured", () => {
  assert.equal(percentile(oneToHundred, 50), 50);
  assert.equal(percentile(oneToHundred, 90), 90);
  assert.equal(percentile(oneToHundred, 95), 95);
  assert.equal(percentile(oneToHundred, 99), 99);
  assert.equal(percentile(oneToHundred, 100), 100);
  assert.equal(percentile(oneToHundred, 0), 1);
  // Never an average of two neighbours.
  assert.equal(percentile([10, 20], 50), 10);
  assert.equal(percentile([10, 20, 30, 40], 50), 20);
});

test("with few samples a high percentile leans to the slowest value", () => {
  assert.equal(percentile([5], 99), 5);
  assert.equal(percentile([1, 2, 3], 95), 3);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 1000], 95), 1000);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 1000], 90), 9);
});

test("percentile rejects nonsense", () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile(null, 50), null);
  assert.throws(() => percentile([1], 101), RangeError);
  assert.throws(() => percentile([1], -1), RangeError);
});

test("summarize sorts, rounds to a tenth and ignores non-numbers", () => {
  const summary = summarize([3.14159, 1, NaN, 2, Infinity, 100.06]);
  assert.deepEqual(summary, { count: 4, min: 1, mean: 26.6, p50: 2, p90: 100.1, p95: 100.1, p99: 100.1, max: 100.1 });
  assert.deepEqual(summarize([]), { count: 0, min: null, mean: null, p50: null, p90: null, p95: null, p99: null, max: null });
});

test("summarize on a known spread", () => {
  const values = [...oneToHundred].reverse();
  const summary = summarize(values);
  assert.equal(summary.count, 100);
  assert.equal(summary.mean, 50.5);
  assert.equal(summary.p50, 50);
  assert.equal(summary.p99, 99);
  assert.equal(summary.max, 100);
});

const sample = (step, stage, ok, kind, ms) => ({ step, stage, ok, kind, ms, bytes: 10 });

test("a report counts errors by kind and keeps failures out of latency", () => {
  const samples = [
    sample("a", "steady", true, "ok", 10),
    sample("a", "steady", true, "ok", 20),
    sample("b", "spike", false, "http_429", 1),
    sample("b", "spike", false, "timeout", 5000),
    sample("b", "spike", false, "http_429", 2),
    sample("a", "spike", true, "ok", 30),
  ];
  const report = buildReport(samples, 2);
  assert.equal(report.requests, 6);
  assert.equal(report.ok, 3);
  assert.equal(report.failed, 3);
  assert.equal(report.error_rate, 0.5);
  assert.deepEqual(report.errors, { http_429: 2, timeout: 1 });
  // A fast refusal or a slow timeout never enters the latency figures.
  assert.equal(report.latency_ms.count, 3);
  assert.equal(report.latency_ms.max, 30);
  assert.equal(report.latency_ms.min, 10);
  // Throughput counts successful answers only.
  assert.equal(report.throughput_rps, 1.5);
  assert.equal(report.measured_seconds, 2);
  assert.deepEqual(Object.keys(report.by_step).sort(), ["a", "b"]);
  assert.equal(report.by_step.b.failed, 3);
  assert.equal(report.by_step.b.latency_ms.p50, null);
  assert.equal(report.by_stage.spike.requests, 4);
  assert.equal(report.by_stage.steady.error_rate, 0);
});

test("samples without a stage are not grouped by stage", () => {
  const report = buildReport([sample("a", null, true, "ok", 1)], 1);
  assert.deepEqual(report.by_stage, {});
  assert.equal(report.by_step.a.requests, 1);
});

test("an empty or zero-length run reports zeros, not NaN", () => {
  const report = buildReport([], 0);
  assert.equal(report.requests, 0);
  assert.equal(report.error_rate, 0);
  assert.equal(report.throughput_rps, 0);
  assert.equal(report.latency_ms.p95, null);
  assert.equal(buildReport([sample("a", null, true, "ok", 1)], -3).throughput_rps, 0);
});

test("thresholds: upper limits, lower limits and missing figures", () => {
  const report = buildReport([sample("a", null, true, "ok", 10), sample("a", null, true, "ok", 200)], 1);
  const results = evaluateThresholds(report, { error_rate: 0, p50_ms: 50, p95_ms: 100, max_ms: 500, min_throughput_rps: 2, min_requests: 3 });
  const byName = Object.fromEntries(results.map((item) => [item.name, item]));
  assert.equal(byName.error_rate.ok, true);
  assert.equal(byName.p50_ms.ok, true);
  assert.equal(byName.p95_ms.ok, false);
  assert.equal(byName.p95_ms.actual, 200);
  assert.equal(byName.max_ms.ok, true);
  assert.equal(byName.min_throughput_rps.ok, true); // 2 >= 2
  assert.equal(byName.min_requests.ok, false);

  // No successful request: a latency limit cannot be met.
  const none = buildReport([sample("a", null, false, "connection", 1)], 1);
  const [p95] = evaluateThresholds(none, { p95_ms: 100 });
  assert.deepEqual(p95, { name: "p95_ms", limit: 100, actual: null, ok: false });

  assert.deepEqual(evaluateThresholds(report, {}), []);
  assert.throws(() => evaluateThresholds(report, { p42_ms: 1 }), /Unknown threshold/);
});
