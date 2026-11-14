#!/usr/bin/env node
// The check after every merge to main. Cloudflare Pages builds the public
// site from main by itself; this waits until diamondecho.com says it serves
// the merged commit (/version.json, written by scripts/copy-build.mjs), then
// runs the post-deploy suite of synthetic checks against it.
//
//   node scripts/sre/post-deploy.mjs --commit SHA --out post-deploy.json
//        [--run-out run.json] [--timeout-minutes 15] [--interval-seconds 30] [--apply]
//
// If the build never shows up, or a check fails, the run fails visibly. With
// --apply it also opens (or adds to) one `sre-incident` issue naming the
// merge, what failed and how to roll back; and, only when the Cloudflare
// secrets exist AND the repository variable SRE_PAGES_AUTOROLLBACK is
// "enabled", it puts the previous build of the site back
// (cloudflare/pages-rollback.sh --apply). A rollback is only ever made when
// the merged build itself is the live one and a website check that a
// rollback could fix failed twice, a minute apart.
//
// The API is deployed by hand, not by the merge. When the merge changed
// backend/ and the live API still runs an older commit, the summary says so;
// that is expected, not a failure.
//
// Exit 0: the merged build is live and every check passed.
// Exit 1: the build never went live, a check failed, or the checks broke.
// Exit 2: this command itself broke (bad arguments).
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { githubClient } from "./lib/github.mjs";
import { TARGETS, USER_AGENT } from "./targets.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const COMMIT = /^[0-9a-f]{7,40}$/;
const SITE_SEVERITIES = new Set(["sev1", "sev2"]);
// Website checks a rollback of the build cannot fix: the www redirect is a
// Cloudflare zone rule, not part of the build.
const NOT_THE_BUILD = new Set(["public-www-redirect", "edge-www-redirect"]);
export const RECHECK_DELAY_MS = 60_000;
export const ISSUE_TITLE = "Post-merge check failed";
export const LABEL = { name: "sre-incident", color: "d93f0b", description: "Opened and closed by the SRE monitor" };

const short = (commit) => (commit || "").slice(0, 7);
const sameCommit = (a, b) => Boolean(a && b) && (a.startsWith(b) || b.startsWith(a));

// The clock: SRE_NOW (tests, drills) starts it at a fixed time; it then runs
// at the real pace so the polling deadline still arrives.
export function makeClock(env = process.env, realNow = Date.now) {
  if (!env.SRE_NOW) return realNow;
  const base = Date.parse(env.SRE_NOW);
  if (Number.isNaN(base)) throw new UsageError("SRE_NOW is not an ISO time");
  const start = realNow();
  return () => base + (realNow() - start);
}

export class UsageError extends Error {}

// One GET of a small public JSON file. Never throws: a failed request is
// data. Only the commit-shaped field is kept.
async function readCommit(fetcher, url) {
  try {
    const response = await fetcher(url, {
      headers: { "User-Agent": USER_AGENT, "Cache-Control": "no-cache", Accept: "application/json" },
      cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(15_000),
    });
    const text = response.ok ? await response.text() : "";
    let body = null;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    const commit = typeof body?.commit === "string" && COMMIT.test(body.commit) ? body.commit : null;
    return { status: response.status, commit, body };
  } catch {
    return { status: 0, commit: null, body: null };
  }
}

// The name of the check Cloudflare Pages puts on a commit for the production
// project (seen on every pull request and merge of this repository).
export const PAGES_CHECK_NAME = "Cloudflare Pages: diamondecho";

// What Cloudflare Pages itself reported to GitHub about building a commit:
// "success", "failure", "pending" (not finished, or not reported yet) or
// "unknown" (GitHub could not be read). Read-only.
export async function pagesBuildState(github, commit) {
  try {
    const runs = (await github.listCheckRuns(commit)).filter((run) => run.name === PAGES_CHECK_NAME);
    if (runs.length === 0) return "pending";
    if (runs.some((run) => run.status !== "completed")) return "pending";
    return runs.every((run) => run.conclusion === "success") ? "success" : "failure";
  } catch {
    return "unknown";
  }
}

