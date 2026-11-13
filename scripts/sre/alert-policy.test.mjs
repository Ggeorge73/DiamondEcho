import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCheck, makeRun } from "./lib/schema.mjs";
import { evaluate, isTrusted, judgeCheck, isOutsideCheck, oneLine, cloudflareRefusal, readComments, statusText, OPEN_AFTER, RESOLVE_AFTER, ESCALATION, isBlindRun, incidentTitle, runbooksFor, duration } from "./alert-policy.mjs";

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
  // Failures at 00:00 (first) to 00:15 (last); confirmed, then closed after a stable recovery.
  assert.equal(resolved.updates.at(-1).text, "Resolved: every check has passed at least 3 runs in a row. Checks failed from 00:00 to 00:15 UTC; the incident was open for 25 minutes.");
  assert.ok(resolved.updates.every((update) => !/\.\./.test(update.text)), "no double full stop");
  const close = kinds(out.actions, "close-issue")[0];
  assert.match(close.body, /the incident was open for 25 minutes/);
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
  // The budget incident seen first hands its issue over to the API's own
  // incident: one issue, retitled and continued, never closed and replaced.
  assert.equal(kinds(both.actions, "close-issue").length, 0);
  assert.equal(kinds(both.actions, "open-issue").length, 1);
  const takeover = kinds(both.actions, "take-over-issue");
  assert.deepEqual(takeover.map((action) => [action.key, action.from_key, action.from_severity, action.severity]), [["api", "budget:api-availability", "sev2", "sev2"]]);
  assert.match(takeover[0].body, /^\*\*Now followed here as: API is not working properly\.\*\*/);
  assert.equal(both.doc.open[0].issue_number, both.steps[0].incidents.open[0].issue_number, "the same issue number");
  assert.match(both.doc.recent[0].updates.at(-1).text, /^Followed from now on in the API is not working properly incident, on the same issue\.$/);
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
  // A Cloudflare refusal shows up as the website or staff site failing.
  assert.deepEqual(runbooksFor("public-site"), ["docs/sre/runbooks/site-down.md", "docs/sre/runbooks/cloudflare-outage.md"]);
  assert.deepEqual(runbooksFor("staff-site"), ["docs/sre/runbooks/site-down.md", "docs/sre/runbooks/cloudflare-outage.md"]);
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
  const say = (first_line, extra = {}) => ({ login: "someone", bot: false, author_association: "COLLABORATOR", created_at: "2026-11-13T00:20:00.000Z", first_line, ...extra });
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
    { login: "p", bot: false, author_association: "OWNER", created_at: "2026-11-13T00:12:00.000Z", first_line: "status:   Rolling back" },
    { login: "b", bot: true, author_association: "OWNER", created_at: "2026-11-13T00:13:00.000Z", first_line: "Status: from a bot" },
    { login: "p", bot: false, author_association: "OWNER", created_at: "2026-11-13T00:14:00.000Z", first_line: "Status:" },
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

test("blindness is judged by third-party check ids: our own search page failing is an outage, not blindness", () => {
  const dark = (id, component, severity = "sev2") => makeCheck({ id, name: id, component, severity, ok: false, status: null, detail: "No answer.", slis: [] });
  // A fast run (found in review): every check fails with no answer, and the
  // only `search` check is search-page, our own page on Cloudflare. The old
  // rule keyed on the component and called this blind, so it counted
  // against nothing and a total outage opened no incident.
  const fast = [dark("public-home", "public-site", "sev1"), dark("api-health", "api"), dark("search-page", "search"), dark("inquiry-page", "inquiry")];
  assert.equal(isBlindRun(aRun(T0, fast)), false);
  const out = replay([fast, fast]);
  // (search-page and inquiry-page are Cloudflare page loads: folded into the website incident.)
  assert.deepEqual(out.doc.open.map((item) => [item.key, item.severity]), [["public-site", "sev1"], ["api", "sev2"]]);
  assert.deepEqual(out.doc.engine.incidents["public-site"].also, ["search", "inquiry"]);
  // A slow run with third parties failing too is still blind.
  const slow = [dark("tls-public", "tls"), dark("dns-apex-resolves", "dns", "sev1"), dark("domain-expiry", "domain"), dark("search-idx-provider", "search", "sev3")];
  assert.equal(isBlindRun(aRun(T0, slow, "slow")), true);
  for (const id of ["search-idx-provider", "dns-mail-mx", "domain-delegation", "edge-caa"]) assert.equal(isOutsideCheck(id), true, id);
  for (const id of ["search-page", "public-home", "api-health", "tls-public", "edge-hsts"]) assert.equal(isOutsideCheck(id), false, id);
});

