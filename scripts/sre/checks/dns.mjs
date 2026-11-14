// DNS checks: does the world still find the site, and does mail still have
// the records it depends on? Mail for realtor@diamondecho.com lives on the same
// zone as the site, so one careless DNS edit can stop mail without the site
// noticing. The records on record are in deploy/dns/expected-records.json.
//
// Every question is put to two public resolvers over HTTPS (DNS over HTTPS,
// "DoH": an ordinary GET that returns JSON). A record counts as wrong only
// when both resolvers say so. One resolver being unreachable, or the two
// disagreeing for a few minutes after a change, is not a fault of the site and
// is reported in the detail instead.
import { readFileSync } from "node:fs";
import { makeCheck } from "../lib/schema.mjs";
import { USER_AGENT } from "../targets.mjs";

export const suites = ["slow"];

export const RESOLVERS = [
  { id: "cloudflare", name: "Cloudflare DNS", url: "https://cloudflare-dns.com/dns-query" },
  { id: "google", name: "Google DNS", url: "https://dns.google/resolve" },
];

const TYPE_NUMBERS = { A: 1, NS: 2, CNAME: 5, MX: 15, TXT: 16, AAAA: 28, SRV: 33, DS: 43, CAA: 257 };
const SERVFAIL = 2;
const NXDOMAIN = 3;
const QUERY_TIMEOUT_MS = 8000;
const EXPECTED_FILE = new URL("../../../deploy/dns/expected-records.json", import.meta.url);
const EXPECTED_PATH = "deploy/dns/expected-records.json";

// Which check a record in the expected file belongs to, and how bad it is if
// both resolvers agree the record is wrong.
const GROUPS = {
  "mail-mx": { id: "dns-mail-mx", name: "Mail delivery records (MX)", severity: "sev2" },
  "mail-spf": { id: "dns-mail-spf", name: "Mail sender record (SPF)", severity: "sev2" },
  "mail-microsoft-365": { id: "dns-mail-microsoft-365", name: "Microsoft 365 mail records", severity: "sev3" },
  "mail-dmarc": { id: "dns-mail-dmarc", name: "Mail policy record (DMARC)", severity: "sev3" },
  other: { id: "dns-other-records", name: "Other records carried from GoDaddy", severity: "sev4" },
};
const MATCHES = ["exact", "includes", "starts-with", "single-spf"];

// The default transport: one DoH question to one resolver. Returns the DNS
// response code and the answers of the type that was asked for. Throws when
// the resolver cannot be reached or does not answer in DNS JSON.
export async function dohQuery({ resolver, name, type, fetch, timeoutMs = QUERY_TIMEOUT_MS }) {
  const number = TYPE_NUMBERS[type];
  if (!number) throw new Error(`dns.mjs does not know record type ${type}`);
  const url = `${resolver.url}?name=${encodeURIComponent(name)}&type=${type}`;
  const response = await fetch(url, {
    headers: { accept: "application/dns-json", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  if (!body || !Number.isInteger(body.Status)) throw new Error("not a DNS answer");
  const answers = Array.isArray(body.Answer) ? body.Answer : [];
  return { rcode: body.Status, answers: answers.filter((answer) => answer.type === number).map((answer) => String(answer.data)) };
}

// The two resolvers spell the same answer differently (a trailing dot, quotes
// round TXT text, upper or lower case). Bring both to one spelling.
export function normalize(type, value) {
  let text = String(value).trim();
  if (type === "TXT") {
    // A long TXT record arrives as several quoted pieces: "part one" "part two".
    return text.startsWith('"') ? text.replace(/"\s+"/g, "").replace(/^"|"$/g, "") : text;
  }
  text = text.toLowerCase().replace(/\s+/g, " ");
  return text.endsWith(".") ? text.slice(0, -1) : text;
}

export function loadExpectedRecords(file = EXPECTED_FILE) {
  return validateExpected(JSON.parse(readFileSync(file, "utf8")));
}

// A mistake in the expected file is a bug in the repository, not a DNS
// failure, so it throws instead of producing a failed check.
export function validateExpected(expected) {
  const problems = [];
  if (!expected || typeof expected !== "object") throw new Error(`${EXPECTED_PATH}: must be an object`);
  if (!Array.isArray(expected.nameservers) || expected.nameservers.length === 0) problems.push("nameservers must be a non-empty list");
  if (!Array.isArray(expected.records)) problems.push("records must be a list");
  if (expected.registrar !== undefined && (typeof expected.registrar !== "string" || !expected.registrar)) problems.push("registrar must be a name when given");
  for (const record of expected.records ?? []) {
    const label = `${record?.name} ${record?.type}`;
    if (typeof record?.name !== "string" || !record.name) problems.push(`${label}: name is required`);
    if (!Object.hasOwn(TYPE_NUMBERS, record?.type)) problems.push(`${label}: unknown type`);
    if (!MATCHES.includes(record?.match)) problems.push(`${label}: match must be one of ${MATCHES.join(", ")}`);
    if (!Object.hasOwn(GROUPS, record?.group)) problems.push(`${label}: unknown group ${record?.group}`);
    if (!Array.isArray(record?.values) || record.values.length === 0 || record.values.some((value) => typeof value !== "string" || !value)) problems.push(`${label}: values must be a non-empty list of strings`);
    if (record?.match === "single-spf" && (record.type !== "TXT" || record.values?.length !== 1)) problems.push(`${label}: single-spf needs one TXT value`);
  }
  if (problems.length) throw new Error(`${EXPECTED_PATH}: ${problems.join("; ")}`);
  return expected;
}

// Ask both resolvers the same question, once per run however many checks need
// the answer. An unreachable resolver is tried a second time before it is
// written off for this question.
export function createAsker(ctx) {
  const query = ctx.dohQuery ?? ((question) => dohQuery({ ...question, fetch: ctx.fetch }));
  const asked = new Map();
  async function askOne(resolver, name, type) {
    let reason = "";
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const { rcode, answers } = await query({ resolver, name, type });
        return { resolver, reachable: true, rcode, values: answers.map((answer) => normalize(type, answer)), attempts: attempt };
      } catch (error) {
        reason = shortReason(error);
      }
    }
    return { resolver, reachable: false, reason, attempts: 2 };
  }
  return function ask(name, type) {
    const key = `${type} ${name}`;
    if (!asked.has(key)) asked.set(key, Promise.all(RESOLVERS.map((resolver) => askOne(resolver, name, type))));
    return asked.get(key);
  };
}

// Why a resolver gave nothing usable, in words safe to publish: an error
// code, an HTTP status or one of our own phrases, never a free-text message.
function shortReason(error) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "timed out";
  const code = String(error?.cause?.code ?? error?.code ?? "");
  if (/^[A-Z][A-Z0-9_]{1,59}$/.test(code)) return code;
  const message = String(error?.message ?? "");
  if (/^HTTP \d{3}$/.test(message) || message === "not a DNS answer") return message;
  return "no usable answer";
}

