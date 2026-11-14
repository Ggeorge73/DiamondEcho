// The rules for automatic fixes. This file decides; it never does anything:
// no files, no network, no processes. scripts/sre/remediate.mjs reads the
// state, asks this file what to do, and carries it out.
//
// The principle: an automatic fix must never make an outage worse. So the
// list of fixes is short (one), each has guardrails, every guardrail has a
// test (remediation-policy.test.mjs), and any doubt ends in "skipped: tell a
// person". The plain-language version is docs/sre/auto-remediation.md.

import { COMPONENTS } from "./lib/schema.mjs";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const ROLLBACK = "cloud-run-rollback";
export const NO_ACTION = "none";
export const DEFAULT_SERVICE = "diamondecho-api";

// Every number the guardrails use, in one place. These are policy choices,
// not measurements; the reasoning is beside each one.
export const LIMITS = {
  // A check result older than this is not evidence of anything. The fast
  // suite runs every 5 minutes; GitHub can start a scheduled run late.
  freshMinutes: 20,
  // DNS is checked by the hourly suite, so its results are older. Two hours
  // allows one late or missed hourly run.
  dnsFreshMinutes: 120,
  // One failed run can be a blip. Two in a row is a failure.
  minConsecutiveFailures: 2,
  // "Recent deploy": the incident opened no more than this long after the
  // serving revision started serving. A broken build fails on its first
  // requests, so the monitor sees it within a few runs. docs/de13-production-
  // setup.md has exact clock times for two production redeploys; in both the
  // new revision took the traffic minutes after it was created (about 12 and
  // about 2). When the monitor did not see the moment the revision started
  // serving, the revision's creation time is used instead, which is earlier
  // and so makes the window stricter. Past an hour a failure is more likely
  // to be something else (Google, Firestore, a quota), which a rollback would
  // not fix.
  deployWindowMinutes: 60,
  // The automatic fix is for the gap before a person responds. Once an
  // incident has been open this long, a person may be working on it and the
  // engine keeps its hands off.
  actWithinMinutes: 60,
  // The monitor writes "new revision seen" and the alert engine writes
  // "incident opened" seconds apart in the same run; allow for either order.
  sameRunSlackMinutes: 2,
  // The API must have been quiet for this long before the new revision was
  // created. If it was already failing, the new revision is not the cause
  // and may be somebody's fix.
  quietHoursBeforeDeploy: 6,
  // At most one automatic attempt (worked or failed) in this many hours.
  hoursBetweenAttempts: 24,
  // After acting, the failing checks must pass within this long, or the
  // rollback is recorded as not having fixed it.
  verifyMinutes: 30,
  // If the monitor produces no evidence either way for this long, stop
  // waiting and record the rollback as unverified.
  verifyGiveUpHours: 24,
};

const SERIOUS = ["sev1", "sev2"];

// What may be done for each part of the site. The only acting entry is the
// Cloud Run rollback, and only the three parts whose failure can be caused by
// the API's code may ask for it. Everything else is "tell a person", with the
// runbook that person follows. The order of `ROLLBACK_TRIGGERS` is the order
// in which incidents are considered.
export const ROLLBACK_TRIGGERS = ["api", "inquiry", "calculators"];

export const CATALOGUE = {
  api: { action: ROLLBACK, runbook: "docs/sre/runbooks/api-down.md" },
  inquiry: { action: ROLLBACK, runbook: "docs/sre/runbooks/inquiry-not-delivered.md" },
  calculators: { action: ROLLBACK, runbook: "docs/sre/runbooks/api-down.md" },
  "public-site": { action: NO_ACTION, runbook: "docs/sre/runbooks/site-down.md" },
  "staff-site": { action: NO_ACTION, runbook: "docs/sre/runbooks/site-down.md" },
  search: { action: NO_ACTION, runbook: "docs/sre/runbooks/search-provider-down.md" },
  dns: { action: NO_ACTION, runbook: "docs/sre/runbooks/dns-problem.md" },
  tls: { action: NO_ACTION, runbook: "docs/sre/runbooks/tls-certificate.md" },
  domain: { action: NO_ACTION, runbook: "docs/sre/runbooks/domain-expiry.md" },
  // The alert engine's own incidents: Cloudflare refusing the monitor, or the
  // monitor seeing nothing at all. Never a reason to touch the API.
  monitoring: { action: NO_ACTION, runbook: "docs/sre/runbooks/cloudflare-outage.md and docs/sre/runbooks/monitoring-is-blind.md" },
};
const UNKNOWN_PART = { action: NO_ACTION, runbook: "docs/sre/runbooks/README.md" };

