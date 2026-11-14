// post-deploy.mjs with everything outside replaced: the site and the API
// (fetch), the clock, the synthetic checks, GitHub and the Pages rollback.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { childEnv, ISSUE_TITLE, makeClock, parseCli, postDeploy, RECHECK_DELAY_MS, rollbackTriggers, UsageError } from "./post-deploy.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const MERGED = "1111111111111111111111111111111111111111";
const OLD = "0000000000000000000000000000000000000000";
const LATER = "2222222222222222222222222222222222222222";
const TOKEN = "cf-token-for-tests-only";

const check = (id, component, severity, ok, detail = "") => ({ id, name: id, component, severity, ok, status: ok ? 200 : 500, latency_ms: 10, detail, attempts: 1, slis: [] });

// A small world: what the site and the API answer, and a fake clock that the
// fake sleep moves forward.
function world({ site = [MERGED], api = { status: 200, commit: OLD }, checks = { code: 0, run: { checks: [check("public-home", "public-site", "sev1", true)] } },
  backendChanged = true, ancestors = {}, rollback = null, openIssues = [], env = {}, pagesChecks = null } = {}) {
  let clock = Date.parse("2026-11-13T10:00:00Z");
  const siteAnswers = [...site];
  const calls = { fetch: [], github: [], rollback: [], checks: [], sleeps: 0, slept: [] };
  let live = null;
  const fetcher = async (url) => {
    calls.fetch.push(url);
    if (url === "https://diamondecho.com/version.json") {
      const next = live ?? (siteAnswers.length > 1 ? siteAnswers.shift() : siteAnswers[0]);
      // 403: Cloudflare's Bot Fight Mode turning the runner away.
      if (next === 403) return new Response("<html>blocked</html>", { status: 403 });
      return next === 404 ? new Response("<html>not found</html>", { status: 404 }) : new Response(JSON.stringify({ commit: next, built_at: "x" }), { status: 200 });
    }
    if (url === "https://diamondecho-api-180189726732.us-east1.run.app/api/") {
      return new Response(JSON.stringify({ service: "DiamondEcho API", revision: "r", commit: api.commit }), { status: api.status });
    }
    throw new Error(`unexpected request ${url}`);
  };
  const github = {
    listOpenIssues: async (label) => { calls.github.push(["list", label]); return openIssues; },
    ensureLabel: async (name) => { calls.github.push(["label", name]); },
    createIssue: async (issue) => { calls.github.push(["create", issue]); return { number: 7, html_url: "https://github.com/o/r/issues/7" }; },
    comment: async (number, body) => { calls.github.push(["comment", number, body]); },
    closeIssue: async (number) => { calls.github.push(["close", number]); },
    // What Cloudflare Pages reported to GitHub for the commit: one answer per
    // look, the last one repeating. Absent: this GitHub cannot be asked.
    ...(pagesChecks ? { listCheckRuns: async (sha) => {
      calls.github.push(["check-runs", sha]);
      const answer = pagesChecks.length > 1 ? pagesChecks.shift() : pagesChecks[0];
      if (answer instanceof Error) throw answer;
      return answer;
    } } : {}),
  };
  const deps = {
    fetcher, github,
    now: () => clock,
    sleep: async (ms) => { calls.sleeps += 1; calls.slept.push(ms); clock += ms; },
    // `checks` is one answer for every look, or [first look, second look].
    runChecks: async (label) => { calls.checks.push(label); return Array.isArray(checks) ? checks[calls.checks.length - 1] : checks; },
    isAncestor: (a, b) => Boolean(ancestors[`${a}..${b}`]),
    backendChanged: () => backendChanged,
    pagesRollback: async (args) => {
      calls.rollback.push(args);
      const answer = rollback ?? { code: 0, last: { applied: args.includes("--apply"), to: { id: "x", commit: OLD }, verified: args.includes("--apply") ? true : null } };
      if (args.includes("--apply") && answer.code === 0) live = answer.last.to.commit;
      return answer;
    },
  };
  const run = (options = {}) => postDeploy({ commit: MERGED, timeoutMinutes: 15, intervalSeconds: 30, apply: true,
    env: { GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "99", ...env }, ...options }, deps);
  return { run, calls };
}