// Wait until the site serves the merged commit, or a later one that contains it.
//
// The first source is the site itself (/version.json). Cloudflare's Bot Fight
// Mode refuses GitHub's runners (403), so when the site answers 403 the
// second source is asked: the result Cloudflare Pages reported to GitHub for
// this commit (`pagesBuild`). That proves the build was published; that the
// pages then load is watched by the uptime service (checks/uptime.mjs).
export async function waitForBuild({ merged, fetcher, sleep, now, timeoutMs, intervalMs, isAncestor, origin, pagesBuild = null }) {
  const deadline = now() + timeoutMs;
  let attempts = 0;
  let last = { status: 0, commit: null };
  for (;;) {
    attempts += 1;
    last = await readCommit(fetcher, `${origin}/version.json`);
    if (last.commit && sameCommit(last.commit, merged)) return { live: true, commit: last.commit, attempts, later: false, via: "version.json" };
    if (last.commit && isAncestor(merged, last.commit)) return { live: true, commit: last.commit, attempts, later: true, via: "version.json" };
    if (last.status === 403 && pagesBuild) {
      const state = await pagesBuild(merged);
      if (state === "success") return { live: true, commit: merged, attempts, later: false, via: "cloudflare-pages-check" };
      if (state === "failure") return { live: false, commit: null, status: last.status, attempts, build_failed: true };
    }
    if (now() + intervalMs > deadline) return { live: false, commit: last.commit, status: last.status, attempts };
    await sleep(intervalMs);
  }
}

// What the live API says it runs, compared with the merge.
export async function apiNote({ merged, fetcher, backendChanged, origin }) {
  const seen = await readCommit(fetcher, `${origin}/api/`);
  if (seen.status !== 200) return { state: "unreachable", text: `The API's identity route answered ${seen.status || "nothing"}; its commit is unknown.` };
  if (!seen.commit) {
    return { state: "unknown", text: "The API does not report its commit yet (the serving revision was deployed before the build identity). Whether it is behind main cannot be told." };
  }
  const changed = sameCommit(seen.commit, merged) ? false : backendChanged(seen.commit, merged);
  if (changed === true) {
    return { state: "behind", api_commit: seen.commit,
      text: `The API runs \`${short(seen.commit)}\` and backend/ has changed on main since. The API is deployed by hand: docs/sre/release-safety.md, "Deploying the API". This is expected after a backend merge, not a failure.` };
  }
  if (changed === false) return { state: "current", api_commit: seen.commit, text: `The API runs \`${short(seen.commit)}\`; backend/ is the same on main.` };
  return { state: "unknown", api_commit: seen.commit, text: `The API runs \`${short(seen.commit)}\`; it could not be compared with main here.` };
}

function failedChecks(run) {
  return (Array.isArray(run?.checks) ? run.checks : []).filter((check) => check && check.ok === false)
    .map((check) => ({ id: String(check.id), name: String(check.name), component: String(check.component),
      severity: String(check.severity), status: Number.isInteger(check.status) ? check.status : null,
      detail: String(check.detail || "").slice(0, 200) }));
}

const ROLLBACK_STEPS = [
  "**How to roll back the website** (docs/sre/release-safety.md, \"Rolling back the website\"):",
  "1. Cloudflare dashboard > Workers & Pages > `diamondecho` > Deployments. Find the production deployment before this merge, open its menu and choose **Rollback to this deployment**. The old build is live within a minute.",
  "   Or, where the Cloudflare secrets are set: `bash scripts/sre/cloudflare/pages-rollback.sh` (dry run), then the same with `--apply`.",
  "2. Revert the merge on GitHub (the **Revert** button on the pull request) so the next build does not bring it back. Merging the revert is Gbenga's.",
  "3. Check https://diamondecho.com/version.json names the commit you expect.",
  "Runbook: docs/sre/runbooks/bad-deploy.md. The API is not changed by a merge; for the API see the same runbook.",
];

