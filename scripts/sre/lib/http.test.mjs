import { test } from "node:test";
import assert from "node:assert/strict";
import { request, failureText, firstProblem, toCheck, notRun, expectStatus, expectType, expectHeader, expectBody, cloudflareRefused, jsonOrNull, DEFAULTS } from "./http.mjs";
import { USER_AGENT } from "../targets.mjs";

// A fetch that answers from a script, one entry per call, and remembers what
// it was asked. An Error in the script is thrown, as a network failure would be.
function scripted(...answers) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const next = answers.length > 1 ? answers.shift() : answers[0];
    if (next instanceof Error) throw next;
    return new Response(next.body ?? "", { status: next.status ?? 200, headers: next.headers ?? {} });
  };
  return { fetch, calls };
}

function context(fetch) {
  let clock = 0;
  const sleeps = [];
  return {
    ctx: { fetch, now: () => (clock += 10), sleep: async (ms) => { sleeps.push(ms); } },
    sleeps,
  };
}

const networkError = (code) => Object.assign(new TypeError("fetch failed"), { cause: { code } });
const timeout = () => new DOMException("The operation was aborted due to timeout", "TimeoutError");

test("one request: the monitor's name, no redirects followed, a time limit, the body read", async () => {
  const { fetch, calls } = scripted({ status: 200, body: "<h1>hi</h1>", headers: { "content-type": "text/html" } });
  const { ctx } = context(fetch);
  const result = await request(ctx, "https://example.test/page");
  assert.equal(result.answered, true);
  assert.equal(result.status, 200);
  assert.equal(result.body, "<h1>hi</h1>");
  assert.equal(result.attempts, 1);
  assert.equal(result.latency_ms, 10);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(calls[0].init.headers["User-Agent"], USER_AGENT);
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test("a server error is tried again after a short wait, and only the answering attempt is timed", async () => {
  const { fetch, calls } = scripted({ status: 503 }, { status: 200, body: "ok" });
  const { ctx, sleeps } = context(fetch);
  const result = await request(ctx, "https://example.test/");
  assert.equal(calls.length, 2);
  assert.equal(result.status, 200);
  assert.equal(result.attempts, 2);
  assert.equal(result.latency_ms, 10);
  assert.deepEqual(sleeps, [DEFAULTS.backoffMs[0]]);
});

test("a server error on every attempt stops after three attempts and reports the last answer", async () => {
  const { fetch, calls } = scripted({ status: 500 });
  const { ctx, sleeps } = context(fetch);
  const result = await request(ctx, "https://example.test/");
  assert.equal(calls.length, 3);
  assert.equal(result.answered, true);
  assert.equal(result.status, 500);
  assert.equal(result.attempts, 3);
  assert.deepEqual(sleeps, DEFAULTS.backoffMs);
});

test("a refusal (4xx) is an answer and is not tried again", async () => {
  const { fetch, calls } = scripted({ status: 404 });
  const { ctx } = context(fetch);
  const result = await request(ctx, "https://example.test/");
  assert.equal(calls.length, 1);
  assert.equal(result.status, 404);
});

test("no answer at all: three attempts, a plain reason, and the host gets one short attempt for the rest of the run", async () => {
  const { fetch, calls } = scripted(networkError("ECONNREFUSED"));
  const { ctx } = context(fetch);
  const first = await request(ctx, "https://down.test/a");
  assert.equal(first.answered, false);
  assert.equal(first.status, null);
  assert.equal(first.latency_ms, null);
  assert.equal(first.attempts, 3);
  assert.equal(first.error, "the connection was refused");
  const second = await request(ctx, "https://down.test/b");
  assert.equal(second.attempts, 1);
  assert.equal(calls.length, 4);
  // Another host is not affected.
  await request(ctx, "https://other.test/");
  assert.equal(calls.length, 7);
});

test("a timeout is reported in seconds", async () => {
  const { fetch } = scripted(timeout());
  const { ctx } = context(fetch);
  const result = await request(ctx, "https://slow.test/", { timeoutMs: 4000, retries: 0 });
  assert.equal(result.error, "timed out after 4 s");
});

test("requests after the first wait a moment, so the site sees one visitor at a human pace", async () => {
  const { fetch } = scripted({ status: 200 });
  const { ctx, sleeps } = context(fetch);
  await request(ctx, "https://example.test/1");
  assert.deepEqual(sleeps, []);
  await request(ctx, "https://example.test/2");
  assert.deepEqual(sleeps, [DEFAULTS.gapMs]);
});

test("read none does not download the body; a long body is cut off", async () => {
  const { fetch } = scripted({ status: 200, body: "x".repeat(5000) });
  const { ctx } = context(fetch);
  const headersOnly = await request(ctx, "https://example.test/", { read: "none" });
  assert.equal(headersOnly.body, "");
  const cut = await request(ctx, "https://example.test/", { maxBodyBytes: 1000 });
  assert.equal(cut.truncated, true);
  assert.equal(cut.body.length, 1000);
});

test("a reason never repeats an address or anything the far side sent", () => {
  assert.equal(failureText(networkError("ENOTFOUND"), 10_000), "the name could not be looked up (ENOTFOUND)");
  assert.equal(failureText(networkError("ECONNRESET"), 10_000), "the connection was cut");
  assert.equal(failureText(networkError("CERT_HAS_EXPIRED"), 10_000), "the certificate was not accepted (CERT_HAS_EXPIRED)");
  assert.equal(failureText(new Error("https://secret.test/?token=abc went wrong"), 10_000), "the connection failed");
  assert.equal(failureText({ cause: { code: "https://x.test/?a=b" } }, 10_000), "the connection failed");
});

test("expectations name statuses, types and headers in plain words", () => {
  const result = { answered: true, status: 200, headers: new Headers({ "content-type": "text/plain" }), body: "hello" };
  assert.equal(expectStatus(200)(result), "");
  assert.equal(expectStatus(301, 308)(result), "Answered 200, expected 301 or 308.");
  assert.equal(expectType("text/html")(result), 'Content type is "text/plain", expected text/html.');
  assert.equal(expectHeader("x-frame-options", (v) => v === "DENY", "expected DENY")(result), "Header x-frame-options is missing: expected DENY.");
  assert.equal(expectBody("hello", "missing")(result), "");
  assert.equal(expectBody((b) => b.includes("bye"), "no bye")(result), "no bye");
  assert.equal(firstProblem(result, [expectStatus(200), expectType("text/html"), expectStatus(404)]), 'Content type is "text/plain", expected text/html.');
  assert.equal(firstProblem({ answered: false, error: "timed out after 10 s" }, [expectStatus(200)]), "No answer: timed out after 10 s.");
});

test("Cloudflare's own refusal is named, a 403 from our code is not", () => {
  const cloudflare = { answered: true, status: 403, headers: new Headers({ server: "cloudflare", "cf-ray": "abc-ATL" }), body: "" };
  const ours = { answered: true, status: 403, headers: new Headers({ server: "Google Frontend" }), body: "" };
  assert.equal(cloudflareRefused(cloudflare), true);
  assert.equal(cloudflareRefused(ours), false);
  assert.match(firstProblem(cloudflare, [expectStatus(200)]), /^Cloudflare refused the request \(403\): a Cloudflare security setting/);
  const page = '<title>Access denied | diamondecho.com used Cloudflare to restrict access</title><span data-translate="error">Error</span> <span>1010</span> Your IP: 203.0.113.9';
  const detail = firstProblem({ ...cloudflare, body: page }, [expectStatus(200)]);
  assert.match(detail, /\(403, error 1010: the browser signature check, usually Browser Integrity Check\)/);
  assert.doesNotMatch(detail, /203\.0\.113/);
  assert.equal(firstProblem(ours, [expectStatus(200)]), "Answered 403, expected 200.");
});

test("a result becomes a contract check; a pass that needed a retry says so", () => {
  const base = { id: "public-home", name: "Home page", component: "public-site", severity: "sev1", slis: ["public-availability"] };
  const passed = toCheck(base, { status: 200, latency_ms: 12.4, attempts: 2 });
  assert.equal(passed.ok, true);
  assert.equal(passed.latency_ms, 12);
  assert.equal(passed.detail, "Answered on attempt 2.");
  const failed = toCheck(base, { status: 500, latency_ms: 30, attempts: 3 }, "Answered 500, expected 200.", {});
  assert.equal(failed.ok, false);
  assert.equal(failed.detail, "Answered 500, expected 200.");
  const skipped = notRun(base, "The home page did not load.");
  assert.equal(skipped.ok, false);
  assert.equal(skipped.status, null);
});

test("jsonOrNull never throws", () => {
  assert.deepEqual(jsonOrNull('{"a":1}'), { a: 1 });
  assert.equal(jsonOrNull("<html>"), null);
});
