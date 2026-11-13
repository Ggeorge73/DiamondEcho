// One careful request to the live site, and the small helpers a check uses to
// read the answer. Every check module that speaks HTTP goes through request():
// it sets a time limit, tries again after a short wait when nothing useful
// came back, and reports how long the answering attempt took. It never prints
// or returns anything to a log: a body is handed to the caller to be matched
// and is then dropped.
import { makeCheck } from "./schema.mjs";
import { USER_AGENT } from "../targets.mjs";

export const DEFAULTS = Object.freeze({
  timeoutMs: 10_000,          // one attempt; a cold Cloud Run start fits in this
  retries: 2,                 // so at most three attempts
  backoffMs: Object.freeze([500, 1500]),
  maxBodyBytes: 512 * 1024,   // enough for any page; the rest is not downloaded
  gapMs: 100,                 // pause before each request after the first: human pace
  quietTimeoutMs: 5_000,      // see "quiet origins" below
});

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Quiet origins. If a host gives no answer at all (not even an error page)
// after every attempt, the other checks on that host in the same run get one
// shorter attempt each. They are still real attempts, so the result stays
// true, but a host that swallows connections cannot make one run outlast the
// five minutes until the next.
const runMemory = new WeakMap();
const memoryFor = (ctx) => {
  if (!runMemory.has(ctx)) runMemory.set(ctx, { quiet: new Set(), requests: 0 });
  return runMemory.get(ctx);
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

// request(ctx, url, options) -> {
//   answered  true when an HTTP answer came back, whatever its status
//   status    the HTTP status, or null
//   headers   a Headers object (empty when nothing answered)
//   body      the text, "" when read is "none" or nothing answered
//   truncated true when the body was longer than maxBodyBytes
//   latency_ms  the answering attempt alone: from sending it to the last byte
//               read (to the headers when read is "none"); null when nothing
//               answered
//   attempts  how many attempts were made
//   error     why nothing answered, "" otherwise
// }
// options: method, headers, body, read ("text" | "none"), timeoutMs, retries,
// retryStatus (which answers count as "try again": 500 and up by default).
export async function request(ctx, url, options = {}) {
  const {
    method = "GET", headers = {}, body, read = "text",
    timeoutMs = DEFAULTS.timeoutMs, retries = DEFAULTS.retries,
    retryStatus = (status) => status >= 500, maxBodyBytes = DEFAULTS.maxBodyBytes,
  } = options;
  const sleep = ctx.sleep || realSleep;
  const now = ctx.now || Date.now;
  const memory = memoryFor(ctx);
  const origin = new URL(url).origin;
  const quiet = memory.quiet.has(origin);
  const limit = quiet ? Math.min(timeoutMs, DEFAULTS.quietTimeoutMs) : timeoutMs;
  const maxAttempts = quiet ? 1 : retries + 1;

  if (memory.requests > 0) await sleep(DEFAULTS.gapMs);
  memory.requests += 1;

  let last = { answered: false, status: null, headers: new Headers(), body: "", truncated: false, latency_ms: null, attempts: 0, error: "" };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) await sleep(DEFAULTS.backoffMs[Math.min(attempt - 2, DEFAULTS.backoffMs.length - 1)]);
    const sent = now();
    try {
      const response = await ctx.fetch(url, {
        method, body, redirect: "manual", signal: AbortSignal.timeout(limit),
        headers: { "User-Agent": USER_AGENT, Accept: "*/*", ...headers },
      });
      let text = "";
      let truncated = false;
      if (read === "none") await response.body?.cancel().catch(() => {});
      else ({ text, truncated } = await readBody(response, maxBodyBytes));
      last = { answered: true, status: response.status, headers: response.headers, body: text, truncated, latency_ms: Math.max(0, now() - sent), attempts: attempt, error: "" };
      if (!retryStatus(response.status)) return last;
    } catch (error) {
      last = { answered: false, status: null, headers: new Headers(), body: "", truncated: false, latency_ms: null, attempts: attempt, error: failureText(error, limit) };
    }
  }
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

// Cloudflare's own "Access denied" page, as opposed to a 403 from our code.
// Seen on 2026-11-13: Cloudflare refused the monitor's plain User-Agent with
// error 1010 (the browser signature check) while answering browsers. Naming
// it saves a wrong diagnosis. Only the four-digit error number is read from
// the page: it also prints the requester's address, which is never copied.
export function cloudflareRefused(result) {
  return result.status === 403 && /cloudflare/i.test(result.headers.get("server") || "") && result.headers.has("cf-ray");
}

const CLOUDFLARE_CODE = [/<span data-translate="error">Error<\/span>\s*<span>(\d{4})<\/span>/, /errorCode:\s*(\d{4})\b/];

function cloudflareRefusalText(result) {
  const code = CLOUDFLARE_CODE.map((pattern) => pattern.exec(result.body || "")?.[1]).find(Boolean);
  const which = code === "1010" ? ", error 1010: the browser signature check, usually Browser Integrity Check"
    : code ? `, error ${code}` : "";
  return `Cloudflare refused the request (403${which}): a Cloudflare security setting is blocking the monitor, and perhaps visitors too.`;
}

// The first thing wrong with a result, or "" when every expectation holds.
export function firstProblem(result, expectations) {
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
// that needs retries is worth a look even while it is up.
export function toCheck(base, result, problem = "", observed = {}) {
  const retried = !problem && result.attempts > 1 ? `Answered on attempt ${result.attempts}.` : "";
  return makeCheck({
    ...base, ok: !problem, status: result.status, latency_ms: result.latency_ms,
    attempts: Math.max(1, result.attempts), detail: problem || retried, observed,
  });
}

// For a check that could not be made because an earlier one gave it nothing to
// work with (the home page did not load, so its script is unknown).
export function notRun(base, reason) {
  return makeCheck({ ...base, ok: false, status: null, latency_ms: null, attempts: 1, detail: reason });
}

// Parse JSON without throwing; null when it is not JSON.
export function jsonOrNull(text) {
  try { return JSON.parse(text); } catch { return null; }
}
