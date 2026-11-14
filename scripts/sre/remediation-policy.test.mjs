// Every guardrail of the automatic rollback has a test here. No network, no
// files except the check modules read as text (to keep API_CHECKS honest).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  plan, verify, summarize, fingerprint, mayAct, isAllowedCommand, rollbackCommand, isRevisionName,
  API_CHECKS, CATALOGUE, ROLLBACK, STATUS_COMMAND, LIMITS,
} from "./remediation-policy.mjs";

const NOW = Date.parse("2026-11-13T12:00:00.000Z");
const at = (minutesAgo) => new Date(NOW - minutesAgo * 60_000).toISOString();
const OLD = "diamondecho-api-00028-zin";
const NEW = "diamondecho-api-00031-abc";

function check(id, component, severity, ok, extra = {}) {
  return { name: id, component, severity, suite: "fast", ok, status: ok ? 200 : 500, latency_ms: 100, detail: "",
    checked_at: at(1), consecutive_failures: ok ? 0 : 3, last_ok_at: ok ? at(1) : at(30), last_failure_at: ok ? null : at(1), observed: {}, ...extra };
}

// A bad deploy, everything else healthy, the plan already written down once.
function scenario() {
  return {
    now: NOW,
    status: {
      schema: 1, updated_at: at(0.5), overall: "degraded",
      components: {
        "public-site": { name: "Website", state: "operational" },
        dns: { name: "DNS", state: "degraded" }, // DMARC (sev3) is missing today: must not block
        api: { name: "API", state: "outage" },
      },
      checks: {
        "public-home": check("public-home", "public-site", "sev1", true),
        "edge-hsts": check("edge-hsts", "public-site", "sev3", false),
        "dns-apex-resolves": check("dns-apex-resolves", "dns", "sev1", true, { suite: "slow", checked_at: at(53) }),
        "dns-mail-dmarc": check("dns-mail-dmarc", "dns", "sev3", false, { suite: "slow", checked_at: at(53) }),
        "api-health": check("api-health", "api", "sev2", false),
        "api-identity": check("api-identity", "api", "sev2", true, { observed: { revision: NEW, commit: "d728ded" } }),
        "api-docs-off": check("api-docs-off", "api", "sev3", false, { suite: "slow", checked_at: at(53) }),
        "inquiry-page": check("inquiry-page", "inquiry", "sev2", true),
        "inquiry-route": check("inquiry-route", "inquiry", "sev2", true, { status: 405 }),
      },
    },
    incidents: {
      schema: 1, engine: {}, recent: [],
      open: [{ key: "api", component: "api", severity: "sev2", title: "API is down", opened_at: at(20), failing_checks: ["api-health"], issue_number: 41 }],
    },
    deploys: [
      { at: at(29), what: "api", check: "api-identity", fact: "revision", from: OLD, to: NEW },
      { at: at(29), what: "api", check: "api-identity", fact: "commit", from: "90739bd", to: "d728ded" },
    ],
    log: [
      { at: at(5.5), trigger: "api", action: ROLLBACK, decision: "skipped", code: "pending-confirmation", reason: "…",
        from_revision: NEW, to_revision: OLD, verified: null, incident_key: "api", incident_opened_at: at(20) },
    ],
    cloudrun: {
      ok: true,
      data: {
        serving: [{ revision: NEW, percent: 100 }],
        tags: [],
        // No images here, so the commit the monitor saw change is the proof
        // of new code; the image path has tests of its own.
        revisions: [
          { name: NEW, created: at(40), ready: true, settings: "s-1" },
          { name: "diamondecho-api-00030-xyz", created: at(41), ready: false, settings: "s-1" },
          { name: OLD, created: "2026-10-26T13:45:00.000Z", ready: true, settings: "s-1" },
        ],
      },
    },
  };
}

const only = (input) => {
  const { decisions } = plan(input);
  assert.equal(decisions.length, 1, JSON.stringify(decisions, null, 1));
  return decisions[0];
};
const expectSkip = (input, code) => {
  const decision = only(input);
  assert.equal(decision.decision, "skipped", decision.reason);
  assert.equal(decision.code, code, decision.reason);
  assert.ok(decision.reason.length > 10);
  return decision;
};

