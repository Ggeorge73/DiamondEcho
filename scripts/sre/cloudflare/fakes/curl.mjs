#!/usr/bin/env node
// A stand-in for `curl`, for the tests of pages-rollback.sh. It plays the
// Cloudflare Pages API from the JSON model in FAKE_STATE, insists on the
// token arriving in a header file (never as an argument), and writes each
// call, arguments as given, to FAKE_LOG so a test can check that the token
// never appeared on a command line.
//
// FAKE_SCENARIO: "bad-token" (403), "rollback-ignored" (accepted, nothing
// changes).
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const scenario = new Set((process.env.FAKE_SCENARIO || "").split(",").filter(Boolean));
if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, `curl ${args.join(" ")}\n`);
let method = "GET", url = "", bodyFile = null, format = "", auth = "";
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "-X") method = args[++i];
  else if (arg === "-o") bodyFile = args[++i];
  else if (arg === "-w") format = args[++i];
  else if (arg === "-H") {
    const value = args[++i];
    if (value.startsWith("@")) auth = readFileSync(value.slice(1), "utf8").trim();
    else if (/^authorization:/i.test(value)) auth = "ON THE COMMAND LINE";
  } else if (arg === "--max-time") i += 1;
  else if (!arg.startsWith("-")) url = arg;
}
const statePath = process.env.FAKE_STATE;
const state = JSON.parse(readFileSync(statePath, "utf8"));
const send = (status, body) => {
  if (bodyFile) writeFileSync(bodyFile, JSON.stringify(body));
  if (format.includes("%{http_code}")) process.stdout.write(String(status));
};
const parsed = new URL(url);
const prefix = `/client/v4/accounts/${state.account}/pages/projects/${state.project}`;
if (parsed.hostname !== "api.cloudflare.com") { process.stderr.write("unexpected host\n"); process.exit(6); }
if (auth !== `Authorization: Bearer ${state.token}` || scenario.has("bad-token")) {
  send(403, { success: false, errors: [{ code: 10000, message: "Authentication error" }], result: null });
} else if (method === "GET" && parsed.pathname === prefix) {
  send(200, { success: true, errors: [], result: { name: state.project, canonical_deployment: state.deployments.find((row) => row.id === state.live) } });
} else if (method === "GET" && parsed.pathname === `${prefix}/deployments` && parsed.searchParams.get("env") === "production") {
  send(200, { success: true, errors: [], result: state.deployments });
} else if (method === "POST" && parsed.pathname.startsWith(`${prefix}/deployments/`) && parsed.pathname.endsWith("/rollback")) {
  const id = parsed.pathname.split("/").at(-2);
  if (!scenario.has("rollback-ignored")) state.live = id;
  state.rollbacks = [...(state.rollbacks || []), id];
  writeFileSync(statePath, JSON.stringify(state));
  send(200, { success: true, errors: [], result: state.deployments.find((row) => row.id === id) });
} else {
  send(404, { success: false, errors: [{ code: 8000007, message: "Not found" }], result: null });
}
