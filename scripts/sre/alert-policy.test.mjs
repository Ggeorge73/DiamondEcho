import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCheck, makeRun } from "./lib/schema.mjs";
import { evaluate, judgeCheck, readComments, statusText, OPEN_AFTER, RESOLVE_AFTER, ESCALATION, isBlindRun, incidentTitle, runbooksFor, duration } from "./alert-policy.mjs";

const MIN = 60_000;
const T0 = Date.parse("2026-11-13T00:00:00.000Z");

const home = (ok, extra = {}) => makeCheck({ id: "public-home", name: "Home page", component: "public-site", severity: "sev1", ok, status: ok ? 200 : 503, detail: ok ? "" : "Answered 503.", slis: [], ...extra });
const terms = (ok, extra = {}) => makeCheck({ id: "public-page-terms", name: "Terms of use page", component: "public-site", severity: "sev3", ok, status: ok ? 200 : 500, detail: ok ? "" : "Answered 500.", slis: [], ...extra });
const idx = (ok) => makeCheck({ id: "search-idx-provider", name: "Georgia MLS search", component: "search", severity: "sev3", ok, status: ok ? 200 : null, slis: [] });

function aRun(at, checks, suite = "fast") {
  return makeRun({ suite, started_at: new Date(at).toISOString(), finished_at: new Date(at + 4000).toISOString(), vantage: { provider: "github-actions", region: "eastus" }, checks });
}

// Replays a list of runs (each a list of checks), 5 minutes apart, through
// the policy; returns every step's output.
function replay(list, { start = T0, every = 5 * MIN, incidents = null, slo = () => null, github = () => null, notify = true, owner = null, suite = "fast" } = {}) {
  let doc = incidents;
  const steps = [];
  list.forEach((checks, index) => {
    const at = start + index * every;
    const out = evaluate({ run: aRun(at, checks, suite), incidents: doc, slo: slo(at, index), now: at + 10_000, github: github(doc, index), notify, owner, links: { repository: "owner/repo" } });
    // Pretend GitHub gave every new issue a number, as alert.mjs would.
    for (const action of out.actions) {
      const incident = out.incidents.open.find((item) => item.key === action.key);
      if (action.kind === "open-issue" && incident) { incident.issue_number = 100 + index; incident.issue_url = `https://github.test/issues/${100 + index}`; }
    }
    doc = out.incidents;
    steps.push(out);
  });
  return { steps, doc, actions: steps.flatMap((step, index) => step.actions.map((action) => ({ ...action, step: index }))) };
}
const kinds = (actions, kind) => actions.filter((action) => action.kind === kind);

test("thresholds: sev1 opens on the 2nd failed run in a row, sev3 on the 3rd, sev4 on the 6th", () => {
  assert.deepEqual(OPEN_AFTER, { sev1: 2, sev2: 2, sev3: 3, sev4: 6 });
  const one = replay([[home(false)]]);
  assert.equal(one.doc.open.length, 0, "a single failed run is not an incident");
  const two = replay([[home(false)], [home(false)]]);
  assert.equal(two.doc.open.length, 1);
  assert.equal(two.doc.open[0].severity, "sev1");
  assert.equal(two.doc.open[0].title, "Website is down");
  assert.equal(two.steps[1].actions[0].kind, "open-issue");
  assert.deepEqual(two.steps[1].actions[0].labels, ["sre-incident", "sev1"]);
  assert.equal(two.doc.open[0].updates[0].text, "Opened: Home page has failed 2 checks in a row.");

  const minor = replay([[terms(false)], [terms(false)], [terms(false)]]);
  assert.equal(minor.steps[1].incidents.open.length, 0);
  assert.equal(minor.doc.open[0].severity, "sev3");
  assert.equal(kinds(minor.actions, "webhook").length, 0, "sev3 goes to the issue only");

  const notice = (ok) => makeCheck({ id: "edge-caa", name: "CAA record", component: "dns", severity: "sev4", ok, slis: [] });
  const notices = replay(Array.from({ length: 6 }, () => [notice(false)]), { suite: "slow", every: 60 * MIN });
  assert.equal(notices.steps[4].incidents.open.length, 0);
  assert.equal(notices.doc.open[0].severity, "sev4");
});