test("outside text cannot open or close the issue's hidden marker or add HTML (CodeQL finding)", () => {
  for (const attack of ["<!<!---->--", "--!>", "x -->\n<script>alert(1)</script>", "<!-- sre-incident-key: api -->"]) {
    const clean = oneLine(attack);
    assert.ok(!/[<>\r\n]/.test(clean), JSON.stringify(clean));
  }
  assert.equal(oneLine("y".repeat(400)).length, 300);

  // Everywhere outside text reaches an issue, chat message or title: check
  // names and details from run.json, SLO names and burn texts from slo.json.
  const evil = "Home <!<!---->-- page --!> <img src=x>";
  const bad = (ok) => makeCheck({ id: "public-home", name: evil, component: "public-site", severity: "sev1", ok, status: ok ? 200 : 500, detail: ok ? "" : evil, slis: [] });
  const sloDoc = (at) => ({ schema: 1, generated_at: new Date(at).toISOString(), slos: [{ id: "api-availability", name: evil }], burn_alerts: [{ slo: "api-availability", component: "<b>api</b>", severity: "sev2", text: evil }] });
  const out = replay([[bad(false)], [bad(false)], [bad(true), bad(true)].slice(0, 1), [bad(false)], [bad(false)]], { slo: sloDoc });
  const texts = out.actions.flatMap((action) => [action.title, action.body, action.text]).filter(Boolean);
  assert.ok(texts.length > 3);
  for (const text of texts) {
    const withoutMarker = text.replace(/\n<!-- sre-incident-key: [a-z0-9:-]+ -->$/, "");
    assert.ok(!/[<>]/.test(withoutMarker), text);
  }
  // The budget incident landed on a known component, not on "<b>api</b>".
  assert.ok(out.doc.open.concat(out.doc.recent).every((item) => !/[<>]/.test(item.component)));
});

// The pattern seen on the first run from GitHub's runners: every page
// Cloudflare serves answered 403 to the monitor, the API passed.
const REFUSED = "Cloudflare refused the request (403, error 1010: the browser signature check). See docs/sre/runbooks/cloudflare-outage.md.";
function cloudflareRun({ realFailure = false } = {}) {
  const page = (id, component, severity) => makeCheck({ id, name: id, component, severity, ok: false, status: 403, latency_ms: 90, detail: REFUSED, slis: ["public-availability"] });
  const notMade = (id) => makeCheck({ id, name: id, component: "public-site", severity: "sev1", ok: false, status: null, latency_ms: null, detail: "The home page did not load, so the file it asks for is not known.", slis: [] });
  const api = (id, component) => makeCheck({ id, name: id, component, severity: "sev2", ok: true, status: id === "inquiry-route" ? 405 : 200, latency_ms: 150, slis: [] });
  return [
    page("public-home", "public-site", "sev1"), page("public-page-about", "public-site", "sev2"), notMade("public-asset-js"),
    page("search-page", "search", "sev2"), page("calculators-deal-page", "calculators", "sev2"), page("inquiry-page", "inquiry", "sev2"),
    page("staff-home", "staff-site", "sev2"), api("api-health", "api"), api("inquiry-route", "inquiry"), api("staff-api-auth", "staff-site"),
    ...(realFailure ? [makeCheck({ id: "public-page-terms", name: "Terms", component: "public-site", severity: "sev3", ok: false, status: 500, latency_ms: 80, detail: "Answered 500.", slis: [] })] : []),
  ];
}

