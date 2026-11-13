// One careful request to the live site, and the small helpers a check uses to
// read the answer. Every check module that speaks HTTP goes through request():
// it sets a time limit, tries again after a short wait when nothing answered,
// keeps inside the module's deadline, and reports how long the whole request
// took. It never prints or returns anything to a log: a body is handed to the
// caller to be matched and is then dropped.
import { makeCheck } from "./schema.mjs";
import { USER_AGENT } from "../targets.mjs";

export const DEFAULTS = Object.freeze({
  timeoutMs: 10_000,          // one attempt; a cold Cloud Run start fits in this
  retries: 2,                 // so at most three attempts, only when nothing answered
  backoffMs: Object.freeze([500, 1500]),
  maxBodyBytes: 512 * 1024,   // enough for any page; the rest is not downloaded
  gapMs: 100,                 // pause before each request after the first: human pace
  quietTimeoutMs: 5_000,      // see "quiet origins" below
  minAttemptMs: 100,          // less time left than this before the deadline: not sent
});

export const NOT_TRIED = "not tried: the module's time ran out";
const CUT_SHORT = "the module's time ran out while waiting";

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Quiet origins. If a host gives no answer at all (not even an error page)
// after every attempt, the other checks on that host in the same run get one
// shorter attempt each. They are still real attempts, so the result stays
// true, but a host that swallows connections cannot make one run outlast the
// five minutes until the next. The memory lasts one run: the runner hands
// every module the same `ctx.memory` object (a ctx without one is its own).
const runMemory = new WeakMap();
const memoryFor = (ctx) => {
  const key = ctx.memory && typeof ctx.memory === "object" ? ctx.memory : ctx;
  if (!runMemory.has(key)) runMemory.set(key, { quiet: new Set(), requests: 0 });
  return runMemory.get(key);
};

// Why a request got no answer, in words that are safe to publish: never the
// address, never anything the far side sent.
export function failureText(error, timeoutMs) {
  const name = error?.name || "";
  const code = error?.cause?.code || error?.code || "";
  if (name === "TimeoutError" || name === "AbortError") return `timed out after ${Math.round(timeoutMs / 1000)} s`;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return `the name could not be looked up (${code})`;
  if (code === "ECONNREFUSED") return "the connection was refused";
  if (code === "ECONNRESET" || code === "UND_ERR_SOCKET") return "the connection was cut";
  if (/^(CERT_|ERR_TLS_|DEPTH_ZERO_|UNABLE_TO_|SELF_SIGNED_)/.test(code)) return `the certificate was not accepted (${code})`;
  if (/^[A-Z][A-Z0-9_]{2,40}$/.test(code)) return `the connection failed (${code})`;
  return "the connection failed";
}

const isTimeout = (error) => error?.name === "TimeoutError" || error?.name === "AbortError";

async function readBody(response, maxBytes) {
  if (!response.body) return { text: "", truncated: false };
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size >= maxBytes) {
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
  }
  // A chunk can be large; the cut is made at the limit, not after the chunk.
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return { text: (truncated ? bytes.subarray(0, maxBytes) : bytes).toString("utf8"), truncated };
}

const nothing = (attempts, error) => ({ answered: false, notTried: false, status: null, headers: new Headers(), body: "", truncated: false, latency_ms: null, attempts, error });

