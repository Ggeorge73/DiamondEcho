// The alerting rules: when a failure becomes an incident, how loud it is, when
// it is over, and who is reminded. This file decides; it never does anything:
// no files, no network, no clock. scripts/sre/alert.mjs reads the inputs,
// calls evaluate() and carries out the actions it returns. state.mjs uses the
// same thresholds, so the status page and the incidents always agree.
//
// The plain-language version, with the reasons for each number, is
// docs/sre/alerting.md. Change a number here only with a test that shows the
// old behaviour was wrong (reproduce it first with scripts/sre/fire-drill.mjs).

import { COMPONENTS, SEVERITIES } from "./lib/schema.mjs";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ------------------------------------------------------------------ numbers

// How many failed runs in a row make a failure real. Every check already
// retries inside a run (lib/http.mjs), so one failed run is two failed
// attempts. That can still be the monitor's own network on a shared GitHub
// runner; two runs in a row (5 to 10 minutes on the fast suite) is not.
// sev3 and sev4 are not urgent, so they wait longer and stay quieter.
// On the hourly slow suite the same counts mean hours, which suits the
// certificate and registration warnings that live there.
export const OPEN_AFTER = { sev1: 2, sev2: 2, sev3: 3, sev4: 6 };

// A check that keeps failing and passing never makes OPEN_AFTER in a row,
// yet one failure in three runs is a real problem for visitors. So a check
// that failed in INTERMITTENT.failures of its last INTERMITTENT.window
// results, in at least INTERMITTENT.episodes separate spells, opens an
// incident too, one severity lower ("failing on and off"). One unbroken
// spell of failures is not "on and off": OPEN_AFTER deals with it.
export const INTERMITTENT = { window: 12, failures: 4, episodes: 2 };

// An incident closes only when every check in it has passed this many runs in
// a row (15 minutes on the fast suite) and none is failing on and off. One
// good run after an outage is not a recovery.
export const RESOLVE_AFTER = 3;

// A component that fails again this soon after its incident closed reopens
// the same incident and the same issue, rather than starting a new one.
export const REOPEN_WITHIN_MINUTES = 60;

// Changes that are not urgent (a check joins or leaves, the severity drops)
// are posted on the issue at most this often. A rise in severity, an
// escalation and the resolution are posted at once.
export const COMMENT_EVERY_MINUTES = 60;

// Where each severity is announced. The issue is the record for all of them;
// the webhook (a chat channel) is for what needs a person soon.
export const CHANNELS = {
  sev1: { issue: true, webhook: true },
  sev2: { issue: true, webhook: true },
  sev3: { issue: true, webhook: false },
  sev4: { issue: true, webhook: false },
};

// The escalation ladder. Minutes are counted from the moment the incident
// reached its current severity. Each step happens once: a comment on the issue
// (naming the owner when SRE_OWNER is set) and a repeat on the webhook.
// Acknowledging the issue stops the ladder. After the last step the issue
// stays open and quiet: more noise would not reach anyone the first three did
// not.
export const ESCALATION = {
  sev1: [15, 45, 120],
  sev2: [60, 240],
  sev3: [],
  sev4: [],
};

// Labels the engine uses on GitHub issues.
export const LABELS = {
  incident: { name: "sre-incident", color: "d93f0b", description: "Opened and closed by the SRE monitor" },
  acknowledged: { name: "acknowledged", color: "0e8a16", description: "A person is on it: stops reminders" },
  silenced: { name: "sre-silenced", color: "cccccc", description: "No more comments or chat messages for this incident" },
  sev1: { name: "sev1", color: "b60205", description: "Visitors cannot use the site" },
  sev2: { name: "sev2", color: "d93f0b", description: "A main feature is down or badly degraded" },
  sev3: { name: "sev3", color: "fbca04", description: "A minor feature, or an early warning" },
  sev4: { name: "sev4", color: "c5def5", description: "Notice only" },
};

// The monitor is "blind" when it reached nothing at all, not even outside
// services it does not depend on us for (the Georgia MLS search, the public
// DNS resolvers, the domain registry). That is the monitor's own network,
// not the site. Such a run says nothing about the site: it is not counted
// against any check, and two in a row open a "monitoring" incident instead.
const OUTSIDE_SERVICES = new Set(["search", "dns", "domain"]);
export const BLIND_RUNS_TO_OPEN = 2;

export function isBlindRun(run) {
  const checks = Array.isArray(run?.checks) ? run.checks : [];
  if (checks.length < 3) return false;
  if (!checks.some((check) => OUTSIDE_SERVICES.has(check.component))) return false;
  return checks.every((check) => check.ok === false && (check.status === null || check.status === undefined));
}

// How long a scheduled suite may go without a run before the monitor says it
// is not watching. GitHub starts scheduled runs late when it is busy, often by
// 10 to 20 minutes, so these allow for that.
export const OVERDUE_MINUTES = { fast: 45, slow: 180 };