// The inquiry and calculator parts are checked partly on the website
// (Cloudflare Pages) and partly on the API. Only the checks that call the API
// can show an API fault; a page that fails is the website's problem, which a
// rollback of the API cannot fix. The ids are those in scripts/sre/checks/
// (inquiry.mjs, calculators.mjs); remediation-policy.test.mjs fails if one
// leaves those files. A check not on this list never counts as an API fault.
export const API_CHECKS = {
  inquiry: ["inquiry-preflight", "inquiry-route", "inquiry-queue"],
  calculators: ["calculators-api-analyze"],
};

// The only two commands the engine may ever run. Both belong to the release
// role (scripts/sre/cloudrun/). The first only reads. The second moves
// traffic between revisions that already exist and does nothing else: it
// cannot change a setting, a secret, a permission, a DNS record, scaling or
// the database, and it deletes nothing.
export const STATUS_COMMAND = Object.freeze({ file: "bash", args: Object.freeze(["scripts/sre/cloudrun/status.sh"]) });
export function rollbackCommand(revision, service = DEFAULT_SERVICE) {
  if (!isRevisionName(revision, service)) throw new Error("Refusing to build a rollback command for an invalid revision name.");
  return { file: "bash", args: ["scripts/sre/cloudrun/rollback.sh", "--to", revision, "--apply"] };
}
export function isAllowedCommand(file, args, service = DEFAULT_SERVICE) {
  if (file !== "bash" || !Array.isArray(args)) return false;
  if (args.length === 1) return args[0] === STATUS_COMMAND.args[0];
  return args.length === 4 && args[0] === "scripts/sre/cloudrun/rollback.sh" && args[1] === "--to"
    && isRevisionName(args[2], service) && args[3] === "--apply";
}

// A service name as Cloud Run allows it. The name ends up in revision names
// the engine checks, so it is checked too.
export function isServiceName(value) {
  return typeof value === "string" && /^[a-z]([a-z0-9-]{0,47}[a-z0-9])?$/.test(value);
}

// A revision name comes from files a workflow wrote and from Cloud Run. It
// ends up as a command argument, so it is checked against the exact form
// Cloud Run uses (service name, a number, a short suffix) before any use.
export function isRevisionName(value, service = DEFAULT_SERVICE) {
  return typeof value === "string" && value.length <= 63 && value.startsWith(`${service}-`)
    && /^[a-z][a-z0-9-]*[a-z0-9]$/.test(value);
}

// The switch. Acting needs both: the workflow passes --apply, and Gbenga has
// set the repository variable SRE_AUTOREMEDIATE to exactly "enabled".
export function mayAct({ apply, env }) {
  return apply === true && String(env?.SRE_AUTOREMEDIATE ?? "").trim() === "enabled";
}

const time = (value) => (typeof value === "string" ? Date.parse(value) : NaN);
const iso = (ms) => new Date(ms).toISOString();
const minutesBetween = (later, earlier) => Math.round((later - earlier) / MINUTE);
const partName = (component) => COMPONENTS[component] ?? (component === "monitoring" ? "Monitoring" : String(component));

function isFresh(at, now, minutes = LIMITS.freshMinutes) {
  const t = time(at);
  return Number.isFinite(t) && now - t <= minutes * MINUTE && t - now <= 5 * MINUTE;
}