export function issueText(result) {
  const lines = [`**${ISSUE_TITLE} for \`${short(result.commit)}\`** at ${result.finished_at}.`, ""];
  lines.push(`- Merge: ${result.commit_url || `\`${result.commit}\``}`);
  if (result.run_url) lines.push(`- Workflow run: ${result.run_url}`);
  lines.push("");
  if (result.outcome === "build-not-live" && result.build.build_failed) {
    lines.push("**What failed:** Cloudflare Pages reported to GitHub that its build of this commit failed (the check \"Cloudflare Pages: diamondecho\" on the commit).");
    lines.push("The previous build is still serving, so visitors see the old site. Open that check on the commit, or Cloudflare Pages > `diamondecho` > Deployments, for the build log. Nothing was rolled back.");
  } else if (result.outcome === "build-not-live") {
    lines.push(`**What failed:** diamondecho.com did not show this commit within ${result.timeout_minutes} minutes (${result.build.attempts} looks at /version.json). The last answer named ${result.build.commit ? `\`${short(result.build.commit)}\`` : `no commit (status ${result.build.status || "none"})`}.`);
    lines.push("The previous build is most likely still serving, so visitors see the old site. Look at Cloudflare Pages > `diamondecho` > Deployments for a failed or stuck build. Nothing was rolled back.");
  } else if (result.outcome === "checks-broke") {
    lines.push("**What failed:** the post-deploy checks themselves did not run to the end, so the new build is unverified. Nothing was rolled back.");
  } else {
    lines.push("**What failed** (post-deploy checks on the merged build):", "");
    for (const check of result.failed) lines.push(`- ${check.name} (\`${check.id}\`, ${check.component}, ${check.severity}): ${check.detail || "failed"}`);
  }
  lines.push("", `**Automatic rollback:** ${result.rollback.text}`, "", `**API:** ${result.api.text}`, "", ...ROLLBACK_STEPS, "",
    "Do not paste secret values, tokens or visitor data into this issue.");
  return lines.join("\n");
}

export function summaryText(result) {
  const head = {
    ok: `Post-merge check passed: \`${short(result.commit)}\` is live on diamondecho.com and every post-deploy check passed.`,
    "build-not-live": `Post-merge check FAILED: \`${short(result.commit)}\` did not go live within ${result.timeout_minutes} minutes.`,
    "checks-failed": `Post-merge check FAILED: ${result.failed.length} post-deploy check(s) failed on \`${short(result.build.commit)}\`.`,
    "checks-broke": "Post-merge check FAILED: the post-deploy checks did not run to the end.",
  }[result.outcome];
  const lines = [`### ${head}`, ""];
  if (result.build.live && result.build.later) lines.push(`- A later merge, \`${short(result.build.commit)}\`, is live and includes this one; it was checked.`);
  for (const check of result.failed) lines.push(`- FAILED ${check.name} (\`${check.id}\`): ${check.detail || "failed"}`);
  if (result.outcome !== "ok") lines.push(`- Automatic rollback: ${result.rollback.text}`);
  lines.push(`- API: ${result.api.text}`);
  if (result.issue?.html_url) lines.push(`- Issue: ${result.issue.html_url}`);
  return `${lines.join("\n")}\n`;
}