// What is wrong with one resolver's answer, as a short phrase, or null when
// the answer is what is on record.
export function findProblem(expectation, answer) {
  if (answer.rcode === SERVFAIL) return "the resolver could not get an answer (SERVFAIL)";
  if (answer.rcode !== 0 && answer.rcode !== NXDOMAIN) return `the resolver answered with DNS error code ${answer.rcode}`;
  const seen = answer.values;
  const none = answer.rcode === NXDOMAIN ? "the name does not exist" : "no record";
  const want = (expectation.values ?? []).map((value) => normalize(expectation.type, value));
  if (expectation.match === "resolves") return seen.length > 0 ? null : none;
  if (expectation.match === "exact") {
    if (seen.length === 0) return none;
    const extra = seen.filter((value) => !want.includes(value));
    const missing = want.filter((value) => !seen.includes(value));
    if (!extra.length && !missing.length) return null;
    return [missing.length ? `missing ${missing.join(", ")}` : "", extra.length ? `unexpected ${extra.join(", ")}` : ""].filter(Boolean).join("; ");
  }
  if (expectation.match === "includes") {
    const missing = want.filter((value) => !seen.includes(value));
    return missing.length ? `missing ${missing.join(", ")}` : null;
  }
  if (expectation.match === "starts-with") {
    return seen.some((value) => want.some((prefix) => value.startsWith(prefix))) ? null : seen.length ? `no record starting "${want[0]}"` : none;
  }
  if (expectation.match === "single-spf") {
    const spf = seen.filter((value) => value.toLowerCase().startsWith("v=spf1"));
    if (spf.length === 0) return "no SPF record";
    if (spf.length > 1) return `${spf.length} SPF records (mail servers treat more than one as an error)`;
    return spf[0] === want[0] ? null : "the SPF record is not the one on record";
  }
  throw new Error(`dns.mjs does not know match ${expectation.match}`);
}