test("Cloudflare refusing the monitor is one sev2 'monitoring' incident, not six outages, and counts against nothing", () => {
  const refusal = cloudflareRefusal(aRun(T0, cloudflareRun()));
  assert.equal(refusal.refused, 6);
  assert.ok(refusal.ids.has("public-asset-js"), "a check not made because its page was refused goes with it");
  assert.ok(!refusal.ids.has("api-health"));

  const one = replay([cloudflareRun()]);
  assert.deepEqual(one.doc.open, [], "one refused run is not enough");
  const okPage = makeCheck({ id: "public-home", name: "Home page", component: "public-site", severity: "sev1", ok: true, status: 200, latency_ms: 100, slis: [] });
  const out = replay([cloudflareRun(), cloudflareRun(), cloudflareRun(), [okPage], [okPage]]);
  const opened = out.steps[1].incidents.open;
  assert.deepEqual(opened.map((item) => [item.key, item.component, item.severity, item.title]), [["monitoring", "monitoring", "sev2", "Cloudflare is refusing the monitor"]]);
  const issue = kinds(out.actions, "open-issue");
  assert.equal(issue.length, 1);
  assert.match(issue[0].body, /may be working for visitors, but Cloudflare is refusing the monitor/);
  assert.match(issue[0].body, /cloudflare-outage\.md.*monitoring-is-blind\.md/);
  assert.equal(kinds(out.actions, "webhook")[0].text.startsWith("[sev2] New: Cloudflare is refusing the monitor."), true);
  assert.ok(out.steps.every((step) => step.incidents.open.every((item) => item.key === "monitoring")), "no per-component incident");
  assert.equal(out.steps[2].incidents.engine.checks["public-home"], undefined, "refused results are not remembered as failures");
  // Pages answer again: closed after two clean runs.
  assert.equal(out.doc.open.length, 0);
  assert.equal(out.doc.recent[0].key, "monitoring");
});

test("if one Cloudflare page fails for another reason, the normal per-component rules apply", () => {
  assert.equal(cloudflareRefusal(aRun(T0, cloudflareRun({ realFailure: true }))), null);
  const out = replay([cloudflareRun({ realFailure: true }), cloudflareRun({ realFailure: true }), cloudflareRun({ realFailure: true })]);
  const keys = out.doc.open.map((item) => item.key);
  assert.ok(keys.includes("public-site"));
  assert.ok(!keys.includes("monitoring"));
  assert.equal(out.doc.open.find((item) => item.key === "public-site").severity, "sev1");
});