test("one incident per component, however many of its checks fail", () => {
  const out = replay([[home(false), terms(false)], [home(false), terms(false)], [home(false), terms(false)]]);
  assert.equal(out.doc.open.length, 1);
  assert.equal(kinds(out.actions, "open-issue").length, 1);
  assert.deepEqual(out.doc.open[0].failing_checks, ["public-home", "public-page-terms"]);
});

test("flapping: alternating results open one 'on and off' incident, never close and reopen, then resolve once", () => {
  const pattern = Array.from({ length: 24 }, (_, i) => [home(i % 2 === 1)]); // fail, pass, fail, pass, …
  const calm = Array.from({ length: 12 }, () => [home(true)]);
  const out = replay([...pattern, ...calm]);
  assert.equal(kinds(out.actions, "open-issue").length, 1);
  assert.equal(kinds(out.actions, "close-issue").length, 1);
  assert.equal(kinds(out.actions, "reopen-issue").length, 0);
  const opened = kinds(out.actions, "open-issue")[0];
  assert.equal(opened.title, "Website is failing on and off");
  assert.equal(opened.severity, "sev2", "on-and-off is one level below the check's own severity");
  const closed = kinds(out.actions, "close-issue")[0];
  assert.ok(closed.step >= pattern.length + RESOLVE_AFTER - 1, "not closed before a stable recovery");
  // Comments during the flapping are batched: at most one an hour.
  const comments = kinds(out.actions, "comment").filter((action) => action.escalation === undefined);
  assert.ok(comments.length <= Math.ceil((out.steps.length * 5) / 60), `${comments.length} comments`);
});

test("a single good run does not resolve; RESOLVE_AFTER good runs in a row do, with the duration", () => {
  const fail = [home(false)];
  const pass = [home(true)];
  const out = replay([fail, fail, pass, fail, pass, pass, pass]);
  assert.equal(out.steps[2].incidents.open.length, 1, "one good run is not a recovery");
  assert.equal(out.steps[5].incidents.open.length, 1);
  assert.equal(out.steps[6].incidents.open.length, 0);
  const resolved = out.doc.recent[0];
  assert.equal(resolved.key, "public-site");
  assert.equal(resolved.duration_minutes, 25);
  assert.match(resolved.updates.at(-1).text, /^Resolved: .*It lasted 25 minutes\.$/);
  const close = kinds(out.actions, "close-issue")[0];
  assert.match(close.body, /Duration: 25 minutes/);
  assert.equal(close.issue_number, 101);
  // It was announced on the chat webhook, so its end is too.
  assert.match(kinds(out.actions, "webhook").at(-1).text, /Resolved after 25 minutes/);
});

test("severity rises at once when it worsens, with a comment, a relabel and a chat message", () => {
  const out = replay([[terms(false), home(true)], [terms(false), home(true)], [terms(false), home(true)], [terms(false), home(false)], [terms(false), home(false)]]);
  assert.equal(out.steps[2].incidents.open[0].severity, "sev3");
  assert.equal(kinds(out.steps[2].actions, "webhook").length, 0);
  const step = out.steps[4];
  assert.equal(step.incidents.open[0].severity, "sev1");
  assert.equal(step.incidents.open[0].title, "Website is down");
  const relabel = kinds(step.actions, "set-severity")[0];
  assert.deepEqual([relabel.from, relabel.to, relabel.issue_number], ["sev3", "sev1", 102]);
  assert.match(kinds(step.actions, "comment")[0].body, /Severity raised from sev3 to sev1/);
  assert.match(kinds(step.actions, "comment")[0].body, /Home page is failing too/);
  assert.equal(kinds(step.actions, "webhook").length, 1);
  assert.match(step.incidents.open[0].updates.at(-1).text, /^Worse: now a major outage/);
  // The same change is not repeated in the next batched comment.
  const later = replay(Array.from({ length: 20 }, () => [terms(false), home(false)]), { incidents: out.doc, start: T0 + 30 * MIN });
  assert.ok(kinds(later.actions, "comment").every((action) => !/Home page is failing too/.test(action.body)));
});

