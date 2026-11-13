// Tests for dns.mjs. No test reaches a resolver: the DNS-over-HTTPS transport
// is replaced by a fake zone, one per resolver, so the two can disagree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRun } from "../lib/schema.mjs";
import { TARGETS } from "../targets.mjs";
import { run, suites, normalize, validateExpected, loadExpectedRecords, findProblem, createAsker, dohQuery, RESOLVERS } from "./dns.mjs";

const NOW = Date.parse("2026-11-13T12:00:00Z");
const EXPECTED = loadExpectedRecords();

// The zone as both resolvers saw it on 2026-11-13, spelled the way each one
// spells it: Cloudflare quotes TXT text, Google does not; both end names in a dot.
function healthyZone(resolverId) {
  const quote = (text) => (resolverId === "cloudflare" ? `"${text}"` : text);
  const zone = new Map();
  const put = (name, type, values) => zone.set(`${type} ${name}`, { rcode: 0, answers: values });
  put("diamondecho.com", "A", ["104.21.0.1", "172.67.0.1"]);
  put("staff.diamondecho.com", "A", ["104.21.0.1"]);
  put("diamondecho.com", "NS", ["jasper.ns.cloudflare.com.", "georgia.ns.cloudflare.com."]);
  put("diamondecho.com", "MX", ["0 mx3-usg2.ppe-hosted.com.", "0 mx1-usg2.ppe-hosted.com.", "0 mx2-usg2.ppe-hosted.com."]);
  put("diamondecho.com", "TXT", [quote("NETORGFT9628004.onmicrosoft.com"), quote("v=spf1 include:_spf-usg2.ppe-hosted.com include:secureserver.net ~all")]);
  put("_dmarc.diamondecho.com", "TXT", [quote("v=DMARC1; p=none; rua=mailto:someone@example.invalid")]);
  for (const record of EXPECTED.records) {
    if (record.type === "CNAME" || record.type === "SRV") put(record.name, record.type, record.values.map((value) => `${value}.`));
  }
  return zone;
}

// A fake transport. `zones` maps resolver id to a Map, or to "down".
function fakeDoh(zones) {
  const calls = [];
  const query = async ({ resolver, name, type }) => {
    calls.push(`${resolver.id} ${type} ${name}`);
    const zone = zones[resolver.id];
    if (zone === "down") throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    return zone.get(`${type} ${name}`) ?? { rcode: 0, answers: [] };
  };
  return { query, calls };
}

function ctxWith(zones, over = {}) {
  const fake = fakeDoh(zones);
  return {
    calls: fake.calls,
    ctx: {
      fetch: () => { throw new Error("tests must not fetch"); },
      now: () => NOW, targets: TARGETS.production, env: {}, dohQuery: fake.query, ...over,
    },
  };
}

const both = (change) => {
  const zones = { cloudflare: healthyZone("cloudflare"), google: healthyZone("google") };
  for (const zone of Object.values(zones)) change(zone);
  return zones;
};
const byId = (checks, id) => checks.find((check) => check.id === id);

test("runs hourly only, against two resolvers", () => {
  assert.deepEqual(suites, ["slow"]);
  assert.deepEqual(RESOLVERS.map((resolver) => resolver.id), ["cloudflare", "google"]);
});

test("the zone as it is today passes every check and makes a valid run", async () => {
  const { ctx } = ctxWith({ cloudflare: healthyZone("cloudflare"), google: healthyZone("google") });
  const checks = await run(ctx);
  assert.deepEqual(checks.map((check) => check.id), [
    "dns-apex-resolves", "dns-staff-resolves", "dns-nameservers", "dns-mail-mx", "dns-mail-spf",
    "dns-mail-microsoft-365", "dns-mail-dmarc", "dns-other-records",
  ]);
  for (const check of checks) {
    assert.equal(check.ok, true, `${check.id}: ${check.detail}`);
    assert.equal(check.component, "dns");
    assert.deepEqual(check.slis, []);
  }
  assert.equal(byId(checks, "dns-nameservers").observed.nameservers, "georgia.ns.cloudflare.com, jasper.ns.cloudflare.com");
  makeRun({ suite: "slow", started_at: "2026-11-13T12:00:00Z", finished_at: "2026-11-13T12:00:01Z", checks });
});

