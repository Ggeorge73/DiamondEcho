// Latency statistics for the load generator. Plain functions, no state.
//
// Percentiles use the nearest-rank rule: p95 is the smallest measured value
// that at least 95 percent of the measurements are at or below. It is always
// a value that was really measured (never an average of two), and with few
// samples it leans high, which is the safe side for a latency report.

const round1 = (value) => Math.round(value * 10) / 10;

/** Nearest-rank percentile of an ascending list. `p` is 0 to 100. */
export function percentile(sorted, p) {
  if (!Array.isArray(sorted) || sorted.length === 0) return null;
  if (!(p >= 0 && p <= 100)) throw new RangeError(`percentile must be 0 to 100, got ${p}`);
  if (p === 0) return sorted[0];
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/** Count, min, mean, p50, p90, p95, p99 and max of a list of milliseconds. */
export function summarize(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return { count: 0, min: null, mean: null, p50: null, p90: null, p95: null, p99: null, max: null };
  }
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    min: round1(sorted[0]),
    mean: round1(sum / sorted.length),
    p50: round1(percentile(sorted, 50)),
    p90: round1(percentile(sorted, 90)),
    p95: round1(percentile(sorted, 95)),
    p99: round1(percentile(sorted, 99)),
    max: round1(sorted[sorted.length - 1]),
  };
}

/**
 * Turn the raw samples of one scenario into its report.
 * A sample is { step, stage, ok, kind, ms, bytes }: `kind` is "ok" or the
 * error kind ("timeout", "connection", "http_429", "body", "shed", …).
 * Latency figures cover successful requests only; failures are counted by
 * kind beside them, so a fast refusal never flatters the latency.
 */
export function buildReport(samples, measuredSeconds) {
  const tally = (list) => {
    const errors = {};
    const good = [];
    for (const sample of list) {
      if (sample.ok) good.push(sample.ms);
      else errors[sample.kind] = (errors[sample.kind] ?? 0) + 1;
    }
    const failed = list.length - good.length;
    return {
      requests: list.length,
      ok: good.length,
      failed,
      error_rate: list.length ? Math.round((failed / list.length) * 10000) / 10000 : 0,
      errors,
      latency_ms: summarize(good),
    };
  };
  const group = (key) => {
    const groups = new Map();
    for (const sample of samples) {
      const name = sample[key];
      if (name === undefined || name === null) continue;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(sample);
    }
    return Object.fromEntries([...groups].map(([name, list]) => [name, tally(list)]));
  };
  const overall = tally(samples);
  const seconds = measuredSeconds > 0 ? measuredSeconds : 0;
  return {
    ...overall,
    measured_seconds: Math.round(seconds * 100) / 100,
    // Successful answers per second: refusals and timeouts are not throughput.
    throughput_rps: seconds ? Math.round((overall.ok / seconds) * 100) / 100 : 0,
    by_step: group("step"),
    by_stage: group("stage"),
  };
}

/**
 * Compare a report with stated thresholds. Supported names: error_rate,
 * p50_ms, p90_ms, p95_ms, p99_ms, max_ms (upper limits) and
 * min_throughput_rps, min_requests (lower limits). A threshold whose figure
 * is missing (no successful request at all) counts as missed.
 */
export function evaluateThresholds(report, thresholds = {}) {
  const actuals = {
    error_rate: report.error_rate,
    p50_ms: report.latency_ms.p50,
    p90_ms: report.latency_ms.p90,
    p95_ms: report.latency_ms.p95,
    p99_ms: report.latency_ms.p99,
    max_ms: report.latency_ms.max,
    min_throughput_rps: report.throughput_rps,
    min_requests: report.requests,
  };
  return Object.entries(thresholds).map(([name, limit]) => {
    if (!(name in actuals)) throw new Error(`Unknown threshold "${name}"`);
    const actual = actuals[name];
    const lower = name.startsWith("min_");
    const ok = actual !== null && actual !== undefined && (lower ? actual >= limit : actual <= limit);
    return { name, limit, actual: actual ?? null, ok };
  });
}
