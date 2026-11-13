// The load generator's safety rules, in code.
//
// A load generator is the one SRE tool that can hurt the site by working as
// designed. So the rules below are not options:
//
// 1. Production is refused. Always. There is no flag, environment variable or
//    scenario setting that changes this.
// 2. The default target is this machine (localhost).
// 3. Staging is accepted only at an address listed here, only over HTTPS, only
//    with STAGING_FLAG typed on the command line, and only under STAGING_CAPS.
// 4. Every other address is refused: an address this file does not know could
//    be anybody's service.
// 5. Only the routes in ALLOWED_ROUTES are ever requested. The inquiry route
//    and the paid property routes are refused by name before that list is
//    even read.
// 6. Redirects are never followed (see runner.mjs), so a server cannot send
//    the generator on to another host.
//
// Changing any constant in this file is a code change that goes through a
// pull request Gbenga reviews. That is the only way to widen what may be hit.
import { TARGETS } from "../../scripts/sre/targets.mjs";

export class SafetyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SafetyError";
    this.code = code;
  }
}

// Production, spelled out here as well as read from targets.mjs, so a change
// to that file can add a forbidden host but can never remove one.
export const PRODUCTION_DOMAIN = "diamondecho.com";
export const PRODUCTION_API_HOST = "diamondecho-api-180189726732.us-east1.run.app";
// Every Cloud Run address of the production project carries its project
// number, including tagged ones such as candidate---diamondecho-api-….
export const PRODUCTION_PROJECT_NUMBER = "180189726732";
// The production Cloudflare Pages projects' own addresses still load.
export const PRODUCTION_PAGES_HOSTS = ["diamondecho.pages.dev", "diamondecho-staff.pages.dev"];

// The staging API (docs/de33-staging-setup.md). Cloud Run gives the one
// service two addresses; both are listed. Nothing else counts as staging.
export const STAGING_HOSTS = [
  "diamondecho-api-staging-299705773978.us-east1.run.app",
  "diamondecho-api-staging-2ku27sqe6q-ue.a.run.app",
];
export const STAGING_FLAG = "--i-have-approval-for-staging";

// Hard ceilings for a staging run. Staging has the same shape as production
// (one request per instance, three instances) and costs real money per
// second of use, so a run is short and gentle. Six visitors at once is
// already twice what three instances serve side by side.
export const STAGING_CAPS = Object.freeze({
  ratePerSecond: 5,
  concurrency: 6,
  totalSeconds: 120, // warm-up included
  requests: 600,
});

// Ceilings for a local run. These only stop a typing mistake from tying up
// the machine or a CI runner for an hour.
export const LOCAL_CAPS = Object.freeze({
  ratePerSecond: 500,
  concurrency: 64,
  totalSeconds: 600,
  requests: 200000,
});

// Refused by name, whatever the method, so the message is exact.
// - /api/v1/inquiries: every well-formed attempt is counted against real
//   visitors' allowance, and an accepted one lands in the staff queue.
// - /api/v1/properties: each call spends paid RentCast or Mapbox quota.
// - staff routes and /api/status: sign-in only; nothing to measure.
export const NEVER_PATHS = [
  { prefix: "/api/v1/inquiries", why: "the inquiry route is never load-tested: attempts count against visitors and reach the staff queue" },
  { prefix: "/api/v1/properties", why: "the property routes spend paid RentCast and Mapbox quota" },
  // When its saved copy is stale, the brief reads FRED and Freddie Mac and has
  // Google's text-to-speech (paid per character) read the script aloud.
  { prefix: "/api/v1/market-brief", why: "the market brief calls outside data sources and paid text-to-speech" },
  { prefix: "/api/v1/podcast/staff", why: "staff routes are never load-tested" },
  { prefix: "/api/status", why: "staff routes are never load-tested" },
];