test("each question is put to each resolver once per run, however many checks need it", async () => {
  const { ctx, calls } = ctxWith({ cloudflare: healthyZone("cloudflare"), google: healthyZone("google") });
  await run(ctx);
  assert.equal(calls.length, new Set(calls).size);
  assert.equal(calls.filter((call) => call.endsWith("TXT diamondecho.com")).length, 2);
});

test("severities: the apex is sev1, mail delivery and SPF sev2, the rest lower", async () => {
  const { ctx } = ctxWith({ cloudflare: healthyZone("cloudflare"), google: healthyZone("google") });
  const severities = Object.fromEntries((await run(ctx)).map((check) => [check.id, check.severity]));
  assert.deepEqual(severities, {
    "dns-apex-resolves": "sev1", "dns-staff-resolves": "sev2", "dns-nameservers": "sev2", "dns-mail-mx": "sev2",
    "dns-mail-spf": "sev2", "dns-mail-microsoft-365": "sev3", "dns-mail-dmarc": "sev3", "dns-other-records": "sev4",
  });
});

test("MX records gone at both resolvers: mail delivery fails, sev2, and says how to accept a meant change", async () => {
  const { ctx } = ctxWith(both((zone) => zone.delete("MX diamondecho.com")));
  const mx = byId(await run(ctx), "dns-mail-mx");
  assert.equal(mx.ok, false);
  assert.equal(mx.severity, "sev2");
  assert.match(mx.detail, /MX diamondecho\.com: no record\. Both resolvers agree\./);
  assert.match(mx.detail, /update deploy\/dns\/expected-records\.json/);
});

test("one MX host replaced: the missing and the unexpected one are both named", async () => {
  const { ctx } = ctxWith(both((zone) => zone.set("MX diamondecho.com", { rcode: 0, answers: ["0 mx1-usg2.ppe-hosted.com.", "0 mx2-usg2.ppe-hosted.com.", "10 mail.example.net."] })));
  const mx = byId(await run(ctx), "dns-mail-mx");
  assert.equal(mx.ok, false);
  assert.match(mx.detail, /missing 0 mx3-usg2\.ppe-hosted\.com; unexpected 10 mail\.example\.net/);
});

test("a disagreement between resolvers is reported but not counted as a failure", async () => {
  const zones = { cloudflare: healthyZone("cloudflare"), google: healthyZone("google") };
  zones.google.delete("MX diamondecho.com");
  const { ctx } = ctxWith(zones);
  const mx = byId(await run(ctx), "dns-mail-mx");
  assert.equal(mx.ok, true);
  assert.match(mx.detail, /Google DNS reports MX diamondecho\.com: no record, but Cloudflare DNS sees it as expected/);
  assert.match(mx.detail, /Not confirmed by both resolvers/);
});

test("one resolver unreachable and the other sees a fault: an early warning (sev3), not a pass", async () => {
  const zones = { cloudflare: "down", google: healthyZone("google") };
  zones.google.delete("MX diamondecho.com");
  const { ctx } = ctxWith(zones);
  const checks = await run(ctx);
  const mx = byId(checks, "dns-mail-mx");
  assert.deepEqual([mx.ok, mx.severity], [false, "sev3"]);
  assert.match(mx.detail, /Google DNS reports MX diamondecho\.com: no record, and Cloudflare DNS could not be reached to confirm it\. Counted as an early warning/);
  assert.match(mx.detail, /update deploy\/dns\/expected-records\.json/);
  // The other records are fine at the one resolver that answers: they pass.
  assert.equal(byId(checks, "dns-mail-spf").ok, true);
});

test("the same half-confirmed fault on a sev4 record stays sev4", async () => {
  const zones = { cloudflare: healthyZone("cloudflare"), google: "down" };
  zones.cloudflare.delete("CNAME pay.diamondecho.com");
  const other = byId(await run(ctxWith(zones).ctx), "dns-other-records");
  assert.deepEqual([other.ok, other.severity], [false, "sev4"]);
});