test("failing again within the hour reopens the same issue instead of a new one", () => {
  const fail = [home(false)];
  const pass = [home(true)];
  const out = replay([fail, fail, pass, pass, pass, fail, fail]);
  assert.equal(kinds(out.actions, "open-issue").length, 1);
  const reopen = kinds(out.actions, "reopen-issue");
  assert.equal(reopen.length, 1);
  assert.equal(reopen[0].issue_number, 101);
  assert.equal(out.doc.open[0].opened_at, out.steps[1].incidents.open[0].opened_at);
  assert.equal(out.doc.recent.length, 0);
});

test("burn alerts open budget incidents, are folded into a component incident, and resolve when gone", () => {
  const sloDoc = (at, alerts) => ({ schema: 1, generated_at: new Date(at).toISOString(), slos: [{ id: "api-availability", name: "API availability" }], burn_alerts: alerts });
  const burn = { slo: "api-availability", component: "api", severity: "sev2", window: "1h", burn_rate: 16, text: "API availability is using its error budget 16 times faster than allowed: 4 of 12 probes were bad." };
  const api = makeCheck({ id: "api-health", name: "API is up", component: "api", severity: "sev2", ok: true, status: 200, slis: [] });
  const alerts = [true, true, false, false];
  const out = replay(alerts.map(() => [api]), { slo: (at, i) => sloDoc(at, alerts[i] ? [burn] : []) });
  assert.equal(out.steps[0].incidents.open[0].key, "budget:api-availability");
  assert.equal(out.steps[0].incidents.open[0].component, "api");
  assert.equal(out.steps[0].incidents.open[0].title, "API availability: failing more often than its target allows");
  assert.equal(kinds(out.actions, "open-issue").length, 1);
  assert.equal(out.steps[2].incidents.open.length, 1, "one quiet evaluation is not enough");
  assert.equal(out.doc.open.length, 0);
  assert.equal(out.doc.recent[0].key, "budget:api-availability");

  // A stale slo.json changes nothing.
  const stale = replay([[api]], { slo: (at) => sloDoc(at - 5 * 60 * MIN, [burn]) });
  assert.equal(stale.doc.open.length, 0);
  assert.match(stale.steps[0].notes.join(" "), /out of date/);

  // While the API has its own incident, the burn alert is noted on it, once.
  const down = (ok) => makeCheck({ id: "api-health", name: "API is up", component: "api", severity: "sev2", ok, status: ok ? 200 : 502, slis: [] });
  const both = replay(Array.from({ length: 16 }, () => [down(false)]), { slo: (at) => sloDoc(at, [burn]) });
  assert.deepEqual(both.doc.open.map((item) => item.key), ["api"]);
  // The budget incident seen first is merged into the API's own incident.
  const merged = kinds(both.actions, "close-issue");
  assert.equal(merged.length, 1);
  assert.match(merged[0].body, /^\*\*Merged:\*\* the same problem is now followed in the API is not working properly incident \[\[issue:api\]\]\./);
  assert.equal(kinds(both.actions, "webhook").filter((action) => /budget|Resolved/.test(action.text)).length, 0);
  const noted = kinds(both.actions, "comment").filter((action) => /Error budget/.test(action.body));
  assert.equal(noted.length, 0, "already known from the merged incident: not repeated");
});