test("the bad-deploy picture proceeds to a rollback to the revision seen before", () => {
  const decision = only(scenario());
  assert.equal(decision.decision, "proceed", decision.reason);
  assert.equal(decision.from_revision, NEW);
  assert.equal(decision.to_revision, OLD);
  assert.equal(decision.issue_number, 41);
  assert.deepEqual(decision.verify_checks, ["api-health"], "only sev1/sev2 checks are verified");
});

test("files first: Cloud Run is asked only after every file guardrail passed", () => {
  const input = scenario();
  delete input.cloudrun;
  assert.deepEqual(plan(input), { decisions: [], needsCloudRun: true });
  input.incidents.open[0].severity = "sev3";
  assert.equal(plan(input).needsCloudRun, false);
});

test("first sighting only writes the plan down; it acts on a later failed run", () => {
  const input = scenario();
  input.log = [];
  const first = expectSkip(input, "pending-confirmation");
  assert.equal(first.to_revision, OLD);
  assert.match(summarize(first), /^No action yet\. Plan: move all API traffic/);
  // Plan written, but the checks have not failed again since.
  input.log = [{ ...first, at: at(0.5) }];
  expectSkip(input, "pending-confirmation");
  // A plan for a different target does not count.
  input.log = [{ ...first, at: at(5), to_revision: "diamondecho-api-00025-sij" }];
  expectSkip(input, "pending-confirmation");
  // An earlier dry run of the same plan counts as the sighting.
  input.log = [{ ...first, at: at(5), decision: "dry-run", code: "would-roll-back" }];
  assert.equal(only(input).decision, "proceed");
});

test("only open sev1 and sev2 incidents are considered", () => {
  const input = scenario();
  input.incidents.open[0].severity = "sev3";
  expectSkip(input, "severity-too-low");
  input.incidents.open = [];
  input.incidents.recent = [{ ...scenario().incidents.open[0], resolved_at: at(1), duration_minutes: 19 }];
  assert.deepEqual(plan(input).decisions, []);
});

test("parts with no automatic fix are logged with their runbook", () => {
  const input = scenario();
  input.incidents.open = [{ key: "public-site", component: "public-site", severity: "sev1", opened_at: at(10) }];
  const decision = expectSkip(input, "no-automatic-fix");
  assert.equal(decision.action, "none");
  assert.equal(decision.runbook, "docs/sre/runbooks/site-down.md");
  for (const part of ["public-site", "staff-site", "search", "dns", "tls", "domain"]) assert.equal(CATALOGUE[part].action, "none");
  input.incidents.open = [{ key: "x", component: "something-new", severity: "sev1", opened_at: at(10) }];
  expectSkip(input, "no-automatic-fix");
});

test("a monitoring incident (Cloudflare refusing the monitor) never touches the API", () => {
  const input = scenario();
  input.incidents.open = [{ key: "monitoring", component: "monitoring", severity: "sev2", opened_at: at(10) }];
  const decision = expectSkip(input, "no-automatic-fix");
  assert.equal(decision.action, "none");
  assert.match(decision.runbook, /cloudflare-outage\.md/);
  const text = summarize(decision);
  assert.match(text, /Monitoring/);
  assert.equal(text.match(/A person follows/g).length, 1, text);
});

test("a failure seen once is not confirmed", () => {
  const input = scenario();
  input.status.checks["api-health"].consecutive_failures = 1;
  expectSkip(input, "not-confirmed");
});

test("nothing failing right now means nothing to fix; sev3 failures do not count", () => {
  const input = scenario();
  input.status.checks["api-health"] = check("api-health", "api", "sev2", true);
  expectSkip(input, "checks-pass-now"); // api-docs-off (sev3) still fails
  input.status.checks["api-health"] = check("api-health", "api", "sev2", false, { checked_at: at(45) });
  expectSkip(input, "checks-pass-now");
});

test("stale or missing monitoring data blocks the engine", () => {
  const input = scenario();
  input.status.updated_at = at(LIMITS.freshMinutes + 1);
  expectSkip(input, "status-stale");
  input.status = null;
  expectSkip(input, "status-stale");
});

test("an incident open too long is left to a person", () => {
  const input = scenario();
  input.incidents.open[0].opened_at = at(LIMITS.actWithinMinutes + 1);
  expectSkip(input, "incident-too-old");
  input.incidents.open[0].opened_at = "not a time";
  expectSkip(input, "incident-unreadable");
});

