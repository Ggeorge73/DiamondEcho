// The service level indicators (SLIs) and objectives (SLOs) for diamondecho.com,
// as data. An SLI is a measurement of what a visitor feels ("the page loaded").
// An SLO is the share of those measurements that must be good over a window.
// The error budget is what is left over: the share that is allowed to be bad.
//
// The synthetic checks tag each result with the SLI ids below (`slis` in
// lib/schema.mjs), slo-calc.mjs counts them, and docs/sre/slo.md explains the
// choices. Every target here is a PROPOSAL until Gbenga accepts it: `accepted`
// stays false until he says yes, and only he changes it. Setting it to true
// also needs `accepted_on` and `accepted_record` (see configProblems) and a
// row in the "Accepted targets" table of docs/sre/slo.md.
//
// Measured basis (2026-11-13, one vantage, through the sandbox's proxy, a
// dozen requests each; docs/sre/slo.md has the detail): home page 0.22 to
// 0.63 s; API /health 0.12 to 0.29 s warm, 7.7 s on a cold start.

export const WINDOW_DAYS = 28;

// The fast suite runs every five minutes, when GitHub's scheduler keeps time.
// So the smallest outage a probe can see is one probe: five minutes.
export const PROBE_INTERVAL_MINUTES = 5;

const MINUTES_PER_DAY = 24 * 60;

// The error budget of a target, as minutes of complete outage per window.
export function budgetMinutes(target, windowDays = WINDOW_DAYS) {
  return (1 - target) * windowDays * MINUTES_PER_DAY;
}

// How many five-minute probes are scheduled in a window.
export function expectedRuns(windowMinutes) {
  return windowMinutes / PROBE_INTERVAL_MINUTES;
}

// kind "availability": a tagged check result is good when the check passed.
// kind "latency": only results that passed and carry a timing are counted, and
// one is good when it answered in under `threshold_ms`. A failed probe is
// charged to the availability SLO alone, so one outage is not counted twice.
//
// `severity_cap` is the most serious level a burn alert on this SLO may carry:
// slow is "degraded", not "down", and the staff site has one user.
export const SLOS = [
  {
    id: "public-availability",
    name: "Website availability",
    component: "public-site",
    kind: "availability",
    target: 0.999,
    window_days: WINDOW_DAYS,
    threshold_ms: null,
    accepted: false,
    severity_cap: "sev2",
    definition: "A probe of a public page (home, advisory, about, podcast, privacy, terms, search) or of the site's script and stylesheet is good when it answers 200 with its own content.",
  },
  {
    id: "public-latency",
    name: "Website speed",
    component: "public-site",
    kind: "latency",
    target: 0.99,
    window_days: WINDOW_DAYS,
    threshold_ms: 1500,
    accepted: false,
    severity_cap: "sev3",
    definition: "A probe of a public page that answered is good when the whole HTML arrived in under 1,500 ms.",
  },
  {
    id: "api-availability",
    name: "API availability",
    component: "api",
    kind: "availability",
    target: 0.995,
    window_days: WINDOW_DAYS,
    threshold_ms: null,
    accepted: false,
    severity_cap: "sev2",
    definition: "A probe of the API is good when its health route says ok, its identity route names the build, and the deal analysis route returns the reference figures.",
  },
  {
    id: "api-latency",
    name: "API speed",
    component: "api",
    kind: "latency",
    target: 0.95,
    window_days: WINDOW_DAYS,
    threshold_ms: 1000,
    accepted: false,
    severity_cap: "sev3",
    definition: "A probe of the API that answered is good when the answer arrived in under 1,000 ms. A cold start (the first request after the service scaled to zero) usually is not.",
  },
  {
    id: "calculators-availability",
    name: "Calculators availability",
    component: "calculators",
    kind: "availability",
    target: 0.995,
    window_days: WINDOW_DAYS,
    threshold_ms: null,
    accepted: false,
    severity_cap: "sev2",
    definition: "A probe of a calculator page (Deal Studio, mortgage simulator, seller net sheet) is good when the page loads with its own content. The calculator pages are served by Cloudflare, not the API, so the API's answer counts toward API availability instead.",
  },
  {
    id: "inquiry-availability",
    name: "Inquiry form availability",
    component: "inquiry",
    kind: "availability",
    target: 0.995,
    window_days: WINDOW_DAYS,
    threshold_ms: null,
    accepted: false,
    severity_cap: "sev2",
    definition: "A probe is good when the contact page loads and the inquiry route answers as an open, working route would. Nothing is ever submitted, so delivery to the staff queue is not measured here.",
  },
  {
    id: "staff-availability",
    name: "Staff site availability",
    component: "staff-site",
    kind: "availability",
    target: 0.995,
    window_days: WINDOW_DAYS,
    threshold_ms: null,
    accepted: false,
    severity_cap: "sev3",
    definition: "A probe is good when the staff sign-in page loads with its strict security headers and the staff API asks for sign-in.",
  },
];

// The burn rate says how fast the budget is being spent: 1 means "exactly on
// course to spend the whole budget by the end of the window", 14.4 means "14.4
// times faster than that". These are the windows slo.json reports.
export const BURN_WINDOWS = { "1h": 60, "6h": 360, "3d": 4320 };

