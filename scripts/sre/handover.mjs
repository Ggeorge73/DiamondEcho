#!/usr/bin/env node
// Starts the next monitor run five minutes after this one began.
//
//   node scripts/sre/handover.mjs --started EPOCH_SECONDS [--interval 300] [--dry-run]
//
// Why: GitHub's scheduler does not keep a five-minute schedule. On
// 2026-11-14 it started the "*/5" monitor 4 times in about 17 hours. GitHub
// says scheduled workflows can be delayed, and dropped, when it is busy. A
// run started through the API ("workflow_dispatch") is not scheduled: it
// starts when asked. So each monitor run ends by waiting out the rest of its
// five minutes and asking GitHub to start the next one. The schedule stays
// in the workflow as the watchdog that restarts the chain if a link breaks.
//
// One chain only. A scheduled or hand-started run can arrive while this one
// waits. Then that newer run carries the chain on, and this one must not
// start a second: before asking, it looks for a newer run of the workflow
// that has not finished, and stands down if there is one. (The workflow also
// cancels an older waiting handover when a newer one starts.)
//
// It changes nothing but that one request. Environment: GITHUB_TOKEN (needs
// the job permission `actions: write`), GITHUB_REPOSITORY, GITHUB_RUN_ID,
// GITHUB_API_URL. The token is sent only in the Authorization header and is
// never printed.
//
// Exit codes: 0 the next run was asked for, or this run stood down, or it
// was a dry run; 2 it could not do its job (bad arguments, GitHub refused).
import { pathToFileURL } from "node:url";

export const WORKFLOW_FILE = "sre-monitor.yml";
export const DEFAULT_INTERVAL_SECONDS = 300;
// Never wait longer than this, whatever the arguments say: the job has a
// time limit, and a wrong start time must not hold a runner.
export const MAX_WAIT_SECONDS = 600;
const UNFINISHED = new Set(["queued", "in_progress", "waiting", "pending", "requested"]);

export class UsageError extends Error {}

export function parseArgs(argv) {
  const args = { started: null, interval: DEFAULT_INTERVAL_SECONDS, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "--started" || flag === "--interval") {
      const value = Number(argv[i + 1]);
      if (!Number.isFinite(value) || value <= 0) throw new UsageError(`${flag} needs a positive number`);
      args[flag.slice(2)] = value;
      i += 1;
    } else throw new UsageError(`unknown option ${flag}`);
  }
  if (args.started === null) throw new UsageError("usage: node scripts/sre/handover.mjs --started EPOCH_SECONDS [--interval 300] [--dry-run]");
  return args;
}

// Seconds still to wait so the next run starts `interval` after this one did.
export function waitSeconds({ started, nowSeconds, interval = DEFAULT_INTERVAL_SECONDS }) {
  const left = Math.ceil(started + interval - nowSeconds);
  return Math.max(0, Math.min(left, MAX_WAIT_SECONDS, interval));
}

// Is there a run of the workflow, other than this one and newer than it,
// that has not finished? Then that run carries the chain on.
export function newerUnfinishedRun(runs, selfId) {
  const self = (runs || []).find((run) => String(run?.id) === String(selfId));
  const selfCreated = Date.parse(self?.created_at ?? "");
  return (runs || []).find((run) => String(run?.id) !== String(selfId) && UNFINISHED.has(String(run?.status))
    && run?.event !== "pull_request"
    // Without this run's own time (it fell off the page), any unfinished run counts.
    && (!Number.isFinite(selfCreated) || Date.parse(run?.created_at ?? "") > selfCreated)) ?? null;
}

async function github(fetcher, env, method, path, body) {
  const base = `${(env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "")}/repos/${env.GITHUB_REPOSITORY}`;
  let response;
  try {
    response = await fetcher(`${base}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json", Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "DiamondEcho-SRE-Monitor/1",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new Error(`GitHub ${method} ${path.split("?")[0]} ${error?.name === "TimeoutError" ? "timed out" : "gave no answer"}`);
  }
  if (!response.ok) throw new Error(`GitHub ${method} ${path.split("?")[0]} refused (HTTP ${response.status})`);
  return response.status === 204 ? null : response.json();
}

export async function handover({ args, env = process.env, fetch: fetcher = globalThis.fetch, now = () => Date.now(), sleep = (ms) => new Promise((done) => setTimeout(done, ms)), log = (line) => console.log(line) }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY || "")) throw new UsageError("GITHUB_REPOSITORY must look like owner/name");
  if (!env.GITHUB_TOKEN && !args.dryRun) throw new UsageError("GITHUB_TOKEN is needed");

  const wait = waitSeconds({ started: args.started, nowSeconds: now() / 1000, interval: args.interval });
  log(`handover: waiting ${wait} s, so the next run starts ${args.interval} s after this one began.`);
  if (wait > 0) await sleep(wait * 1000);

  if (args.dryRun) {
    log("handover: dry run, nothing was asked of GitHub.");
    return { action: "dry-run", waited: wait };
  }
  const list = await github(fetcher, env, "GET", `/actions/workflows/${WORKFLOW_FILE}/runs?branch=main&per_page=30`);
  const newer = newerUnfinishedRun(list?.workflow_runs, env.GITHUB_RUN_ID);
  if (newer) {
    log(`handover: run ${newer.run_number ?? newer.id} (${newer.event}) is newer and has not finished; it carries the chain on. Standing down.`);
    return { action: "stood-down", waited: wait, newer: newer.id };
  }
  await github(fetcher, env, "POST", `/actions/workflows/${WORKFLOW_FILE}/dispatches`, { ref: "main", inputs: { suite: "auto" } });
  log("handover: asked GitHub to start the next monitor run.");
  return { action: "dispatched", waited: wait };
}

async function main() {
  try {
    await handover({ args: parseArgs(process.argv.slice(2)) });
  } catch (error) {
    console.error(`handover: ${error.message}`);
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
