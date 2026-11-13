#!/usr/bin/env node
// The alert engine: turns monitor runs into incidents, one per component.
//
//   node scripts/sre/alert.mjs --run run.json --state-dir DIR --out actions.json [--slo slo.json] [--apply]
//
// Reads run.json, DIR/incidents.json (and DIR/deploys.jsonl when present, to
// point at the bad-deploy runbook). Writes DIR/incidents.json (only this
// script writes it) and actions.json (what it did or would do).
//
// The rules are in alert-policy.mjs; this file reads, asks the policy, and
// carries out. Without --apply nothing outside the files is touched. With
// --apply it opens, updates and closes GitHub issues through lib/github.mjs
// and posts to the chat webhook in SRE_ALERT_WEBHOOK_URL when that is set.
// Without a GitHub token, --apply is a logged dry run for GitHub.
//
// Environment: GITHUB_TOKEN, GITHUB_REPOSITORY (the client's defaults),
// SRE_ALERT_WEBHOOK_URL (a secret: never printed), SRE_OWNER (a GitHub login
// named on escalation reminders), SRE_NOW (replaces the clock).
//
// Exit codes: 0 done (a failed check, or GitHub or the webhook refusing, is
// logged, not an error); 2 this command broke or the run document is invalid.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runProblems } from "./lib/schema.mjs";
import { githubClient } from "./lib/github.mjs";
import { evaluate, normalizeIncidents, readComments, LABELS, READ_COMMENTS_EVERY_MINUTES } from "./alert-policy.mjs";
import { nowFrom } from "./state.mjs";

const WEBHOOK_TIMEOUT_MS = 10_000;
// A close that GitHub refused is retried on later runs for this long.
const CLOSE_RETRY_HOURS = 24;

class UsageError extends Error {}

