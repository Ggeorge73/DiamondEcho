// The shared shape of a synthetic check run. Every SRE script reads or writes
// this shape, so it is defined once here: the checker produces it, the state
// store files it, the alert engine and the SLO calculator read it.
// The full contract (files, commands, owners) is scripts/sre/README.md.

export const SCHEMA_VERSION = 1;

export const SUITES = ["fast", "slow", "post-deploy"];

// What a visitor would call the part that is broken. The status page shows
// these names; an incident is opened per component, not per check.
export const COMPONENTS = {
  "public-site": "Website",
  search: "Property search",
  calculators: "Intelligence calculators",
  inquiry: "Inquiry form",
  api: "API",
  "staff-site": "Staff site",
  dns: "DNS",
  tls: "TLS certificates",
  domain: "Domain registration",
};

// sev1: visitors cannot use the site. sev2: a main feature is down or badly
// degraded. sev3: a minor feature or an early warning. sev4: notice only.
// docs/sre/severity-and-escalation.md is the full definition.
export const SEVERITIES = ["sev1", "sev2", "sev3", "sev4"];

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_DETAIL = 300;
const MAX_FACT = 100;

// One check result. `slis` names the SLIs (scripts/sre/slo.config.mjs) this
// result counts toward; a check that feeds no SLO passes []. `observed` holds
// short facts read from the live service, such as the API revision or the
// commit a page was built from; the state store uses them to notice a deploy.
export function makeCheck({ id, name, component, severity, ok, status = null, latency_ms = null, detail = "", attempts = 1, slis = [], observed = {} }) {
  const check = {
    id, name, component, severity, ok: ok === true, status,
    latency_ms: latency_ms === null ? null : Math.round(latency_ms),
    detail: String(detail).slice(0, MAX_DETAIL), attempts, slis, observed,
  };
  const problems = checkProblems(check);
  if (problems.length) throw new Error(`Invalid check ${id}: ${problems.join("; ")}`);
  return check;
}

export function makeRun({ suite, started_at, finished_at, vantage = { provider: "local", region: null }, commit = null, checks }) {
  const run = { schema: SCHEMA_VERSION, suite, started_at, finished_at, vantage, commit, checks };
  const problems = runProblems(run);
  if (problems.length) throw new Error(`Invalid run: ${problems.join("; ")}`);
  return run;
}

function checkProblems(check) {
  const problems = [];
  if (typeof check.id !== "string" || !ID.test(check.id)) problems.push("id must be kebab-case");
  if (typeof check.name !== "string" || !check.name) problems.push("name is required");
  if (!Object.hasOwn(COMPONENTS, check.component)) problems.push(`unknown component ${check.component}`);
  if (!SEVERITIES.includes(check.severity)) problems.push(`unknown severity ${check.severity}`);
  if (typeof check.ok !== "boolean") problems.push("ok must be true or false");
  if (check.status !== null && !Number.isInteger(check.status)) problems.push("status must be a whole number or null");
  if (check.latency_ms !== null && !(Number.isFinite(check.latency_ms) && check.latency_ms >= 0)) problems.push("latency_ms must be a number or null");
  if (typeof check.detail !== "string" || check.detail.length > MAX_DETAIL) problems.push("detail must be a short string");
  if (!Number.isInteger(check.attempts) || check.attempts < 1) problems.push("attempts must be 1 or more");
  if (!Array.isArray(check.slis) || check.slis.some((sli) => typeof sli !== "string")) problems.push("slis must be a list of names");
  const facts = check.observed && typeof check.observed === "object" && !Array.isArray(check.observed) ? Object.entries(check.observed) : null;
  if (!facts || facts.some(([key, value]) => !ID.test(key) || typeof value !== "string" || value.length > MAX_FACT)) problems.push("observed must map short names to short strings");
  return problems;
}

// Every problem with a run document, as plain sentences. An empty list means
// the document can be filed.
export function runProblems(run) {
  const problems = [];
  if (!run || typeof run !== "object") return ["run must be an object"];
  if (run.schema !== SCHEMA_VERSION) problems.push(`schema must be ${SCHEMA_VERSION}`);
  if (!SUITES.includes(run.suite)) problems.push(`unknown suite ${run.suite}`);
  for (const key of ["started_at", "finished_at"]) {
    if (typeof run[key] !== "string" || Number.isNaN(Date.parse(run[key]))) problems.push(`${key} must be an ISO time`);
  }
  if (!run.vantage || typeof run.vantage.provider !== "string") problems.push("vantage.provider is required");
  if (!Array.isArray(run.checks) || run.checks.length === 0) return [...problems, "checks must be a non-empty list"];
  const seen = new Set();
  for (const check of run.checks) {
    for (const problem of checkProblems(check)) problems.push(`${check?.id}: ${problem}`);
    if (seen.has(check.id)) problems.push(`duplicate check id ${check.id}`);
    seen.add(check.id);
  }
  return problems;
}