test("a burn alert whose failing checks belong to an open incident is that incident, not a second page", () => {
  const sloDoc = (at, alerts) => ({ schema: 1, generated_at: new Date(at).toISOString(), slos: [{ id: "public-availability", name: "Website availability" }, { id: "api-availability", name: "API availability" }], burn_alerts: alerts });
  // /search failing burns the website's budget: one incident (search), not search + a website budget incident.
  const page = (ok) => makeCheck({ id: "search-page", name: "Property search page", component: "search", severity: "sev2", ok, status: ok ? 200 : 500, latency_ms: 100, slis: ["public-availability"] });
  const websiteBurn = { slo: "public-availability", component: "public-site", severity: "sev2", window: "1h", text: "Website budget burning.", checks: ["search-page"] };
  const search = replay(Array.from({ length: 8 }, () => [page(false), home(true)]), { slo: (at, i) => sloDoc(at, i >= 1 ? [websiteBurn] : []) });
  assert.deepEqual(search.doc.open.map((item) => item.key), ["search"]);
  assert.ok(!search.actions.some((action) => action.key.startsWith("budget:")));

  // A sev3 calculator check burning the API's budget does not become a sev2 page.
  const calc = (ok) => makeCheck({ id: "calculators-api-analyze", name: "Deal analysis service", component: "calculators", severity: "sev3", ok, status: ok ? 200 : 500, latency_ms: 100, slis: ["api-availability"] });
  const apiBurn = { slo: "api-availability", component: "api", severity: "sev2", window: "1h", text: "API budget burning.", checks: ["calculators-api-analyze"] };
  const calcs = replay(Array.from({ length: 8 }, () => [calc(false)]), { slo: (at, i) => sloDoc(at, i >= 2 ? [apiBurn] : []) });
  assert.deepEqual(calcs.doc.open.map((item) => [item.key, item.severity]), [["calculators", "sev3"]]);
  assert.equal(kinds(calcs.actions, "webhook").length, 0, "no chat page for a sev3 problem");

  // The burn alert arriving before the check's own incident: its issue is taken over when it opens.
  const early = replay(Array.from({ length: 4 }, () => [calc(false)]), { slo: (at) => sloDoc(at, [apiBurn]) });
  assert.deepEqual(early.doc.open.map((item) => item.key), ["calculators"]);
  assert.equal(kinds(early.actions, "close-issue").length, 0);
  assert.equal(kinds(early.actions, "take-over-issue").length, 1);
});

test("sre-silenced also stops the closing comment, and a reopen within the hour stays silent", () => {
  const fail = [home(false)];
  const pass = [home(true)];
  const silenced = (doc) => (doc?.open?.[0]?.issue_number ? { [doc.open[0].issue_number]: { open: true, acknowledged: false, silenced: true } } : null);
  const out = replay([fail, fail, fail, pass, pass, pass, fail, fail, fail], { github: silenced });
  const after = out.actions.filter((action) => action.step >= 2);
  const close = kinds(after, "close-issue");
  assert.equal(close.length, 1);
  assert.equal(close[0].body, null, "closed without a comment");
  const reopen = kinds(after, "reopen-issue");
  assert.equal(reopen.length, 1);
  assert.equal(reopen[0].body, null, "reopened without a comment");
  assert.equal(kinds(after, "webhook").length, 0, "no chat message on resolve or reopen");
  assert.equal(kinds(after, "comment").length, 0);

  // Closed by hand: the reopened incident shows on the status page but the issue stays closed.
  const byHand = replay([fail, fail, fail, pass, pass, pass, fail, fail], { github: (doc, i) => (i === 2 && doc?.open?.[0] ? { [doc.open[0].issue_number]: { open: false } } : null) });
  const later = byHand.actions.filter((action) => action.step >= 3);
  assert.equal(kinds(later, "reopen-issue").length, 0);
  assert.equal(kinds(later, "close-issue").length, 0);
  assert.equal(byHand.doc.open[0].key, "public-site");
});

test("security: a stranger's comment on the public repository neither acknowledges nor reaches the status page", () => {
  const opened = "2026-11-14T09:05:30.000Z";
  const stranger = (first_line, association = "NONE") => ({ login: "random-stranger", bot: false, author_association: association, created_at: "2026-11-14T09:07:00.000Z", first_line });
  for (const association of ["NONE", "CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER", undefined]) {
    const said = readComments([stranger("ack", association), stranger("Status: Site moved, send your inquiry elsewhere", association)], opened);
    assert.deepEqual(said, { acknowledged: false, statuses: [] }, String(association));
  }
  for (const association of ["OWNER", "MEMBER", "COLLABORATOR"]) assert.equal(readComments([stranger("ack", association)], opened).acknowledged, true, association);
  // The SRE_OWNER login is trusted even without an association (any case).
  assert.equal(isTrusted({ login: "Example-Owner", bot: false, author_association: "NONE" }, "example-owner"), true);
  assert.equal(isTrusted({ login: "example-owner[bot]", bot: true, author_association: "OWNER" }, "example-owner"), false);

  // End to end through the engine: no update, the reminder still goes out.
  const fails = Array.from({ length: 6 }, () => [home(false)]);
  const out = replay(fails, { github: (doc) => (doc?.open?.[0]?.issue_number
    ? { [doc.open[0].issue_number]: { open: true, silenced: false, ...readComments([stranger("ack"), stranger("Status: Site moved")], doc.open[0].opened_at) } } : null) });
  assert.ok(!out.doc.open[0].updates.some((update) => /Site moved/.test(update.text)));
  assert.equal(kinds(out.actions, "comment").filter((action) => action.escalation).length, 1);
});