test("a confirmed fault and a half-confirmed one together keep the full severity", async () => {
  const zones = { cloudflare: healthyZone("cloudflare"), google: healthyZone("google") };
  zones.cloudflare.delete("CNAME autodiscover.diamondecho.com");
  zones.google.delete("CNAME autodiscover.diamondecho.com");
  const { query } = fakeDoh(zones);
  const ctx = {
    now: () => NOW, targets: TARGETS.production, env: {},
    // Google cannot be asked about the TXT record only.
    dohQuery: async (question) => {
      if (question.resolver.id === "google" && question.type === "TXT" && question.name === "diamondecho.com") throw new Error("HTTP 503");
      return query(question);
    },
  };
  zones.cloudflare.set("TXT diamondecho.com", { rcode: 0, answers: ['"v=spf1 include:_spf-usg2.ppe-hosted.com include:secureserver.net ~all"'] });
  const m365 = byId(await run(ctx), "dns-mail-microsoft-365");
  assert.deepEqual([m365.ok, m365.severity], [false, "sev3"]);
  assert.match(m365.detail, /CNAME autodiscover\.diamondecho\.com: no record\. Both resolvers agree/);
  assert.match(m365.detail, /could not be reached to confirm it/);
});

test("one resolver unreachable and the other healthy: passes and says it was one resolver", async () => {
  const { ctx } = ctxWith({ cloudflare: "down", google: healthyZone("google") });
  const checks = await run(ctx);
  for (const check of checks) assert.equal(check.ok, true, check.id);
  assert.match(byId(checks, "dns-apex-resolves").detail, /Cloudflare DNS could not be reached; the other resolver sees the records as expected\. That is not a fault of the site\./);
  assert.equal(byId(checks, "dns-apex-resolves").attempts, 2);
});

test("both resolvers unreachable: nothing is known, which fails as an early warning, never as healthy", async () => {
  const { ctx } = ctxWith({ cloudflare: "down", google: "down" });
  const checks = await run(ctx);
  for (const check of checks) {
    assert.equal(check.ok, false, check.id);
    assert.equal(check.severity, check.id === "dns-other-records" ? "sev4" : "sev3", check.id);
    assert.match(check.detail, /Neither resolver could be asked/);
  }
});

test("the apex not existing at both resolvers is a sev1 failure", async () => {
  const { ctx } = ctxWith(both((zone) => zone.set("A diamondecho.com", { rcode: 3, answers: [] })));
  const apex = byId(await run(ctx), "dns-apex-resolves");
  assert.equal(apex.ok, false);
  assert.equal(apex.severity, "sev1");
  assert.match(apex.detail, /the name does not exist\. Both resolvers agree/);
});

test("SERVFAIL at both resolvers fails (a broken zone or broken signing looks like this)", async () => {
  const { ctx } = ctxWith(both((zone) => zone.set("A staff.diamondecho.com", { rcode: 2, answers: [] })));
  const staff = byId(await run(ctx), "dns-staff-resolves");
  assert.equal(staff.ok, false);
  assert.equal(staff.severity, "sev2");
  assert.match(staff.detail, /SERVFAIL/);
});

test("nameservers moved away from Cloudflare at both resolvers: sev2", async () => {
  const { ctx } = ctxWith(both((zone) => zone.set("NS diamondecho.com", { rcode: 0, answers: ["ns55.domaincontrol.com.", "ns56.domaincontrol.com."] })));
  const ns = byId(await run(ctx), "dns-nameservers");
  assert.equal(ns.ok, false);
  assert.equal(ns.severity, "sev2");
  assert.match(ns.detail, /missing georgia\.ns\.cloudflare\.com, jasper\.ns\.cloudflare\.com; unexpected ns55\.domaincontrol\.com/);
  assert.equal(ns.observed.nameservers, "ns55.domaincontrol.com, ns56.domaincontrol.com");
});

test("a second SPF record fails even when both are correct, because receivers reject two", async () => {
  const spf = "v=spf1 include:_spf-usg2.ppe-hosted.com include:secureserver.net ~all";
  const { ctx } = ctxWith(both((zone) => zone.get("TXT diamondecho.com").answers.push(`"${spf}"`)));
  const check = byId(await run(ctx), "dns-mail-spf");
  assert.equal(check.ok, false);
  assert.match(check.detail, /2 SPF records/);
});

test("a changed SPF record fails; another TXT record added beside it does not", async () => {
  const changed = both((zone) => zone.set("TXT diamondecho.com", { rcode: 0, answers: ['"NETORGFT9628004.onmicrosoft.com"', '"v=spf1 -all"'] }));
  assert.equal(byId(await run(ctxWith(changed).ctx), "dns-mail-spf").ok, false);
  const added = both((zone) => zone.get("TXT diamondecho.com").answers.push('"google-site-verification=abc"'));
  const checks = await run(ctxWith(added).ctx);
  assert.equal(byId(checks, "dns-mail-spf").ok, true);
  assert.equal(byId(checks, "dns-mail-microsoft-365").ok, true);
});

