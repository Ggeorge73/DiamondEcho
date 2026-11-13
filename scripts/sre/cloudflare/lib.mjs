// Reads the Cloudflare Pages API answers for pages-rollback.sh. The shell
// script does the talking; the judging is here, as plain functions, so it can
// be tested alone (pages-rollback.test.mjs). Nothing here sees the API token.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const COMMIT = /^[0-9a-f]{7,40}$/;

const commitOf = (deployment) => {
  const value = deployment?.deployment_trigger?.metadata?.commit_hash;
  return typeof value === "string" && COMMIT.test(value) ? value : "";
};
const succeeded = (deployment) => deployment?.latest_stage?.name === "deploy" && deployment?.latest_stage?.status === "success";
const summary = (deployment) => ({ id: deployment.id, commit: commitOf(deployment), created: String(deployment.created_on ?? "") });

// The deployment serving the production address now.
export function liveDeployment(project) {
  const live = project?.result?.canonical_deployment;
  return live && ID.test(live.id ?? "") ? summary(live) : null;
}

// Where to roll back to: the named deployment, or the newest successful
// production deployment older than the live one and built from another
// commit (a retry of the same commit would not undo anything). null: none.
export function rollbackChoice(list, live, wanted = "") {
  const rows = (list?.result ?? []).filter((row) => ID.test(row?.id ?? "") && row.environment === "production");
  if (wanted) {
    const row = rows.find((item) => item.id === wanted);
    return row && succeeded(row) && row.id !== live.id ? summary(row) : null;
  }
  const older = rows
    .filter((row) => succeeded(row) && row.id !== live.id && String(row.created_on ?? "") < live.created)
    .filter((row) => !live.commit || commitOf(row) !== live.commit)
    .sort((a, b) => (a.created_on < b.created_on ? 1 : -1));
  return older.length ? summary(older[0]) : null;
}

// Cloudflare's own verdict, and its error codes (never its full answer).
export function answerOk(answer) {
  return answer?.success === true;
}
export function answerErrors(answer) {
  return (answer?.errors ?? []).map((error) => `${Number(error?.code) || "?"} ${String(error?.message ?? "").slice(0, 120)}`).join("; ");
}

const readJson = (file) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; } };
const line = (...facts) => `${facts.map((fact) => (fact === "" || fact == null ? "-" : String(fact))).join("\t")}\n`;
const commands = {
  // live PROJECT.json -> id, commit, created
  live: ([file]) => { const live = liveDeployment(readJson(file)); return live ? line(live.id, live.commit, live.created) : ""; },
  // choose LIST.json LIVE_ID LIVE_COMMIT LIVE_CREATED [WANTED] -> id, commit, created
  choose: ([file, id, commit, created, wanted = ""]) => {
    const live = { id, commit: commit === "-" ? "" : commit, created: created === "-" ? "" : created };
    const choice = rollbackChoice(readJson(file), live, wanted);
    return choice ? line(choice.id, choice.commit, choice.created) : "";
  },
  // ok ANSWER.json -> yes | no
  ok: ([file]) => `${answerOk(readJson(file)) ? "yes" : "no"}\n`,
  // errors ANSWER.json -> one line
  errors: ([file]) => `${answerErrors(readJson(file))}\n`,
  // json-string TEXT
  "json-string": ([text = ""]) => `${JSON.stringify(text)}\n`,
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [name, ...rest] = process.argv.slice(2);
  if (!commands[name]) { console.error(`lib.mjs: unknown command ${name ?? ""}`); process.exit(2); }
  process.stdout.write(commands[name](rest));
}
