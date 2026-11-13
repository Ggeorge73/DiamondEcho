#!/usr/bin/env node
// A stand-in for `curl`, for the tests of rollback.sh and deploy.sh. It reads
// the fake Cloud Run model (FAKE_STATE, written by fakes/gcloud.mjs) to decide
// which revision answers: the tagged address always reaches its revision, the
// service address the revision with the largest share. It understands only
// the options lib.sh's probe() passes. Every call goes to FAKE_LOG.
//
// FAKE_SCENARIO (comma-separated) makes the newest revision misbehave:
//   candidate-fails   /health answers 500
//   fail-at-50        /health answers 503 while it has 50 percent
//   wrong-commit      /api/ names another commit
//   docs-on           /docs answers 200
//   old-formula       the analysis answers an older formula
//   old-fails         the original revision's /health answers 500 (an
//                     unhealthy rollback target)
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const scenario = new Set((process.env.FAKE_SCENARIO || "").split(",").filter(Boolean));
let method = "GET", url = "", bodyFile = null, headerFile = null, format = "", data = null;
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "-X") method = args[++i];
  else if (arg === "-o") bodyFile = args[++i];
  else if (arg === "-D") headerFile = args[++i];
  else if (arg === "-w") format = args[++i];
  else if (arg === "--data-binary" || arg === "-d") data = args[++i];
  else if (["-A", "--max-time", "-H"].includes(arg)) i += 1;
  else if (arg.startsWith("-")) continue;
  else url = arg;
}
if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, `curl ${method} ${url}${data ? ` ${data}` : ""}\n`);

const state = JSON.parse(readFileSync(process.env.FAKE_STATE, "utf8"));
const traffic = state.service.status.traffic;
const { pathname, hostname } = new URL(url);
let revisionName;
if (hostname.startsWith("candidate---")) {
  revisionName = traffic.find((entry) => entry.tag === "candidate")?.revisionName;
} else {
  revisionName = [...traffic].filter((entry) => entry.percent > 0).sort((a, b) => b.percent - a.percent)[0]?.revisionName;
}
const isNew = revisionName && revisionName === state.service.status.latestCreatedRevisionName && revisionName !== state.original;
const share = traffic.filter((entry) => entry.revisionName === revisionName).reduce((sum, entry) => sum + (entry.percent || 0), 0);
const revision = state.revisions.find((item) => item.metadata.name === revisionName);
const commit = revision?.spec.containers[0].env.find((item) => item.name === "APP_COMMIT")?.value ?? null;

let status = 404, body = { detail: "Not Found" };
if (!revision) {
  status = 503; body = "no revision";
} else if (pathname === "/health") {
  status = 200; body = { status: "ok" };
  if (isNew && scenario.has("candidate-fails")) { status = 500; body = "error"; }
  if (isNew && scenario.has("fail-at-50") && share === 50) { status = 503; body = "error"; }
  if (revisionName === state.original && scenario.has("old-fails")) { status = 500; body = "error"; }
} else if (pathname === "/api/" && method === "GET") {
  status = 200;
  body = { service: "DiamondEcho API", revision: revisionName, commit: isNew && scenario.has("wrong-commit") ? "1111111" : commit };
} else if (pathname === "/api/v1/inquiries/staff") {
  status = 401; body = { detail: "Sign in" };
} else if ((pathname === "/docs" || pathname === "/openapi.json") && isNew && scenario.has("docs-on")) {
  status = 200; body = "docs";
} else if (pathname === "/api/v1/deals/analyze" && method === "POST") {
  status = 200;
  body = {
    formula_version: isNew && scenario.has("old-formula") ? "diamond-underwriting-0.9.0" : state.formula,
    metrics: {
      residual_land_value: { value: 221050.14 }, development_profit: { value: -2406352.18 },
      development_margin: { value: -0.5347 }, irr: { value: -0.2891 },
    },
  };
} else if (pathname.startsWith("/api/v1/inquiries") && method === "POST") {
  // A deploy must never send an inquiry. Fail the test loudly.
  process.stderr.write("FAKE CURL: an inquiry was posted\n");
  process.exit(99);
}
if (bodyFile) writeFileSync(bodyFile, typeof body === "string" ? body : JSON.stringify(body));
if (headerFile) writeFileSync(headerFile, `HTTP/2 ${status}\r\ncontent-type: application/json\r\n\r\n`);
if (format.includes("%{http_code}")) process.stdout.write(String(status));