// A check result older than this no longer describes the site. The fast
// suite runs every 5 minutes, the slow one every hour; the limits allow for
// late runs. A check last seen only after a deploy is held to the slow limit.
export const STALE_MINUTES = { fast: 20, slow: 150, "post-deploy": 150 };

// A check not seen for this long has been removed from the monitor. It is
// dropped from memory, so it cannot hold an incident open forever.
export const FORGET_CHECK_DAYS = 7;

// Comments on an open issue are read every run while a reminder could still
// be due (an unacknowledged sev1 or sev2), and otherwise at most this often,
// to pick up "Status:" lines without an extra GitHub call every run.
export const READ_COMMENTS_EVERY_MINUTES = 15;

// A comment by a person acknowledges only when its first line starts with
// one of these words. Any other comment (a question, a note an AI agent
// posts through a person's account) does not stop the reminders.
export const ACK_WORDS = /^(ack|acknowledged)\b/i;
// A comment by a person whose first line starts with "Status:" is a public
// update: the rest of that line goes on the status page.
export const STATUS_PREFIX = /^status:\s*/i;
export const MAX_STATUS_CHARS = 280;

// What a person's comments say, from the first lines only.
export function readComments(comments, openedAt) {
  const since = time(openedAt);
  const human = (comments || []).filter((comment) => comment && !comment.bot
    && !(time(comment.created_at) < since) && typeof comment.first_line === "string");
  return {
    acknowledged: human.some((comment) => ACK_WORDS.test(comment.first_line.trim())),
    statuses: human.filter((comment) => STATUS_PREFIX.test(comment.first_line.trim()))
      .map((comment) => ({ at: comment.created_at, text: statusText(comment.first_line) }))
      .filter((status) => status.text),
  };
}