// Turn the answers for one or more expectations into one check. Fails only
// when both resolvers agree a record is wrong, or when neither could be asked
// (then nothing is known, which must not read as healthy).
export async function judge({ ask, now, expectations, id, name, severity, hint = "", observe = null }) {
  const started = now();
  const confirmed = [];
  const unconfirmed = [];
  const blind = [];
  // A fault seen by one resolver while the other cannot be asked: not
  // confirmed, but not contradicted either. Passing it would hide a real
  // fault for as long as the second resolver stays out of reach.
  const halfBlind = [];
  const oneDown = new Set();
  let attempts = 1;
  let firstAnswers = null;
  for (const expectation of expectations) {
    const answers = await ask(expectation.name, expectation.type);
    firstAnswers ??= answers;
    attempts = Math.max(attempts, ...answers.map((answer) => answer.attempts));
    const label = `${expectation.type} ${expectation.name}`;
    const reachable = answers.filter((answer) => answer.reachable);
    const wrong = reachable.map((answer) => ({ answer, problem: findProblem(expectation, answer) })).filter((entry) => entry.problem);
    for (const answer of answers) if (!answer.reachable) oneDown.add(answer.resolver.name);
    if (reachable.length === 0) blind.push(label);
    else if (wrong.length === answers.length) confirmed.push(`${label}: ${wrong[0].problem}`);
    else if (wrong.length > 0) {
      const other = answers.find((answer) => answer !== wrong[0].answer);
      if (other.reachable) unconfirmed.push(`${wrong[0].answer.resolver.name} reports ${label}: ${wrong[0].problem}, but ${other.resolver.name} sees it as expected`);
      else halfBlind.push(`${wrong[0].answer.resolver.name} reports ${label}: ${wrong[0].problem}, and ${other.resolver.name} could not be reached to confirm it`);
    }
  }
  const ok = confirmed.length === 0 && blind.length === 0 && halfBlind.length === 0;
  const sentences = [];
  if (confirmed.length) sentences.push(`${confirmed.join(". ")}. Both resolvers agree.${hint ? ` ${hint}` : ""}`);
  if (halfBlind.length) sentences.push(`${halfBlind.join(". ")}. Counted as an early warning until both resolvers can be asked.${hint ? ` ${hint}` : ""}`);
  if (blind.length) sentences.push(`Neither resolver could be asked about ${blind.join(", ")}, so this was not checked.`);
  if (unconfirmed.length) sentences.push(`${unconfirmed.join(". ")}. Not confirmed by both resolvers, so not counted as a failure.`);
  if (ok && !unconfirmed.length && oneDown.size) sentences.push(`${[...oneDown].join(" and ")} could not be reached; the other resolver sees the records as expected. That is not a fault of the site.`);
  // Not being able to ask (fully or half) is an early warning at most, however
  // important the record: the site itself may be fine.
  const blindSeverity = severity === "sev4" ? "sev4" : "sev3";
  return makeCheck({
    id, name, component: "dns", ok,
    severity: confirmed.length || ok ? severity : blindSeverity,
    latency_ms: Math.max(0, now() - started),
    detail: sentences.join(" "),
    attempts,
    slis: [],
    observed: observe ? observe(firstAnswers) : {},
  });
}

export async function run(ctx) {
  const expected = ctx.expectedRecords ? validateExpected(ctx.expectedRecords) : loadExpectedRecords();
  const ask = createAsker(ctx);
  const now = ctx.now;
  const apex = ctx.targets.domain;
  const staff = new URL(ctx.targets.staffOrigin).hostname;
  const changeHint = `If the change was meant, update ${EXPECTED_PATH}.`;
  // Put every question to both resolvers at once. Asked one after another, a
  // resolver that hangs would cost two time limits per question and push the
  // module past the runner's 90 s limit (synthetic-checks.mjs). The answers
  // are kept by the asker, so the checks below wait for nothing new.
  const questions = [[apex, "A"], [staff, "A"], [apex, "NS"], ...expected.records.map((record) => [record.name, record.type])];
  for (const [name, type] of questions) ask(name, type);
  const checks = [
    await judge({
      ask, now, id: "dns-apex-resolves", name: "Website address resolves", severity: "sev1",
      expectations: [{ name: apex, type: "A", match: "resolves" }],
    }),
    await judge({
      ask, now, id: "dns-staff-resolves", name: "Staff site address resolves", severity: "sev2",
      expectations: [{ name: staff, type: "A", match: "resolves" }],
    }),
    await judge({
      ask, now, id: "dns-nameservers", name: "Nameservers are the two on record", severity: "sev2", hint: changeHint,
      expectations: [{ name: apex, type: "NS", match: "exact", values: expected.nameservers }],
      observe: (answers) => {
        const answer = answers.find((entry) => entry.reachable && entry.values.length);
        return answer ? { nameservers: [...answer.values].sort().join(", ").slice(0, 100) } : {};
      },
    }),
  ];
  for (const [group, { id, name, severity }] of Object.entries(GROUPS)) {
    const expectations = expected.records.filter((record) => record.group === group);
    if (expectations.length) checks.push(await judge({ ask, now, id, name, severity, hint: changeHint, expectations }));
  }
  return checks;
}