test("Microsoft 365: the tenant TXT removed, or autodiscover pointed elsewhere, fails", async () => {
  const noTenant = both((zone) => zone.set("TXT diamondecho.com", { rcode: 0, answers: ['"v=spf1 include:_spf-usg2.ppe-hosted.com include:secureserver.net ~all"'] }));
  assert.match(byId(await run(ctxWith(noTenant).ctx), "dns-mail-microsoft-365").detail, /missing NETORGFT9628004\.onmicrosoft\.com/);
  const moved = both((zone) => zone.set("CNAME autodiscover.diamondecho.com", { rcode: 0, answers: ["diamondecho.com."] }));
  assert.equal(byId(await run(ctxWith(moved).ctx), "dns-mail-microsoft-365").ok, false);
});

test("DMARC: only the start is compared, so a new report address is fine but a stricter policy is noticed", async () => {
  const otherAddress = both((zone) => zone.set("TXT _dmarc.diamondecho.com", { rcode: 0, answers: ['"v=DMARC1; p=none; rua=mailto:x@example.invalid"'] }));
  assert.equal(byId(await run(ctxWith(otherAddress).ctx), "dns-mail-dmarc").ok, true);
  const strict = both((zone) => zone.set("TXT _dmarc.diamondecho.com", { rcode: 0, answers: ['"v=DMARC1; p=reject"'] }));
  const check = byId(await run(ctxWith(strict).ctx), "dns-mail-dmarc");
  assert.equal(check.ok, false);
  assert.match(check.detail, /no record starting "v=DMARC1; p=none"/);
});

test("normalize: trailing dots, case, quoted and split TXT text", () => {
  assert.equal(normalize("NS", "Georgia.NS.Cloudflare.com."), "georgia.ns.cloudflare.com");
  assert.equal(normalize("MX", "0  MX1-usg2.ppe-hosted.com."), "0 mx1-usg2.ppe-hosted.com");
  assert.equal(normalize("TXT", '"v=spf1 include:a" " include:b ~all"'), "v=spf1 include:a include:b ~all");
  assert.equal(normalize("TXT", "v=spf1 ~all"), "v=spf1 ~all");
  assert.equal(normalize("TXT", '"NETORGFT9628004.onmicrosoft.com"'), "NETORGFT9628004.onmicrosoft.com");
});

test("findProblem: other DNS errors are named; an unknown match is a bug", () => {
  assert.match(findProblem({ name: "x", type: "A", match: "resolves" }, { rcode: 5, values: [] }), /DNS error code 5/);
  assert.throws(() => findProblem({ name: "x", type: "A", match: "fuzzy", values: ["a"] }, { rcode: 0, values: [] }), /does not know match/);
});

test("a mistake in the expected file is a bug and throws", () => {
  assert.throws(() => validateExpected(null), /must be an object/);
  assert.throws(() => validateExpected({ nameservers: [], records: [] }), /nameservers/);
  const record = { name: "diamondecho.com", type: "MX", match: "exact", group: "mail-mx", values: ["0 a.example"] };
  assert.throws(() => validateExpected({ nameservers: ["a"], records: [{ ...record, type: "MXX" }] }), /unknown type/);
  assert.throws(() => validateExpected({ nameservers: ["a"], records: [{ ...record, match: "fuzzy" }] }), /match must be/);
  assert.throws(() => validateExpected({ nameservers: ["a"], records: [{ ...record, group: "web" }] }), /unknown group/);
  assert.throws(() => validateExpected({ nameservers: ["a"], records: [{ ...record, values: [] }] }), /values/);
  assert.throws(() => validateExpected({ nameservers: ["a"], records: [{ ...record, type: "TXT", match: "single-spf", values: ["a", "b"] }] }), /single-spf/);
  assert.throws(() => validateExpected({ nameservers: ["a"], registrar: "", records: [] }), /registrar/);
  assert.doesNotThrow(() => validateExpected({ nameservers: ["a"], registrar: "GoDaddy.com, LLC", records: [record] }));
});