// Public text: one line, no markup characters, short.
export function statusText(line) {
  return String(line).trim().replace(STATUS_PREFIX, "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_STATUS_CHARS);
}

// slo.json older than this is not used to open or close anything.
export const SLO_FRESH_MINUTES = 120;

// A burn alert for a component that has (or just had) its own incident is
// the same problem seen another way. It is noted on that incident instead of
// opening a second one.
export const BUDGET_QUIET_HOURS = 6;
// A budget incident closes when its burn alert has been absent this many
// evaluations in a row.
export const BUDGET_RESOLVE_AFTER = 2;

// Resolved incidents kept for the status page.
export const RECENT_DAYS = 90;
// Updates kept per incident (the status page shows them all).
export const MAX_UPDATES = 40;

// ---------------------------------------------------------------- wording

export const MONITORING = "monitoring";
const NAMES = { ...COMPONENTS, [MONITORING]: "Monitoring" };
export const componentName = (component) => NAMES[component] ?? String(component);

// What a visitor (or Gbenga) would notice. Public text: no internals.
export const IMPACT = {
  "public-site": "Pages of diamondecho.com may not load, or may load incomplete, for visitors.",
  search: "The property search on /search may not show listings. The search is provided by Georgia MLS.",
  calculators: "Deal Studio, the mortgage simulator or the seller net sheet may not work fully. The pages calculate in the browser when the service behind them is down, and say so.",
  inquiry: "Visitors may not be able to send a request from the contact form. A request that is not confirmed on screen is not stored.",
  api: "The service behind the calculators and the contact form is not answering correctly.",
  "staff-site": "Staff may not be able to open the request queue at staff.diamondecho.com.",
  dns: "The name diamondecho.com may not lead visitors, or mail, to the right place.",
  tls: "Browsers may warn visitors that the connection is not secure, now or soon.",
  domain: "The registration of diamondecho.com needs attention. If it lapses, the website and mail stop.",
  [MONITORING]: "The monitor cannot see the site, so the status shown may be out of date. This says nothing about whether the site itself works.",
};
const BUDGET_IMPACT = "The site is failing more often than its reliability target allows, even if it works right now.";

export const RUNBOOK_DIR = "docs/sre/runbooks";
export const RUNBOOKS = {
  "public-site": ["site-down.md"],
  "staff-site": ["site-down.md"],
  search: ["search-provider-down.md"],
  calculators: ["api-down.md", "api-slow-or-saturated.md"],
  inquiry: ["inquiry-not-delivered.md", "api-down.md"],
  api: ["api-down.md", "api-slow-or-saturated.md"],
  dns: ["dns-problem.md"],
  tls: ["tls-certificate.md"],
  domain: ["domain-expiry.md"],
  [MONITORING]: ["monitoring-is-blind.md"],
};
// Parts that a new deploy can break: when a deploy of one was seen shortly
// before the incident, the bad-deploy runbook is listed first.
const DEPLOYED = { api: "api", inquiry: "api", calculators: "api", "public-site": "public-site", search: "public-site", "staff-site": "staff-site" };
export const DEPLOY_SUSPECT_MINUTES = 120;

export function runbooksFor(component, { recentDeploy = false } = {}) {
  const list = RUNBOOKS[component] ?? ["README.md"];
  const files = recentDeploy && DEPLOYED[component] ? ["bad-deploy.md", ...list] : list;
  return files.map((file) => `${RUNBOOK_DIR}/${file}`);
}

const TITLE_WORDS = { sev1: "is down", sev2: "is not working properly", sev3: "has a minor problem", sev4: "notice" };
export function incidentTitle({ component, severity, intermittent = false, budgetName = null, key }) {
  if (budgetName) return `${budgetName}: failing more often than its target allows`;
  if (key === MONITORING) return "Monitoring cannot see the site";
  const name = componentName(component);
  if (intermittent) return `${name} is failing on and off`;
  return severity === "sev4" ? `${name}: notice` : `${name} ${TITLE_WORDS[severity]}`;
}

// ---------------------------------------------------------------- helpers

const rank = (severity) => {
  const index = SEVERITIES.indexOf(severity);
  return index === -1 ? SEVERITIES.length : index;
};
export const moreSevere = (a, b) => (rank(a) <= rank(b) ? a : b);
export const isMoreSevere = (a, b) => rank(a) < rank(b);
const lowerOne = (severity) => SEVERITIES[Math.min(rank(severity) + 1, SEVERITIES.length - 1)] ?? severity;
const iso = (ms) => new Date(ms).toISOString();
const time = (value) => (typeof value === "string" ? Date.parse(value) : NaN);
const minutes = (ms) => Math.max(0, Math.round(ms / MINUTE));
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const SEVERITY_WORDS = { sev1: "major outage", sev2: "partial outage", sev3: "minor problem", sev4: "notice" };

export function staleLimitMinutes(suites) {
  const limits = (suites || []).map((suite) => STALE_MINUTES[suite]).filter(Number.isFinite);
  return limits.length ? Math.min(...limits) : STALE_MINUTES.slow;
}

// ----------------------------------------------------------- check memory

// The engine keeps its own memory of every check (engine.checks), so it does
// not depend on another script's file: last result, streaks, and the last
// INTERMITTENT.window results as a string of "1" (pass) and "0" (fail).
export function rememberRun(memory, run) {
  const checks = { ...(memory || {}) };
  const at = run.finished_at;
  for (const check of run.checks) {
    const before = isObject(checks[check.id]) ? checks[check.id] : {};
    const recent = `${before.recent || ""}${check.ok ? "1" : "0"}`.slice(-INTERMITTENT.window);
    checks[check.id] = {
      name: check.name,
      component: check.component,
      severity: check.severity,
      // The severity the check had when it last failed. A passing TLS check
      // reports sev3; the failing one says how bad it is.
      fail_severity: check.ok ? before.fail_severity ?? check.severity : check.severity,
      ok: check.ok,
      status: check.status ?? null,
      detail: check.ok ? "" : check.detail,
      at,
      suites: [...new Set([...(before.suites || []), run.suite])].sort(),
      fails: check.ok ? 0 : (before.fails || 0) + 1,
      oks: check.ok ? (before.oks || 0) + 1 : 0,
      failing_since: check.ok ? null : before.failing_since && !before.ok ? before.failing_since : at,
      recent,
    };
  }
  return checks;
}

export function forgetOldChecks(memory, now) {
  const kept = {};
  for (const [id, check] of Object.entries(memory || {})) {
    if (now - time(check.at) <= FORGET_CHECK_DAYS * DAY) kept[id] = check;
  }
  return kept;
}

// Is this check, on its own, a reason for an incident? Returns
// { severity, intermittent } or null.
export function judgeCheck(check) {
  if (!check) return null;
  if (!check.ok && check.fails >= (OPEN_AFTER[check.fail_severity] ?? OPEN_AFTER.sev4)) {
    return { severity: check.fail_severity, intermittent: false };
  }
  const recent = check.recent || "";
  const failures = [...recent].filter((mark) => mark === "0").length;
  const episodes = recent.split("1").filter(Boolean).length;
  if (failures >= INTERMITTENT.failures && episodes >= INTERMITTENT.episodes) {
    return { severity: lowerOne(check.fail_severity), intermittent: true };
  }
  return null;
}

// Has this check recovered for good?
export function hasRecovered(check) {
  if (!check) return true; // forgotten: removed from the monitor
  return check.ok && check.oks >= RESOLVE_AFTER && judgeCheck(check) === null;
}

// --------------------------------------------------------------- evaluate

// Turns one run into the next incidents.json and a list of actions. Inputs:
//   run        the run document (already valid)
//   incidents  the previous incidents.json, or null
//   slo        slo.json, or null when not given or unreadable (budget
//              incidents are then left exactly as they are)
//   now        milliseconds (SRE_NOW in drills and tests)
//   deploys    lines of deploys.jsonl, to point at the bad-deploy runbook
//   github     what GitHub says about our issues, or null when unknown:
//              { [issue number]: { open, acknowledged, silenced } }
//   notify     true when the actions will really be carried out; only then
//              is a missing issue retried on later runs
//   owner      GitHub login named on escalations (SRE_OWNER), or null
//   links      { repository: "owner/name" } to turn runbook paths into links
// Returns { incidents, actions, notes }. Every text in incidents and actions
// is public.
export function evaluate({ run, incidents = null, slo = null, now, deploys = [], github = null, notify = false, owner = null, links = {} }) {
  const doc = normalizeIncidents(incidents);
  const engine = doc.engine;
  const notes = [];
  const actions = [];

  if (engine.runs[run.suite] === run.started_at) {
    return { incidents: doc, actions, notes: [`The ${run.suite} run of ${run.started_at} was already processed; nothing changed.`] };
  }
  engine.runs[run.suite] = run.started_at;

  const blind = isBlindRun(run);
  if (blind) {
    engine.blind = { streak: (engine.blind.streak || 0) + 1, since: engine.blind.since || run.finished_at };
    notes.push(`The monitor reached nothing in this run (${run.checks.length} checks, not even outside services); it is not counted against the site.`);
  } else {
    engine.blind = { streak: 0, since: null };
    engine.checks = rememberRun(engine.checks, run);
  }
  engine.checks = forgetOldChecks(engine.checks, now);

  const ctx = { doc, engine, actions, notes, now, deploys, github, notify, owner, links: links || {} };
  syncWithGithub(ctx);

  if (!blind) {
    const components = new Set(Object.values(engine.checks).map((check) => check.component));
    for (const incident of doc.open) if (!incident.key.startsWith("budget:") && incident.key !== MONITORING) components.add(incident.component);
    const order = Object.keys(COMPONENTS);
    for (const component of [...components].sort((a, b) => order.indexOf(a) - order.indexOf(b))) judgeComponent(ctx, component);
  }
  judgeBudgets(ctx, slo);
  judgeMonitoring(ctx);

  for (const incident of doc.open) {
    escalate(ctx, incident);
    flushPending(ctx, incident);
    retryMissingIssue(ctx, incident);
  }
  doc.recent = doc.recent.filter((incident) => now - time(incident.resolved_at) <= RECENT_DAYS * DAY);
  return { incidents: doc, actions, notes };
}

export function normalizeIncidents(value) {
  const doc = isObject(value) ? structuredClone(value) : {};
  const engine = isObject(doc.engine) ? doc.engine : {};
  return {
    schema: 1,
    engine: {
      checks: isObject(engine.checks) ? engine.checks : {},
      runs: isObject(engine.runs) ? engine.runs : {},
      blind: isObject(engine.blind) ? engine.blind : { streak: 0, since: null },
      incidents: isObject(engine.incidents) ? engine.incidents : {},
      pending_closes: Array.isArray(engine.pending_closes) ? engine.pending_closes : [],
    },
    open: Array.isArray(doc.open) ? doc.open.filter((incident) => isObject(incident) && typeof incident.key === "string") : [],
    recent: Array.isArray(doc.recent) ? doc.recent.filter(isObject) : [],
  };
}

// The engine's private notes about one open incident.
function memoryOf(ctx, incident) {
  const all = ctx.engine.incidents;
  if (!isObject(all[incident.key])) {
    all[incident.key] = {
      members: Object.fromEntries((incident.failing_checks || []).map((id) => [id, incident.severity])),
      severity_since: incident.opened_at,
      escalation: 0,
      last_comment_at: incident.opened_at,
      pending: [],
      acknowledged: false,
      silenced: false,
      hand_closed: false,
      webhooked: false,
      budget_noted: [],
      clear: 0,
    };
  }
  return all[incident.key];
}

function syncWithGithub(ctx) {
  if (!ctx.github) return;
  for (const incident of ctx.doc.open) {
    const facts = Number.isInteger(incident.issue_number) ? ctx.github[incident.issue_number] : undefined;
    if (!facts) continue;
    const memo = memoryOf(ctx, incident);
    if (facts.open === false && !memo.hand_closed) {
      // A person closed the issue: they know. Stay quiet until it resolves;
      // the status page still shows the incident while checks fail.
      memo.hand_closed = true;
      ctx.notes.push(`Issue #${incident.issue_number} (${incident.key}) was closed by a person; no more comments or messages for it.`);
    }
    memo.acknowledged = memo.acknowledged || facts.acknowledged === true || memo.hand_closed;
    memo.silenced = facts.silenced === true || memo.hand_closed;
    // A person's "Status:" line goes onto the status page once.
    const seen = Array.isArray(memo.status_seen) ? memo.status_seen : [];
    for (const status of Array.isArray(facts.statuses) ? facts.statuses : []) {
      if (!status?.text || !Number.isFinite(time(status.at)) || seen.includes(status.at)) continue;
      seen.push(status.at);
      addUpdate(incident, status.at, statusText(status.text));
    }
    memo.status_seen = seen.slice(-50);
  }
}

// ----------------------------------------------------- component incidents

function judgeComponent(ctx, component) {
  const { doc, engine } = ctx;
  const checks = Object.entries(engine.checks).filter(([, check]) => check.component === component);
  const qualifying = checks.map(([id, check]) => ({ id, check, verdict: judgeCheck(check) })).filter((entry) => entry.verdict);
  const incident = doc.open.find((item) => item.key === component);

  if (!incident) {
    if (qualifying.length) openIncident(ctx, { key: component, component, qualifying });
    return;
  }

  const memo = memoryOf(ctx, incident);
  const changes = [];
  for (const { id, check, verdict } of qualifying) {
    if (!Object.hasOwn(memo.members, id)) changes.push(`${check.name} is failing too.`);
    memo.members[id] = verdict.severity;
  }
  for (const id of Object.keys(memo.members)) {
    if (hasRecovered(engine.checks[id])) {
      delete memo.members[id];
      changes.push(`${engine.checks[id]?.name ?? id} works again.`);
    }
  }
  if (Object.keys(memo.members).length === 0) {
    resolveIncident(ctx, incident, `every check has passed at least ${RESOLVE_AFTER} runs in a row`);
    return;
  }
  incident.failing_checks = Object.keys(memo.members).sort();
  const intermittent = incident.failing_checks.every((id) => judgeCheck(engine.checks[id])?.intermittent === true);
  const severity = Object.values(memo.members).reduce(moreSevere, "sev4");
  // A rise is commented on at once, with these changes in it; anything else
  // waits for the next batched update.
  const raised = changeSeverity(ctx, incident, severity, { intermittent, why: changes });
  if (!raised && changes.length) memo.pending.push(...changes);
}

function openIncident(ctx, { key, component, qualifying = [], severity = null, budget = null, reason = null }) {
  const { doc, engine, now, actions } = ctx;
  const at = iso(now);
  const members = Object.fromEntries(qualifying.map(({ id, verdict }) => [id, verdict.severity]));
  const level = severity ?? Object.values(members).reduce(moreSevere, "sev4");
  const intermittent = qualifying.length > 0 && qualifying.every(({ verdict }) => verdict.intermittent);
  const title = incidentTitle({ key, component, severity: level, intermittent, budgetName: budget?.name });
  const why = reason ?? qualifying.map(({ check, verdict }) => (verdict.intermittent
    ? `${check.name} failed ${failuresIn(check)} of its last ${check.recent.length} checks`
    : `${check.name} has failed ${check.fails} checks in a row`)).join("; ");

  // Failing again soon after it closed: the same incident, the same issue.
  const index = doc.recent.findIndex((item) => item.key === key && now - time(item.resolved_at) <= REOPEN_WITHIN_MINUTES * MINUTE);
  let incident;
  if (index !== -1) {
    incident = doc.recent.splice(index, 1)[0];
    const quiet = minutes(now - time(incident.resolved_at));
    delete incident.resolved_at;
    delete incident.duration_minutes;
    Object.assign(incident, { severity: level, title, failing_checks: Object.keys(members).sort() });
    addUpdate(incident, at, `Failing again ${plural(quiet, "minute")} after it recovered: ${why}.`);
  } else {
    incident = {
      key, component, severity: level, title, opened_at: at,
      failing_checks: Object.keys(members).sort(), issue_number: null, issue_url: null,
      updates: [{ at, text: `Opened: ${why}.` }],
    };
  }
  doc.open.push(incident);
  delete engine.incidents[key];
  const memo = memoryOf(ctx, incident);
  Object.assign(memo, { members, severity_since: at, last_comment_at: at });
  if (budget) Object.assign(memo, { slo: budget.slo, budget_name: budget.name });
  if (key === MONITORING) memo.reason = why;

  const body = issueBody(ctx, incident, { reason: why, budget });
  if (index !== -1 && Number.isInteger(incident.issue_number)) {
    actions.push({ kind: "reopen-issue", key, issue_number: incident.issue_number, title, severity: level, body: `**Failing again.** ${why}.\n\n${body}` });
  } else {
    actions.push({ kind: "open-issue", key, title, severity: level, labels: [LABELS.incident.name, level], body });
  }
  announce(ctx, incident, `${index !== -1 ? "Failing again" : "New"}: ${title}. ${impactOf(incident)}`);

  // An error-budget incident for the same part is now the same problem: one
  // issue at a time per part, so it is merged into this one.
  if (!budget && key !== MONITORING) {
    for (const other of doc.open.filter((item) => item.key.startsWith("budget:") && item.component === component)) {
      memo.budget_noted.push(other.key.slice(7));
      resolveIncident(ctx, other, null, { merged: incident });
    }
  }
}

function changeSeverity(ctx, incident, severity, { intermittent = false, why = [] } = {}) {
  const memo = memoryOf(ctx, incident);
  const title = incidentTitle({ key: incident.key, component: incident.component, severity, intermittent, budgetName: memo.budget_name });
  if (severity === incident.severity && title === incident.title) return false;
  const from = incident.severity;
  const at = iso(ctx.now);
  incident.severity = severity;
  incident.title = title;
  if (severity === from) {
    ctx.actions.push({ kind: "set-severity", key: incident.key, issue_number: incident.issue_number, from, to: severity, title });
    return false;
  }
  memo.severity_since = at;
  memo.escalation = 0;
  if (isMoreSevere(severity, from)) {
    addUpdate(incident, at, `Worse: now a ${SEVERITY_WORDS[severity]}. ${why.join(" ")}`.trim());
    ctx.actions.push({ kind: "set-severity", key: incident.key, issue_number: incident.issue_number, from, to: severity, title });
    if (!memo.silenced) {
      const pending = memo.pending.splice(0);
      ctx.actions.push({ kind: "comment", key: incident.key, issue_number: incident.issue_number, body: `**Severity raised from ${from} to ${severity}** (${SEVERITY_WORDS[severity]}).\n\n${[...pending, ...why].map((line) => `- ${line}`).join("\n") || "- More checks are failing."}` });
      memo.last_comment_at = at;
    }
    // A rise to a severity that goes to chat goes to chat, once.
    if (CHANNELS[severity].webhook && !CHANNELS[from]?.webhook) announce(ctx, incident, `Worse: ${title}. ${impactOf(incident)}`);
    else if (CHANNELS[severity].webhook) announce(ctx, incident, `Worse (${from} to ${severity}): ${title}.`);
    return true;
  }
  addUpdate(incident, at, `Improving: now a ${SEVERITY_WORDS[severity]}.`);
  ctx.actions.push({ kind: "set-severity", key: incident.key, issue_number: incident.issue_number, from, to: severity, title });
  memo.pending.push(`Severity lowered from ${from} to ${severity}: the more serious failures have recovered.`);
  return false;
}

// Closes an incident. `merged` is the incident that carries on with the
// same problem; then the text says so instead of "resolved".
function resolveIncident(ctx, incident, why, { merged = null } = {}) {
  const { doc, engine, now, actions } = ctx;
  const memo = memoryOf(ctx, incident);
  const at = iso(now);
  const lasted = minutes(now - time(incident.opened_at));
  incident.resolved_at = at;
  incident.duration_minutes = lasted;
  incident.failing_checks = [];
  const where = merged ? `the ${merged.title} incident` : "";
  addUpdate(incident, at, merged ? `Followed from now on in ${where}.` : `Resolved: ${why}. It lasted ${duration(lasted)}.`);
  doc.open = doc.open.filter((item) => item !== incident);
  doc.recent.unshift(incident);
  delete engine.incidents[incident.key];
  if (!memo.hand_closed) {
    const body = merged
      // alert.mjs turns [[issue:KEY]] into that incident's issue number,
      // which may only exist once this run's actions are carried out.
      ? `**Merged:** the same problem is now followed in ${where} [[issue:${merged.key}]].`
      : `**Resolved** at ${at}: ${why}. Duration: ${duration(lasted)}.\n\nIf this needs a postmortem, see docs/sre/postmortem-template.md.`;
    actions.push({ kind: "close-issue", key: incident.key, issue_number: incident.issue_number, body });
  }
  if (memo.webhooked && !merged) announce(ctx, incident, `Resolved after ${duration(lasted)}: ${incident.title}.`, { force: true, memo });
}

// -------------------------------------------------------- budget incidents

function judgeBudgets(ctx, slo) {
  const { doc, now, notes } = ctx;
  if (!isObject(slo)) return;
  const generated = time(slo.generated_at);
  if (!Number.isFinite(generated) || now - generated > SLO_FRESH_MINUTES * MINUTE || generated - now > 5 * MINUTE) {
    notes.push("slo.json is missing a time or is out of date; budget incidents are left as they are.");
    return;
  }
  const names = Object.fromEntries((Array.isArray(slo.slos) ? slo.slos : []).filter(isObject).map((item) => [item.id, item.name]));
  const alerts = {};
  for (const alert of Array.isArray(slo.burn_alerts) ? slo.burn_alerts : []) {
    if (!isObject(alert) || typeof alert.slo !== "string" || !/^[a-z0-9-]+$/.test(alert.slo) || !SEVERITIES.includes(alert.severity)) continue;
    // A slow burn (sev4) is a note for the weekly review
    // (docs/sre/error-budget-policy.md): it stays in slo.json and the weekly
    // report and opens no issue.
    if (alert.severity === "sev4") continue;
    if (!alerts[alert.slo] || isMoreSevere(alert.severity, alerts[alert.slo].severity)) alerts[alert.slo] = alert;
  }

  for (const alert of Object.values(alerts)) {
    const key = `budget:${alert.slo}`;
    const component = typeof alert.component === "string" ? alert.component : "public-site";
    const text = typeof alert.text === "string" ? alert.text.slice(0, 400) : `${names[alert.slo] ?? alert.slo} is using its error budget too fast.`;
    const existing = doc.open.find((item) => item.key === key);
    if (existing) {
      const memo = memoryOf(ctx, existing);
      memo.clear = 0;
      if (isMoreSevere(alert.severity, existing.severity)) changeSeverity(ctx, existing, alert.severity, { why: [text] });
      continue;
    }
    // The same trouble as an incident the component has (or just had): say
    // so on that incident instead of opening a second one.
    const own = doc.open.find((item) => item.key === component)
      ?? doc.recent.find((item) => item.key === component && now - time(item.resolved_at) <= BUDGET_QUIET_HOURS * HOUR);
    if (own) {
      if (doc.open.includes(own)) {
        const memo = memoryOf(ctx, own);
        if (!memo.budget_noted.includes(alert.slo)) {
          memo.budget_noted.push(alert.slo);
          memo.pending.push(`Error budget: ${text}`);
        }
      }
      continue;
    }
    const budget = { slo: alert.slo, name: names[alert.slo] ?? alert.slo };
    openIncident(ctx, { key, component, severity: alert.severity, budget, reason: text });
  }

  for (const incident of [...doc.open]) {
    if (!incident.key.startsWith("budget:") || alerts[incident.key.slice(7)]) continue;
    const memo = memoryOf(ctx, incident);
    memo.clear = (memo.clear || 0) + 1;
    if (memo.clear >= BUDGET_RESOLVE_AFTER) resolveIncident(ctx, incident, "the error budget is no longer being used up fast");
  }
}

// ---------------------------------------------------- monitoring incident

function judgeMonitoring(ctx) {
  const { doc, engine, now } = ctx;
  const reasons = [];
  if (engine.blind.streak >= BLIND_RUNS_TO_OPEN) {
    reasons.push(`The monitor reached nothing in its last ${engine.blind.streak} runs, not even outside services such as the Georgia MLS search. That points at the monitor's own network, not at the site`);
  }
  for (const [suite, limit] of Object.entries(OVERDUE_MINUTES)) {
    const last = time(engine.runs[suite]);
    if (Number.isFinite(last) && now - last > limit * MINUTE) {
      reasons.push(`The ${suite} checks have not run since ${engine.runs[suite]} (more than ${duration(limit)})`);
    }
  }
  const incident = doc.open.find((item) => item.key === MONITORING);
  if (reasons.length) {
    const reason = reasons.join(". ");
    if (!incident) {
      openIncident(ctx, { key: MONITORING, component: MONITORING, severity: "sev3", reason });
      return;
    }
    const memo = memoryOf(ctx, incident);
    memo.clear = 0;
    if (memo.reason !== reason) memo.pending.push(`${reason}.`);
    memo.reason = reason;
    return;
  }
  if (!incident) return;
  const memo = memoryOf(ctx, incident);
  memo.clear = (memo.clear || 0) + 1;
  if (memo.clear >= 2) resolveIncident(ctx, incident, "the monitor is running and reaching the site again");
}

// ------------------------------------------------------ reminders, output

function escalate(ctx, incident) {
  const memo = memoryOf(ctx, incident);
  const steps = ESCALATION[incident.severity] ?? [];
  if (memo.acknowledged || memo.silenced || memo.escalation >= steps.length) return;
  const waited = ctx.now - time(memo.severity_since);
  if (!(waited >= steps[memo.escalation] * MINUTE)) return;
  memo.escalation += 1;
  const who = validLogin(ctx.owner) ? `@${ctx.owner} ` : "";
  const last = memo.escalation === steps.length ? " This is the last reminder; the issue stays open until the checks pass." : "";
  ctx.actions.push({
    kind: "comment", key: incident.key, issue_number: incident.issue_number, escalation: memo.escalation,
    body: `${who}**Reminder ${memo.escalation} of ${steps.length}:** this ${incident.severity} incident has not been acknowledged for ${duration(minutes(waited))}. Follow ${runbookLinks(ctx, incident)}, then comment "ack" here or add the \`acknowledged\` label.${last}`,
  });
  memo.last_comment_at = iso(ctx.now);
  announce(ctx, incident, `Reminder ${memo.escalation}: not acknowledged for ${duration(minutes(waited))}: ${incident.title}.`, { force: true });
}

function flushPending(ctx, incident) {
  const memo = memoryOf(ctx, incident);
  if (!memo.pending.length) return;
  if (memo.silenced) { memo.pending = []; return; }
  if (ctx.now - time(memo.last_comment_at) < COMMENT_EVERY_MINUTES * MINUTE) return;
  const lines = [...new Set(memo.pending.splice(0))];
  ctx.actions.push({ kind: "comment", key: incident.key, issue_number: incident.issue_number, body: `**Update.**\n\n${lines.map((line) => `- ${line}`).join("\n")}\n\nStill failing: ${failingNames(ctx, incident)}.` });
  memo.last_comment_at = iso(ctx.now);
}

function retryMissingIssue(ctx, incident) {
  if (!ctx.notify || Number.isInteger(incident.issue_number)) return;
  if (ctx.actions.some((action) => action.key === incident.key && action.kind === "open-issue")) return;
  ctx.actions.push({ kind: "open-issue", key: incident.key, title: incident.title, severity: incident.severity, labels: [LABELS.incident.name, incident.severity], body: issueBody(ctx, incident, { reason: incident.updates?.[0]?.text ?? "" }) });
}

// A message for the chat webhook, when the severity goes there.
function announce(ctx, incident, text, { force = false, memo = memoryOf(ctx, incident) } = {}) {
  if (memo.silenced) return;
  if (!force && !CHANNELS[incident.severity]?.webhook) return;
  if (!CHANNELS[incident.severity]?.webhook && !memo.webhooked) return;
  memo.webhooked = true;
  ctx.actions.push({ kind: "webhook", key: incident.key, severity: incident.severity, text: `[${incident.severity}] ${text}` });
}

function addUpdate(incident, at, text) {
  incident.updates = [...(Array.isArray(incident.updates) ? incident.updates : []), { at, text: text.slice(0, 500) }].slice(-MAX_UPDATES);
}

function impactOf(incident) {
  return incident.key.startsWith("budget:") ? BUDGET_IMPACT : IMPACT[incident.component] ?? "";
}

function failuresIn(check) {
  return [...(check.recent || "")].filter((mark) => mark === "0").length;
}

function failingNames(ctx, incident) {
  const names = (incident.failing_checks || []).map((id) => ctx.engine.checks[id]?.name ?? id);
  return names.length ? names.join(", ") : "see the latest monitor run";
}

function recentDeploy(ctx, incident) {
  const opened = time(incident.opened_at);
  const part = DEPLOYED[incident.component];
  return Boolean(part) && (ctx.deploys || []).some((line) => isObject(line) && line.what === part && Number.isFinite(time(line.at))
    && opened - time(line.at) >= -5 * MINUTE && opened - time(line.at) <= DEPLOY_SUSPECT_MINUTES * MINUTE);
}

function runbookLinks(ctx, incident) {
  const repository = ctx.links.repository;
  return runbooksFor(incident.component, { recentDeploy: recentDeploy(ctx, incident) })
    .map((file) => (repository ? `[${file}](https://github.com/${repository}/blob/main/${file})` : file))
    .join(" and ");
}

const validLogin = (login) => typeof login === "string" && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login);
const oneLine = (text) => String(text ?? "").replace(/[\r\n]+/g, " ").replace(/<!--|-->/g, "").slice(0, 300);