// The only requests the generator can make. `localOnly` routes run against
// this machine and nowhere else: the three heavy calculation routes can each
// hold an instance for seconds and are limited to 10 per 10 minutes per
// sender, so they are timed a few at a time, never under load.
export const ALLOWED_ROUTES = Object.freeze([
  { method: "GET", path: "/health" },
  { method: "GET", path: "/api/" },
  { method: "GET", path: "/api/assistant/health" },
  { method: "GET", path: "/api/v1/deals/assumption-profiles" },
  { method: "POST", path: "/api/v1/deals/analyze" },
  { method: "POST", path: "/api/assistant/chat" },
  { method: "POST", path: "/api/v1/deals/scenarios", localOnly: true, heavy: true },
  { method: "POST", path: "/api/v1/deals/sensitivity", localOnly: true, heavy: true },
  { method: "POST", path: "/api/v1/deals/monte-carlo", localOnly: true, heavy: true },
]);

// The heavy routes' own limiter refuses the 11th call in 10 minutes from one
// address, so more than this in one scenario would only measure refusals.
export const HEAVY_REQUESTS_PER_SCENARIO = 9;

const stripDots = (host) => host.replace(/\.+$/, "");

function hostOf(origin) {
  try {
    return stripDots(new URL(origin).hostname.toLowerCase());
  } catch {
    return null;
  }
}

// Hosts named in scripts/sre/targets.mjs: ours and the Georgia MLS search,
// which is a third party and is not ours to load at all.
const TARGET_FILE_HOSTS = Object.values(TARGETS.production)
  .map((value) => (String(value).includes("://") ? hostOf(value) : stripDots(String(value).toLowerCase())))
  .filter(Boolean);

/** Why this host is production (or a production dependency), or null. */
export function productionReason(hostname) {
  const host = stripDots(String(hostname).toLowerCase());
  if (host === PRODUCTION_DOMAIN || host.endsWith(`.${PRODUCTION_DOMAIN}`)) {
    return `${host} is the live site (${PRODUCTION_DOMAIN} or a subdomain of it)`;
  }
  if (host === PRODUCTION_API_HOST) return `${host} is the production API`;
  if (host.includes(PRODUCTION_PROJECT_NUMBER)) {
    return `${host} carries the production project number ${PRODUCTION_PROJECT_NUMBER}`;
  }
  for (const pages of PRODUCTION_PAGES_HOSTS) {
    if (host === pages || host.endsWith(`.${pages}`)) return `${host} is a production Cloudflare Pages address`;
  }
  for (const listed of TARGET_FILE_HOSTS) {
    if (host === listed || host.endsWith(`.${listed}`)) return `${host} is listed as a production address in scripts/sre/targets.mjs`;
  }
  // Cloud Run's second address form: diamondecho-api-<letters>-ue.a.run.app.
  // The staging service's name starts diamondecho-api-staging-; anything else
  // named diamondecho-api on run.app is treated as production.
  if (host.endsWith(".run.app")) {
    const service = host.split(".")[0].split("---").pop();
    if (service.startsWith("diamondecho-api") && !service.startsWith("diamondecho-api-staging-")) {
      return `${host} looks like the production Cloud Run service`;
    }
  }
  return null;
}

const isLoopback = (host) => host === "localhost" || host === "[::1]" || /^127(\.\d{1,3}){3}$/.test(host);

/**
 * Decide whether a target may be used. Returns { kind: "local" | "staging",
 * origin, host } or throws SafetyError. `stagingApproved` is true only when
 * STAGING_FLAG was typed on the command line.
 */
export function checkTarget(raw, { stagingApproved = false } = {}) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    throw new SafetyError("bad-target", `Refused: "${raw}" is not a web address.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafetyError("bad-target", `Refused: ${url.protocol} is not http or https.`);
  }
  // "https://localhost@diamondecho.com/" reads as local and is not.
  if (url.username || url.password) {
    throw new SafetyError("bad-target", "Refused: a target must not carry a user name or password.");
  }
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new SafetyError("bad-target", "Refused: give the target as an origin only, for example http://127.0.0.1:8080.");
  }
  const host = stripDots(url.hostname.toLowerCase());

  // Production first, before anything could accept the address.
  const production = productionReason(host);
  if (production) {
    throw new SafetyError(
      "production",
      `Refused: ${production}. Production is never load-tested and no flag changes that.`,
    );
  }
  if (isLoopback(host)) return { kind: "local", origin: url.origin, host };

  if (STAGING_HOSTS.includes(host)) {
    if (url.protocol !== "https:") {
      throw new SafetyError("staging-http", "Refused: staging is reached over https only.");
    }
    if (!stagingApproved) {
      throw new SafetyError(
        "staging-needs-approval",
        `Refused: ${host} is staging. A staging run needs Gbenga's yes and the flag ${STAGING_FLAG}.`,
      );
    }
    return { kind: "staging", origin: url.origin, host };
  }
  throw new SafetyError(
    "unknown-target",
    `Refused: ${host} is neither this machine nor a staging address listed in tests/load/safety.mjs.`,
  );
}

