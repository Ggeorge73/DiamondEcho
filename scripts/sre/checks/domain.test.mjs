// Tests for domain.mjs. No test reaches the registry: the RDAP transport is
// replaced by a fake that returns a record shaped like Verisign's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRun } from "../lib/schema.mjs";
import { TARGETS } from "../targets.mjs";
import { run, suites, readRecord, expiryVerdict, lockVerdict, delegationVerdict, rdapLookup, EXPIRY_LEVELS } from "./domain.mjs";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-13T12:00:00Z");
const EXPIRES = "2027-07-17T21:05:39Z";

// The facts the registry gave on 2026-11-13, trimmed to what the module reads.
const record = (over = {}) => ({
  objectClassName: "domain",
  ldhName: "DIAMONDECHO.COM",
  status: ["client delete prohibited", "client renew prohibited", "client transfer prohibited", "client update prohibited"],
  events: [
    { eventAction: "registration", eventDate: "2017-07-17T21:05:39Z" },
    { eventAction: "expiration", eventDate: EXPIRES },
    { eventAction: "last changed", eventDate: "2026-10-06T14:46:04Z" },
  ],
  nameservers: [{ ldhName: "GEORGIA.NS.CLOUDFLARE.COM" }, { ldhName: "JASPER.NS.CLOUDFLARE.COM" }],
  entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "GoDaddy.com, LLC"]]] }],
  secureDNS: { delegationSigned: false },
  ...over,
});

function ctxWith(lookup, over = {}) {
  const calls = [];
  return {
    calls,
    ctx: {
      fetch: () => { throw new Error("tests must not fetch"); },
      now: () => NOW, targets: TARGETS.production, env: {},
      rdapLookup: async (question) => { calls.push(question); return lookup(question); },
      ...over,
    },
  };
}
const byId = (checks, id) => checks.find((check) => check.id === id);

test("runs hourly only", () => {
  assert.deepEqual(suites, ["slow"]);
});

test("today's registry record passes all three checks and makes a valid run", async () => {
  const { ctx, calls } = ctxWith(() => record());
  const checks = await run(ctx);
  assert.deepEqual(calls, [{ domain: "diamondecho.com" }]);
  assert.deepEqual(checks.map((check) => [check.id, check.ok, check.severity]), [
    ["domain-expiry", true, "sev3"], ["domain-registrar-lock", true, "sev3"], ["domain-delegation", true, "sev2"],
  ]);
  assert.match(byId(checks, "domain-expiry").detail, /Registered until 2027-07-17 \(246 days left\)/);
  assert.deepEqual(byId(checks, "domain-expiry").observed, { expires: "2027-07-17" });
  assert.deepEqual(byId(checks, "domain-registrar-lock").observed, { locks: "transfer, delete, update", registrar: "GoDaddy.com, LLC" });
  for (const check of checks) { assert.equal(check.component, "domain"); assert.deepEqual(check.slis, []); }
  makeRun({ suite: "slow", started_at: "2026-11-13T12:00:00Z", finished_at: "2026-11-13T12:00:01Z", checks });
});

test("expiry levels follow the assignment: under 60 days sev3, under 30 sev2, under 7 sev1", () => {
  assert.deepEqual(EXPIRY_LEVELS, [{ under: 7, severity: "sev1" }, { under: 30, severity: "sev2" }, { under: 60, severity: "sev3" }]);
  const at = (days) => expiryVerdict({ expiresMs: NOW + days * DAY, statuses: [], nowMs: NOW });
  assert.deepEqual([at(60).ok, at(60).severity], [true, "sev3"]);
  assert.deepEqual([at(59.99).ok, at(59.99).severity], [false, "sev3"]);
  assert.equal(at(30).severity, "sev3");
  assert.equal(at(29.99).severity, "sev2");
  assert.equal(at(7).severity, "sev2");
  assert.equal(at(6.99).severity, "sev1");
  assert.match(at(0.4).detail, /in less than a day/);
  assert.match(at(1).detail, /in 1 day\./);
  const expired = at(-1);
  assert.deepEqual([expired.ok, expired.severity], [false, "sev1"]);
  assert.match(expired.detail, /expired on .*Renew it at GoDaddy now/);
});