test("the website must be healthy", () => {
  let input = scenario();
  input.status.checks["public-home"] = check("public-home", "public-site", "sev1", false);
  expectSkip(input, "site-or-dns-unhealthy");
  input = scenario();
  input.status.components["public-site"].state = "outage";
  expectSkip(input, "site-or-dns-unhealthy");
  input = scenario();
  input.incidents.open.push({ key: "public-site", component: "public-site", severity: "sev1", opened_at: at(10) });
  assert.equal(plan(input).decisions.find((d) => d.trigger === "api").code, "site-or-dns-unhealthy");
  input = scenario();
  input.status.checks["public-home"].checked_at = at(LIMITS.freshMinutes + 5);
  expectSkip(input, "site-or-dns-unhealthy");
});

test("DNS must be healthy; a sev3 DNS failure (no DMARC) does not block", () => {
  let input = scenario();
  assert.equal(only(input).decision, "proceed");
  input.status.checks["dns-apex-resolves"] = check("dns-apex-resolves", "dns", "sev1", false, { checked_at: at(53) });
  expectSkip(input, "site-or-dns-unhealthy");
  input = scenario();
  input.status.checks["dns-apex-resolves"].checked_at = at(LIMITS.dnsFreshMinutes + 1);
  expectSkip(input, "site-or-dns-unhealthy");
  input = scenario();
  input.incidents.open.push({ key: "dns", component: "dns", severity: "sev2", opened_at: at(10) });
  assert.equal(plan(input).decisions.find((d) => d.trigger === "api").code, "site-or-dns-unhealthy");
});

test("a minor (sev3 or sev4) website or DNS incident is a notice and does not block the rollback", () => {
  for (const [component, severity] of [["dns", "sev3"], ["dns", "sev4"], ["public-site", "sev3"]]) {
    const input = scenario();
    input.incidents.open.push({ key: component, component, severity, opened_at: at(600) });
    assert.equal(plan(input).decisions.find((d) => d.trigger === "api").decision, "proceed", `${component} ${severity}`);
  }
});

test("the analysis check is serious enough for the calculators rollback to be reachable", async () => {
  const { run } = await import("./checks/calculators.mjs");
  const source = run.toString();
  assert.match(source, /id: "calculators-api-analyze"[^}]*severity: "sev2"/);
  assert.ok(API_CHECKS.calculators.includes("calculators-api-analyze"));
});

test("refusals are not API faults", () => {
  const input = scenario();
  for (const status of [401, 403, 429]) {
    input.status.checks["api-health"].status = status;
    expectSkip(input, "not-api-fault");
  }
  input.status.checks["api-health"].status = null; // no answer at all
  assert.equal(only(input).decision, "proceed");
});

test("inquiry: only API checks count, and the queue's 503 is not a fault", () => {
  const input = scenario();
  input.incidents.open = [{ key: "inquiry", component: "inquiry", severity: "sev2", opened_at: at(20) }];
  input.log = [{ ...input.log[0], incident_key: "inquiry" }];
  input.status.checks["api-health"] = check("api-health", "api", "sev2", true);
  input.status.checks["inquiry-route"] = check("inquiry-route", "inquiry", "sev2", false, { status: 500 });
  assert.equal(only(input).decision, "proceed");
  input.status.checks["inquiry-route"].status = 503;
  expectSkip(input, "not-api-fault");
  input.status.checks["inquiry-route"].status = 500;
  input.status.checks["inquiry-page"] = check("inquiry-page", "inquiry", "sev2", false, { status: 502 });
  const decision = expectSkip(input, "not-api-fault");
  assert.match(decision.reason, /on the website, not the API/);
});

test("calculators: a failing page on Cloudflare Pages never triggers an API rollback", () => {
  const input = scenario();
  input.incidents.open = [{ key: "calculators", component: "calculators", severity: "sev2", opened_at: at(20) }];
  input.status.checks["calculators-deal-page"] = check("calculators-deal-page", "calculators", "sev2", false, { status: 503 });
  expectSkip(input, "not-api-fault");
});

test("API_CHECKS names checks that exist in the check modules", () => {
  for (const [part, ids] of Object.entries(API_CHECKS)) {
    const file = { inquiry: "inquiry.mjs", calculators: "calculators.mjs" }[part];
    const source = readFileSync(new URL(`./checks/${file}`, import.meta.url), "utf8");
    for (const id of ids) assert.ok(source.includes(`id: "${id}"`), `${id} is not in checks/${file}`);
  }
});