test("a blind monitor counts against nothing and opens one 'monitoring' incident after two runs", () => {
  const dark = [home(false, { status: null }), terms(false, { status: null }), idx(false)];
  assert.equal(isBlindRun(aRun(T0, dark)), true);
  assert.equal(isBlindRun(aRun(T0, [home(false, { status: null }), terms(false, { status: null }), idx(true)])), false);
  const out = replay([[home(true), idx(true)], dark, dark, dark, [home(true), idx(true)], [home(true), idx(true)]]);
  assert.equal(out.steps[1].incidents.open.length, 0);
  assert.deepEqual(out.steps[2].incidents.open.map((item) => [item.key, item.severity, item.title]), [["monitoring", "sev3", "Monitoring cannot see the site"]]);
  assert.ok(out.steps.every((step) => !step.incidents.open.some((item) => item.key === "public-site")), "never a false 'Website is down'");
  assert.equal(out.steps[4].incidents.open.length, 1);
  assert.equal(out.doc.open.length, 0);
  assert.equal(out.doc.engine.checks["public-home"].fails, 0);
});

test("a scheduled suite that stops running opens the monitoring incident", () => {
  const slow = evaluate({ run: aRun(T0, [idx(true)], "slow"), incidents: null, now: T0 });
  const fast = evaluate({ run: aRun(T0 + 4 * 60 * MIN, [home(true), idx(true)]), incidents: slow.incidents, now: T0 + 4 * 60 * MIN });
  const open = fast.incidents.open.find((item) => item.key === "monitoring");
  assert.ok(open);
  assert.match(open.updates[0].text, /slow checks have not run since 2026-11-13T00:00:00.000Z/);
});

test("escalation: sev1 reminders at 15, 45 and 120 minutes, naming the owner; acknowledgement stops them", () => {
  assert.deepEqual(ESCALATION.sev1, [15, 45, 120]);
  const fails = Array.from({ length: 30 }, () => [home(false)]);
  const out = replay(fails, { owner: "example-owner" });
  const reminders = kinds(out.actions, "comment").filter((action) => action.escalation);
  assert.deepEqual(reminders.map((action) => action.escalation), [1, 2, 3]);
  assert.match(reminders[0].body, /^@example-owner \*\*Reminder 1 of 3:\*\*/);
  assert.match(reminders[0].body, /site-down\.md/);
  assert.equal(kinds(out.actions, "webhook").length, 4, "open + three reminders");

  // A person comments on the issue before the first reminder.
  const acked = replay(fails, { github: (doc) => (doc?.open?.[0]?.issue_number ? { [doc.open[0].issue_number]: { open: true, acknowledged: true, silenced: false } } : null) });
  assert.equal(kinds(acked.actions, "comment").filter((action) => action.escalation).length, 0);

  // A bad owner value is never turned into a mention.
  const odd = replay(fails.slice(0, 6), { owner: "x y @everyone" });
  assert.ok(kinds(odd.actions, "comment").every((action) => !action.body.includes("@")));
});

test("a person closing the issue silences it; the incident still resolves without a second close", () => {
  const fails = Array.from({ length: 6 }, () => [home(false)]);
  const passes = Array.from({ length: 3 }, () => [home(true)]);
  const out = replay([...fails, ...passes], { github: (doc, i) => (i >= 3 && doc?.open?.[0] ? { [doc.open[0].issue_number]: { open: false } } : null) });
  const after = out.actions.filter((action) => action.step >= 3);
  assert.equal(kinds(after, "comment").length, 0);
  assert.equal(kinds(after, "webhook").length, 0);
  assert.equal(kinds(after, "close-issue").length, 0);
  assert.equal(out.doc.recent[0].key, "public-site");
});

test("in a dry run a missing issue is not re-announced every run; live, it is retried", () => {
  const fails = Array.from({ length: 4 }, () => [home(false)]);
  let doc = null;
  const opens = [];
  fails.forEach((checks, i) => {
    const out = evaluate({ run: aRun(T0 + i * 5 * MIN, checks), incidents: doc, now: T0 + i * 5 * MIN, notify: false });
    opens.push(kinds(out.actions, "open-issue").length);
    doc = out.incidents;
  });
  assert.deepEqual(opens, [0, 1, 0, 0]);
  const live = evaluate({ run: aRun(T0 + 30 * MIN, [home(false)]), incidents: doc, now: T0 + 30 * MIN, notify: true });
  assert.equal(kinds(live.actions, "open-issue").length, 1);
});

