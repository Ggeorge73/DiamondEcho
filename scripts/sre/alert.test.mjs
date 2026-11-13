import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { makeCheck, makeRun } from "./lib/schema.mjs";
import { runAlert, parseArgs, postWebhook } from "./alert.mjs";

const exec = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIN = 60_000;
const T0 = Date.parse("2026-11-13T00:00:00.000Z");
const HOOK = "https://hooks.example.invalid/services/SECRET-PART";

const home = (ok) => makeCheck({ id: "public-home", name: "Home page", component: "public-site", severity: "sev1", ok, status: ok ? 200 : 503, detail: ok ? "" : "Answered 503.", slis: [] });
const aRun = (at, checks) => makeRun({ suite: "fast", started_at: new Date(at).toISOString(), finished_at: new Date(at + 4000).toISOString(), vantage: { provider: "github-actions", region: "eastus" }, checks });

// A stand-in for GitHub and the webhook. `state.issues` is the repository.
function fakeServer({ webhookStatus = 200, createStatus = 201, issues = [] } = {}) {
  const calls = [];
  const state = { issues: [...issues], next: 12, comments: {} };
  const fetcher = async (url, init = {}) => {
    const method = init.method || "GET";
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers?.Authorization });
    const json = (status, value) => new Response(status === 204 ? null : JSON.stringify(value ?? {}), { status });
    if (url.startsWith("https://hooks.example.invalid/")) return json(webhookStatus, {});
    const { pathname } = new URL(url);
    const route = pathname.replace("/repos/owner/repo", "");
    if (method === "GET" && route === "/issues") return json(200, state.issues.filter((issue) => issue.state === "open"));
    if (method === "GET" && route.startsWith("/labels/")) return json(404, {});
    if (method === "POST" && route === "/labels") return json(201, {});
    if (method === "POST" && route === "/issues") {
      if (createStatus !== 201) return json(createStatus, {});
      const body = JSON.parse(init.body);
      const issue = { number: state.next++, title: body.title, html_url: `https://github.test/owner/repo/issues/${state.next - 1}`, state: "open", labels: body.labels.map((name) => ({ name })) };
      state.issues.push(issue);
      return json(201, issue);
    }
    const match = route.match(/^\/issues\/(\d+)(\/comments|\/labels.*)?$/);
    if (match) {
      const issue = state.issues.find((item) => item.number === Number(match[1]));
      if (match[2] === "/comments") return json(method === "GET" ? 200 : 201, method === "GET" ? state.comments[match[1]] ?? [] : {});
      if (match[2]) return json(200, []);
      if (method === "PATCH") Object.assign(issue, JSON.parse(init.body));
      return json(200, issue);
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  return { fetcher, calls, state };
}