test("with the fast suite's outside-dns-probe, a fast run where everything fails unanswered is blind", () => {
  const dark = (id, component, severity = "sev2") => makeCheck({ id, name: id, component, severity, ok: false, status: null, latency_ms: 5000, detail: "No answer.", slis: component === "dns" ? [] : ["public-availability"] });
  const site = [dark("public-home", "public-site", "sev1"), dark("api-health", "api"), dark("search-page", "search")];
  const withProbe = [...site, dark("outside-dns-probe", "dns", "sev4")];
  assert.equal(isOutsideCheck("outside-dns-probe"), true);
  assert.equal(isBlindRun(aRun(T0, site)), false, "without the probe: not blind (counts against the site)");
  assert.equal(isBlindRun(aRun(T0, withProbe)), true);
  const out = replay([withProbe, withProbe, withProbe]);
  assert.deepEqual(out.doc.open.map((item) => [item.key, item.severity]), [["monitoring", "sev3"]], "no false 'Website is down'");
  // The probe answering while our hosts do not is a real outage.
  const probeOk = [...site, makeCheck({ id: "outside-dns-probe", name: "Outside DNS probe", component: "dns", severity: "sev4", ok: true, status: 200, latency_ms: 40, slis: [] })];
  assert.equal(isBlindRun(aRun(T0, probeOk)), false);
});

test("a reason that ends in a full stop gets no second one", () => {
  const sloDoc = (at) => ({ schema: 1, generated_at: new Date(at).toISOString(), slos: [{ id: "api-availability", name: "API availability" }], burn_alerts: [{ slo: "api-availability", component: "api", severity: "sev2", text: "Burning 16 times too fast: 4 of 12 probes were bad." }] });
  const out = replay([[home(true)]], { slo: sloDoc });
  assert.equal(out.doc.open[0].updates[0].text, "Opened: Burning 16 times too fast: 4 of 12 probes were bad.");
});

// A Cloudflare Pages outage as the website's checks and the other parts'
// page loads see it; the API (not on Cloudflare) keeps passing.
function pagesOutage(down) {
  const page = (id, component, severity) => makeCheck({ id, name: id, component, severity, ok: !down, status: down ? 522 : 200, latency_ms: 200, detail: down ? "Answered 522." : "", slis: ["public-availability"] });
  return [
    page("public-home", "public-site", "sev1"), page("public-page-about", "public-site", "sev2"), page("search-page", "search", "sev2"),
    page("calculators-deal-page", "calculators", "sev2"), page("calculators-mortgage-page", "calculators", "sev2"), page("inquiry-page", "inquiry", "sev2"),
    makeCheck({ id: "api-health", name: "API is up", component: "api", severity: "sev2", ok: true, status: 200, latency_ms: 150, slis: [] }),
    makeCheck({ id: "inquiry-route", name: "Inquiry route exists", component: "inquiry", severity: "sev2", ok: true, status: 405, latency_ms: 150, slis: [] }),
  ];
}