function statusProblem(status, now) {
  if (!status || typeof status !== "object" || typeof status.checks !== "object" || status.checks === null
    || typeof status.components !== "object" || status.components === null) return "status.json is missing or not in the expected shape";
  if (!isFresh(status.updated_at, now)) return `status.json was last updated more than ${LIMITS.freshMinutes} minutes ago`;
  return null;
}

function checksOf(status, component) {
  return Object.entries(status.checks)
    .filter(([, check]) => check && check.component === component)
    .map(([id, check]) => ({ id, ...check }));
}

// The revision and commit the monitor last read from the live API.
function observedFact(status, fact) {
  for (const check of checksOf(status, "api")) {
    const value = check.observed?.[fact];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

function base(incident, entry) {
  return {
    trigger: incident.component,
    action: entry.action,
    from_revision: null,
    to_revision: null,
    incident_key: incident.key ?? incident.component,
    incident_opened_at: incident.opened_at ?? null,
    issue_number: Number.isInteger(incident.issue_number) ? incident.issue_number : null,
    runbook: entry.runbook,
  };
}

function skip(basis, code, reason, extra = {}) {
  return { ...basis, ...extra, decision: "skipped", code, reason };
}

export function sameIncident(line, decision) {
  return line.incident_key === decision.incident_key && line.incident_opened_at === decision.incident_opened_at;
}

// Is the website, or DNS, healthy enough that the API's trouble is the API's
// own? Judged from the checks themselves rather than the component's state,
// because a part can be "degraded" for a minor reason that has nothing to do
// with the network (DNS has no DMARC record today, a sev3 check). Returns a
// sentence when it is not, or null.
function neighbourProblem(part, status, incidents, now) {
  const name = partName(part);
  const minutes = part === "dns" ? LIMITS.dnsFreshMinutes : LIMITS.freshMinutes;
  if (status.components[part]?.state === "outage") return `${name} is marked as an outage.`;
  // A sev3 or sev4 incident there is a notice (a missing mail record, a
  // certificate due in weeks), not a sign that the network is in trouble.
  if ((incidents.open ?? []).some((other) => other?.component === part && SERIOUS.includes(other.severity))) return `There is an open ${name} incident.`;
  const serious = checksOf(status, part).filter((check) => SERIOUS.includes(check.severity));
  const failing = serious.filter((check) => check.ok === false && isFresh(check.checked_at, now, minutes));
  if (failing.length) return `${name} check "${failing[0].name ?? failing[0].id}" is failing.`;
  if (!serious.some((check) => check.ok === true && isFresh(check.checked_at, now, minutes))) {
    return `No ${name} check has passed in the last ${minutes} minutes, so the monitor cannot show that it is healthy.`;
  }
  return null;
}

// Does the failure look like the API's code breaking? A refusal (401, 403,
// 429) is not: it is a permission or a limit, which a rollback does not fix.
// For the inquiry form 503 does not count either: it is the API's documented
// answer when the queue is switched off or the hourly cap is reached. For the
// inquiry and calculator parts only the checks that call the API count.
function apiFaultProblem(component, failing) {
  const name = partName(component);
  if (component !== "api") {
    const allowed = API_CHECKS[component] ?? [];
    const notApi = failing.filter((check) => !allowed.includes(check.id));
    if (notApi.length) return `The failing ${name} check "${notApi[0].name ?? notApi[0].id}" is on the website, not the API. A rollback of the API would not fix it.`;
  }
  const serverError = component === "inquiry" ? [500, 502, 504] : [500, 502, 503, 504];
  const refusals = [401, 403, 429];
  const isFault = (check) => {
    const status = check.status;
    if (status === null || status === undefined) return true; // no answer at all
    if (component === "api") return !refusals.includes(status);
    return serverError.includes(status);
  };
  if (failing.every(isFault)) return null;
  return component === "inquiry"
    ? `The failing ${name} checks do not show the API erroring (a 500, 502 or 504, or no answer). A refusal, or the inquiry form's 503 (queue off or hourly cap reached), is not fixed by a rollback.`
    : `The failing ${name} checks show a refusal (401, 403 or 429) or a non-error answer, not the API breaking. A rollback does not fix a permission or a limit.`;
}

// The guardrails that need only the files in the state directory.
function judgeFromFiles(incident, basis, ctx) {
  const { now, status, incidents, log, logUnreadable } = ctx;
  const name = partName(incident.component);

  if (!SERIOUS.includes(incident.severity)) {
    return skip(basis, "severity-too-low", `The ${name} incident is ${incident.severity}. Only sev1 and sev2 are considered for an automatic rollback.`);
  }
  if (logUnreadable) {
    return skip(basis, "log-unreadable", "remediation-log.jsonl could not be read, so the engine cannot tell what it has already done.");
  }
  const openedAt = time(incident.opened_at);
  if (!Number.isFinite(openedAt) || openedAt > now + 5 * MINUTE) return skip(basis, "incident-unreadable", "The incident has no readable opening time.");
  if (now - openedAt > LIMITS.actWithinMinutes * MINUTE) {
    return skip(basis, "incident-too-old", `The incident has been open ${minutesBetween(now, openedAt)} minutes. The engine acts only in the first ${LIMITS.actWithinMinutes} minutes; after that a person may be working on it.`);
  }

  const problem = statusProblem(status, now);
  if (problem) return skip(basis, "status-stale", `No fresh monitoring data: ${problem}.`);

  const failing = checksOf(status, incident.component)
    .filter((check) => SERIOUS.includes(check.severity) && check.ok === false && isFresh(check.checked_at, now));
  if (failing.length === 0) {
    return skip(basis, "checks-pass-now", `No sev1 or sev2 ${name} check has failed in the last ${LIMITS.freshMinutes} minutes, so there is nothing to fix right now.`);
  }
  if (!failing.some((check) => (check.consecutive_failures ?? 0) >= LIMITS.minConsecutiveFailures)) {
    return skip(basis, "not-confirmed", `The ${name} failure has been seen once. It needs ${LIMITS.minConsecutiveFailures} failed runs in a row.`);
  }

  // If the website or DNS is unhealthy too, the likelier cause is the
  // network, a provider or the monitor itself, not the API's newest revision.
  for (const part of ["public-site", "dns"]) {
    const why = neighbourProblem(part, status, incidents, now);
    if (why) return skip(basis, "site-or-dns-unhealthy", `${why} When more than the API is failing the cause is probably the network, a provider or the monitor, not the newest API revision.`);
  }

  const notFault = apiFaultProblem(incident.component, failing);
  if (notFault) return skip(basis, "not-api-fault", notFault);

  const lastAttempt = [...log].reverse().find((line) => (line.decision === "acted" || line.decision === "failed") && now - time(line.at) < LIMITS.hoursBetweenAttempts * HOUR);
  if (lastAttempt) {
    return skip(basis, "rollback-limit", `An automatic rollback was already attempted at ${lastAttempt.at}. There is at most one in ${LIMITS.hoursBetweenAttempts} hours; a second failure goes to a person.`);
  }
  return { failing, openedAt };
}

// The guardrails that need to know what Cloud Run is serving.
function judgeFromCloudRun(incident, basis, ctx, { failing, openedAt }) {
  const { status, incidents, deploys, deploysUnreadable, log, cloudrun, service } = ctx;

  if (!cloudrun?.ok) {
    return skip(basis, "cloud-run-unreadable", `Could not read the Cloud Run revisions (${cloudrun?.error ?? "no answer"}). Without that the engine cannot tell what is serving.`);
  }
  const data = cloudrun.data;
  const serving = Array.isArray(data?.serving) ? data.serving.filter((entry) => Number(entry?.percent) > 0) : [];
  const revisions = Array.isArray(data?.revisions) ? data.revisions : [];
  // Never race a person or deploy.sh. A deploy starts a revision with no
  // traffic under the tag "candidate", checks it, then moves traffic (maybe
  // in steps). While a candidate tag exists or traffic is split, someone is
  // part-way through; and if status.sh does not say which tags exist, the
  // engine cannot rule that out.
  if (serving.length !== 1 || Number(serving[0].percent) !== 100) {
    return skip(basis, "deploy-in-progress", "Traffic is not 100 percent on one revision. Someone is part-way through a rollout; the engine does not interfere.");
  }
  if (!Array.isArray(data?.tags)) {
    return skip(basis, "deploy-in-progress", "Cloud Run's answer does not say which traffic tags exist, so the engine cannot rule out a deploy in progress.");
  }
  if (data.tags.some((entry) => entry?.tag === "candidate")) {
    return skip(basis, "deploy-in-progress", "A revision tagged \"candidate\" exists: a deploy is in progress. The engine does not interfere.");
  }
  const current = serving[0].revision;
  const currentEntry = revisions.find((entry) => entry?.name === current);
  const createdAt = time(currentEntry?.created);
  if (!isRevisionName(current, service) || !Number.isFinite(createdAt) || createdAt > ctx.now + 5 * MINUTE) {
    return skip(basis, "serving-unknown", "The serving revision's name or creation time could not be read from Cloud Run.");
  }
  const withFrom = { from_revision: current };

  if (openedAt < createdAt) {
    return skip(basis, "incident-before-deploy", `The incident opened before ${current} was created, so that revision did not cause it. It may be somebody's fix.`, withFrom);
  }

  // The rollback target is the revision the monitor itself saw serving just
  // before this one. Never "the next newest in the list": that could be a
  // candidate that failed its checks and never served a visitor.
  if (deploysUnreadable) {
    return skip(basis, "no-previous-revision", "deploys.jsonl could not be read, so the engine does not know which revision was serving before.", withFrom);
  }
  const revisionLines = deploys.filter((line) => line?.what === "api" && line?.fact === "revision");
  const last = revisionLines.at(-1);
  let previous = null;
  let seenLine = null;
  if (last && last.to === current) {
    previous = last.from;
    seenLine = last;
  } else if (last) {
    // The monitor never read the new revision's name (a build that does not
    // start cannot answer the identity route). The last one it did see is the
    // one that was serving before.
    previous = last.to;
  } else {
    previous = observedFact(status, "revision");
  }

  // When did the current revision start serving? The monitor's own sighting
  // if it has one, otherwise Cloud Run's creation time (earlier, so stricter).
  const seenAt = time(seenLine?.at);
  const servingSince = Number.isFinite(seenAt) && seenAt >= createdAt ? seenAt : createdAt;
  if (seenLine && openedAt < servingSince - LIMITS.sameRunSlackMinutes * MINUTE) {
    return skip(basis, "incident-before-deploy", `The incident opened before the monitor first saw ${current} serving, so that revision did not cause it. It may be somebody's fix.`, withFrom);
  }
  if (openedAt - servingSince > LIMITS.deployWindowMinutes * MINUTE) {
    return skip(basis, "no-recent-deploy", `${current} started serving ${minutesBetween(openedAt, servingSince)} minutes before the incident opened. Only a failure within ${LIMITS.deployWindowMinutes} minutes of a new revision is treated as a bad deploy.`, withFrom);
  }

  if (!previous || previous === current) {
    return skip(basis, "no-previous-revision", "The monitor has no record of a different revision serving before this one, so there is no known-good revision to go back to.", withFrom);
  }
  if (!isRevisionName(previous, service)) {
    return skip(basis, "previous-invalid", "The recorded previous revision does not have the form of a Cloud Run revision name for this service.", withFrom);
  }
  const plan = { from_revision: current, to_revision: previous };
  const previousEntry = revisions.find((entry) => entry?.name === previous);
  if (!previousEntry) return skip(basis, "previous-missing", `${previous} is no longer listed in Cloud Run.`, plan);
  if (previousEntry.ready !== true) return skip(basis, "previous-not-ready", `${previous} is not marked ready in Cloud Run.`, plan);
  if (!(time(previousEntry.created) < createdAt)) {
    return skip(basis, "previous-not-older", `${previous} is not older than ${current}; going "back" to it would not be a rollback.`, plan);
  }

  // A revision is the code and its settings together. If only a setting
  // changed (the same code), a person changed it on purpose: the inquiry
  // queue switch, an origin, a limit, a rotated key. Going back would undo
  // their decision, and pin the service to the old settings. So the engine
  // needs proof that the code changed: different container images in Cloud
  // Run's list, or the monitor seeing the published commit change together
  // with the revision.
  const images = [currentEntry.image, previousEntry.image];
  const haveImages = images.every((image) => typeof image === "string" && image);
  const commitChanged = Boolean(seenLine) && deploys.some((line) => line?.what === "api" && line?.fact === "commit"
    && Math.abs(time(line.at) - time(seenLine.at)) <= LIMITS.sameRunSlackMinutes * MINUTE);
  if (haveImages) {
    if (images[0] === images[1]) {
      return skip(basis, "settings-only", `${current} runs the same container image as ${previous}: a setting was changed, not the code. Going back would undo a setting a person changed on purpose.`, plan);
    }
  } else if (!commitChanged) {
    if (seenLine && observedFact(status, "commit")) {
      return skip(basis, "settings-only", `The monitor saw the revision change to ${current} but the commit the API publishes stayed the same. That is a settings change; going back would undo a setting a person changed on purpose.`, plan);
    }
    return skip(basis, "cannot-tell-new-code", `The engine cannot prove ${current} is new code rather than a settings change: Cloud Run's list does not show the container images, and the monitor did not see the published commit change.`, plan);
  }

  // A rollback brings back ALL of the older revision's settings, the inquiry
  // queue switch and the origins among them. So the engine goes back only to
  // a revision whose settings are the same as the serving one's, by the
  // fingerprint status.sh reports (image and APP_COMMIT left out). A missing
  // fingerprint is unknown, and unknown is a no.
  const settings = [currentEntry.settings, previousEntry.settings];
  if (!settings.every((value) => typeof value === "string" && value)) {
    return skip(basis, "settings-differ", `Cloud Run's answer does not give the settings fingerprint of both ${current} and ${previous}, so the engine cannot show that going back keeps today's settings (the inquiry queue switch among them).`, plan);
  }
  if (settings[0] !== settings[1]) {
    return skip(basis, "settings-differ", `${previous} has different settings from ${current}. Going back would also bring back its older settings (the inquiry queue switch, origins or limits), which a person may have changed on purpose.`, plan);
  }

  const quietFrom = createdAt - LIMITS.quietHoursBeforeDeploy * HOUR;
  const earlier = [...(incidents.open ?? []), ...(incidents.recent ?? [])].find((other) => {
    if (!other || !ROLLBACK_TRIGGERS.includes(other.component) || !SERIOUS.includes(other.severity)) return false;
    if (!(time(other.opened_at) < createdAt)) return false;
    return other.resolved_at === undefined || other.resolved_at === null || time(other.resolved_at) > quietFrom;
  });
  if (earlier) {
    return skip(basis, "unstable-before-deploy", `There was already a ${partName(earlier.component)} incident (opened ${earlier.opened_at}) in the ${LIMITS.quietHoursBeforeDeploy} hours before ${current} was created. The trouble started before this revision.`, plan);
  }

  if (log.some((line) => (line.decision === "acted" || line.decision === "failed") && line.to_revision === previous)) {
    return skip(basis, "same-target", `The engine has already tried to roll back to ${previous} once. It never goes to the same revision twice; a person must look.`, plan);
  }

  // Never act on the first sighting. The engine writes down the plan and
  // acts on a later run only if the picture is the same and the checks have
  // failed again since. That proves the failures happened while this
  // revision was already serving, and gives a blip one more chance to clear.
  const verifyChecks = failing.map((check) => check.id);
  const mine = log.filter((line) => sameIncident(line, basis));
  const sighting = mine.at(-1);
  const seenBefore = sighting && ["pending-confirmation", "would-roll-back"].includes(sighting.code)
    && sighting.from_revision === current && sighting.to_revision === previous;
  const failedSince = seenBefore && failing.every((check) => time(check.checked_at) > time(sighting.at));
  const why = `${partName(incident.component)} incident opened ${minutesBetween(openedAt, servingSince)} minutes after ${current} started serving; ${previous} was serving before it and is ready.`;
  if (!failedSince) {
    return skip(basis, "pending-confirmation", `Plan: move all API traffic from ${current} back to ${previous}. ${why} Waiting for one more failed run before deciding.`, { ...plan, verify_checks: verifyChecks });
  }
  return { ...basis, ...plan, decision: "proceed", code: "roll-back", reason: why, verify_checks: verifyChecks };
}

// Decide what to do about every open incident.
//
//   now       milliseconds
//   status    status.json (or null)
//   incidents incidents.json (or null)
//   deploys   lines of deploys.jsonl; deploysUnreadable when the file is damaged
//   log       lines of remediation-log.jsonl; logUnreadable when damaged
//   cloudrun  undefined (not asked yet), or { ok: true, data } / { ok: false, error }
//
// Returns { decisions, needsCloudRun }. When needsCloudRun is true the caller
// runs STATUS_COMMAND and calls plan() again with the answer. A decision is
// "skipped" (with a code and a reason) or "proceed" (every guardrail passed);
// the caller turns "proceed" into a dry run or an action, depending on the
// switch. An incident already acted on gets no decision: the caller verifies
// that action instead (verify()).
export function plan({ now, status = null, incidents = null, deploys = [], deploysUnreadable = false, log = [], logUnreadable = false, cloudrun, service = DEFAULT_SERVICE }) {
  const safeIncidents = incidents && typeof incidents === "object" ? incidents : {};
  const open = Array.isArray(safeIncidents.open) ? safeIncidents.open.filter((incident) => incident && typeof incident === "object") : [];
  const ctx = { now, status, incidents: safeIncidents, deploys, deploysUnreadable, log, logUnreadable, cloudrun, service };
  const decisions = [];
  let needsCloudRun = false;
  let chosen = null;

  const order = (incident) => {
    const index = ROLLBACK_TRIGGERS.indexOf(incident.component);
    return index === -1 ? ROLLBACK_TRIGGERS.length : index;
  };
  for (const incident of [...open].sort((a, b) => order(a) - order(b))) {
    const entry = CATALOGUE[incident.component] ?? UNKNOWN_PART;
    const basis = base(incident, entry);
    if (entry.action !== ROLLBACK) {
      decisions.push(skip(basis, "no-automatic-fix", `There is no automatic fix for ${partName(incident.component)}.`));
      continue;
    }
    if (log.some((line) => sameIncident(line, basis) && (line.decision === "acted" || line.decision === "failed"))) continue;

    const first = judgeFromFiles(incident, basis, ctx);
    if (first.decision) { decisions.push(first); continue; }
    if (cloudrun === undefined) { needsCloudRun = true; continue; }
    const second = judgeFromCloudRun(incident, basis, ctx, first);
    if (second.decision === "proceed" && chosen) {
      decisions.push(skip(basis, "covered-by-other", `The rollback considered for the ${partName(chosen.trigger)} incident covers this one too.`, { from_revision: second.from_revision, to_revision: second.to_revision }));
      continue;
    }
    if (second.decision === "proceed") chosen = second;
    decisions.push(second);
  }
  return { decisions, needsCloudRun };
}

// After a rollback, a later run checks whether it worked. `line` is the
// "acted" log line. Returns { verified: true | false | null, text }; null
// means "not known yet, look again next run".
export function verify({ line, status, now }) {
  const actedAt = time(line.at);
  const target = line.to_revision;
  const waited = now - actedAt;
  const gaveUp = waited > LIMITS.verifyGiveUpHours * HOUR;
  if (statusProblem(status, now)) {
    return gaveUp
      ? { verified: false, text: `The rollback to ${target} could not be verified: the monitor produced no fresh data for ${LIMITS.verifyGiveUpHours} hours. A person must check the API.` }
      : { verified: null, text: `The rollback to ${target} is not verified yet: no fresh monitoring data.` };
  }
  const since = (check) => check && time(check.checked_at) > actedAt;
  const identity = checksOf(status, "api").find((check) => since(check) && check.ok === true && typeof check.observed?.revision === "string" && check.observed.revision);
  if (identity && identity.observed.revision !== target) {
    return { verified: false, text: `After the rollback the API reports revision ${identity.observed.revision}, not ${target}. Traffic was moved again or the rollback did not take. A person must look.` };
  }
  const ids = Array.isArray(line.verify?.checks) ? line.verify.checks : [];
  const results = ids.map((id) => status.checks[id]);
  const rechecked = results.filter(since);
  if (ids.length > 0 && rechecked.length === ids.length && rechecked.every((check) => check.ok === true)) {
    return { verified: true, text: `Verified: the checks that were failing (${ids.join(", ")}) pass again after the rollback to ${target}${identity ? ", and the API reports that revision" : ""}. The newer revision ${line.from_revision} is still there and still broken: do not send traffic to it again without a fix.` };
  }
  const stillFailing = rechecked.filter((check) => check.ok === false).map((check) => check.name ?? "a check");
  if (waited > LIMITS.verifyMinutes * MINUTE && stillFailing.length > 0) {
    return { verified: false, text: `The rollback to ${target} did not fix it: ${stillFailing.join(", ")} still failing ${minutesBetween(now, actedAt)} minutes later. The engine will not try anything else. A person must take over (${line.runbook ?? "docs/sre/runbooks/api-down.md"}).` };
  }
  if (gaveUp) {
    return { verified: false, text: `The rollback to ${target} could not be verified within ${LIMITS.verifyGiveUpHours} hours. A person must check the API.` };
  }
  return { verified: null, text: `The rollback to ${target} is not verified yet: waiting for the failing checks to run again and pass (by ${iso(actedAt + LIMITS.verifyMinutes * MINUTE)}).` };
}

// The sentence an incident issue can quote.
export function summarize(decision) {
  const { decision: kind, from_revision: from, to_revision: to, reason, runbook } = decision;
  if (kind === "acted") {
    return `Automatic rollback done: all API traffic moved from ${from} back to ${to}. Why: ${reason} Nothing else was changed (no settings, secrets, permissions, DNS, scaling or data) and nothing was deleted. The next monitor runs verify it and record the result here. A person should still look at why ${from} failed: ${runbook}.`;
  }
  if (kind === "dry-run") {
    return `Dry run, nothing was changed. The engine would move all API traffic from ${from} back to ${to}. Why: ${reason} To do it by hand, follow ${runbook}. To let the engine do it, see docs/sre/auto-remediation.md.`;
  }
  if (kind === "failed") {
    return `Automatic rollback from ${from} to ${to} FAILED: ${reason} The engine will not retry. A person must take over now: ${runbook}.`;
  }
  if (decision.code === "pending-confirmation") return `No action yet. ${reason}`;
  return `No automatic action. ${reason} A person follows ${runbook}.`;
}

// Two decisions that say the same thing about the same incident are written
// to the log once, not every five minutes.
export function fingerprint(entry) {
  return [entry.incident_key, entry.incident_opened_at, entry.decision, entry.code, entry.from_revision, entry.to_revision].join("|");
}
