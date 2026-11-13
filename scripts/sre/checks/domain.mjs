// Domain registration checks: when does diamondecho.com expire, is it locked
// against being moved to another registrar, and does the .com registry still
// point it at the nameservers on record. A lapsed domain takes the site, the
// staff site and all mail down at once, and the reminders go to a mailbox on
// the domain itself.
//
// The facts come from the .com registry (Verisign) over RDAP, the JSON
// successor to WHOIS: one public GET, no account. The registry's expiry date
// is not the whole story: see docs/sre/runbooks/domain-expiry.md.
import { makeCheck } from "../lib/schema.mjs";
import { USER_AGENT } from "../targets.mjs";
import { loadExpectedRecords, validateExpected } from "./dns.mjs";
import { wallClock } from "./tls.mjs";

export const suites = ["slow"];

// Verisign runs the registry for .com only, which is the only name we own.
const RDAP_BASE = "https://rdap.verisign.com/com/v1/domain/";
const LOOKUP_TIMEOUT_MS = 10_000;
const DAY_MS = 86_400_000;

// Days left below which the expiry check fails, most urgent first. 60 days
// leaves time for a failed card or a missed email to be noticed and fixed.
export const EXPIRY_LEVELS = [
  { under: 7, severity: "sev1" },
  { under: 30, severity: "sev2" },
  { under: 60, severity: "sev3" },
];

// Registry statuses that mean the name has stopped working or is on its way
// to being deleted.
const STOPPED = ["client hold", "server hold", "redemption period", "pending delete"];
const LOCKS = ["transfer", "delete", "update"];