test("a held or deleting domain is sev1 whatever its date", () => {
  for (const status of ["client hold", "server hold", "redemption period", "pending delete"]) {
    const verdict = expiryVerdict({ expiresMs: NOW + 300 * DAY, statuses: [status], nowMs: NOW });
    assert.deepEqual([verdict.ok, verdict.severity], [false, "sev1"], status);
    assert.match(verdict.detail, new RegExp(status));
  }
});

test("a renewal by the registry asks for the payment to be confirmed", () => {
  const verdict = expiryVerdict({ expiresMs: NOW + 360 * DAY, statuses: ["auto renew period"], nowMs: NOW });
  assert.equal(verdict.ok, true);
  assert.match(verdict.detail, /confirm at GoDaddy that it was paid for/);
});

test("locks: all on, some missing, transfer off", () => {
  assert.equal(lockVerdict({ statuses: ["client transfer prohibited", "client delete prohibited", "client update prohibited"] }).ok, true);
  const partial = lockVerdict({ statuses: ["server transfer prohibited"] });
  assert.equal(partial.ok, true);
  assert.match(partial.detail, /Not set: delete, update lock/);
  const off = lockVerdict({ statuses: ["client delete prohibited"] });
  assert.deepEqual([off.ok, off.severity, off.observed.locks], [false, "sev3", "delete"]);
  assert.match(off.detail, /transfer lock is off/);
  assert.equal(lockVerdict({ statuses: [] }).observed.locks, "none");
});

test("a transfer under way, or another registrar, is sev2", async () => {
  const pending = lockVerdict({ statuses: ["client transfer prohibited", "pending transfer"] });
  assert.deepEqual([pending.ok, pending.severity], [false, "sev2"]);
  assert.match(pending.detail, /transfer to another registrar under way/);

  const { ctx } = ctxWith(() => record({ entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["fn", {}, "text", "Other Registrar Inc."]]] }] }));
  const lock = byId(await run(ctx), "domain-registrar-lock");
  assert.deepEqual([lock.ok, lock.severity], [false, "sev2"]);
  assert.match(lock.detail, /registrar as Other Registrar Inc\., not GoDaddy\.com, LLC/);
  assert.equal(lockVerdict({ statuses: ["client transfer prohibited"], registrar: "GODADDY.COM, LLC", expectedRegistrar: "GoDaddy.com, LLC" }).ok, true);
  assert.equal(lockVerdict({ statuses: ["client transfer prohibited"], registrar: null, expectedRegistrar: "GoDaddy.com, LLC" }).ok, true);
});

test("delegation: the registry pointing elsewhere is sev2 and reads as a possible takeover", async () => {
  const { ctx } = ctxWith(() => record({ nameservers: [{ ldhName: "NS1.EXAMPLE.NET" }, { ldhName: "NS2.EXAMPLE.NET" }] }));
  const check = byId(await run(ctx), "domain-delegation");
  assert.deepEqual([check.ok, check.severity], [false, "sev2"]);
  assert.match(check.detail, /points the domain at ns1\.example\.net, ns2\.example\.net; on record are georgia\.ns\.cloudflare\.com, jasper\.ns\.cloudflare\.com/);
  assert.match(check.detail, /takeover/);
  assert.match(delegationVerdict({ nameservers: [], expected: ["a.example"] }).detail, /no nameservers/);
  assert.equal(delegationVerdict({ nameservers: ["a.example", "b.example"], expected: ["B.example.", "a.example"] }).ok, true);
});

test("readRecord copes with a sparse or odd record", () => {
  assert.deepEqual(readRecord({}), { expiresMs: null, statuses: [], registrar: null, nameservers: [] });
  assert.deepEqual(readRecord({ status: ["Client Transfer Prohibited"], nameservers: [{ ldhName: "A.EXAMPLE." }, {}] }).nameservers, ["a.example"]);
  assert.equal(readRecord({ status: ["Client Transfer Prohibited"] }).statuses[0], "client transfer prohibited");
});