/** Throws unless this exact method and path may be requested on this kind of target. */
export function checkRoute(method, path, kind) {
  const verb = String(method).toUpperCase();
  const text = String(path);
  // Resolve the path the way fetch will, so "/api/v1/../v1/inquiries" or
  // "//host/x" cannot slip past a plain string comparison.
  let resolved;
  let lowered;
  try {
    resolved = new URL(text, "http://loadgen.invalid");
    lowered = decodeURIComponent(resolved.pathname).toLowerCase();
  } catch {
    // A broken %-escape cannot be compared with the lists, so it is refused.
    throw new SafetyError("forbidden-route", `Refused: "${text}" is not a plain path from the allowed list.`);
  }
  const pathname = resolved.pathname;
  for (const never of NEVER_PATHS) {
    if (lowered === never.prefix || lowered.startsWith(`${never.prefix}/`) || lowered.startsWith(`${never.prefix}?`)) {
      throw new SafetyError("forbidden-route", `Refused: ${verb} ${pathname}: ${never.why}.`);
    }
  }
  if (resolved.host !== "loadgen.invalid" || pathname !== text || resolved.search || resolved.hash) {
    throw new SafetyError("forbidden-route", `Refused: "${text}" is not a plain path from the allowed list.`);
  }
  const route = ALLOWED_ROUTES.find((item) => item.method === verb && item.path === pathname);
  if (!route) {
    throw new SafetyError("forbidden-route", `Refused: ${verb} ${pathname} is not in the load generator's allowed routes.`);
  }
  if (route.localOnly && kind !== "local") {
    throw new SafetyError("forbidden-route", `Refused: ${verb} ${pathname} is timed on this machine only, never on ${kind}.`);
  }
  return route;
}

/**
 * The largest request rate a scenario can produce, per second. Open loop: the
 * highest arrival rate it asks for. Closed loop: each visitor waits at least
 * its think time between requests, so even an instant server sees no more
 * than concurrency x 1000 / thinkTimeMs a second; with no think time the rate
 * has no bound (Infinity) and is as fast as the server answers.
 */
export function peakRate(scenario) {
  if (scenario.mode === "closed") {
    return scenario.thinkTimeMs > 0 ? (scenario.concurrency * 1000) / scenario.thinkTimeMs : Infinity;
  }
  const rates = [scenario.ratePerSecond ?? 0, ...(scenario.stages ?? []).map((stage) => stage.ratePerSecond ?? 0)];
  return Math.max(...rates);
}

/** Warm-up plus measured time, in seconds. */
export function totalSeconds(scenario) {
  const measured = scenario.stages?.length
    ? scenario.stages.reduce((sum, stage) => sum + stage.seconds, 0)
    : scenario.durationSeconds ?? 0;
  return (scenario.warmupSeconds ?? 0) + measured;
}

/** The most requests a scenario can send, from its own settings. */
export function requestCeiling(scenario) {
  if (scenario.maxRequests) return scenario.maxRequests;
  if (scenario.mode === "open") {
    const stages = scenario.stages?.length
      ? scenario.stages
      : [{ seconds: scenario.durationSeconds ?? 0, ratePerSecond: scenario.ratePerSecond ?? 0 }];
    const measured = stages.reduce((sum, stage) => sum + stage.seconds * stage.ratePerSecond, 0);
    const warm = (scenario.warmupSeconds ?? 0) * (stages[0]?.ratePerSecond ?? 0);
    return Math.ceil(measured + warm);
  }
  if (scenario.thinkTimeMs > 0) {
    // Each visitor sends at most one request per think time, plus the one it
    // may already have sent when the clock runs out.
    return Math.ceil(peakRate(scenario) * totalSeconds(scenario)) + scenario.concurrency;
  }
  return null; // closed loop with no pause and no count: bounded only by time
}