test("at most one attempt in 24 hours, acted or failed", () => {
  const input = scenario();
  const attempt = { at: at(60 * 3), trigger: "api", action: ROLLBACK, decision: "acted", from_revision: "diamondecho-api-00020-aaa", to_revision: "diamondecho-api-00019-bbb", incident_key: "api", incident_opened_at: at(200), verified: false };
  input.log = [attempt, ...input.log];
  const decision = expectSkip(input, "rollback-limit");
  assert.match(decision.reason, /a person/);
  input.log[0] = { ...attempt, decision: "failed" };
  expectSkip(input, "rollback-limit");
  input.log[0] = { ...attempt, at: at(60 * 25) };
  assert.equal(only(input).decision, "proceed");
  input.log[0] = { ...attempt, at: at(60 * 3), decision: "dry-run" };
  assert.equal(only(input).decision, "proceed", "a dry run is not an attempt");
});

test("never twice to the same target", () => {
  const input = scenario();
  input.log = [{ at: at(60 * 30), trigger: "api", action: ROLLBACK, decision: "acted", from_revision: "diamondecho-api-00029-qqq", to_revision: OLD, incident_key: "api", incident_opened_at: at(60 * 31) }, ...input.log];
  expectSkip(input, "same-target");
});

test("an incident already acted on is not judged again", () => {
  const input = scenario();
  input.log.push({ ...input.log[0], at: at(1), decision: "acted", code: "roll-back" });
  assert.deepEqual(plan(input).decisions, []);
});

test("no recent deploy, no rollback", () => {
  let input = scenario();
  input.deploys = [{ at: "2026-10-26T14:00:00.000Z", what: "api", fact: "revision", from: "diamondecho-api-00025-sij", to: OLD }];
  input.cloudrun.data.serving = [{ revision: OLD, percent: 100 }];
  expectSkip(input, "no-recent-deploy");
  // Window measured from when the monitor saw it serving.
  input = scenario();
  input.incidents.open[0].opened_at = at(5);
  input.deploys = input.deploys.map((line) => ({ ...line, at: at(5 + LIMITS.deployWindowMinutes + 1) }));
  input.cloudrun.data.revisions[0].created = at(5 + LIMITS.deployWindowMinutes + 10);
  expectSkip(input, "no-recent-deploy");
});

test("an incident that opened before the revision cannot have been caused by it", () => {
  let input = scenario();
  input.cloudrun.data.revisions[0].created = at(15); // after the incident (20 minutes ago)
  expectSkip(input, "incident-before-deploy");
  input = scenario();
  input.deploys = input.deploys.map((line) => ({ ...line, at: at(10) })); // monitor saw it after the incident
  expectSkip(input, "incident-before-deploy");
});

test("a deploy in progress, or unreadable Cloud Run: hands off", () => {
  let input = scenario();
  input.cloudrun.data.serving = [{ revision: NEW, percent: 50 }, { revision: OLD, percent: 50 }];
  expectSkip(input, "deploy-in-progress");
  input = scenario();
  input.cloudrun.data.tags = [{ tag: "candidate", revision: "diamondecho-api-00032-cnd" }];
  expectSkip(input, "deploy-in-progress");
  input = scenario();
  delete input.cloudrun.data.tags; // status.sh does not report tags: unknown is a no
  expectSkip(input, "deploy-in-progress");
  input = scenario();
  input.cloudrun.data.tags = [{ tag: "old-fallback", revision: OLD }];
  assert.equal(only(input).decision, "proceed", "another tag is not a deploy");
  input = scenario();
  input.cloudrun = { ok: false, error: "status.sh exited with code 2" };
  expectSkip(input, "cloud-run-unreadable");
  input = scenario();
  input.cloudrun.data.serving = [{ revision: "something-else-1", percent: 100 }];
  expectSkip(input, "serving-unknown");
});

test("the previous revision must be known, valid, listed, ready and older", () => {
  let input = scenario();
  input.deploys = [];
  input.status.checks["api-identity"].observed = { revision: NEW };
  expectSkip(input, "no-previous-revision");
  input = scenario();
  expectSkip({ ...input, deploysUnreadable: true }, "no-previous-revision");
  input = scenario();
  input.deploys[0].from = "other-service-00001-aaa";
  expectSkip(input, "previous-invalid");
  input = scenario();
  input.cloudrun.data.revisions = input.cloudrun.data.revisions.filter((r) => r.name !== OLD);
  expectSkip(input, "previous-missing");
  input = scenario();
  input.cloudrun.data.revisions[2].ready = false;
  expectSkip(input, "previous-not-ready");
  input = scenario();
  input.cloudrun.data.revisions[2].created = at(1);
  expectSkip(input, "previous-not-older");
});