test("a record with no expiry date is 'not checked', never healthy", async () => {
  const { ctx } = ctxWith(() => record({ events: [] }));
  const checks = await run(ctx);
  for (const check of checks) {
    assert.deepEqual([check.ok, check.severity], [false, "sev3"]);
    assert.match(check.detail, /no expiry date/);
  }
});

test("the registry unreachable: tried twice, then every check is an early warning", async () => {
  const { ctx, calls } = ctxWith(() => { throw Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } }); });
  const checks = await run(ctx);
  assert.equal(calls.length, 2);
  for (const check of checks) {
    assert.deepEqual([check.ok, check.severity, check.attempts], [false, "sev3", 2]);
    assert.match(check.detail, /Could not read the registry's record for diamondecho\.com \(ENOTFOUND\), so this was not checked/);
  }
});

test("a failed first lookup and a good second one pass", async () => {
  let first = true;
  const { ctx } = ctxWith(() => { if (first) { first = false; throw new Error("HTTP 503"); } return record(); });
  const checks = await run(ctx);
  assert.ok(checks.every((check) => check.ok && check.attempts === 2));
});

test("the registry saying twice that the name does not exist is sev1 on the expiry check", async () => {
  const { ctx } = ctxWith(() => { throw Object.assign(new Error("HTTP 404"), { code: "NOT_REGISTERED" }); });
  const checks = await run(ctx);
  const expiry = byId(checks, "domain-expiry");
  assert.deepEqual([expiry.ok, expiry.severity, expiry.status], [false, "sev1", 404]);
  assert.match(expiry.detail, /no record of diamondecho\.com/);
  assert.equal(byId(checks, "domain-delegation").severity, "sev3");
});

test("a 404 then a good answer is not a lapse", async () => {
  let first = true;
  const { ctx } = ctxWith(() => { if (first) { first = false; throw Object.assign(new Error("HTTP 404"), { code: "NOT_REGISTERED" }); } return record(); });
  assert.ok((await run(ctx)).every((check) => check.ok));
});

test("a free-text error never reaches the detail", async () => {
  const { ctx } = ctxWith(() => { throw new Error("Unexpected token < in JSON: <html>whatever the far side said</html>"); });
  const [check] = await run(ctx);
  assert.match(check.detail, /\(no answer\)/);
  assert.doesNotMatch(check.detail, /html/);
});

test("SRE_NOW replays another day", async () => {
  const { ctx } = ctxWith(() => record(), { env: { SRE_NOW: "2027-07-01T00:00:00Z" } });
  const expiry = byId(await run(ctx), "domain-expiry");
  assert.deepEqual([expiry.ok, expiry.severity], [false, "sev2"]);
  assert.match(expiry.detail, /in 16 days/);
});

test("rdapLookup asks Verisign for a .com name only and marks a 404", async () => {
  const seen = [];
  const fetch = async (url, init) => { seen.push([url, init.headers.accept]); return new Response(JSON.stringify(record()), { status: 200 }); };
  const body = await rdapLookup({ domain: "diamondecho.com", fetch });
  assert.equal(body.ldhName, "DIAMONDECHO.COM");
  assert.deepEqual(seen, [["https://rdap.verisign.com/com/v1/domain/diamondecho.com", "application/rdap+json"]]);
  await assert.rejects(rdapLookup({ domain: "diamondecho.org", fetch }), /only look up \.com/);
  await assert.rejects(rdapLookup({ domain: "a.com/../b", fetch }), /only look up \.com/);
  await assert.rejects(rdapLookup({ domain: "diamondecho.com", fetch: async () => new Response("", { status: 404 }) }), (error) => error.code === "NOT_REGISTERED");
  await assert.rejects(rdapLookup({ domain: "diamondecho.com", fetch: async () => new Response("", { status: 429 }) }), /HTTP 429/);
});