// The whole check. Everything that reaches outside is passed in, so the
// tests replace all of it.
export async function postDeploy(options, deps) {
  const { commit, timeoutMinutes = 15, intervalSeconds = 30, apply = false, env = {} } = options;
  const { fetcher, sleep, now, runChecks, isAncestor, backendChanged, pagesRollback, github, log = () => {} } = deps;
  const targets = TARGETS.production;
  const result = {
    schema: 1, commit, started_at: new Date(now()).toISOString(), timeout_minutes: timeoutMinutes,
    commit_url: env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/commit/${commit}` : null,
    run_url: env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null,
    outcome: "ok", build: null, failed: [], rollback: { action: "none", text: "not needed." }, api: null, issue: null,
  };

  log(`Waiting for diamondecho.com to serve ${short(commit)} (up to ${timeoutMinutes} minutes).`);
  result.build = await waitForBuild({ merged: commit, fetcher, sleep, now, isAncestor, origin: targets.publicOrigin,
    timeoutMs: timeoutMinutes * 60_000, intervalMs: intervalSeconds * 1000,
    pagesBuild: github && !github.dryRun ? (sha) => pagesBuildState(github, sha) : null });

  if (!result.build.live) {
    result.outcome = "build-not-live";
    result.rollback = { action: "none", text: "not attempted: the merged build never went live, so the previous one is still serving." };
  } else {
    log(`Live: ${short(result.build.commit)}. Running the post-deploy checks.`);
    const checks = await runChecks("first");
    if (checks.code === 0 || checks.code === 1) result.failed = failedChecks(checks.run);
    if (checks.code === 0 && result.failed.length === 0) {
      result.outcome = "ok";
    } else if (checks.code === 1 && result.failed.length > 0) {
      result.outcome = "checks-failed";
    } else {
      result.outcome = "checks-broke";
    }
    if (result.outcome === "checks-broke") {
      result.rollback = { action: "none", text: "not attempted: the checks did not finish, so there is no evidence against the build." };
    } else if (result.outcome === "checks-failed") {
      result.rollback = await decideRollback({ result, env, apply, pagesRollback, runChecks, fetcher, sleep, origin: targets.publicOrigin });
    }
  }

  result.api = await apiNote({ merged: commit, fetcher, backendChanged, origin: targets.apiOrigin });
  result.finished_at = new Date(now()).toISOString();

  if (apply) {
    try {
      result.issue = await fileIssue(result, github, log);
    } catch (error) {
      // The verdict still stands and the run still fails visibly; GitHub's
      // error names the method and status only (lib/github.mjs).
      result.issue = { action: "failed", error: String(error?.message || error).slice(0, 200) };
      log(`Could not file the issue: ${result.issue.error}`);
    }
  }
  return result;
}

// A failed check that a rollback of the build could fix: a website check of
// severity 1 or 2, not refused by Cloudflare itself (a security setting, the
// same for every build), and not the www redirect.
export function rollbackTriggers(failed) {
  return failed.filter((check) => check.component === "public-site" && SITE_SEVERITIES.has(check.severity)
    && !NOT_THE_BUILD.has(check.id) && !(check.status === 403 && /^Cloudflare refused/.test(check.detail)));
}

async function decideRollback({ result, env, apply, pagesRollback, runChecks, fetcher, sleep, origin }) {
  const first = rollbackTriggers(result.failed);
  if (first.length === 0) {
    return { action: "none", text: "not attempted: no failed website check that a rollback could fix (a severity 1 or 2 website check, not refused by Cloudflare itself, not the www redirect)." };
  }
  if (result.build.later) {
    return { action: "none", text: `not attempted: a later merge (\`${short(result.build.commit)}\`) is live, and its own post-merge check decides about it.` };
  }
  const configured = Boolean(env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID);
  const enabled = env.SRE_PAGES_AUTOROLLBACK === "enabled";
  const args = ["--expect-live-commit", result.build.commit];
  if (!configured) {
    return { action: "not-set-up", text: "off: the Cloudflare secrets are not set (docs/sre/needs-from-gbenga.md). Roll back by hand with the steps below." };
  }
  // A second look about a minute later: one passing blip must not take a
  // build off the site. Only a check that fails both times counts.
  await sleep(RECHECK_DELAY_MS);
  const again = await runChecks("recheck");
  const againIds = new Set(rollbackTriggers(failedChecks(again.run)).map((check) => check.id));
  result.recheck = { code: again.code, still_failing: first.filter((check) => againIds.has(check.id)).map((check) => check.id) };
  if (result.recheck.still_failing.length === 0) {
    return { action: "none", text: "not attempted: the failed website checks passed on a second look a minute later (or the second look did not run)." };
  }
  if (!(apply && enabled)) {
    const dry = await pagesRollback(args);
    const target = dry.last?.to?.commit ? ` It would put back the build of \`${short(dry.last.to.commit)}\`.` : "";
    return { action: "dry-run", text: `off (SRE_PAGES_AUTOROLLBACK is not "enabled"${apply ? "" : ", or this was not an --apply run"}).${target} Roll back by hand with the steps below.` };
  }
  const done = await pagesRollback(["--apply", ...args]);
  if (done.code !== 0 || done.last?.verified !== true) {
    return { action: "failed", text: `**attempted and did not complete** (exit ${done.code}). Roll back by hand with the steps below, now.` };
  }
  // Read it back from the address visitors use. A few gentle looks: the
  // switch takes seconds, the edge may take a little longer.
  const wanted = done.last.to.commit;
  let seen = null;
  for (let i = 0; i < 6; i += 1) {
    seen = (await readCommit(fetcher, `${origin}/version.json`)).commit;
    if (seen && wanted && sameCommit(seen, wanted)) break;
    await sleep(10_000);
  }
  const confirmed = seen && wanted && sameCommit(seen, wanted);
  return { action: "rolled-back", to: done.last.to,
    text: `done: the build of \`${short(wanted)}\` was put back${confirmed ? " and diamondecho.com/version.json names it" : `, but diamondecho.com/version.json still names \`${short(seen) || "nothing"}\`; check it by hand`}. Revert the merge so the next build does not bring it back.` };
}

async function fileIssue(result, github, log) {
  const open = (await github.listOpenIssues(LABEL.name)).find((issue) => issue.title.startsWith(ISSUE_TITLE));
  if (result.outcome === "ok") {
    if (!open) return null;
    await github.comment(open.number, `Post-merge check passed for \`${short(result.commit)}\` at ${result.finished_at}: it is live and every post-deploy check passed. Closing.`);
    await github.closeIssue(open.number);
    log(`Closed issue #${open.number}.`);
    return { number: open.number, html_url: open.html_url, action: "closed" };
  }
  const body = issueText(result);
  if (open) {
    await github.comment(open.number, body);
    log(`Added to issue #${open.number}.`);
    return { number: open.number, html_url: open.html_url, action: "commented" };
  }
  await github.ensureLabel(LABEL.name, LABEL.color, LABEL.description);
  const created = await github.createIssue({ title: `${ISSUE_TITLE} for ${short(result.commit)}`, body, labels: [LABEL.name] });
  log(`Opened issue ${created.html_url || "(dry run)"}.`);
  return { ...created, action: "opened" };
}

