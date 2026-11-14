// Tests for tls.mjs. No test opens a socket: the TLS transport is replaced by
// a fake that returns what a server would present, or throws Node's error.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRun } from "../lib/schema.mjs";
import { TARGETS } from "../targets.mjs";
import { run, suites, coversHost, certificateProblems, classifyError, hostsFor, wallClock, EXPIRY_LEVELS } from "./tls.mjs";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-13T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

// What a healthy host presents: valid since a month ago, 80 days left.
const goodInfo = (host, over = {}) => ({
  protocol: "TLSv1.3", validFrom: iso(NOW - 30 * DAY), validTo: iso(NOW + 80 * DAY),
  altNames: [host], commonName: host, issuer: "Google Trust Services", ...over,
});

function ctxWith(connect, over = {}) {
  const calls = [];
  return {
    calls,
    ctx: {
      fetch: () => { throw new Error("tls.mjs must not use fetch"); },
      now: () => NOW, targets: TARGETS.production, env: {},
      tlsConnect: async (options) => { calls.push(options); return connect(options); },
      ...over,
    },
  };
}

const errorWith = (code) => Object.assign(new Error(`fake ${code}`), { code });

test("runs hourly only", () => {
  assert.deepEqual(suites, ["slow"]);
});

test("the four hosts come from targets.mjs", () => {
  assert.deepEqual(hostsFor(TARGETS.production).map((entry) => entry.host), [
    "diamondecho.com", "www.diamondecho.com", "staff.diamondecho.com", "diamondecho-api-180189726732.us-east1.run.app",
  ]);
});

test("four healthy hosts give four passing checks that make a valid run", async () => {
  const { ctx, calls } = ctxWith(({ host }) => goodInfo(host));
  const checks = await run(ctx);
  assert.deepEqual(checks.map((check) => check.id), ["tls-public", "tls-www", "tls-staff", "tls-api"]);
  for (const check of checks) {
    assert.equal(check.ok, true, check.detail);
    assert.equal(check.component, "tls");
    assert.deepEqual(check.slis, []);
    assert.equal(check.observed.expires, iso(NOW + 80 * DAY).slice(0, 10));
    assert.match(check.detail, /80 days left/);
  }
  assert.ok(calls.every((call) => call.port === 443));
  makeRun({ suite: "slow", started_at: iso(NOW), finished_at: iso(NOW), checks });
});

test("expiry levels follow the assignment: under 21 days sev3, under 7 sev2, under 2 sev1", () => {
  assert.deepEqual(EXPIRY_LEVELS, [{ under: 2, severity: "sev1" }, { under: 7, severity: "sev2" }, { under: 21, severity: "sev3" }]);
  const severityAt = (days) => {
    const problems = certificateProblems({ host: "diamondecho.com", info: goodInfo("diamondecho.com", { validTo: iso(NOW + days * DAY) }), nowMs: NOW });
    return problems.map((problem) => problem.severity).join(",") || "none";
  };
  assert.equal(severityAt(21), "none");
  assert.equal(severityAt(20.99), "sev3");
  assert.equal(severityAt(7), "sev3");
  assert.equal(severityAt(6.99), "sev2");
  assert.equal(severityAt(2), "sev2");
  assert.equal(severityAt(1.99), "sev1");
  assert.equal(severityAt(0.5), "sev1");
  assert.equal(severityAt(0), "sev1");
  assert.equal(severityAt(-3), "sev1");
});

test("an expired certificate says when it expired", () => {
  const [problem] = certificateProblems({ host: "diamondecho.com", info: goodInfo("diamondecho.com", { validTo: "2026-11-10T00:00:00.000Z" }), nowMs: NOW });
  assert.equal(problem.severity, "sev1");
  assert.match(problem.text, /expired on 2026-11-10/);
});

test("a certificate not yet valid, an unreadable date and an old protocol are each caught", () => {
  const host = "diamondecho.com";
  assert.equal(certificateProblems({ host, info: goodInfo(host, { validFrom: iso(NOW + DAY) }), nowMs: NOW })[0].severity, "sev1");
  assert.match(certificateProblems({ host, info: goodInfo(host, { validTo: null }), nowMs: NOW })[0].text, /could not be read/);
  const old = certificateProblems({ host, info: goodInfo(host, { protocol: "TLSv1.1" }), nowMs: NOW });
  assert.equal(old[0].severity, "sev2");
  assert.match(old[0].text, /TLSv1.1, older than TLS 1.2/);
  assert.equal(certificateProblems({ host, info: goodInfo(host, { protocol: "TLSv1.2" }), nowMs: NOW }).length, 0);
  assert.equal(certificateProblems({ host, info: goodInfo(host, { protocol: undefined }), nowMs: NOW })[0].severity, "sev2");
});

test("hostname matching: exact names and one-label wildcards only", () => {
  assert.equal(coversHost("diamondecho.com", ["diamondecho.com"]), true);
  assert.equal(coversHost("Staff.DiamondEcho.com", ["staff.diamondecho.com"]), true);
  assert.equal(coversHost("staff.diamondecho.com", ["*.diamondecho.com"]), true);
  assert.equal(coversHost("diamondecho.com", ["*.diamondecho.com"]), false);
  assert.equal(coversHost("a.b.diamondecho.com", ["*.diamondecho.com"]), false);
  assert.equal(coversHost("diamondecho-api-180189726732.us-east1.run.app", ["*.us-east1.run.app"]), true);
  assert.equal(coversHost("diamondecho.com", ["example.com"]), false);
  assert.equal(coversHost("diamondecho.com", []), false);
});