test("when the new revision never answered, the last revision the monitor saw is the target", () => {
  const input = scenario();
  // The monitor never read NEW's name: the last line it wrote is the move to OLD.
  input.deploys = [{ at: "2026-10-26T14:00:00.000Z", what: "api", fact: "revision", from: "diamondecho-api-00025-sij", to: OLD }];
  input.status.checks["api-identity"] = check("api-identity", "api", "sev2", false, { observed: { revision: OLD } });
  // Without images the engine cannot prove new code: hands off.
  expectSkip(input, "cannot-tell-new-code");
  // With images (if status.sh reports them) it can.
  input.cloudrun.data.revisions[0].image = "us-east1-docker.pkg.dev/p/r/api@sha256:bbb";
  input.cloudrun.data.revisions[2].image = "us-east1-docker.pkg.dev/p/r/api@sha256:aaa";
  const decision = only(input);
  assert.equal(decision.decision, "proceed");
  assert.equal(decision.to_revision, OLD);
});

test("a settings-only revision is never rolled back", () => {
  let input = scenario();
  input.cloudrun.data.revisions[0].image = "img@sha256:same";
  input.cloudrun.data.revisions[2].image = "img@sha256:same";
  expectSkip(input, "settings-only");
  input = scenario();
  input.deploys = input.deploys.filter((line) => line.fact !== "commit");
  expectSkip(input, "settings-only"); // the API publishes a commit and it did not change
  input.status.checks["api-identity"].observed = { revision: NEW };
  expectSkip(input, "cannot-tell-new-code"); // no commit published at all
});

test("going back must not bring back different settings", () => {
  let input = scenario();
  input.cloudrun.data.revisions[2].settings = "s-0"; // e.g. the queue switch was different then
  const decision = expectSkip(input, "settings-differ");
  assert.match(decision.reason, /inquiry queue switch/);
  input = scenario();
  delete input.cloudrun.data.revisions[2].settings;
  expectSkip(input, "settings-differ");
  input = scenario();
  input.cloudrun.data.revisions[0].settings = "";
  expectSkip(input, "settings-differ");
});

test("trouble that started before the deploy is not blamed on it", () => {
  const input = scenario();
  input.incidents.recent = [{ key: "api", component: "api", severity: "sev2", opened_at: at(120), resolved_at: at(60), duration_minutes: 60 }];
  expectSkip(input, "unstable-before-deploy");
  input.incidents.recent[0] = { ...input.incidents.recent[0], opened_at: at(60 * 9), resolved_at: at(60 * 8) };
  assert.equal(only(input).decision, "proceed");
});

test("one rollback covers incidents on the API, the form and the calculators together", () => {
  const input = scenario();
  input.incidents.open.unshift({ key: "inquiry", component: "inquiry", severity: "sev2", opened_at: at(19) });
  input.status.checks["inquiry-route"] = check("inquiry-route", "inquiry", "sev2", false, { status: 502 });
  input.log.push({ ...input.log[0], incident_key: "inquiry", incident_opened_at: at(19) });
  const { decisions } = plan(input);
  assert.equal(decisions.length, 2);
  assert.equal(decisions[0].trigger, "api");
  assert.equal(decisions[0].decision, "proceed");
  assert.equal(decisions[1].code, "covered-by-other");
});

test("the damaged log blocks acting", () => {
  expectSkip({ ...scenario(), logUnreadable: true }, "log-unreadable");
});

test("the switch: --apply and SRE_AUTOREMEDIATE exactly enabled", () => {
  assert.equal(mayAct({ apply: true, env: { SRE_AUTOREMEDIATE: "enabled" } }), true);
  assert.equal(mayAct({ apply: true, env: { SRE_AUTOREMEDIATE: " enabled\n" } }), true);
  for (const value of [undefined, "", "Enabled", "true", "1", "yes", "disabled"]) {
    assert.equal(mayAct({ apply: true, env: { SRE_AUTOREMEDIATE: value } }), false, String(value));
  }
  assert.equal(mayAct({ apply: false, env: { SRE_AUTOREMEDIATE: "enabled" } }), false);
  assert.equal(mayAct({ apply: "yes", env: { SRE_AUTOREMEDIATE: "enabled" } }), false);
});