const failedSite = { code: 1, run: { checks: [check("public-home", "public-site", "sev1", false, "Home page answered 500."), check("api-health", "api", "sev1", true)] } };
const configured = { CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef" };

test("the merged build goes live, every check passes: no issue, no rollback", async () => {
  const w = world({ site: [404, OLD, MERGED], backendChanged: false });
  const result = await w.run();
  assert.equal(result.outcome, "ok");
  assert.equal(result.build.attempts, 3);
  assert.equal(w.calls.sleeps, 2);
  assert.deepEqual(w.calls.checks, ["first"], "no second look when everything passed");
  assert.deepEqual(w.calls.rollback, []);
  assert.deepEqual(w.calls.github, [["list", "sre-incident"]]);
  assert.equal(result.api.state, "current");
});

test("a build that never goes live fails visibly, opens an issue, and rolls nothing back", async () => {
  const w = world({ site: [OLD], env: configured });
  const result = await w.run({ env: { ...configured, SRE_PAGES_AUTOROLLBACK: "enabled", GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "o/r" } });
  assert.equal(result.outcome, "build-not-live");
  assert.equal(result.build.attempts, 31, "one look every 30 s for 15 minutes");
  assert.deepEqual(w.calls.checks, []);
  assert.deepEqual(w.calls.rollback, []);
  const created = w.calls.github.find(([kind]) => kind === "create")[1];
  assert.equal(created.title, `${ISSUE_TITLE} for 1111111`);
  assert.deepEqual(created.labels, ["sre-incident"]);
  assert.match(created.body, /did not show this commit within 15 minutes \(31 looks at \/version.json\)\. The last answer named `0000000`/);
  assert.match(created.body, /Rollback to this deployment/);
  const links = (created.body.match(/https:\/\/[^\s)>\]]+/g) || []).map((link) => link.replace(/[.,]+$/, ""));
  assert.ok(links.some((link) => link === "https://github.com/o/r/commit/1111111111111111111111111111111111111111"), links.join(" "));
});

test("a failed website check rolls the site back only when set up AND enabled, and reads it back", async () => {
  const w = world({ checks: failedSite });
  const result = await w.run({ env: { ...configured, SRE_PAGES_AUTOROLLBACK: "enabled" } });
  assert.equal(result.outcome, "checks-failed");
  assert.deepEqual(w.calls.rollback, [["--apply", "--expect-live-commit", MERGED]]);
  assert.deepEqual(w.calls.checks, ["first", "recheck"], "the failure is looked at twice");
  assert.ok(w.calls.slept.includes(RECHECK_DELAY_MS) && RECHECK_DELAY_MS === 60_000, "a minute apart");
  assert.deepEqual(result.recheck.still_failing, ["public-home"]);
  assert.equal(result.rollback.action, "rolled-back");
  assert.match(result.rollback.text, /build of `0000000` was put back and diamondecho.com\/version.json names it/);
  const body = w.calls.github.find(([kind]) => kind === "create")[1].body;
  assert.match(body, /- public-home \(`public-home`, public-site, sev1\): Home page answered 500\./);
  assert.match(body, /\*\*Automatic rollback:\*\* done/);
  for (const text of [body, JSON.stringify(result)]) assert.ok(!text.includes(TOKEN), "the Cloudflare token is never written");
});

test("with the secrets but without the switch, it only says what it would do", async () => {
  const w = world({ checks: failedSite });
  const result = await w.run({ env: { ...configured, SRE_PAGES_AUTOROLLBACK: "yes please" } });
  assert.deepEqual(w.calls.rollback, [["--expect-live-commit", MERGED]]);
  assert.equal(result.rollback.action, "dry-run");
  assert.match(result.rollback.text, /It would put back the build of `0000000`/);
});

test("without the secrets nothing is attempted; a failed API check never rolls the site back", async () => {
  let w = world({ checks: failedSite });
  let result = await w.run({ env: { SRE_PAGES_AUTOROLLBACK: "enabled" } });
  assert.equal(result.rollback.action, "not-set-up");
  assert.deepEqual(w.calls.rollback, []);

  w = world({ checks: { code: 1, run: { checks: [check("api-health", "api", "sev1", false, "API answered 503.")] } } });
  result = await w.run({ env: { ...configured, SRE_PAGES_AUTOROLLBACK: "enabled" } });
  assert.equal(result.outcome, "checks-failed");
  assert.equal(result.rollback.action, "none");
  assert.deepEqual(w.calls.rollback, []);

  w = world({ checks: { code: 1, run: { checks: [check("public-robots", "public-site", "sev3", false)] } } });
  result = await w.run({ env: { ...configured, SRE_PAGES_AUTOROLLBACK: "enabled" } });
  assert.equal(result.rollback.action, "none", "a minor website check does not justify a rollback");
});

