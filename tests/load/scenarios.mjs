// The load scenarios, as data. The generator (loadgen.mjs) runs them; the
// safety rules (safety.mjs) decide whether each may run on a given target.
//
// The request bodies are the reference requests the backend's own tests use
// (backend/tests/deal_intelligence/), copied into payloads/ so a load run
// exercises the same calculations the unit tests check. They describe
// illustrative deals, not listed properties.
//
// A scenario:
//   id, description
//   mode          "closed" (N pretend visitors, each waits for its answer) or
//                 "open" (requests arrive at a set rate regardless)
//   concurrency   closed: visitors at once. open: the most requests allowed
//                 to be waiting at once; further arrivals are counted "shed"
//   ratePerSecond open loop only (or per stage in `stages`)
//   durationSeconds, warmupSeconds   warm-up requests are sent, not counted
//   stages        optional [{ name, seconds, ratePerSecond }] instead of one
//                 duration, for a spike; results are also reported per stage
//   timeoutMs     per request
//   thinkTimeMs   closed loop: pause after each answer
//   order         "session": every visitor starts at the first step
//   maxRequests   stop after this many
//   steps         [{ name, method, path, body, expectStatus, bodyIncludes }]
//   thresholds    { local: {...}, staging: {...} }: see stats.mjs for names
import { readFileSync } from "node:fs";

const payload = (name) => JSON.parse(readFileSync(new URL(`./payloads/${name}.json`, import.meta.url), "utf8"));

const rental = payload("analyze-rental");
const flip = payload("analyze-flip");
const land = payload("analyze-land");
const officeDeal = payload("office-rental-deal");
const monteCarloDeal = payload("monte-carlo-deal");

const ANALYZE = "/api/v1/deals/analyze";
const analyzeStep = (name, body) => ({ name, method: "POST", path: ANALYZE, body, bodyIncludes: '"formula_version"' });

const analyzeRental = analyzeStep("analyze rental", rental);
const analyzeFlip = analyzeStep("analyze flip", flip);
const analyzeLand = analyzeStep("analyze land", land);

// Questions a visitor might type. The assistant answers from its own written
// sources on the server; it calls no outside service. Nothing personal here.
const chatStep = (name, message) => ({
  name,
  method: "POST",
  path: "/api/assistant/chat",
  body: { message, jurisdiction: { country: "US", state: "GA" } },
  bodyIncludes: '"answer"',
});
const chatEarnest = chatStep("chat earnest money", "What is earnest money in Georgia?");
const chatClosing = chatStep("chat closing costs", "What closing costs should a buyer expect?");

const health = { name: "health", method: "GET", path: "/health", bodyIncludes: '"ok"' };
const apiRoot = { name: "api root", method: "GET", path: "/api/" };
const assistantHealth = { name: "assistant health", method: "GET", path: "/api/assistant/health" };
const profiles = { name: "assumption profiles", method: "GET", path: "/api/v1/deals/assumption-profiles", bodyIncludes: '"profiles"' };

const monteCarloCase = (name, iterations, seed) => ({
  name,
  iterations,
  seed,
  drivers: {
    rent_change: { minimum: -0.1, mode: 0, maximum: 0.08 },
    vacancy_rate: { minimum: 0.03, mode: 0.06, maximum: 0.14 },
    exit_cap_rate: { minimum: 0.06, mode: 0.0675, maximum: 0.08 },
  },
});

// One visitor's walk through the API, in the order the site makes the calls:
// a question to the assistant, a few Deal Studio calculations as they change
// their figures, another question, one more calculation. The address lookup
// a real visitor might also do is left out on purpose: it is paid.
const visitorSteps = [chatEarnest, analyzeRental, analyzeRental, analyzeFlip, chatClosing, analyzeLand];