test("one cause, one page: a 20-minute Pages outage opens 1 issue and posts at most 2 chat messages", () => {
  // 09:00 to 09:20 down (4 runs), then up.
  const runs = [...Array.from({ length: 4 }, () => pagesOutage(true)), ...Array.from({ length: 6 }, () => pagesOutage(false))];
  const out = replay(runs);
  assert.equal(kinds(out.actions, "open-issue").length, 1);
  const chat = kinds(out.actions, "webhook");
  assert.ok(chat.length <= 2, chat.map((action) => action.text).join(" | "));
  assert.match(chat[0].text, /^\[sev1\] New: Website is down/);
  assert.match(chat.at(-1).text, /Resolved/);
  const body = kinds(out.actions, "open-issue")[0].body;
  assert.match(body, /\*\*Also affected:\*\* Property search, Intelligence calculators, Inquiry form\./);
  const site = out.doc.recent.find((item) => item.key === "public-site");
  assert.ok(site.updates.some((update) => update.text.startsWith("Also affected: Property search.")));
  // At 09:15 every check passed, so the 15-minute reminder was skipped.
  assert.equal(kinds(out.actions, "comment").filter((action) => action.escalation).length, 0);
  assert.equal(out.doc.open.length, 0);
});

test("a folded part gets its own incident only if it still fails once the website recovers", () => {
  const site = (ok) => makeCheck({ id: "public-home", name: "Home page", component: "public-site", severity: "sev1", ok, status: ok ? 200 : 522, latency_ms: 100, slis: [] });
  const search = (ok) => makeCheck({ id: "search-page", name: "Property search page", component: "search", severity: "sev2", ok, status: ok ? 200 : 500, latency_ms: 100, slis: [] });
  const out = replay([[site(false), search(false)], [site(false), search(false)], [site(true), search(false)], [site(true), search(false)], [site(true), search(false)], [site(true), search(false)]]);
  assert.equal(out.steps[1].incidents.open.map((item) => item.key).join(), "public-site");
  assert.deepEqual(out.doc.open.map((item) => item.key), ["search"], "search still failing after the website closed");
  assert.equal(kinds(out.actions, "open-issue").length, 2);
  // A sev3 website incident does not fold anything.
  const terms = (ok) => makeCheck({ id: "public-page-terms", name: "Terms", component: "public-site", severity: "sev3", ok, status: ok ? 200 : 500, latency_ms: 100, slis: [] });
  const minor = replay(Array.from({ length: 4 }, () => [terms(false), search(false)]));
  assert.deepEqual(minor.doc.open.map((item) => item.key).sort(), ["public-site", "search"]);
});

test("a reminder is skipped while every check of the incident passes, and comes when it fails again", () => {
  const runs = [[home(false)], [home(false)], [home(false)], [home(false)], [home(true)], [home(false)]];
  const out = replay(runs);
  const reminders = kinds(out.actions, "comment").filter((action) => action.escalation);
  // Opened at 00:05; 15 minutes later (00:20) the home page passed: skipped. At 00:25 it failed again: sent.
  assert.deepEqual(reminders.map((action) => action.step), [5]);
  // One good run in the middle does not lower a sev1 to "on and off".
  assert.equal(out.doc.open[0].severity, "sev1");
  assert.equal(out.doc.open[0].title, "Website is down");
});

test("the flapping home page that first burns the budget yields one issue", () => {
  const sloDoc = (at, alerts) => ({ schema: 1, generated_at: new Date(at).toISOString(), slos: [{ id: "public-availability", name: "Website availability" }], burn_alerts: alerts });
  const burn = { slo: "public-availability", component: "public-site", severity: "sev2", window: "1h", text: "Website availability is burning fast.", checks: ["public-home"] };
  // Fails one run in three for an hour (as in the SLO engineer's replay), then steady.
  const runs = Array.from({ length: 24 }, (_, i) => [home(!(i < 12 && i % 3 === 0))]);
  const out = replay(runs, { slo: (at, i) => sloDoc(at, i >= 6 && i < 14 ? [burn] : []) });
  const opened = out.actions.filter((action) => action.kind === "open-issue" || action.kind === "reopen-issue");
  assert.equal(opened.length, 1, opened.map((action) => action.key).join());
  assert.equal(kinds(out.actions, "close-issue").length <= 1, true);
});