async function workspace() {
  const dir = await mkdtemp(path.join(tmpdir(), "sre-alert-"));
  let n = 0;
  return {
    dir,
    stateDir: dir,
    out: path.join(dir, "actions.json"),
    async run(at, checks, { env = {}, fetch, apply = false, slo = null } = {}) {
      const runFile = path.join(dir, `run-${(n += 1)}.json`);
      await writeFile(runFile, JSON.stringify(aRun(at, checks)));
      const lines = [];
      const result = await runAlert({ args: { run: runFile, stateDir: dir, out: path.join(dir, "actions.json"), apply, slo }, env, fetch, now: at + 10_000, log: (line) => lines.push(line) });
      return { ...result, lines, actions: JSON.parse(await readFile(path.join(dir, "actions.json"), "utf8")) };
    },
    incidents: async () => JSON.parse(await readFile(path.join(dir, "incidents.json"), "utf8")),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

test("without --apply nothing is sent, and incidents.json still follows the site", async () => {
  const w = await workspace();
  try {
    const fetch = async () => { throw new Error("must not be called"); };
    await w.run(T0, [home(false)], { fetch, env: { GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "owner/repo", SRE_ALERT_WEBHOOK_URL: HOOK } });
    const second = await w.run(T0 + 5 * MIN, [home(false)], { fetch, env: { GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "owner/repo", SRE_ALERT_WEBHOOK_URL: HOOK } });
    const doc = await w.incidents();
    assert.equal(doc.schema, 1);
    assert.equal(doc.open[0].key, "public-site");
    assert.equal(doc.open[0].issue_number, null);
    assert.deepEqual(second.actions.actions.map((action) => [action.kind, action.result]), [["open-issue", "dry-run"], ["webhook", "dry-run"]]);
    assert.equal(second.actions.apply, false);
    assert.ok(!JSON.stringify(second).includes("SECRET-PART"), "the webhook address is never printed or saved");
  } finally {
    await w.cleanup();
  }
});

test("--apply without a token is a logged dry run for GitHub; the webhook still posts", async () => {
  const w = await workspace();
  try {
    const server = fakeServer();
    await w.run(T0, [home(false)], { apply: true, fetch: server.fetcher, env: { SRE_ALERT_WEBHOOK_URL: HOOK } });
    const out = await w.run(T0 + 5 * MIN, [home(false)], { apply: true, fetch: server.fetcher, env: { SRE_ALERT_WEBHOOK_URL: HOOK } });
    assert.match(out.lines.join("\n"), /--apply is a dry run for GitHub/);
    assert.match(out.lines.join("\n"), /\[github dry run\] would open issue "Website is down"/);
    assert.equal(out.actions.github, "dry-run");
    assert.deepEqual(server.calls.map((call) => call.url), [HOOK]);
    assert.deepEqual(server.calls[0].body, { text: "[sev1] New: Website is down. Pages of diamondecho.com may not load, or may load incomplete, for visitors." });
  } finally {
    await w.cleanup();
  }
});

test("--apply with a token opens one issue with labels, and a failing webhook does not break the run", async () => {
  const w = await workspace();
  try {
    const server = fakeServer({ webhookStatus: 500 });
    const env = { GITHUB_TOKEN: "t0ken", GITHUB_REPOSITORY: "owner/repo", SRE_ALERT_WEBHOOK_URL: HOOK };
    await w.run(T0, [home(false)], { apply: true, fetch: server.fetcher, env });
    const out = await w.run(T0 + 5 * MIN, [home(false)], { apply: true, fetch: server.fetcher, env });
    const doc = await w.incidents();
    assert.equal(doc.open[0].issue_number, 12);
    assert.equal(doc.open[0].issue_url, "https://github.test/owner/repo/issues/12");
    const created = server.calls.find((call) => call.method === "POST" && call.url.endsWith("/issues"));
    assert.deepEqual(created.body.labels, ["sre-incident", "sev1"]);
    assert.ok(server.calls.some((call) => call.method === "POST" && call.url.endsWith("/labels") && call.body.name === "acknowledged"));
    const hook = out.actions.actions.find((action) => action.kind === "webhook");
    assert.equal(hook.result, "failed: refused (HTTP 500)");
    assert.match(hook.text, /https:\/\/github\.test\/owner\/repo\/issues\/12$/, "the chat message links the issue");
    assert.ok(!out.lines.join("\n").includes("SECRET-PART"));
    assert.ok(!JSON.stringify(out.actions).includes("SECRET-PART"));
    assert.ok(!out.lines.join("\n").includes("t0ken"));

    // Recovery closes the same issue with a comment.
    for (let i = 2; i < 5; i += 1) await w.run(T0 + i * 5 * MIN, [home(true)], { apply: true, fetch: server.fetcher, env });
    assert.equal(server.state.issues[0].state, "closed");
    const comments = server.calls.filter((call) => call.method === "POST" && call.url.endsWith("/issues/12/comments"));
    assert.match(comments.at(-1).body.body, /^\*\*Resolved\*\*/);
    assert.equal((await w.incidents()).recent[0].issue_number, 12);
  } finally {
    await w.cleanup();
  }
});

test("GitHub refusing to open an issue is retried next run, and an existing issue is adopted, not duplicated", async () => {
  const w = await workspace();
  try {
    const env = { GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "owner/repo" };
    const refusing = fakeServer({ createStatus: 502 });
    await w.run(T0, [home(false)], { apply: true, fetch: refusing.fetcher, env });
    const failed = await w.run(T0 + 5 * MIN, [home(false)], { apply: true, fetch: refusing.fetcher, env });
    assert.match(failed.actions.actions[0].result, /^failed: GitHub POST \/issues refused \(HTTP 502\)/);
    assert.equal((await w.incidents()).open[0].issue_number, null);

    // Next run: an issue with the same title is already open (say the
    // earlier create did land): it is adopted.
    const server = fakeServer({ issues: [{ number: 40, title: "Website is down", html_url: "https://github.test/owner/repo/issues/40", state: "open", labels: [{ name: "sre-incident" }] }] });
    const retry = await w.run(T0 + 10 * MIN, [home(false)], { apply: true, fetch: server.fetcher, env });
    assert.deepEqual(retry.actions.actions.map((action) => [action.kind, action.result]), [["open-issue", "adopted"]]);
    assert.equal((await w.incidents()).open[0].issue_number, 40);
    assert.equal(server.calls.filter((call) => call.method === "POST" && call.url.endsWith("/issues")).length, 0);
  } finally {
    await w.cleanup();
  }
});

test("the webhook refuses addresses that are not https and never follows a redirect", async () => {
  assert.deepEqual(await postWebhook({ url: "http://hooks.example.invalid/x", text: "t", fetch: async () => { throw new Error("no"); } }), { ok: false, why: "the webhook address must start with https://" });
  assert.deepEqual(await postWebhook({ url: "not a url", text: "t" }), { ok: false, why: "the webhook setting is not a web address" });
  let seen;
  await postWebhook({ url: HOOK, text: "t", fetch: async (url, init) => { seen = init; return new Response("ok"); } });
  assert.equal(seen.redirect, "error");
  assert.deepEqual(await postWebhook({ url: HOOK, text: "t", fetch: async () => { throw Object.assign(new Error("x"), { name: "TimeoutError" }); } }), { ok: false, why: "timed out" });
});

test("command line: SRE_NOW is honoured, a damaged incidents.json is set aside, a bad run exits 2", async () => {
  const w = await workspace();
  try {
    const runFile = path.join(w.dir, "run.json");
    await writeFile(runFile, JSON.stringify(aRun(T0, [home(true)])));
    await writeFile(path.join(w.dir, "incidents.json"), "{oops");
    const env = { PATH: process.env.PATH, SRE_NOW: "2026-11-13T00:00:10.000Z" };
    const ok = await exec(process.execPath, [path.join(HERE, "alert.mjs"), "--run", runFile, "--state-dir", w.dir, "--out", w.out], { env });
    assert.match(ok.stdout, /could not be read; starting it again/);
    assert.equal(await readFile(path.join(w.dir, "incidents.json.damaged"), "utf8"), "{oops");
    assert.equal(JSON.parse(await readFile(w.out, "utf8")).generated_at, "2026-11-13T00:00:10.000Z");

    await writeFile(runFile, JSON.stringify({ schema: 1 }));
    const bad = await exec(process.execPath, [path.join(HERE, "alert.mjs"), "--run", runFile, "--state-dir", w.dir, "--out", w.out], { env }).catch((error) => error);
    assert.equal(bad.code, 2);
    assert.throws(() => parseArgs(["--run", "r"]), /usage/);
    assert.deepEqual(parseArgs(["--run", "r", "--state-dir", "d", "--out", "o", "--slo", "s", "--apply"]), { run: "r", stateDir: "d", out: "o", slo: "s", apply: true });
  } finally {
    await w.cleanup();
  }
});

test("comments: read only when needed; 'Looking' does not acknowledge, 'ack' does; a Status: line reaches incidents.json", async () => {
  const w = await workspace();
  try {
    const server = fakeServer();
    const env = { GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "owner/repo", SRE_OWNER: "example-owner" };
    const at = (minutes) => T0 + minutes * MIN;
    const reads = () => server.calls.filter((call) => call.method === "GET" && call.url.includes("/issues/12/comments")).length;
    const human = (minutes, body, association = "COLLABORATOR") => ({ user: { login: "someone", type: "User" }, author_association: association, created_at: new Date(at(minutes)).toISOString(), body });
    for (let m = 0; m <= 5; m += 5) await w.run(at(m), [home(false)], { apply: true, fetch: server.fetcher, env });
    assert.equal((await w.incidents()).open[0].issue_number, 12);

    // A person (or an AI agent on their account) writes something that is not an acknowledgement.
    server.state.comments["12"] = [human(7, "Looking into the logs\nsecond line stays out"), human(8, "Status: We are restoring the previous version.")];
    for (let m = 10; m <= 20; m += 5) await w.run(at(m), [home(false)], { apply: true, fetch: server.fetcher, env });
    const reminders = server.calls.filter((call) => call.method === "POST" && call.url.endsWith("/issues/12/comments") && /Reminder 1 of 3/.test(call.body.body));
    assert.equal(reminders.length, 1, "the 15-minute reminder still went out");
    assert.match(reminders[0].body.body, /^@example-owner /);
    const updates = (await w.incidents()).open[0].updates;
    assert.deepEqual(updates.filter((update) => update.text === "We are restoring the previous version.").map((update) => update.at), [new Date(at(8)).toISOString()]);
    assert.ok(!JSON.stringify(await w.incidents()).includes("second line"));

    // Now an acknowledgement: reminders stop, and comments are read at most every 15 minutes.
    server.state.comments["12"].push(human(22, "ack"));
    await w.run(at(25), [home(false)], { apply: true, fetch: server.fetcher, env });
    const before = reads();
    for (let m = 30; m <= 70; m += 5) await w.run(at(m), [home(false)], { apply: true, fetch: server.fetcher, env });
    assert.ok(reads() - before <= 3, `${reads() - before} comment reads in 45 minutes`);
    assert.equal(server.calls.filter((call) => call.method === "POST" && /Reminder 2/.test(call.body?.body ?? "")).length, 0);
  } finally {
    await w.cleanup();
  }
});

test("a person's Status: line written after the incident closed still reaches incidents.json (within a day)", async () => {
  const w = await workspace();
  try {
    const server = fakeServer();
    const env = { GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "owner/repo" };
    const at = (minutes) => T0 + minutes * MIN;
    for (const [m, ok] of [[0, false], [5, false], [10, true], [15, true], [20, true]]) await w.run(at(m), [home(ok)], { apply: true, fetch: server.fetcher, env });
    const closed = (await w.incidents()).recent[0];
    assert.equal(closed.issue_number, 12);
    server.state.comments["12"] = [
      { user: { login: "someone", type: "User" }, author_association: "OWNER", created_at: new Date(at(30)).toISOString(), body: "Status: Fixed. The previous version is back." },
      { user: { login: "stranger", type: "User" }, author_association: "NONE", created_at: new Date(at(31)).toISOString(), body: "Status: Not from us." },
    ];
    await w.run(at(40), [home(true)], { apply: true, fetch: server.fetcher, env });
    await w.run(at(45), [home(true)], { apply: true, fetch: server.fetcher, env });
    const updates = (await w.incidents()).recent[0].updates.map((update) => update.text);
    assert.equal(updates.filter((text) => text === "Fixed. The previous version is back.").length, 1);
    assert.ok(!updates.includes("Not from us."), "a stranger's line is never published");
    // A day later the closed issue is no longer read.
    const before = server.calls.filter((call) => call.method === "GET" && call.url.includes("/issues/12/comments")).length;
    await w.run(at(26 * 60), [home(true)], { apply: true, fetch: server.fetcher, env });
    assert.equal(server.calls.filter((call) => call.method === "GET" && call.url.includes("/issues/12/comments")).length, before);
  } finally {
    await w.cleanup();
  }
});

test("a component incident takes over the budget incident's issue: relabelled, retitled, commented, never closed", async () => {
  const w = await workspace();
  try {
    const server = fakeServer();
    const env = { GITHUB_TOKEN: "t", GITHUB_REPOSITORY: "owner/repo" };
    const at = (minutes) => T0 + minutes * MIN;
    const sloFile = path.join(w.dir, "slo.json");
    const burn = (minutes) => writeFile(sloFile, JSON.stringify({ schema: 1, generated_at: new Date(at(minutes)).toISOString(), slos: [{ id: "public-availability", name: "Website availability" }],
      burn_alerts: [{ slo: "public-availability", component: "public-site", severity: "sev3", window: "6h", text: "Burning.", checks: ["public-home"] }] }));
    await burn(0);
    await w.run(at(0), [home(true)], { apply: true, fetch: server.fetcher, env, slo: sloFile });
    assert.equal((await w.incidents()).open[0].key, "budget:public-availability");
    assert.equal(server.state.issues.length, 1);
    for (const m of [5, 10]) { await burn(m); await w.run(at(m), [home(false)], { apply: true, fetch: server.fetcher, env, slo: sloFile }); }
    const doc = await w.incidents();
    assert.deepEqual(doc.open.map((item) => [item.key, item.issue_number]), [["public-site", 12]]);
    assert.equal(server.state.issues.length, 1, "no second issue");
    assert.equal(server.state.issues[0].state, "open");
    assert.equal(server.state.issues[0].title, "Website is down");
    const calls = server.calls.filter((call) => call.url.includes("/issues/12"));
    assert.ok(calls.some((call) => call.method === "DELETE" && call.url.endsWith("/labels/sev3")));
    assert.ok(calls.some((call) => call.method === "POST" && call.url.endsWith("/labels") && call.body.labels[0] === "sev1"));
    assert.ok(calls.some((call) => call.method === "POST" && call.url.endsWith("/comments") && /^\*\*Now followed here as: Website is down\.\*\*/.test(call.body.body)));
  } finally {
    await w.cleanup();
  }
});