test("a rollback that does not complete is said plainly", async () => {
  const w = world({ checks: failedSite, rollback: { code: 2, last: null } });
  const result = await w.run({ env: { ...configured, SRE_PAGES_AUTOROLLBACK: "enabled" } });
  assert.equal(result.rollback.action, "failed");
  assert.match(result.rollback.text, /attempted and did not complete/);
});

test("checks that break are reported as unverified, never as a reason to roll back", async () => {
  const w = world({ checks: { code: 2, run: null } });
  const result = await w.run({ env: { ...configured, SRE_PAGES_AUTOROLLBACK: "enabled" } });
  assert.equal(result.outcome, "checks-broke");
  assert.deepEqual(w.calls.rollback, []);
});

test("an open post-merge issue gets a comment, and is closed when a later merge passes", async () => {
  const open = [{ number: 5, title: `${ISSUE_TITLE} for abcdef0`, html_url: "u5", labels: ["sre-incident"] }];
  let w = world({ checks: failedSite, openIssues: open });
  await w.run();
  assert.deepEqual(w.calls.github.map(([kind, number]) => [kind, typeof number === "number" ? number : undefined]), [["list", undefined], ["comment", 5]]);

  w = world({ openIssues: open });
  const result = await w.run();
  assert.equal(result.issue.action, "closed");
  assert.deepEqual(w.calls.github.map(([kind]) => kind), ["list", "comment", "close"]);
});

test("another incident's issue is left alone", async () => {
  const w = world({ checks: failedSite, openIssues: [{ number: 3, title: "Website is down", html_url: "u3", labels: ["sre-incident"] }] });
  await w.run();
  assert.ok(w.calls.github.some(([kind]) => kind === "create"));
  assert.ok(!w.calls.github.some(([kind, number]) => kind === "comment" && number === 3));
});

test("a later merge that includes this one counts as live", async () => {
  const w = world({ site: [LATER], ancestors: { [`${MERGED}..${LATER}`]: true } });
  const result = await w.run();
  assert.equal(result.outcome, "ok");
  assert.equal(result.build.later, true);
  assert.equal(result.build.commit, LATER);
});

test("the API note: behind main for backend changes, or not reporting its commit; neither fails the run", async () => {
  let result = await world({ api: { status: 200, commit: OLD }, backendChanged: true }).run();
  assert.equal(result.outcome, "ok");
  assert.equal(result.api.state, "behind");
  assert.match(result.api.text, /The API runs `0000000` and backend\/ has changed on main since/);
  result = await world({ api: { status: 200, commit: null } }).run();
  assert.equal(result.api.state, "unknown");
  assert.match(result.api.text, /does not report its commit yet/);
  result = await world({ api: { status: 503, commit: null } }).run();
  assert.equal(result.api.state, "unreachable");
});

test("without --apply nothing is filed on GitHub and nothing is rolled back for real", async () => {
  const w = world({ checks: failedSite });
  const result = await w.run({ apply: false, env: { ...configured, SRE_PAGES_AUTOROLLBACK: "enabled" } });
  assert.equal(result.outcome, "checks-failed");
  assert.deepEqual(w.calls.github, []);
  assert.deepEqual(w.calls.rollback, [["--expect-live-commit", MERGED]], "a dry run only");
});

test("a GitHub failure is recorded and the verdict still stands", async () => {
  const result = await postDeploy({ commit: MERGED, apply: true, env: {} }, {
    now: () => 0, sleep: async () => {}, isAncestor: () => false, backendChanged: () => null,
    fetcher: async () => new Response(JSON.stringify({ commit: MERGED, service: "DiamondEcho API" }), { status: 200 }),
    runChecks: async () => failedSite, pagesRollback: async () => ({ code: 0, last: null }),
    github: { listOpenIssues: async () => { throw new Error("GitHub GET /issues refused (HTTP 403)"); } },
  });
  assert.equal(result.outcome, "checks-failed");
  assert.deepEqual(result.issue, { action: "failed", error: "GitHub GET /issues refused (HTTP 403)" });
});