// The default transport: the registry's record for the domain, as parsed JSON.
export async function rdapLookup({ domain, fetch, timeoutMs = LOOKUP_TIMEOUT_MS }) {
  if (!/^[a-z0-9-]+\.com$/.test(domain)) throw new Error(`domain.mjs can only look up .com names, not ${domain}`);
  const response = await fetch(`${RDAP_BASE}${domain}`, {
    headers: { accept: "application/rdap+json", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  // 404 from the registry itself means it holds no such name: not a network
  // problem, the worst answer there is. It is marked so run() can tell.
  if (response.status === 404) throw Object.assign(new Error("HTTP 404"), { code: "NOT_REGISTERED" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// The few facts the checks need from a registry record.
export function readRecord(record) {
  const events = Array.isArray(record?.events) ? record.events : [];
  const expiry = events.find((event) => event?.eventAction === "expiration")?.eventDate;
  const expiresMs = Date.parse(expiry);
  return {
    expiresMs: Number.isNaN(expiresMs) ? null : expiresMs,
    statuses: (Array.isArray(record?.status) ? record.status : []).map((status) => String(status).toLowerCase()),
    registrar: registrarName(record),
    nameservers: (Array.isArray(record?.nameservers) ? record.nameservers : []).map((entry) => String(entry?.ldhName ?? "").toLowerCase().replace(/\.$/, "")).filter(Boolean).sort(),
  };
}

// The registrar's name from the entity with the "registrar" role (a vCard).
function registrarName(record) {
  const entity = (Array.isArray(record?.entities) ? record.entities : []).find((entry) => Array.isArray(entry?.roles) && entry.roles.includes("registrar"));
  const card = Array.isArray(entity?.vcardArray?.[1]) ? entity.vcardArray[1] : [];
  const name = card.find((field) => Array.isArray(field) && field[0] === "fn")?.[3];
  return typeof name === "string" && name ? name.slice(0, 100) : null;
}

export function expiryVerdict({ expiresMs, statuses, nowMs }) {
  const date = new Date(expiresMs).toISOString().slice(0, 10);
  const stopped = STOPPED.filter((status) => statuses.includes(status));
  if (stopped.length) return { ok: false, severity: "sev1", detail: `The registry marks the domain "${stopped.join('", "')}": the name has stopped working or is about to be deleted. Registry expiry date ${date}.` };
  const daysLeft = (expiresMs - nowMs) / DAY_MS;
  if (daysLeft <= 0) return { ok: false, severity: "sev1", detail: `The registration expired on ${date}. Renew it at GoDaddy now.` };
  const whole = Math.floor(daysLeft);
  const left = daysLeft < 1 ? "less than a day" : `${whole} day${whole === 1 ? "" : "s"}`;
  const level = EXPIRY_LEVELS.find((entry) => daysLeft < entry.under);
  if (level) return { ok: false, severity: level.severity, detail: `The registration expires on ${date}, in ${left}. Renew it at GoDaddy.` };
  // The registry renews a .com name by itself on the expiry day and gives the
  // registrar 45 days to take it back if the owner has not paid.
  const grace = statuses.includes("auto renew period") ? " The registry shows a renewal in the last 45 days: confirm at GoDaddy that it was paid for." : "";
  return { ok: true, severity: "sev3", detail: `Registered until ${date} (${left} left).${grace}` };
}

// The locks, and the two signs that someone is moving the name away: a
// transfer under way, or a registrar other than the one on record.
export function lockVerdict({ statuses, registrar = null, expectedRegistrar = null }) {
  const on = LOCKS.filter((lock) => statuses.includes(`client ${lock} prohibited`) || statuses.includes(`server ${lock} prohibited`));
  const off = LOCKS.filter((lock) => !on.includes(lock));
  const observed = { locks: on.join(", ") || "none" };
  if (registrar) observed.registrar = registrar;
  if (statuses.includes("pending transfer")) return { ok: false, severity: "sev2", observed, detail: "The registry shows a transfer to another registrar under way. If Gbenga did not start it, refuse it at GoDaddy now: it is how a domain is stolen." };
  if (expectedRegistrar && registrar && registrar.toLowerCase() !== expectedRegistrar.toLowerCase()) return { ok: false, severity: "sev2", observed, detail: `The registry lists the registrar as ${registrar}, not ${expectedRegistrar}. If nobody moved the domain on purpose, treat it as a takeover.` };
  if (!on.includes("transfer")) return { ok: false, severity: "sev3", observed, detail: `The transfer lock is off: the domain could be moved to another registrar. Locks on: ${observed.locks}. Switch "Domain lock" on at GoDaddy unless a transfer is under way.` };
  return { ok: true, severity: "sev3", observed, detail: off.length ? `Transfer lock is on. Not set: ${off.join(", ")} lock.` : "Transfer, delete and update locks are on." };
}

export function delegationVerdict({ nameservers, expected }) {
  const want = expected.map((name) => name.toLowerCase().replace(/\.$/, "")).sort();
  const observed = nameservers.length ? { nameservers: nameservers.join(", ").slice(0, 100) } : {};
  if (nameservers.join() === want.join()) return { ok: true, observed, detail: "" };
  return { ok: false, observed, detail: `The registry points the domain at ${nameservers.join(", ") || "no nameservers"}; on record are ${want.join(", ")}. If nobody changed this on purpose, treat it as a takeover of the domain. If it was meant, update deploy/dns/expected-records.json.` };
}

export async function run(ctx) {
  const lookup = ctx.rdapLookup ?? ((question) => rdapLookup({ ...question, fetch: ctx.fetch }));
  const expected = ctx.expectedRecords ? validateExpected(ctx.expectedRecords) : loadExpectedRecords();
  const domain = ctx.targets.domain;
  const started = ctx.now();
  let facts = null;
  let reason = "";
  let notRegistered = false;
  let attempts = 0;
  while (attempts < 2 && !facts) {
    attempts += 1;
    try {
      facts = readRecord(await lookup({ domain }));
      notRegistered = false;
      if (facts.expiresMs === null) { reason = "the record has no expiry date"; facts = null; }
    } catch (error) {
      notRegistered = error?.code === "NOT_REGISTERED";
      reason = error?.name === "TimeoutError" || error?.name === "AbortError" ? "timed out" : shortCode(error);
    }
  }
  const base = { component: "domain", latency_ms: Math.max(0, ctx.now() - started), attempts, slis: [] };
  const names = {
    "domain-expiry": `Registration of ${domain}`,
    "domain-registrar-lock": "Registrar lock",
    "domain-delegation": "Registry points at the nameservers on record",
  };
  if (!facts) {
    // Not knowing is an early warning, never proof that the domain is at risk.
    // The one exception: the registry answered, twice, that it has no such
    // name. Then the registration has lapsed past every grace period, or was
    // deleted, and the site and mail will stop as soon as caches run out.
    const detail = `Could not read the registry's record for ${domain} (${reason}), so this was not checked.`;
    return Object.entries(names).map(([id, name]) => {
      if (id === "domain-expiry" && notRegistered) {
        return makeCheck({ ...base, id, name, ok: false, severity: "sev1", status: 404, detail: `The .com registry answered twice that it has no record of ${domain}: the registration may have lapsed or been deleted. Check the domain at GoDaddy now (docs/sre/runbooks/domain-expiry.md).` });
      }
      return makeCheck({ ...base, id, name, ok: false, severity: "sev3", detail });
    });
  }
  const expiry = expiryVerdict({ ...facts, nowMs: wallClock(ctx) });
  const lock = lockVerdict({ ...facts, expectedRegistrar: expected.registrar ?? null });
  const delegation = delegationVerdict({ nameservers: facts.nameservers, expected: expected.nameservers });
  return [
    makeCheck({ ...base, id: "domain-expiry", name: names["domain-expiry"], ok: expiry.ok, severity: expiry.severity, detail: expiry.detail, observed: { expires: new Date(facts.expiresMs).toISOString().slice(0, 10) } }),
    makeCheck({ ...base, id: "domain-registrar-lock", name: names["domain-registrar-lock"], ok: lock.ok, severity: lock.severity, detail: lock.detail, observed: lock.observed }),
    makeCheck({ ...base, id: "domain-delegation", name: names["domain-delegation"], ok: delegation.ok, severity: "sev2", detail: delegation.detail, observed: delegation.observed }),
  ];
}

// A short, safe reason: an error code or "HTTP 503", never a free-text message.
function shortCode(error) {
  const code = String(error?.cause?.code ?? error?.code ?? "");
  if (/^[A-Z][A-Z0-9_]{1,59}$/.test(code)) return code;
  const http = /^HTTP \d{3}$/.exec(String(error?.message ?? ""));
  return http ? http[0] : "no answer";
}