test("the expected file in the repository is valid and guards every mail record de13 lists", () => {
  assert.deepEqual(EXPECTED.nameservers, ["georgia.ns.cloudflare.com", "jasper.ns.cloudflare.com"]);
  const guarded = EXPECTED.records.map((record) => `${record.type} ${record.name}`);
  for (const wanted of ["MX diamondecho.com", "TXT diamondecho.com", "CNAME autodiscover.diamondecho.com", "TXT _dmarc.diamondecho.com"]) {
    assert.ok(guarded.includes(wanted), wanted);
  }
  assert.equal(EXPECTED.records.find((record) => record.type === "MX").values.length, 3);
});

test("ctx.expectedRecords replaces the file, and is validated too", async () => {
  const { ctx } = ctxWith({ cloudflare: healthyZone("cloudflare"), google: healthyZone("google") }, { expectedRecords: { nameservers: ["georgia.ns.cloudflare.com", "jasper.ns.cloudflare.com"], records: [] } });
  assert.equal((await run(ctx)).length, 3);
  await assert.rejects(run({ ...ctx, expectedRecords: { nameservers: "x", records: [] } }), /nameservers/);
});

test("a resolver that fails once is asked again before it is written off", async () => {
  let failures = 1;
  const ask = createAsker({
    dohQuery: async ({ resolver }) => {
      if (resolver.id === "google" && failures-- > 0) throw Object.assign(new Error("x"), { name: "TimeoutError" });
      return { rcode: 0, answers: ["1.2.3.4"] };
    },
  });
  const answers = await ask("diamondecho.com", "A");
  assert.deepEqual(answers.map((answer) => [answer.resolver.id, answer.reachable, answer.attempts]), [["cloudflare", true, 1], ["google", true, 2]]);
});

test("an unreachable resolver's reason is a code or our own words, never free text", async () => {
  const ask = createAsker({
    dohQuery: async ({ resolver }) => {
      if (resolver.id === "google") throw new Error("Unexpected token < in JSON at <html>secret</html>");
      throw new Error("HTTP 503");
    },
  });
  const [cloudflare, google] = await ask("diamondecho.com", "A");
  assert.equal(cloudflare.reason, "HTTP 503");
  assert.equal(google.reason, "no usable answer");
});

// The default transport, with a fake fetch.
test("dohQuery asks for DNS JSON, keeps only answers of the asked type, and refuses what is not a DNS answer", async () => {
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({ url, accept: init.headers.accept });
    return new Response(JSON.stringify({ Status: 0, Answer: [
      { name: "staff.diamondecho.com.", type: 5, data: "diamondecho-staff.pages.dev." },
      { name: "diamondecho-staff.pages.dev.", type: 1, data: "104.21.0.1" },
    ] }), { status: 200 });
  };
  const result = await dohQuery({ resolver: RESOLVERS[1], name: "staff.diamondecho.com", type: "A", fetch });
  assert.deepEqual(result, { rcode: 0, answers: ["104.21.0.1"] });
  assert.equal(seen[0].url, "https://dns.google/resolve?name=staff.diamondecho.com&type=A");
  assert.equal(seen[0].accept, "application/dns-json");

  await assert.rejects(dohQuery({ resolver: RESOLVERS[0], name: "x.com", type: "A", fetch: async () => new Response("busy", { status: 503 }) }), /HTTP 503/);
  await assert.rejects(dohQuery({ resolver: RESOLVERS[0], name: "x.com", type: "A", fetch: async () => new Response("{}", { status: 200 }) }), /not a DNS answer/);
  await assert.rejects(dohQuery({ resolver: RESOLVERS[0], name: "x.com", type: "AXFR", fetch }), /does not know record type/);
  const empty = await dohQuery({ resolver: RESOLVERS[0], name: "x.com", type: "CAA", fetch: async () => new Response(JSON.stringify({ Status: 0 }), { status: 200 }) });
  assert.deepEqual(empty, { rcode: 0, answers: [] });
});

test("all questions are put at once, so a hanging resolver costs one time limit, not one per question", async () => {
  let inFlight = 0;
  let most = 0;
  const zones = { cloudflare: healthyZone("cloudflare"), google: healthyZone("google") };
  const { query } = fakeDoh(zones);
  const ctx = {
    now: () => NOW, targets: TARGETS.production, env: {},
    dohQuery: async (question) => {
      inFlight += 1; most = Math.max(most, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight -= 1;
      return query(question);
    },
  };
  const checks = await run(ctx);
  assert.ok(checks.every((check) => check.ok));
  // 3 site questions and 12 record questions, to 2 resolvers; a few share a question.
  assert.ok(most >= 20, `only ${most} questions were in flight at once`);
});