// request(ctx, url, options) -> {
//   answered  true when an HTTP answer came back, whatever its status
//   notTried  true when the module's deadline had passed before any attempt
//   status    the HTTP status, or null
//   headers   a Headers object (empty when nothing answered)
//   body      the text, "" when not read or nothing answered
//   truncated true when the body was longer than maxBodyBytes
//   latency_ms  wall time from sending the first attempt to the last byte read
//               of the answer (to its headers when the body is not read),
//               waits between attempts included; null when nothing answered
//   attempts  how many attempts were made
//   error     why nothing answered, "" otherwise
// }
// options: method, headers, body, read ("text" | "none"), readWhen (status ->
// read the body or not: a route that could leak data is read only for the
// answer that needs reading), timeoutMs, retries, retryStatus.
//
// Only "nothing answered" (a network error or a timeout) is tried again by
// default. A wrong answer, a 5xx included, is reported as it came: retrying it
// would hide errors visitors meet from the SLOs. `retryStatus` lets a check
// that feeds no SLO (an outside provider) try a 5xx again.
//
// ctx.deadline (milliseconds on ctx.now's clock) and ctx.signal come from the
// runner. Each attempt is shortened to the time left; once it has run out,
// nothing more is sent and the result says "not tried".
export async function request(ctx, url, options = {}) {
  const {
    method = "GET", headers = {}, body, read = "text", readWhen = () => true,
    timeoutMs = DEFAULTS.timeoutMs, retries = DEFAULTS.retries,
    retryStatus = () => false, maxBodyBytes = DEFAULTS.maxBodyBytes,
  } = options;
  const sleep = ctx.sleep || realSleep;
  const now = ctx.now || Date.now;
  const deadline = Number.isFinite(ctx.deadline) ? ctx.deadline : Infinity;
  const timeLeft = () => deadline - now();
  const notTried = () => ({ ...nothing(0, NOT_TRIED), notTried: true });
  const memory = memoryFor(ctx);
  const origin = new URL(url).origin;
  const quiet = memory.quiet.has(origin);
  const limit = quiet ? Math.min(timeoutMs, DEFAULTS.quietTimeoutMs) : timeoutMs;
  const maxAttempts = quiet ? 1 : retries + 1;

  // An attempt with only a few milliseconds left cannot get an answer; it
  // would only be a request sent after the module's time had in effect run out.
  const tooLate = () => timeLeft() < DEFAULTS.minAttemptMs || ctx.signal?.aborted;
  if (tooLate()) return notTried();
  if (memory.requests > 0) await sleep(Math.min(DEFAULTS.gapMs, Math.max(0, timeLeft())));
  memory.requests += 1;

  let first = null;
  let last = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      const wait = DEFAULTS.backoffMs[Math.min(attempt - 2, DEFAULTS.backoffMs.length - 1)];
      if (timeLeft() < wait + DEFAULTS.minAttemptMs) break;
      await sleep(wait);
    }
    if (tooLate()) break;
    const left = timeLeft();
    const cut = left < limit;
    const attemptLimit = Math.max(1, Math.min(limit, left));
    const signal = ctx.signal ? AbortSignal.any([AbortSignal.timeout(attemptLimit), ctx.signal]) : AbortSignal.timeout(attemptLimit);
    const sent = now();
    if (first === null) first = sent;
    try {
      const response = await ctx.fetch(url, {
        method, body, redirect: "manual", signal,
        headers: { "User-Agent": USER_AGENT, Accept: "*/*", ...headers },
      });
      let text = "";
      let truncated = false;
      if (read === "none" || !readWhen(response.status)) await response.body?.cancel().catch(() => {});
      else ({ text, truncated } = await readBody(response, maxBodyBytes));
      last = { answered: true, notTried: false, status: response.status, headers: response.headers, body: text, truncated, latency_ms: Math.max(0, now() - first), attempts: attempt, error: "" };
      if (!retryStatus(response.status)) return last;
    } catch (error) {
      const stopped = isTimeout(error) && (cut || ctx.signal?.aborted);
      last = nothing(attempt, stopped ? CUT_SHORT : failureText(error, attemptLimit));
    }
  }
  if (last === null) return notTried();
  if (!last.answered) memory.quiet.add(origin);
  return last;
}

// ---- Reading an answer -----------------------------------------------------
// A check is a list of expectations. Each one looks at the result and returns
// "" when it holds, or one short sentence saying what was found instead. The
// sentences are public (they reach the status page), so they name statuses
// and header names, never a body or a query string.

export const expectStatus = (...wanted) => (result) =>
  wanted.includes(result.status) ? "" : `Answered ${result.status}, expected ${wanted.join(" or ")}.`;