test("the allowlist: exactly two commands, nothing else", () => {
  assert.deepEqual(rollbackCommand(OLD), { file: "bash", args: ["scripts/sre/cloudrun/rollback.sh", "--to", OLD, "--apply"] });
  assert.equal(isAllowedCommand(STATUS_COMMAND.file, STATUS_COMMAND.args), true);
  assert.equal(isAllowedCommand("bash", ["scripts/sre/cloudrun/rollback.sh", "--to", OLD, "--apply"]), true);
  const refused = [
    ["sh", ["scripts/sre/cloudrun/status.sh"]],
    ["bash", ["scripts/sre/cloudrun/deploy.sh", "--apply"]],
    ["bash", ["scripts/sre/cloudrun/rollback.sh", "--to", OLD]],
    ["bash", ["scripts/sre/cloudrun/rollback.sh", "--to", `${OLD};rm`, "--apply"]],
    ["bash", ["scripts/sre/cloudrun/rollback.sh", "--to", "other-api-00001-aaa", "--apply"]],
    ["bash", ["scripts/sre/cloudrun/rollback.sh", "--to", "diamondecho-api-00001-AAA", "--apply"]],
    ["bash", ["scripts/sre/cloudrun/rollback.sh", "--to", `${OLD} --project x`, "--apply"]],
    ["bash", ["-c", "gcloud run services update diamondecho-api --update-env-vars X=1"]],
    ["gcloud", ["run", "services", "update-traffic", "diamondecho-api", `--to-revisions=${OLD}=100`]],
  ];
  for (const [file, args] of refused) assert.equal(isAllowedCommand(file, args), false, `${file} ${args.join(" ")}`);
  assert.throws(() => rollbackCommand("$(reboot)"));
  assert.equal(isRevisionName(`diamondecho-api-${"a".repeat(60)}`), false, "too long");
});

test("verification: passes, fails, waits and gives up", () => {
  const line = { at: at(20), from_revision: NEW, to_revision: OLD, runbook: "docs/sre/runbooks/api-down.md", verify: { checks: ["api-health"] } };
  const base = scenario().status;
  base.checks["api-identity"].observed = { revision: OLD }; // traffic moved, health still failing
  const passing = structuredClone(base);
  passing.checks["api-health"] = check("api-health", "api", "sev2", true);
  passing.checks["api-identity"].observed = { revision: OLD };
  assert.equal(verify({ line, status: passing, now: NOW }).verified, true);

  const elsewhere = structuredClone(passing);
  elsewhere.checks["api-identity"].observed = { revision: "diamondecho-api-00032-new" };
  assert.equal(verify({ line, status: elsewhere, now: NOW }).verified, false);

  assert.equal(verify({ line, status: base, now: NOW }).verified, null, "still failing, but within 30 minutes");
  assert.equal(verify({ line: { ...line, at: at(LIMITS.verifyMinutes + 5) }, status: base, now: NOW }).verified, false);

  const notRechecked = structuredClone(passing);
  notRechecked.checks["api-health"].checked_at = at(25);
  assert.equal(verify({ line, status: notRechecked, now: NOW }).verified, null);

  assert.equal(verify({ line, status: null, now: NOW }).verified, null);
  assert.equal(verify({ line: { ...line, at: at(60 * 25) }, status: null, now: NOW }).verified, false);
});

test("summaries are plain and complete for every kind of decision", () => {
  const basis = { trigger: "api", from_revision: NEW, to_revision: OLD, reason: "Because.", runbook: "docs/sre/runbooks/api-down.md" };
  for (const kind of ["acted", "dry-run", "failed", "skipped"]) {
    const text = summarize({ ...basis, decision: kind, code: "x" });
    assert.doesNotMatch(text, /undefined|null|\[object/);
  }
  assert.match(summarize({ ...basis, decision: "acted" }), /Nothing else was changed/);
  assert.match(summarize({ ...basis, decision: "dry-run" }), /^Dry run, nothing was changed/);
});

test("the fingerprint tells a repeat from a change", () => {
  const a = { incident_key: "api", incident_opened_at: at(1), decision: "skipped", code: "not-confirmed", from_revision: null, to_revision: null };
  assert.equal(fingerprint(a), fingerprint({ ...a, reason: "different words" }));
  assert.notEqual(fingerprint(a), fingerprint({ ...a, code: "status-stale" }));
});