/**
 * Check a whole scenario against the target's ceilings and the route rules.
 * Returns the list of problems; an empty list means it may run.
 */
export function scenarioProblems(scenario, kind) {
  const caps = kind === "staging" ? STAGING_CAPS : LOCAL_CAPS;
  const where = kind === "staging" ? "a staging run" : "a local run";
  const problems = [];
  const number = (value) => Number.isFinite(value) && value >= 0;

  if (scenario.mode !== "open" && scenario.mode !== "closed") problems.push(`mode must be "open" or "closed"`);
  if (!Array.isArray(scenario.steps) || scenario.steps.length === 0) problems.push("a scenario needs at least one step");
  if (!Number.isInteger(scenario.concurrency) || scenario.concurrency < 1) problems.push("concurrency must be a whole number, 1 or more");
  if (scenario.maxRequests !== undefined && scenario.maxRequests !== null && !Number.isInteger(scenario.maxRequests)) {
    problems.push("maxRequests must be a whole number");
  }
  if (!number(scenario.timeoutMs) || scenario.timeoutMs < 1) problems.push("timeoutMs must be 1 or more");
  if (scenario.mode === "open" && !(peakRate(scenario) > 0)) problems.push("an open-loop scenario needs an arrival rate");
  if (!(totalSeconds(scenario) > 0)) problems.push("a scenario needs a duration");
  if (problems.length) return problems;

  if (scenario.concurrency > caps.concurrency) {
    problems.push(`concurrency ${scenario.concurrency} is over the ceiling of ${caps.concurrency} for ${where}`);
  }
  // A local closed loop may run as fast as the machine answers: that is how
  // throughput is measured. On staging every scenario's rate must be bounded
  // before it starts, closed loops included (through their think time).
  const rate = peakRate(scenario);
  if (scenario.mode === "closed" && kind === "staging" && rate > caps.ratePerSecond) {
    problems.push(
      rate === Infinity
        ? `a closed-loop staging run needs a think time, so its rate is bounded (at most ${caps.ratePerSecond} per second)`
        : `${scenario.concurrency} visitors with a ${scenario.thinkTimeMs} ms pause can send ${Math.round(rate * 10) / 10} requests per second, over the ceiling of ${caps.ratePerSecond} for ${where}`,
    );
  } else if (scenario.mode === "open" && rate > caps.ratePerSecond) {
    problems.push(`arrival rate ${rate} per second is over the ceiling of ${caps.ratePerSecond} for ${where}`);
  }
  if (totalSeconds(scenario) > caps.totalSeconds) {
    problems.push(`${totalSeconds(scenario)} seconds (warm-up included) is over the ceiling of ${caps.totalSeconds} for ${where}`);
  }
  const ceiling = requestCeiling(scenario);
  if (ceiling !== null && ceiling > caps.requests) {
    problems.push(`${ceiling} requests is over the ceiling of ${caps.requests} for ${where}`);
  }

  let heavy = false;
  for (const step of scenario.steps ?? []) {
    try {
      const route = checkRoute(step.method, step.path, kind);
      if (route.heavy) heavy = true;
    } catch (error) {
      if (!(error instanceof SafetyError)) throw error;
      problems.push(error.message);
    }
  }
  if (heavy && !(scenario.maxRequests > 0 && scenario.maxRequests <= HEAVY_REQUESTS_PER_SCENARIO)) {
    problems.push(`a scenario with a heavy calculation route must set maxRequests to ${HEAVY_REQUESTS_PER_SCENARIO} or fewer`);
  }
  if (heavy && scenario.concurrency !== 1) {
    problems.push("a scenario with a heavy calculation route runs one request at a time");
  }
  return problems;
}