// ------------------------------------------------------------ real defaults
function git(args) {
  return spawnSync("git", ["-C", REPO, ...args], { encoding: "utf8" }).status;
}
// true when `ancestor` is in the history of `descendant`. A commit this
// checkout does not have yet is fetched once from origin.
export function gitIsAncestor(ancestor, descendant) {
  if (!COMMIT.test(ancestor) || !COMMIT.test(descendant)) return false;
  let status = git(["merge-base", "--is-ancestor", ancestor, descendant]);
  if (status === 128 && git(["fetch", "--quiet", "origin", "main"]) === 0) status = git(["merge-base", "--is-ancestor", ancestor, descendant]);
  return status === 0;
}
// true / false: did backend/ change between the two commits; null: unknown.
export function gitBackendChanged(from, to) {
  if (!COMMIT.test(from) || !COMMIT.test(to)) return null;
  const status = git(["diff", "--quiet", from, to, "--", "backend"]);
  return status === 0 ? false : status === 1 ? true : null;
}

// A child process gets only what it needs: never the GitHub token, and the
// Cloudflare secrets only for the rollback script.
export function childEnv(env, keepCloudflare) {
  return Object.fromEntries(Object.entries(env).filter(([key]) =>
    key !== "GITHUB_TOKEN" && (keepCloudflare || !key.startsWith("CLOUDFLARE_"))));
}