// When a burn rate becomes an alert. Each rule looks at two windows: the long
// one proves the burn is big enough to matter, the short one proves it is
// still going on (so the alert stops soon after the trouble does).
//
// The rates are the usual ones (14.4, 6, 1). At 28 days they mean: 2.1% of the
// budget gone in one hour, 5.4% in six hours, 10.7% in three days.
//
// The rates alone are not enough here. A one-hour window holds 12 probes, so a
// single failed probe is an 8.3% error rate: a burn rate of 83 against a 99.9%
// target and 16.7 against 99.5%. One bad probe would trip every rule. So each
// rule also needs a minimum number of separate runs that saw a failure
// (`min_bad_runs`), and a minimum number of runs in the window at all
// (`min_runs`, a third of what the schedule should produce), so nothing is
// concluded from a window the monitor mostly missed.
export const BURN_POLICY = [
  { name: "fast", severity: "sev2", window: "1h", long_minutes: 60, short_minutes: 15, burn_rate: 14.4, min_bad_runs: 3, min_runs: 4 },
  { name: "medium", severity: "sev3", window: "6h", long_minutes: 360, short_minutes: 60, burn_rate: 6, min_bad_runs: 4, min_runs: 24 },
  { name: "slow", severity: "sev4", window: "3d", long_minutes: 4320, short_minutes: 360, burn_rate: 1, min_bad_runs: 6, min_runs: 288 },
];

// How much budget is left decides what may ship (docs/sre/error-budget-policy.md).
// A state applies when the share of budget left is at or below `at_or_below`.
// `label` and `asks` (`asks_speed` for a speed SLO, which never freezes other
// work) are what the weekly report prints, so the report and the policy say
// the same thing; the policy document is the full text. A state
// binds only once Gbenga has accepted the target; before that it is advice.
export const BUDGET_STATES = [
  {
    state: "exhausted", at_or_below: 0, label: "Spent",
    asks: "stop merging and deploying feature changes that touch this part; only fixes, security patches and reliability work ship until the budget is above zero again or Gbenga records an exception; write a postmortem for what spent it.",
    asks_speed: "put performance work on the slow part ahead of features that add to it, and look at why it is slow (a cold start, a slow route, a provider); other work is not frozen.",
  },
  {
    state: "restricted", at_or_below: 0.25, label: "Restricted",
    asks: "ship only fixes and small low-risk changes to this part, each deploy watched until its checks pass; reliability work comes before new features.",
    asks_speed: "plan performance work on the slow part before features that add to it.",
  },
  {
    state: "caution", at_or_below: 0.5, label: "Caution",
    asks: "ship as usual, but find what spent the budget and plan its fix this week.",
    asks_speed: "ship as usual, but find what made it slow and plan its fix this week.",
  },
];

// An attainment figure is not judged until there is at least a day of probes
// behind it, and enough of them that one failed probe alone could not break
// the target (1,000 for 99.9%).
export const MIN_RUNS_FOR_JUDGEMENT = 288;

export function minRunsFor(target) {
  return Math.max(MIN_RUNS_FOR_JUDGEMENT, Math.ceil(1 / (1 - target) - 1e-9));
}

// Every problem with the configuration, as plain sentences. `components` is
// COMPONENTS from lib/schema.mjs. The test runs this, so a typo fails early.
export function configProblems(components, slos = SLOS, policy = BURN_POLICY) {
  const problems = [];
  const seen = new Set();
  const severities = ["sev1", "sev2", "sev3", "sev4"];
  for (const slo of slos) {
    if (seen.has(slo.id)) problems.push(`duplicate SLO id ${slo.id}`);
    seen.add(slo.id);
    if (!Object.hasOwn(components, slo.component)) problems.push(`${slo.id}: unknown component ${slo.component}`);
    if (!(slo.target > 0 && slo.target < 1)) problems.push(`${slo.id}: target must be between 0 and 1`);
    if (!["availability", "latency"].includes(slo.kind)) problems.push(`${slo.id}: unknown kind ${slo.kind}`);
    if (slo.kind === "latency" && !(slo.threshold_ms > 0)) problems.push(`${slo.id}: a latency SLO needs threshold_ms`);
    if (slo.kind === "availability" && slo.threshold_ms !== null) problems.push(`${slo.id}: an availability SLO has no threshold`);
    if (slo.window_days !== WINDOW_DAYS) problems.push(`${slo.id}: window must be ${WINDOW_DAYS} days`);
    if (typeof slo.accepted !== "boolean") problems.push(`${slo.id}: accepted must be true or false`);
    // An accepted target carries its record: the day Gbenga accepted it and
    // where he said so (a Jira key or a link), so nobody can flip the flag alone.
    if (slo.accepted === true) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(slo.accepted_on ?? "")) problems.push(`${slo.id}: an accepted target needs accepted_on (YYYY-MM-DD)`);
      if (typeof slo.accepted_record !== "string" || !slo.accepted_record.trim()) problems.push(`${slo.id}: an accepted target needs accepted_record (where Gbenga accepted it)`);
    }
    if (!severities.includes(slo.severity_cap)) problems.push(`${slo.id}: unknown severity_cap ${slo.severity_cap}`);
    if (typeof slo.definition !== "string" || !slo.definition) problems.push(`${slo.id}: definition is required`);
  }
  for (const rule of policy) {
    if (!Object.hasOwn(BURN_WINDOWS, rule.window) || BURN_WINDOWS[rule.window] !== rule.long_minutes) problems.push(`${rule.name}: window and long_minutes disagree`);
    if (!(rule.short_minutes > 0 && rule.short_minutes < rule.long_minutes)) problems.push(`${rule.name}: short window must be shorter than the long one`);
    if (!(rule.burn_rate > 0)) problems.push(`${rule.name}: burn_rate must be positive`);
    if (!(rule.min_bad_runs >= 2)) problems.push(`${rule.name}: min_bad_runs must be 2 or more, or one failed probe could alert`);
    if (!(rule.min_runs >= rule.min_bad_runs)) problems.push(`${rule.name}: min_runs must be at least min_bad_runs`);
    if (!severities.includes(rule.severity)) problems.push(`${rule.name}: unknown severity ${rule.severity}`);
  }
  return problems;
}