test("the same run processed twice changes nothing", () => {
  const first = evaluate({ run: aRun(T0, [home(false)]), incidents: null, now: T0 });
  const again = evaluate({ run: aRun(T0, [home(false)]), incidents: first.incidents, now: T0 + MIN });
  assert.equal(again.incidents.engine.checks["public-home"].fails, 1);
  assert.deepEqual(again.actions, []);
});

test("issue text is public-safe and says what to do", () => {
  const out = replay([[home(false)], [home(false)]]);
  const body = out.steps[1].actions[0].body;
  assert.match(body, /What visitors notice:/);
  assert.match(body, /\*\*Failing since:\*\* 2026-11-13 00:00 UTC\./);
  assert.match(body, /\[docs\/sre\/runbooks\/site-down\.md\]\(https:\/\/github\.com\/owner\/repo\/blob\/main\/docs\/sre\/runbooks\/site-down\.md\)/);
  assert.match(body, /`acknowledged` label/);
  assert.match(body, /first line starting `ack`/);
  assert.match(body, /first line starting `Status:`/);
  assert.match(body, /<!-- sre-incident-key: public-site -->/);
  // A detail cannot close the marker comment or add lines.
  const sneaky = replay([[home(false, { detail: "x -->\n<script>" })], [home(false, { detail: "x -->\n<script>" })]]);
  assert.ok(!sneaky.steps[1].actions[0].body.includes("x -->"));
});

test("runbooks: one per component, bad-deploy first after a deploy of that part", () => {
  assert.deepEqual(runbooksFor("search"), ["docs/sre/runbooks/search-provider-down.md"]);
  assert.deepEqual(runbooksFor("api", { recentDeploy: true })[0], "docs/sre/runbooks/bad-deploy.md");
  assert.deepEqual(runbooksFor("tls", { recentDeploy: true }), ["docs/sre/runbooks/tls-certificate.md"]);
  assert.deepEqual(runbooksFor("monitoring"), ["docs/sre/runbooks/monitoring-is-blind.md"]);
  const deploys = [{ at: new Date(T0).toISOString(), what: "api", check: "api-identity", fact: "revision", from: "a", to: "b" }];
  const api = (ok) => makeCheck({ id: "api-health", name: "API is up", component: "api", severity: "sev2", ok, status: ok ? 200 : 500, slis: [] });
  const first = evaluate({ run: aRun(T0, [api(false)]), now: T0, deploys });
  const second = evaluate({ run: aRun(T0 + 5 * MIN, [api(false)]), incidents: first.incidents, now: T0 + 5 * MIN, deploys });
  assert.match(second.actions[0].body, /bad-deploy\.md/);
});

test("small helpers", () => {
  assert.equal(judgeCheck({ ok: false, fails: 1, fail_severity: "sev1", recent: "0" }), null);
  assert.deepEqual(judgeCheck({ ok: true, fails: 0, fail_severity: "sev2", recent: "010101011" }), { severity: "sev3", intermittent: true });
  assert.equal(incidentTitle({ component: "dns", severity: "sev4" }), "DNS: notice");
  assert.equal(duration(59), "59 minutes");
  assert.equal(duration(61), "1 hour 1 minute");
  assert.equal(duration(60 * 72), "3 days");
});