function runChild(command, args, env, timeoutMs) {
  return new Promise((done) => {
    const child = spawn(command, args, { cwd: REPO, env, stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (chunk) => { out += chunk; process.stderr.write(chunk); });
    child.on("error", () => { clearTimeout(timer); done({ code: 2, out }); });
    child.on("close", (code) => { clearTimeout(timer); done({ code: code ?? 2, out }); });
  });
}

export function defaultDeps({ env, runOut }) {
  return {
    fetcher: globalThis.fetch,
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    isAncestor: gitIsAncestor,
    backendChanged: gitBackendChanged,
    // "first" writes run.json; the second look writes run-recheck.json.
    async runChecks(label = "first") {
      const out = label === "first" ? runOut : runOut.replace(/(\.json)?$/, "-recheck.json");
      const { code } = await runChild(process.execPath,
        [join(HERE, "synthetic-checks.mjs"), "--suite", "post-deploy", "--out", out, "--fail-on-failure"], childEnv(env, false), 9 * 60_000);
      let run = null;
      try { run = JSON.parse(readFileSync(out, "utf8")); } catch { /* no run written */ }
      return { code, run };
    },
    async pagesRollback(args) {
      const { code, out } = await runChild("bash", [join(HERE, "cloudflare", "pages-rollback.sh"), ...args], childEnv(env, true), 3 * 60_000);
      let last = null;
      try { last = JSON.parse(out.trim().split("\n").pop()); } catch { /* no result line */ }
      return { code, last };
    },
    github: githubClient({ fetch: globalThis.fetch, log: (line) => console.error(line) }),
    log: (line) => console.error(line),
  };
}

export function parseCli(argv) {
  const { values } = parseArgs({ args: argv, options: {
    commit: { type: "string" }, out: { type: "string" }, "run-out": { type: "string", default: "run.json" },
    "timeout-minutes": { type: "string", default: "15" }, "interval-seconds": { type: "string", default: "30" },
    apply: { type: "boolean", default: false },
  } });
  const commit = (values.commit || "").toLowerCase();
  if (!COMMIT.test(commit)) throw new UsageError("--commit must be a commit (7 to 40 hex characters).");
  if (!values.out) throw new UsageError("--out is required.");
  const timeoutMinutes = Number(values["timeout-minutes"]);
  const intervalSeconds = Number(values["interval-seconds"]);
  if (!(timeoutMinutes > 0 && timeoutMinutes <= 60)) throw new UsageError("--timeout-minutes must be between 1 and 60.");
  // Gentle: never more often than every 10 seconds.
  if (!(intervalSeconds >= 10 && intervalSeconds <= 300)) throw new UsageError("--interval-seconds must be between 10 and 300.");
  return { commit, out: values.out, runOut: values["run-out"], timeoutMinutes, intervalSeconds, apply: values.apply };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseCli(process.argv.slice(2));
    const now = makeClock(process.env);
    const result = await postDeploy({ ...options, env: process.env }, { ...defaultDeps({ env: process.env, runOut: options.runOut }), now });
    writeFileSync(options.out, `${JSON.stringify(result, null, 2)}\n`);
    const summary = summaryText(result);
    process.stdout.write(summary);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    process.exitCode = result.outcome === "ok" ? 0 : 1;
  } catch (error) {
    console.error(`post-deploy: ${error instanceof UsageError ? error.message : `broke: ${error?.message || error}`}`);
    process.exitCode = 2;
  }
}