export function parseArgs(argv) {
  const args = { apply: false, slo: null };
  const value = (flag, i) => {
    if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new UsageError(`${flag} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--run") args.run = value(flag, i++);
    else if (flag === "--state-dir") args.stateDir = value(flag, i++);
    else if (flag === "--out") args.out = value(flag, i++);
    else if (flag === "--slo") args.slo = value(flag, i++);
    else if (flag === "--apply") args.apply = true;
    else throw new UsageError(`unknown option ${flag}`);
  }
  if (!args.run || !args.stateDir || !args.out) {
    throw new UsageError("usage: node scripts/sre/alert.mjs --run run.json --state-dir DIR --out actions.json [--slo slo.json] [--apply]");
  }
  return args;
}

async function readText(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, file);
}

// ------------------------------------------------------------------ GitHub

// What GitHub says about the open incidents' issues: open or closed by a
// person, acknowledged (the label, or a person's comment starting "ack" or
// "Acknowledged"), silenced (label), and "Status:" lines a person wrote.
// null when it cannot be read: then nothing is assumed either way.
// `engine` is incidents.json's engine memory: it records when each issue's
// comments were last read, so they are not fetched on every run.
export async function readGithubFacts(client, open, log, { engine = { incidents: {} }, now = Date.now() } = {}) {
  if (client.dryRun) return null;
  try {
    const listed = await client.listOpenIssues(LABELS.incident.name);
    const byNumber = new Map(listed.map((issue) => [issue.number, issue]));
    const facts = { _titles: Object.fromEntries(listed.map((issue) => [issue.title, issue])) };
    for (const incident of open) {
      const number = incident.issue_number;
      if (!Number.isInteger(number)) continue;
      const issue = byNumber.get(number);
      if (!issue) {
        facts[number] = { open: false, acknowledged: true, silenced: true };
        continue;
      }
      const memo = engine.incidents?.[incident.key];
      let acknowledged = issue.labels.includes(LABELS.acknowledged.name);
      // Comments are read every run where a reminder could still be due, and
      // otherwise at most every READ_COMMENTS_EVERY_MINUTES (for "Status:").
      const reminderDue = !acknowledged && !memo?.acknowledged && (incident.severity === "sev1" || incident.severity === "sev2");
      const lastRead = Date.parse(memo?.comments_read_at ?? "");
      const readDue = !(now - lastRead < READ_COMMENTS_EVERY_MINUTES * 60_000);
      let statuses = [];
      if (reminderDue || readDue) {
        const said = readComments(await client.listComments(number), incident.opened_at);
        acknowledged = acknowledged || said.acknowledged;
        statuses = said.statuses;
        if (memo) memo.comments_read_at = new Date(now).toISOString();
      }
      facts[number] = { open: true, acknowledged, silenced: issue.labels.includes(LABELS.silenced.name), statuses };
    }
    return facts;
  } catch (error) {
    log(`alert: could not read the incident issues (${error.message}); acknowledgements are unknown this run.`);
    return null;
  }
}

// ------------------------------------------------------------------ webhook

// Slack-compatible: { "text": "…" }. The address is a secret: it is never
// printed, not even when the post fails.
export async function postWebhook({ url, text, fetch: fetcher = globalThis.fetch }) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, why: "the webhook setting is not a web address" };
  }
  if (parsed.protocol !== "https:") return { ok: false, why: "the webhook address must start with https://" };
  try {
    const response = await fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      redirect: "error",
    });
    return response.ok ? { ok: true } : { ok: false, why: `refused (HTTP ${response.status})` };
  } catch (error) {
    return { ok: false, why: error?.name === "TimeoutError" ? "timed out" : "no answer" };
  }
}

// ----------------------------------------------------------------- execute

// Carries out the policy's actions in order. Each one is tried on its own: a
// refusal is logged and recorded, never thrown, so one failure cannot stop
// the rest or the saving of incidents.json.
export async function execute({ actions, incidents, client, apply, webhookUrl, fetch: fetcher, facts, log, now }) {
  const results = [];
  const writes = apply && !client.dryRun;
  const byKey = (key) => incidents.open.find((item) => item.key === key) ?? incidents.recent.find((item) => item.key === key);
  let labelsReady = false;
  const ensureLabels = async () => {
    if (labelsReady || !writes) return;
    for (const label of Object.values(LABELS)) await client.ensureLabel(label.name, label.color, label.description);
    labelsReady = true;
  };

  // The policy refers to another incident's issue as [[issue:KEY]].
  const fill = (text) => text.replace(/\[\[issue:([a-z0-9:-]+)\]\]/g, (_, key) => {
    const other = byKey(key);
    return Number.isInteger(other?.issue_number) ? `(#${other.issue_number})` : "";
  }).replace(/ +\./g, ".");

  for (const original of actions) {
    const action = typeof original.body === "string" ? { ...original, body: fill(original.body) } : original;
    const incident = byKey(action.key);
    const number = Number.isInteger(incident?.issue_number) ? incident.issue_number : null;
    const record = { ...action, issue_number: number };
    try {
      if (action.kind === "webhook") {
        const text = incident?.issue_url ? `${action.text} ${incident.issue_url}` : action.text;
        record.text = text;
        if (!webhookUrl) record.result = "skipped: no webhook is set up";
        else if (!apply) { record.result = "dry-run"; log(`[webhook dry run] would post: ${text}`); }
        else {
          const sent = await postWebhook({ url: webhookUrl, text, fetch: fetcher });
          record.result = sent.ok ? "done" : `failed: ${sent.why}`;
          if (!sent.ok) log(`alert: the chat webhook ${sent.why}; the issue is still the record.`);
        }
      } else if (action.kind === "open-issue") {
        if (!apply) record.result = "dry-run";
        else {
          // An issue for this incident may already exist (an earlier run
          // opened it but could not save the number): adopt it.
          const existing = facts?._titles?.[action.title];
          let issue = existing ? { number: existing.number, html_url: existing.html_url } : null;
          if (!issue) {
            await ensureLabels();
            issue = await client.createIssue({ title: action.title, body: action.body, labels: action.labels });
          }
          if (Number.isInteger(issue.number) && incident) {
            incident.issue_number = issue.number;
            incident.issue_url = issue.html_url;
          }
          record.issue_number = issue.number ?? null;
          record.result = client.dryRun ? "dry-run" : existing ? "adopted" : "done";
        }
      } else if (number === null) {
        record.result = "skipped: no issue";
        if (!apply || client.dryRun) log(`[github dry run] would ${action.kind} for ${action.key} (no issue yet)`);
      } else if (!apply) {
        record.result = "dry-run";
      } else if (action.kind === "comment") {
        await client.comment(number, action.body);
        record.result = writes ? "done" : "dry-run";
      } else if (action.kind === "set-severity") {
        await ensureLabels();
        if (action.from !== action.to) {
          await client.removeLabel(number, action.from);
          await client.addLabels(number, [action.to]);
        }
        await client.editIssue(number, { title: action.title });
        record.result = writes ? "done" : "dry-run";
      } else if (action.kind === "reopen-issue") {
        await client.reopenIssue(number);
        await client.comment(number, action.body);
        record.result = writes ? "done" : "dry-run";
      } else if (action.kind === "close-issue") {
        await client.comment(number, action.body);
        await client.closeIssue(number);
        record.result = writes ? "done" : "dry-run";
      } else {
        record.result = "skipped: unknown action";
      }
    } catch (error) {
      record.result = `failed: ${error.message}`;
      log(`alert: ${action.kind} for ${action.key} failed: ${error.message}`);
      if (action.kind === "close-issue" && number !== null) {
        incidents.engine.pending_closes.push({ issue_number: number, body: action.body, since: new Date(now).toISOString() });
      }
    }
    delete record.body; // the body is in the issue; actions.json stays short
    results.push(record);
  }
  return results;
}

// Closes that GitHub refused on an earlier run.
async function retryCloses({ incidents, client, apply, now, log }) {
  const keep = [];
  for (const item of incidents.engine.pending_closes) {
    if (!apply || client.dryRun) { keep.push(item); continue; }
    if (now - Date.parse(item.since) > CLOSE_RETRY_HOURS * 3_600_000) {
      log(`alert: gave up closing issue #${item.issue_number} after ${CLOSE_RETRY_HOURS} hours; close it by hand.`);
      continue;
    }
    try {
      await client.comment(item.issue_number, item.body);
      await client.closeIssue(item.issue_number);
    } catch (error) {
      log(`alert: closing issue #${item.issue_number} failed again: ${error.message}`);
      keep.push(item);
    }
  }
  incidents.engine.pending_closes = keep;
}

// -------------------------------------------------------------------- main

export async function runAlert({ args, env = process.env, fetch: fetcher = globalThis.fetch, now = nowFrom(env), log = (line) => console.log(line) }) {
  const run = JSON.parse(await readFile(args.run, "utf8"));
  const problems = runProblems(run);
  if (problems.length) throw new UsageError(`run.json is not valid: ${problems.join("; ")}`);

  const incidentsFile = path.join(args.stateDir, "incidents.json");
  let previous = null;
  const text = await readText(incidentsFile);
  if (text !== null) {
    try {
      previous = JSON.parse(text);
    } catch {
      // Starting again is better than never alerting again. The damaged copy
      // is kept, and open issues are adopted again by title.
      log("alert: incidents.json could not be read; starting it again (old copy kept as incidents.json.damaged).");
      await rename(incidentsFile, `${incidentsFile}.damaged`);
    }
  }
  const incidentsBefore = normalizeIncidents(previous);

  let slo = null;
  if (args.slo) {
    try {
      slo = JSON.parse(await readFile(args.slo, "utf8"));
    } catch {
      log("alert: slo.json could not be read; budget incidents are left as they are.");
    }
  }
  const deploys = [];
  for (const line of ((await readText(path.join(args.stateDir, "deploys.jsonl"))) ?? "").split("\n")) {
    try { if (line.trim()) deploys.push(JSON.parse(line)); } catch { /* a damaged line costs that line only */ }
  }

  const client = githubClient({ fetch: fetcher, log, token: env.GITHUB_TOKEN, repository: env.GITHUB_REPOSITORY });
  if (args.apply && client.dryRun) log("alert: no GitHub token or repository, so --apply is a dry run for GitHub.");
  const notify = args.apply && !client.dryRun;
  const facts = notify ? await readGithubFacts(client, incidentsBefore.open, log, { engine: incidentsBefore.engine, now }) : null;
  await retryCloses({ incidents: incidentsBefore, client, apply: args.apply, now, log });

  const { incidents, actions, notes } = evaluate({
    run, incidents: incidentsBefore, slo, now, deploys, github: facts, notify,
    owner: env.SRE_OWNER?.trim() || null,
    links: { repository: env.GITHUB_REPOSITORY || null },
  });
  for (const note of notes) log(`alert: ${note}`);

  const results = await execute({
    actions, incidents, client, apply: args.apply, webhookUrl: env.SRE_ALERT_WEBHOOK_URL?.trim() || null,
    fetch: fetcher, facts, log, now,
  });

  await writeJson(incidentsFile, incidents);
  const summary = `${incidents.open.length} open incident(s)${incidents.open.length ? `: ${incidents.open.map((item) => `${item.key} ${item.severity}`).join(", ")}` : ""}; ${results.length} action(s)${args.apply ? "" : " (dry run)"}.`;
  await writeJson(args.out, {
    schema: 1, generated_at: new Date(now).toISOString(), run: { suite: run.suite, started_at: run.started_at },
    apply: args.apply, github: client.dryRun ? "dry-run" : "live", summary, notes, actions: results,
  });
  log(`alert: ${summary}`);
  for (const result of results) log(`alert: ${result.kind} ${result.key}${result.issue_number ? ` #${result.issue_number}` : ""}: ${result.result}`);
  return { incidents, results };
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    await runAlert({ args });
  } catch (error) {
    console.error(`alert: ${error.message}`);
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