export const expectType = (...prefixes) => (result) => {
  const type = (result.headers.get("content-type") || "").toLowerCase();
  return prefixes.some((prefix) => type.startsWith(prefix)) ? "" : `Content type is "${type.slice(0, 60) || "missing"}", expected ${prefixes.join(" or ")}.`;
};

export const expectHeader = (name, test, wanted) => (result) => {
  const value = result.headers.get(name);
  return test(value || "") ? "" : `Header ${name} is ${value === null ? "missing" : "not as expected"}: ${wanted}.`;
};

export const expectBody = (test, missing) => (result) => {
  if (typeof test === "string") return result.body.includes(test) ? "" : missing;
  return test(result.body) ? "" : missing;
};

// Cloudflare's own refusal page, as opposed to a 403 from the site itself.
// Every Cloudflare Pages answer carries `server: cloudflare` and `cf-ray`, so
// the headers alone prove nothing: the page must say it is Cloudflare's block
// (the same signs checks/edge.mjs looks for). Seen on 2026-11-13: error 1010
// (the browser signature check) refused the monitor while browsers got in.
// Only the four-digit error number is read from the page: it also prints the
// requester's address, which is never copied.
const CLOUDFLARE_BLOCK_PAGE = /used Cloudflare to restrict access|id="cf-error-details"|<title>Attention Required! \| Cloudflare|<span data-translate="error">Error<\/span>|error code: 1\d{3}/i;
const CLOUDFLARE_CODE = [/<span data-translate="error">Error<\/span>\s*<span>(\d{4})<\/span>/, /errorCode:\s*(\d{4})\b/, /error code: (\d{4})\b/i];

export function cloudflareRefused(result) {
  return result.status === 403 && /cloudflare/i.test(result.headers.get("server") || "")
    && result.headers.has("cf-ray") && CLOUDFLARE_BLOCK_PAGE.test(result.body || "");
}

// The opening words are matched by the runbooks; keep them.
function cloudflareRefusalText(result) {
  const code = CLOUDFLARE_CODE.map((pattern) => pattern.exec(result.body || "")?.[1]).find(Boolean);
  const which = code === "1010" ? ", error 1010: the browser signature check" : code ? `, error ${code}` : "";
  return `Cloudflare refused the request (403${which}): a Cloudflare security setting is blocking the monitor, and perhaps visitors too. See docs/sre/runbooks/cloudflare-outage.md.`;
}

// The first thing wrong with a result, or "" when every expectation holds.
export function firstProblem(result, expectations) {
  if (result.notTried) return "Not tried: the module's time ran out.";
  if (!result.answered) return `No answer: ${result.error}.`;
  if (cloudflareRefused(result)) return cloudflareRefusalText(result);
  for (const expectation of expectations) {
    const problem = expectation(result);
    if (problem) return problem;
  }
  return "";
}

// A contract check from a result. `base` is { id, name, component, severity,
// slis }. A check that passed only on a later attempt says so, because a site
// that needs retries is worth a look even while it is up. A request that was
// never sent measured nothing, so it counts toward no SLO (slis: []); it is
// still a failed check under its own id and severity.
export function toCheck(base, result, problem = "", observed = {}) {
  const retried = !problem && result.attempts > 1 ? `Answered on attempt ${result.attempts}.` : "";
  return makeCheck({
    ...base, ok: !problem, status: result.status, latency_ms: result.latency_ms,
    attempts: Math.max(1, result.attempts), detail: problem || retried, observed,
    slis: result.notTried ? [] : base.slis,
  });
}

// For a check that could not be made because an earlier one gave it nothing to
// work with (the home page did not load, so its script is unknown). Nothing
// was measured, so it counts toward no SLO.
export function notRun(base, reason) {
  return makeCheck({ ...base, ok: false, status: null, latency_ms: null, attempts: 1, detail: reason, slis: [] });
}

// Parse JSON without throwing; null when it is not JSON.
export function jsonOrNull(text) {
  try { return JSON.parse(text); } catch { return null; }
}