test("acknowledgement needs 'ack' or 'Acknowledged' from a person; any other comment does not count", () => {
  const opened = "2026-11-13T00:10:00.000Z";
  const say = (first_line, extra = {}) => ({ login: "someone", bot: false, created_at: "2026-11-13T00:20:00.000Z", first_line, ...extra });
  for (const line of ["ack", "Ack: on it", "ACK.", "Acknowledged", "acknowledged, rolling back"]) assert.equal(readComments([say(line)], opened).acknowledged, true, line);
  // The old rule counted every one of these; an AI agent posting through a
  // person's account would have silenced a sev1.
  for (const line of ["Looking into the logs now", "Acknowledgement pending", "Status: investigating", "back soon", "packing up"]) {
    assert.equal(readComments([say(line)], opened).acknowledged, false, line);
  }
  assert.equal(readComments([say("ack", { bot: true })], opened).acknowledged, false, "a bot cannot acknowledge");
  assert.equal(readComments([say("ack", { created_at: "2026-11-13T00:00:00.000Z" })], opened).acknowledged, false, "a comment from before the incident does not count");

  const fails = Array.from({ length: 8 }, () => [home(false)]);
  const chatty = replay(fails, { github: (doc) => (doc?.open?.[0]?.issue_number ? { [doc.open[0].issue_number]: { open: true, ...readComments([say("Looking into it")], doc.open[0].opened_at) } } : null) });
  assert.equal(kinds(chatty.actions, "comment").filter((action) => action.escalation).length, 1, "a non-ack comment does not stop the 15-minute reminder");
});

test("a person's 'Status:' line reaches the status page once, as one short public line", () => {
  const status = { at: "2026-11-13T00:12:00.000Z", text: statusText("Status: Rolling back to the previous version <b>now</b>") };
  assert.equal(status.text, "Rolling back to the previous version bnow/b");
  assert.equal(statusText(`Status: ${"x".repeat(400)}`).length, 280);
  const said = readComments([
    { login: "p", bot: false, created_at: "2026-11-13T00:12:00.000Z", first_line: "status:   Rolling back" },
    { login: "b", bot: true, created_at: "2026-11-13T00:13:00.000Z", first_line: "Status: from a bot" },
    { login: "p", bot: false, created_at: "2026-11-13T00:14:00.000Z", first_line: "Status:" },
  ], "2026-11-13T00:10:00.000Z");
  assert.deepEqual(said.statuses, [{ at: "2026-11-13T00:12:00.000Z", text: "Rolling back" }]);

  const fails = Array.from({ length: 5 }, () => [home(false)]);
  const out = replay(fails, { github: (doc) => (doc?.open?.[0]?.issue_number ? { [doc.open[0].issue_number]: { open: true, acknowledged: false, statuses: said.statuses } } : null) });
  const texts = out.doc.open[0].updates.map((update) => update.text);
  assert.equal(texts.filter((text) => text === "Rolling back").length, 1);
  assert.equal(out.doc.open[0].updates.find((update) => update.text === "Rolling back").at, "2026-11-13T00:12:00.000Z");
});

test("a slow budget burn (sev4) opens no issue; it stays a note for the weekly review", () => {
  const sloDoc = (at, alerts) => ({ schema: 1, generated_at: new Date(at).toISOString(), slos: [{ id: "public-availability", name: "Website availability" }], burn_alerts: alerts });
  const slow = { slo: "public-availability", component: "public-site", severity: "sev4", window: "3d", burn_rate: 1.2, text: "Slow burn." };
  const medium = { ...slow, severity: "sev3", window: "6h", text: "Medium burn." };
  const quiet = replay([[home(true)], [home(true)]], { slo: (at) => sloDoc(at, [slow]) });
  assert.deepEqual(quiet.doc.open, []);
  assert.deepEqual(quiet.actions, []);
  // A medium burn opens; when only the slow burn is left, it closes as usual.
  const steps = [[medium], [slow], [slow]];
  const out = replay(steps.map(() => [home(true)]), { slo: (at, i) => sloDoc(at, steps[i]) });
  assert.equal(out.steps[0].incidents.open[0].key, "budget:public-availability");
  assert.equal(out.steps[0].incidents.open[0].severity, "sev3");
  assert.equal(out.doc.open.length, 0);
});