test("child processes never get the GitHub token, and only the rollback gets the Cloudflare secrets", () => {
  const env = { PATH: "/bin", GITHUB_TOKEN: "t", CLOUDFLARE_API_TOKEN: "c", CLOUDFLARE_ACCOUNT_ID: "a" };
  assert.deepEqual(childEnv(env, false), { PATH: "/bin" });
  assert.deepEqual(childEnv(env, true), { PATH: "/bin", CLOUDFLARE_API_TOKEN: "c", CLOUDFLARE_ACCOUNT_ID: "a" });
});

test("the command line: a commit and an output are required, polling stays gentle", () => {
  assert.deepEqual(parseCli(["--commit", MERGED.toUpperCase(), "--out", "x.json"]),
    { commit: MERGED, out: "x.json", runOut: "run.json", timeoutMinutes: 15, intervalSeconds: 30, apply: false });
  for (const bad of [["--out", "x"], ["--commit", "main", "--out", "x"], ["--commit", MERGED], ["--commit", MERGED, "--out", "x", "--interval-seconds", "1"],
    ["--commit", MERGED, "--out", "x", "--timeout-minutes", "600"]]) {
    assert.throws(() => parseCli(bad), UsageError, bad.join(" "));
  }
  const cli = spawnSync(process.execPath, [join(here, "post-deploy.mjs"), "--commit", "nope", "--out", "x"], { encoding: "utf8" });
  assert.equal(cli.status, 2);
  assert.match(cli.stderr, /--commit must be a commit/);
});

test("SRE_NOW starts the clock at a fixed time that still moves", () => {
  let real = 1000;
  const now = makeClock({ SRE_NOW: "2026-11-13T10:00:00Z" }, () => real);
  assert.equal(new Date(now()).toISOString(), "2026-11-13T10:00:00.000Z");
  real += 5000;
  assert.equal(new Date(now()).toISOString(), "2026-11-13T10:00:05.000Z");
  assert.throws(() => makeClock({ SRE_NOW: "yesterday" }), UsageError);
});

const enabled = { ...configured, SRE_PAGES_AUTOROLLBACK: "enabled" };

test("a website failure that passes on the second look a minute later rolls nothing back", async () => {
  const passing = { code: 0, run: { checks: [check("public-home", "public-site", "sev1", true)] } };
  const w = world({ checks: [failedSite, passing] });
  const result = await w.run({ env: enabled });
  assert.equal(result.outcome, "checks-failed", "the first failure is still reported");
  assert.deepEqual(w.calls.checks, ["first", "recheck"]);
  assert.deepEqual(w.calls.rollback, []);
  assert.equal(result.rollback.action, "none");
  assert.match(result.rollback.text, /passed on a second look a minute later/);
});

test("Cloudflare refusing the monitor, or a broken www redirect, never rolls the build back", async () => {
  const refused = { ...check("public-home", "public-site", "sev1", false,
    "Cloudflare refused the request (403, error 1010: the browser signature check, usually Browser Integrity Check): a Cloudflare security setting is blocking the monitor, and perhaps visitors too."), status: 403 };
  const www = check("public-www-redirect", "public-site", "sev2", false, "The redirect does not point at the same page on the bare domain.");
  for (const failing of [refused, www]) {
    const w = world({ checks: { code: 1, run: { checks: [failing] } } });
    const result = await w.run({ env: enabled });
    assert.equal(result.outcome, "checks-failed", failing.id);
    assert.equal(result.rollback.action, "none", failing.id);
    assert.deepEqual(w.calls.rollback, [], failing.id);
    assert.deepEqual(w.calls.checks, ["first"], "no second look either");
  }
  assert.deepEqual(rollbackTriggers([{ ...refused, status: 500 }]).length, 1, "a 500 with the same words still counts");
});

test("no automatic rollback when a later merge is the live build", async () => {
  const w = world({ site: [LATER], ancestors: { [`${MERGED}..${LATER}`]: true }, checks: failedSite });
  const result = await w.run({ env: enabled });
  assert.equal(result.outcome, "checks-failed");
  assert.deepEqual(w.calls.rollback, []);
  assert.match(result.rollback.text, /a later merge \(`2222222`\) is live, and its own post-merge check decides/);
});

// ---- Cloudflare's Bot Fight Mode refuses the runner on /version.json ------