// Local thresholds are set from the measurements in docs/sre/capacity.md
// (taken on 2026-11-13) with wide headroom, because a shared CI runner is
// slower and noisier than a quiet machine. They are there to catch a change
// that makes a route several times slower or starts failing it, not to
// police milliseconds. Staging has no measured baseline yet, so staging
// thresholds check only that requests succeed.
export const SCENARIOS = [
  {
    id: "analyze",
    description: "Everyday analysis, one request at a time: what one Cloud Run instance does.",
    mode: "closed",
    concurrency: 1,
    durationSeconds: 15,
    warmupSeconds: 3,
    timeoutMs: 10000,
    steps: [analyzeRental, analyzeFlip, analyzeLand],
    thresholds: { local: { min_requests: 1, error_rate: 0, p95_ms: 100, p99_ms: 250, min_throughput_rps: 20 } },
  },
  {
    id: "analyze-crowd",
    description: "Eight visitors pressing Analyze at once against one worker: shows the queue behind a single process.",
    mode: "closed",
    concurrency: 8,
    durationSeconds: 15,
    warmupSeconds: 3,
    timeoutMs: 10000,
    steps: [analyzeRental, analyzeFlip, analyzeLand],
    thresholds: { local: { min_requests: 1, error_rate: 0, p95_ms: 500, p99_ms: 1000, min_throughput_rps: 20 } },
  },
  {
    id: "read-routes",
    description: "The light GET routes: health, service name, assistant health, starter assumptions.",
    mode: "closed",
    concurrency: 2,
    durationSeconds: 10,
    warmupSeconds: 2,
    timeoutMs: 5000,
    steps: [health, apiRoot, assistantHealth, profiles],
    thresholds: { local: { min_requests: 1, error_rate: 0, p95_ms: 100, p99_ms: 250, min_throughput_rps: 50 } },
  },
  {
    id: "visitor-session",
    description: "Six visitors each walking through a session (assistant question, Deal Studio runs) with a short pause between steps.",
    mode: "closed",
    order: "session",
    concurrency: 6,
    thinkTimeMs: 250,
    durationSeconds: 20,
    warmupSeconds: 3,
    timeoutMs: 10000,
    steps: visitorSteps,
    thresholds: { local: { min_requests: 1, error_rate: 0, p95_ms: 250, p99_ms: 500 } },
  },
  {
    id: "spike",
    description: "A burst: 5 requests a second, then 50 a second for 8 seconds, then 5 again. Reported per stage.",
    mode: "open",
    // The most requests left waiting at once before new arrivals are counted
    // "shed". Kept under the local ceiling in safety.mjs.
    concurrency: 64,
    warmupSeconds: 2,
    stages: [
      { name: "steady", seconds: 8, ratePerSecond: 5 },
      { name: "spike", seconds: 8, ratePerSecond: 50 },
      { name: "recovery", seconds: 8, ratePerSecond: 5 },
    ],
    timeoutMs: 10000,
    steps: [analyzeRental, chatEarnest, analyzeFlip, profiles, analyzeLand],
    thresholds: { local: { min_requests: 1, error_rate: 0, p95_ms: 500, p99_ms: 1000 } },
  },
  {
    id: "heavy-local",
    description: "The three heavy calculation routes, once each, one at a time, on this machine only: how long each holds the worker.",
    mode: "closed",
    concurrency: 1,
    durationSeconds: 120,
    warmupSeconds: 0,
    maxRequests: 6,
    timeoutMs: 30000,
    steps: [
      { name: "scenarios (3 cases)", method: "POST", path: "/api/v1/deals/scenarios", body: { deal: officeDeal }, bodyIncludes: '"scenarios"' },
      {
        name: "sensitivity (3 cells)",
        method: "POST",
        path: "/api/v1/deals/sensitivity",
        body: { deal: officeDeal, metric: "cash_on_cash", x_axis: { field: "vacancy_rate", changes: [0, 0.05, 0.1] } },
        bodyIncludes: '"cells"',
      },
      {
        name: "sensitivity (9 cells)",
        method: "POST",
        path: "/api/v1/deals/sensitivity",
        body: {
          deal: officeDeal,
          metric: "irr",
          x_axis: { field: "rent", changes: [-0.05, 0, 0.05] },
          y_axis: { field: "exit_cap_rate", changes: [-0.005, 0, 0.005] },
        },
        bodyIncludes: '"cells"',
      },
      {
        name: "monte-carlo (300 iterations)",
        method: "POST",
        path: "/api/v1/deals/monte-carlo",
        body: { deal: monteCarloDeal, scenarios: [monteCarloCase("Investment committee case", 300, 73)] },
        bodyIncludes: '"iterations_completed"',
      },
      {
        name: "monte-carlo (3 x 1,000 iterations)",
        method: "POST",
        path: "/api/v1/deals/monte-carlo",
        body: {
          deal: monteCarloDeal,
          scenarios: [monteCarloCase("Base case", 1000, 1), monteCarloCase("Downside case", 1000, 2), monteCarloCase("Severe stress", 1000, 3)],
        },
        bodyIncludes: '"iterations_completed"',
      },
      {
        name: "monte-carlo (3 x 5,000 iterations)",
        method: "POST",
        path: "/api/v1/deals/monte-carlo",
        body: {
          deal: monteCarloDeal,
          scenarios: [monteCarloCase("Base case", 5000, 1), monteCarloCase("Downside case", 5000, 2), monteCarloCase("Severe stress", 5000, 3)],
        },
        bodyIncludes: '"iterations_completed"',
      },
    ],
    // No latency threshold: the largest run is designed to take the
    // service's own 20-second time budget. It must still answer.
    thresholds: { local: { min_requests: 1, error_rate: 0 } },
  },
  {
    id: "staging-gentle",
    description: "For an approved staging run: three visitors (one per instance) walking the session with a one-second pause, for one minute.",
    mode: "closed",
    order: "session",
    concurrency: 3,
    thinkTimeMs: 1000,
    durationSeconds: 60,
    warmupSeconds: 0,
    maxRequests: 180,
    // Longer than Cloud Run's 30-second request timeout, so a queued request
    // is reported as the 429, 503 or 504 Google answers, not as our timeout.
    timeoutMs: 35000,
    steps: visitorSteps,
    thresholds: { staging: { min_requests: 1, error_rate: 0.02 }, local: { min_requests: 1, error_rate: 0 } },
  },
  {
    id: "staging-spike",
    description: "For an approved staging run: 1 request a second, then 5 a second for 20 seconds, then 1 again. Shows scale-out and cold starts.",
    mode: "open",
    concurrency: 6,
    warmupSeconds: 0,
    stages: [
      { name: "steady", seconds: 20, ratePerSecond: 1 },
      { name: "spike", seconds: 20, ratePerSecond: 5 },
      { name: "recovery", seconds: 20, ratePerSecond: 1 },
    ],
    timeoutMs: 35000,
    steps: [analyzeRental, chatEarnest, analyzeFlip, profiles, analyzeLand],
    thresholds: { staging: { min_requests: 1, error_rate: 0.02 }, local: { min_requests: 1, error_rate: 0 } },
  },
];

// What "node tests/load/loadgen.mjs" runs when no scenario is named.
export const STANDARD = ["analyze", "analyze-crowd", "read-routes", "visitor-session", "spike"];

export function findScenario(id) {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? null;
}