test("a certificate for another name is sev1 and names what it is for", async () => {
  const { ctx } = ctxWith(({ host }) => (host === "staff.diamondecho.com" ? goodInfo(host, { altNames: ["diamondecho-staff.pages.dev"] }) : goodInfo(host)));
  const staff = (await run(ctx)).find((check) => check.id === "tls-staff");
  assert.equal(staff.ok, false);
  assert.equal(staff.severity, "sev1");
  assert.match(staff.detail, /for diamondecho-staff\.pages\.dev, not staff\.diamondecho\.com/);
});

test("the common name is used only when there are no alternative names", () => {
  assert.equal(certificateProblems({ host: "diamondecho.com", info: goodInfo("diamondecho.com", { altNames: [], commonName: "diamondecho.com" }), nowMs: NOW }).length, 0);
});

test("several problems at once: the worst severity wins and all are named", async () => {
  const { ctx } = ctxWith(({ host }) => goodInfo(host, { validTo: iso(NOW + 10 * DAY), protocol: "TLSv1" }));
  const [check] = await run(ctx);
  assert.equal(check.severity, "sev2");
  assert.match(check.detail, /expires on .* in 10 days/);
  assert.match(check.detail, /TLSv1, older than TLS 1.2/);
});

test("Node's certificate errors are sev1 'invalid' and are not retried", async () => {
  const { ctx, calls } = ctxWith(({ host }) => {
    if (host === "diamondecho.com") throw errorWith("CERT_HAS_EXPIRED");
    return goodInfo(host);
  });
  const [publicCheck] = await run(ctx);
  assert.equal(publicCheck.ok, false);
  assert.equal(publicCheck.severity, "sev1");
  assert.equal(publicCheck.attempts, 1);
  assert.match(publicCheck.detail, /not valid \(CERT_HAS_EXPIRED\)\. Browsers will show a warning page/);
  assert.equal(calls.filter((call) => call.host === "diamondecho.com").length, 1);
});

test("a refused handshake is sev1", async () => {
  const { ctx } = ctxWith(() => { throw errorWith("ERR_SSL_UNSUPPORTED_PROTOCOL"); });
  const [check] = await run(ctx);
  assert.equal(check.severity, "sev1");
  assert.match(check.detail, /refused the TLS handshake/);
});

test("a network failure is tried twice and is only an early warning", async () => {
  const { ctx, calls } = ctxWith(({ host }) => {
    if (host === "www.diamondecho.com") throw errorWith("ECONNRESET");
    return goodInfo(host);
  });
  const www = (await run(ctx)).find((check) => check.id === "tls-www");
  assert.equal(www.ok, false);
  assert.equal(www.severity, "sev3");
  assert.equal(www.attempts, 2);
  assert.match(www.detail, /not proof of a certificate problem/);
  assert.equal(calls.filter((call) => call.host === "www.diamondecho.com").length, 2);
});

test("a network failure followed by success passes and records two attempts", async () => {
  let first = true;
  const { ctx } = ctxWith(({ host }) => {
    if (host === "diamondecho.com" && first) { first = false; throw errorWith("ETIMEDOUT"); }
    return goodInfo(host);
  });
  const [check] = await run(ctx);
  assert.equal(check.ok, true);
  assert.equal(check.attempts, 2);
});

test("error classification keeps only a code, never the message", () => {
  assert.equal(classifyError(errorWith("ERR_TLS_CERT_ALTNAME_INVALID")).kind, "invalid");
  assert.equal(classifyError(errorWith("DEPTH_ZERO_SELF_SIGNED_CERT")).kind, "invalid");
  assert.equal(classifyError(errorWith("UNABLE_TO_VERIFY_LEAF_SIGNATURE")).kind, "invalid");
  assert.equal(classifyError(errorWith("EPROTO")).kind, "handshake");
  assert.equal(classifyError(errorWith("ENOTFOUND")).kind, "unreachable");
  assert.equal(classifyError({ cause: { code: "ECONNREFUSED" } }).kind, "unreachable");
  const free = classifyError(new Error("Host: secret.example is not in the cert's altnames"));
  assert.deepEqual(free, { kind: "unreachable", severity: "sev3", code: "unknown error" });
  assert.equal(classifyError(errorWith("not a code at all")).code, "unknown error");
});

test("SRE_NOW replays another day", async () => {
  const { ctx } = ctxWith(({ host }) => goodInfo(host), { env: { SRE_NOW: iso(NOW + 75 * DAY) } });
  const [check] = await run(ctx);
  assert.equal(check.ok, false);
  assert.equal(check.severity, "sev2");
  assert.match(check.detail, /in 5 days/);
});

test("the clock: SRE_NOW first, then ctx.now(), and never a stopwatch value", () => {
  assert.equal(wallClock({ env: { SRE_NOW: "2027-01-01T00:00:00Z" }, now: () => NOW }), Date.parse("2027-01-01T00:00:00Z"));
  assert.equal(wallClock({ env: {}, now: () => NOW }), NOW);
  assert.equal(wallClock({ env: { SRE_NOW: "not a time" }, now: () => NOW }), NOW);
  const stopwatch = wallClock({ env: {}, now: () => 1234.5 });
  assert.ok(stopwatch > 1e12);
});