const pagesCheck = (status, conclusion = null, started_at = "2026-11-13T10:00:05Z") => [{ name: "Cloudflare Pages: diamondecho", status, conclusion, started_at }, { name: "Backend tests", status: "completed", conclusion: "failure", started_at }];
const apiOnly = { code: 0, run: { checks: [check("api-health", "api", "sev2", true), check("public-www-redirect", "public-site", "sev2", true)] } };

test("refused by Cloudflare on /version.json: the build counts as live once Cloudflare Pages reports its build of this commit succeeded", async () => {
  const w = world({ site: [403], checks: apiOnly, pagesChecks: [[], pagesCheck("in_progress"), pagesCheck("completed", "success")] });
  const result = await w.run();
  assert.equal(result.outcome, "ok");
  assert.deepEqual([result.build.live, result.build.commit, result.build.via, result.build.attempts], [true, MERGED, "cloudflare-pages-check", 3]);
  assert.deepEqual(w.calls.github.filter(([kind]) => kind === "check-runs").map(([, sha]) => sha), [MERGED, MERGED, MERGED]);
  assert.deepEqual(w.calls.checks, ["first"], "the post-deploy checks still run");
  assert.equal(w.calls.github.some(([kind]) => kind === "create"), false);
});

test("refused by Cloudflare, and Cloudflare Pages reports the build failed: an issue at once, nothing rolled back", async () => {
  const w = world({ site: [403], pagesChecks: [pagesCheck("completed", "failure")], env: configured });
  const result = await w.run();
  assert.equal(result.outcome, "build-not-live");
  assert.deepEqual([result.build.build_failed, result.build.attempts], [true, 1]);
  assert.deepEqual(w.calls.rollback, []);
  const created = w.calls.github.find(([kind]) => kind === "create")[1];
  assert.match(created.body, /Cloudflare Pages reported to GitHub that its build of this commit failed/);
});

test("refused by Cloudflare and GitHub cannot say: it waits its time out and says the site answered 403, never 'live'", async () => {
  for (const pagesChecks of [[new Error("GitHub GET /commits/x/check-runs refused (HTTP 403)")], null, [pagesCheck("queued")]]) {
    const w = world({ site: [403], pagesChecks });
    const result = await w.run();
    assert.equal(result.outcome, "build-not-live");
    assert.equal(result.build.attempts, 31);
    assert.match(w.calls.github.find(([kind]) => kind === "create")[1].body, /no commit \(status 403\)/);
  }
});

test("when the site can be read, Cloudflare Pages' check is not asked", async () => {
  const w = world({ pagesChecks: [pagesCheck("completed", "failure")] });
  assert.equal((await w.run()).build.via, "version.json");
  assert.equal(w.calls.github.some(([kind]) => kind === "check-runs"), false);
});

test("a cancelled, skipped or neutral Pages check is not a failed build: it is waited out", async () => {
  for (const conclusion of ["cancelled", "skipped", "neutral"]) {
    const w = world({ site: [403], pagesChecks: [pagesCheck("completed", conclusion)] });
    const result = await w.run();
    assert.deepEqual([result.outcome, result.build.build_failed, result.build.attempts], ["build-not-live", undefined, 31], conclusion);
    assert.match(w.calls.github.find(([kind]) => kind === "create")[1].body, /If another merge followed within minutes/);
  }
});

test("after a push, an older preview build of the same commit does not count as the production build", async () => {
  const preview = pagesCheck("completed", "success", "2026-11-13T08:00:00Z");
  const pushed = { GITHUB_EVENT_NAME: "push" };
  // Only the preview's success exists: not live.
  let w = world({ site: [403], pagesChecks: [preview], env: pushed });
  assert.equal((await w.run()).outcome, "build-not-live");
  // The production build, started after the push, then succeeds: live.
  w = world({ site: [403], checks: apiOnly, pagesChecks: [preview, [...preview, ...pagesCheck("completed", "success", "2026-11-13T09:58:00Z")]], env: pushed });
  assert.deepEqual([(await w.run()).build.via], ["cloudflare-pages-check"]);
  // A run started by hand may name an older commit: its build is older too.
  w = world({ site: [403], checks: apiOnly, pagesChecks: [preview], env: { GITHUB_EVENT_NAME: "workflow_dispatch" } });
  assert.equal((await w.run()).outcome, "ok");
});