export function duration(totalMinutes) {
  if (totalMinutes < 60) return plural(totalMinutes, "minute");
  const hours = Math.floor(totalMinutes / 60);
  const rest = totalMinutes % 60;
  if (hours < 48) return rest ? `${plural(hours, "hour")} ${plural(rest, "minute")}` : plural(hours, "hour");
  return plural(Math.round(hours / 24), "day");
}

// The issue text. Public: what visitors notice, what fails, since when, what
// to do, how to acknowledge. No internals beyond the check results.
export function issueBody(ctx, incident, { reason = "", budget = null } = {}) {
  const checks = (incident.failing_checks || []).map((id) => [id, ctx.engine.checks[id]]).filter(([, check]) => check);
  const starts = checks.map(([, check]) => time(check.failing_since)).filter(Number.isFinite);
  const since = starts.length ? iso(Math.min(...starts)) : incident.opened_at;
  const lines = [
    `### ${incident.title}`,
    "",
    `**Severity:** ${incident.severity} (${SEVERITY_WORDS[incident.severity]}), as defined in docs/sre/severity-and-escalation.md.`,
    `**What visitors notice:** ${impactOf(incident)}`,
    `**Failing since:** ${since.replace("T", " ").slice(0, 16)} UTC.`,
    "",
  ];
  if (checks.length) {
    lines.push("**What is failing**", "");
    for (const [, check] of checks) {
      const status = check.status ? `HTTP ${check.status}` : "no answer";
      lines.push(`- ${oneLine(check.name)}: ${oneLine(check.detail) || "failed"} (${status}; ${check.ok ? "passing now" : `failed ${check.fails} runs in a row`})`);
    }
    lines.push("");
  } else if (reason) {
    lines.push(`**What is wrong:** ${oneLine(reason)}`, "");
  }
  if (budget) lines.push(`**Target:** ${oneLine(budget.name)}. Proposed targets are not promises until Gbenga accepts them (docs/sre/slo.md).`, "");
  lines.push(
    `**What to do:** follow ${runbookLinks(ctx, incident)}.`,
    "",
    "**To acknowledge:** comment with a first line starting `ack` (or `Acknowledged`), or add the `acknowledged` label. Either one stops the reminders; other comments do not.",
    "**To update the status page:** comment with a first line starting `Status:`. That one line (up to 280 characters) is shown to the public; nothing else from this issue is.",
    "**To silence:** add the `sre-silenced` label. The engine then stops commenting and messaging about this incident; it still shows on the status page and still closes when the checks pass. Closing the issue by hand does the same.",
    "",
    `This issue is opened, updated and closed by the SRE monitor (scripts/sre/alert.mjs). It closes itself once every failing check has passed ${RESOLVE_AFTER} runs in a row. It is public: never paste secrets, tokens or visitor details here.`,
    "",
    `<!-- sre-incident-key: ${incident.key} -->`,
  );
  return lines.join("\n");
}
