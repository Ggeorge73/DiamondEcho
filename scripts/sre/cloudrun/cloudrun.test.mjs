// status.sh, rollback.sh and deploy.sh, run for real against a fake `gcloud`
// and a fake `curl` (fakes/) in a scratch git checkout. Nothing here touches
// the network or Google Cloud.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const PREV = "diamondecho-api-00028-zin";
const NEW = "diamondecho-api-00031-new";
const SERVICE_URL = "https://diamondecho-api-test.a.run.app";
const FORMULA = "diamond-underwriting-1.8.0";

function template(memory = "1Gi") {
  return {
    metadata: { annotations: { "autoscaling.knative.dev/maxScale": "3", "run.googleapis.com/client-name": "gcloud" } },
    spec: {
      containerConcurrency: 1, timeoutSeconds: 30, serviceAccountName: "runtime@example.iam.gserviceaccount.com",
      containers: [{
        image: "us-east1-docker.pkg.dev/p/cloud-run-source-deploy/api@sha256:old",
        env: [{ name: "INQUIRY_STAFF_QUEUE_ENABLED", value: "true" }],
        ports: [{ containerPort: 8080, name: "http1" }],
        resources: { limits: { cpu: "1", memory } },
      }],
    },
  };
}
const revision = (name, created, ready = true) => ({
  metadata: { name, creationTimestamp: created, annotations: { ...template().metadata.annotations } },
  spec: template().spec,
  status: { conditions: [{ type: "Ready", status: ready ? "True" : "False" }] },
});

function initialState() {
  return {
    project: "diamondecho-prod", region: "us-east1", counter: 28, original: PREV, formula: FORMULA,
    service: {
      metadata: { name: "diamondecho-api", annotations: { "run.googleapis.com/ingress": "all" } },
      spec: { template: template() },
      status: {
        url: SERVICE_URL, latestCreatedRevisionName: PREV, latestReadyRevisionName: PREV,
        traffic: [{ revisionName: PREV, percent: 100, latestRevision: true }],
      },
    },
    revisions: [
      revision("diamondecho-api-00029-bad", "2026-10-27T00:00:00Z", false),
      revision(PREV, "2026-10-26T13:50:00Z"),
      revision("diamondecho-api-00025-sij", "2026-10-26T11:50:00Z"),
    ],
  };
}

function git(cwd, ...args) {
  const result = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

// A scratch checkout holding the scripts and the two backend files deploy.sh
// reads, with origin/main at HEAD, and a bin folder with the two fakes.
function setup({ state = initialState(), onMain = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sre-cloudrun-test-"));
  const repo = join(root, "repo");
  const scripts = join(repo, "scripts", "sre", "cloudrun");
  mkdirSync(scripts, { recursive: true });
  for (const name of ["lib.sh", "lib.mjs", "status.sh", "rollback.sh", "deploy.sh", "cleanup.sh"]) copyFileSync(join(here, name), join(scripts, name));
  mkdirSync(join(repo, "backend", "deal_intelligence"), { recursive: true });
  mkdirSync(join(repo, "backend", "tests", "deal_intelligence"), { recursive: true });
  writeFileSync(join(repo, "backend", "deal_intelligence", "engine.py"), `"""engine"""\nFORMULA_VERSION = "${FORMULA}"\n`);
  copyFileSync(join(repoRoot, "backend", "tests", "deal_intelligence", "candidate_land_equity_first.json"),
    join(repo, "backend", "tests", "deal_intelligence", "candidate_land_equity_first.json"));
  git(root, "init", "-q", "repo");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "first");
  if (onMain) git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
  const commit = git(repo, "rev-parse", "HEAD");

  const bin = join(root, "bin");
  mkdirSync(bin);
  for (const tool of ["gcloud", "curl"]) {
    writeFileSync(join(bin, tool), `#!/bin/sh\nexec "${process.execPath}" "${join(here, "fakes", `${tool}.mjs`)}" "$@"\n`);
    chmodSync(join(bin, tool), 0o755);
  }
  const statePath = join(root, "state.json");
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  const logPath = join(root, "calls.log");
  writeFileSync(logPath, "");

  const env = (scenario = "", extra = {}) => {
    const base = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(GCP_|CLOUD_RUN_|DEPLOY_|GITHUB_|SRE_NOW)/.test(key)));
    return {
      ...base, PATH: `${bin}:${process.env.PATH}`, TMPDIR: root, FAKE_STATE: statePath, FAKE_LOG: logPath, FAKE_SCENARIO: scenario,
      DEPLOY_GATE_SECONDS: "0", DEPLOY_RETRY_SECONDS: "0", ROLLBACK_RETRY_SECONDS: "0", SRE_NOW: "2026-11-13T10:00:00Z", ...extra,
    };
  };
  return {
    root, repo, commit,
    run(script, args = [], scenario = "", extra = {}) {
      const result = spawnSync("bash", [join(scripts, script), ...args], { cwd: repo, env: env(scenario, extra), encoding: "utf8" });
      return { code: result.status, out: result.stdout, err: result.stderr };
    },
    start(script, args = [], scenario = "", extra = {}) {
      return spawn("bash", [join(scripts, script), ...args], { cwd: repo, env: env(scenario, extra) });
    },
    state: () => JSON.parse(readFileSync(statePath, "utf8")),
    calls: () => readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean),
    serving: () => JSON.parse(readFileSync(statePath, "utf8")).service.status.traffic
      .filter((entry) => entry.percent > 0).map((entry) => `${entry.revisionName}=${entry.percent}`).sort(),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

const changes = (calls) => calls.filter((line) => / run deploy | update-traffic /.test(line));

// Signals. The fake gcloud writes MARK lines as traffic calls start, and the
// tests wait for those (or for the traffic itself) before signalling, with a
// generous deadline for slow machines.
// A condition that cannot be judged yet (a file not written, or caught
// mid-write by a fake that is still running) counts as "not yet".
const holds = (condition) => { try { return Boolean(condition()); } catch { return false; } };
async function until(condition, what, ms = 60_000) {
  const deadline = Date.now() + ms;
  while (!holds(condition)) {
    assert.ok(Date.now() < deadline, `timed out waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
function collect(child) {
  const seen = { out: "", err: "" };
  child.stdout.on("data", (chunk) => { seen.out += chunk; });
  child.stderr.on("data", (chunk) => { seen.err += chunk; });
  seen.closed = new Promise((resolve) => child.on("close", resolve));
  return seen;
}


// ---------------------------------------------------------------- status.sh
test("status.sh prints the contract document, revisions newest first", (t) => {
  const box = setup();
  t.after(box.cleanup);
  const { code, out } = box.run("status.sh");
  assert.equal(code, 0);
  const doc = JSON.parse(out);
  assert.deepEqual(doc.serving, [{ revision: PREV, percent: 100 }]);
  assert.deepEqual(doc.tags, []);
  assert.deepEqual(doc.revisions.map((item) => [item.name, item.ready]),
    [["diamondecho-api-00029-bad", false], [PREV, true], ["diamondecho-api-00025-sij", true]]);
  assert.ok(doc.revisions.every((item) => item.image === "us-east1-docker.pkg.dev/p/cloud-run-source-deploy/api@sha256:old"), "each revision names its image");
  assert.match(doc.revisions[0].settings, /^[0-9a-f]{16}$/);
  assert.equal(new Set(doc.revisions.map((item) => item.settings)).size, 1, "same settings, same fingerprint");
  assert.ok(box.calls().every((line) => /describe|list/.test(line)), "status.sh only reads");
});

test("status.sh shows the candidate tag of a deploy in progress, and it is gone afterwards", async (t) => {
  const box = setup();
  t.after(box.cleanup);
  const child = box.start("deploy.sh", ["--apply"], "", { DEPLOY_GATE_SECONDS: "6", DEPLOY_GATE_PROBES: "1" });
  const seen = collect(child);
  await until(() => box.serving().includes(`${NEW}=10`), "the 10 percent step");
  const during = JSON.parse(box.run("status.sh").out);
  assert.deepEqual(during.tags, [{ tag: "candidate", revision: NEW }]);
  // On a slow machine the 50 percent step may already have begun.
  const split = during.serving.map((item) => `${item.revision}=${item.percent}`).sort().join(" ");
  assert.ok([`${PREV}=90 ${NEW}=10`, `${PREV}=50 ${NEW}=50`].includes(split), split);
  assert.equal(await seen.closed, 0, seen.err);
  assert.deepEqual(JSON.parse(box.run("status.sh").out).tags, []);
});

test("status.sh asks the named project and region, and refuses a bad name", (t) => {
  const box = setup();
  t.after(box.cleanup);
  assert.equal(box.run("status.sh", [], "", { GCP_PROJECT_ID: "other-project" }).code, 2, "the fake knows only diamondecho-prod");
  const bad = box.run("status.sh", [], "", { CLOUD_RUN_SERVICE: "api; rm -rf /" });
  assert.equal(bad.code, 2);
  assert.match(bad.err, /not a service name/);
});

// -------------------------------------------------------------- rollback.sh
test("rollback.sh without --apply prints the exact command and changes nothing", (t) => {
  const box = setup();
  t.after(box.cleanup);
  const { code, out, err } = box.run("rollback.sh", ["--to", "diamondecho-api-00025-sij"]);
  assert.equal(code, 0);
  assert.match(err, /gcloud run services update-traffic diamondecho-api --to-revisions=diamondecho-api-00025-sij=100 --project diamondecho-prod --region us-east1/);
  const result = JSON.parse(out.trim().split("\n").pop());
  assert.equal(result.applied, false);
  assert.deepEqual(result.from, [{ revision: PREV, percent: 100 }]);
  assert.deepEqual(changes(box.calls()), []);
  assert.deepEqual(box.serving(), [`${PREV}=100`]);
});

test("rollback.sh --apply moves all traffic, reads it back and checks /health", (t) => {
  const box = setup();
  t.after(box.cleanup);
  const { code, out } = box.run("rollback.sh", ["--to", "diamondecho-api-00025-sij", "--apply"]);
  assert.equal(code, 0);
  const result = JSON.parse(out.trim().split("\n").pop());
  assert.equal(result.applied, true);
  assert.equal(result.verified, true);
  assert.deepEqual(box.serving(), ["diamondecho-api-00025-sij=100"]);
});

test("rollback.sh refuses an unknown or not-ready revision, and a bad name", (t) => {
  const box = setup();
  t.after(box.cleanup);
  for (const [name, why] of [["diamondecho-api-00099-zzz", /not a revision of/], ["diamondecho-api-00029-bad", /not ready/], ["Bad Name", /Not a revision name/]]) {
    const { code, err } = box.run("rollback.sh", ["--to", name, "--apply"]);
    assert.equal(code, 2, name);
    assert.match(err, why);
  }
  assert.deepEqual(changes(box.calls()), []);
});

test("rollback.sh does nothing when the revision already has all the traffic", (t) => {
  const box = setup();
  t.after(box.cleanup);
  const { code, out } = box.run("rollback.sh", ["--to", PREV, "--apply"]);
  assert.equal(code, 0);
  assert.equal(JSON.parse(out.trim().split("\n").pop()).applied, false);
  assert.deepEqual(changes(box.calls()), []);
});

// --------------------------------------------------------------- cleanup.sh
// A deploy killed at 10 percent: traffic split, candidate tag left behind.
function killedMidway() {
  const state = initialState();
  state.revisions.unshift({ ...revision(NEW, "2026-11-13T10:00:00Z"), spec: { ...template().spec } });
  state.service.status.latestCreatedRevisionName = NEW;
  state.service.status.traffic = [
    { revisionName: NEW, percent: 10 }, { revisionName: PREV, percent: 90 },
    { revisionName: NEW, percent: 0, tag: "candidate", url: "https://candidate---diamondecho-api-test.a.run.app" },
  ];
  return state;
}

test("cleanup.sh finishes the rollback of a killed deploy and removes the tag", (t) => {
  const box = setup({ state: killedMidway() });
  t.after(box.cleanup);
  const file = join(box.root, "deploy-state");
  writeFileSync(file, `prev=${PREV}\nnew=${NEW}\n`);
  const dry = box.run("cleanup.sh", ["--state", file]);
  assert.equal(dry.code, 0, dry.err);
  assert.deepEqual(changes(box.calls()), [], "the dry run changes nothing");
  const applied = box.run("cleanup.sh", ["--state", file, "--apply"]);
  assert.equal(applied.code, 0, applied.err);
  assert.deepEqual(box.serving(), [`${PREV}=100`]);
  assert.ok(box.state().service.status.traffic.every((entry) => !entry.tag));
  // Run again: nothing left to do.
  const before = changes(box.calls()).length;
  assert.equal(box.run("cleanup.sh", ["--state", file, "--apply"]).code, 0);
  assert.equal(changes(box.calls()).length, before);
});

test("cleanup.sh never undoes a finished deploy, and does nothing without a state file", (t) => {
  const box = setup({ state: killedMidway() });
  t.after(box.cleanup);
  const file = join(box.root, "deploy-state");
  writeFileSync(file, `prev=${PREV}\nnew=${NEW}\ndone=1\n`);
  assert.equal(box.run("cleanup.sh", ["--state", file, "--apply"]).code, 0);
  assert.equal(box.run("cleanup.sh", ["--state", join(box.root, "missing"), "--apply"]).code, 0);
  assert.deepEqual(box.calls(), [], "not even a read");
  writeFileSync(file, "prev=Not A Revision\n");
  assert.equal(box.run("cleanup.sh", ["--state", file, "--apply"]).code, 2);
});

// ---------------------------------------------------------------- deploy.sh
test("deploy.sh dry run reads, prints every command, and changes nothing", (t) => {
  const box = setup();
  t.after(box.cleanup);
  const before = box.state();
  const { code, err } = box.run("deploy.sh");
  assert.equal(code, 0, err);
  assert.match(err, new RegExp(`gcloud run deploy diamondecho-api --source ${box.repo}/backend --project diamondecho-prod --region us-east1 --no-traffic --tag candidate --update-env-vars APP_COMMIT=${box.commit} --quiet`));
  assert.match(err, new RegExp(`--to-revisions=NEW_REVISION=10,${PREV}=90`));
  assert.match(err, new RegExp(`--to-revisions=NEW_REVISION=50,${PREV}=50`));
  assert.match(err, /update-traffic diamondecho-api --to-latest/);
  assert.match(err, /--remove-tags candidate/);
  assert.match(err, /Dry run: nothing was changed/);
  assert.deepEqual(changes(box.calls()), []);
  assert.ok(!box.calls().some((line) => line.startsWith("curl")), "a dry run sends no request");
  assert.deepEqual(box.state(), before);
});

test("deploy.sh --apply: candidate checks, 10, 50, 100 percent, tag removed, record printed", (t) => {
  const box = setup();
  t.after(box.cleanup);
  const { code, out, err } = box.run("deploy.sh", ["--apply", "--commit", box.commit.slice(0, 7)]);
  assert.equal(code, 0, err);
  assert.deepEqual(changes(box.calls()).map((line) => line.replace(/ --project.*| --source \S+/g, "")), [
    `gcloud run deploy diamondecho-api`,
    `gcloud run services update-traffic diamondecho-api --to-revisions=${NEW}=10,${PREV}=90`,
    `gcloud run services update-traffic diamondecho-api --to-revisions=${NEW}=50,${PREV}=50`,
    "gcloud run services update-traffic diamondecho-api --to-latest",
    "gcloud run services update-traffic diamondecho-api --remove-tags candidate",
  ]);
  const deployCall = box.calls().find((line) => line.includes(" run deploy "));
  assert.match(deployCall, new RegExp(`--no-traffic --tag candidate --update-env-vars APP_COMMIT=${box.commit} --quiet$`), "no other setting is passed");
  const state = box.state();
  assert.deepEqual(box.serving(), [`${NEW}=100`]);
  assert.ok(state.service.status.traffic.every((entry) => !entry.tag), "the candidate tag is gone");
  // The checks went to the candidate address; the reference request was sent there once; no inquiry.
  const curls = box.calls().filter((line) => line.startsWith("curl"));
  assert.ok(curls.some((line) => line === `curl POST https://candidate---diamondecho-api-test.a.run.app/api/v1/deals/analyze @${box.repo}/backend/tests/deal_intelligence/candidate_land_equity_first.json`));
  assert.equal(curls.filter((line) => line.startsWith("curl POST")).length, 1);
  assert.ok(!curls.some((line) => /POST .*inquiries/.test(line)));
  // The record for docs/de13-production-setup.md.
  assert.match(out, new RegExp(`^### API redeploy from \`${box.commit.slice(0, 7)}\` \\(2026-11-13, 10:00:00 to 10:00:00 UTC, deploy.sh\\)`));
  assert.match(out, new RegExp(`Before: \`${PREV}\` served 100 percent`));
  assert.match(out, /formula `diamond-underwriting-1.8.0`, residual land value 221050.14, development profit -2406352.18/);
  assert.match(out, /Settings: .* identical apart from the image and APP_COMMIT/);
  assert.match(out, /Traffic: 10 percent at .*, 50 percent at .*, 100 percent at .*passed/);
  assert.match(out, new RegExp(`Result: \`${NEW}\` .* serves all traffic. Fallback: \`${PREV}\``));
});

test("deploy.sh refuses a failed candidate check before any traffic moves", (t) => {
  const box = setup();
  t.after(box.cleanup);
  const { code, out, err } = box.run("deploy.sh", ["--apply"], "candidate-fails");
  assert.equal(code, 1, err);
  assert.match(err, /candidate \/health answered 500/);
  assert.ok(!changes(box.calls()).some((line) => line.includes(`--to-revisions=${NEW}`) || line.includes("--to-latest")));
  assert.deepEqual(box.serving(), [`${PREV}=100`]);
  assert.ok(box.state().service.status.traffic.every((entry) => !entry.tag), "the tag is removed");
  assert.match(out, /Result: refused before any traffic moved/);
  // The --no-traffic deploy pinned the old revision, and the template holds the refused image.
  assert.match(out, /do NOT run `update-traffic --to-latest`/);
  assert.match(out, /gcloud run services update diamondecho-api --image us-east1-docker.pkg.dev\/p\/cloud-run-source-deploy\/api@sha256:old --update-env-vars NAME=VALUE --remove-env-vars APP_COMMIT/);
});

test("deploy.sh refuses a candidate that names the wrong commit, leaves the route list on, or answers an old formula", (t) => {
  for (const [scenario, why] of [["wrong-commit", /names revision .* and commit 1111111/], ["docs-on", /\/docs answered 200/], ["old-formula", /formula diamond-underwriting-0.9.0, not diamond-underwriting-1.8.0/]]) {
    const box = setup();
    t.after(box.cleanup);
    const { code, err } = box.run("deploy.sh", ["--apply"], scenario);
    assert.equal(code, 1, scenario);
    assert.match(err, why);
    assert.deepEqual(box.serving(), [`${PREV}=100`], scenario);
  }
});

test("deploy.sh rolls back to the serving revision when the 50 percent gate fails", (t) => {
  const box = setup();
  t.after(box.cleanup);
  const { code, out, err } = box.run("deploy.sh", ["--apply"], "fail-at-50");
  assert.equal(code, 1, err);
  assert.match(err, /step gate failed: \/health answered 503 at 50 percent/);
  const moves = changes(box.calls()).filter((line) => line.includes("--to-"));
  assert.deepEqual(moves.map((line) => line.match(/--to-\S+/)[0]), [
    `--to-revisions=${NEW}=10,${PREV}=90`, `--to-revisions=${NEW}=50,${PREV}=50`, `--to-revisions=${PREV}=100`,
  ]);
  assert.deepEqual(box.serving(), [`${PREV}=100`]);
  assert.match(out, new RegExp(`Rolled back at .*: all traffic to \`${PREV}\`, which answers /health`));
  assert.match(out, /Result: rolled back: `diamondecho-api-00028-zin` serves/);
  assert.match(out, /pinned to `diamondecho-api-00028-zin`.*--image us-east1-docker.pkg.dev\/p\/cloud-run-source-deploy\/api@sha256:old/);
  assert.ok(box.state().service.status.traffic.every((entry) => !entry.tag), "the tag is removed");
});

test("deploy.sh exits 3 and points to api-down.md when the old revision is unhealthy after the rollback", (t) => {
  const box = setup();
  t.after(box.cleanup);
  const { code, out, err } = box.run("deploy.sh", ["--apply"], "fail-at-50,old-fails");
  assert.equal(code, 3, err);
  assert.deepEqual(box.serving(), [`${PREV}=100`], "the traffic did move back");
  assert.match(out, /ROLLED BACK BUT UNHEALTHY .*api-down\.md/);
  assert.match(err, /ACT NOW: the traffic is on diamondecho-api-00028-zin but it does not answer \/health/);
});

test("deploy.sh notes its progress in DEPLOY_STATE_FILE for the workflow's cleanup step", (t) => {
  const ok = setup();
  t.after(ok.cleanup);
  const okFile = join(ok.root, "deploy-state");
  assert.equal(ok.run("deploy.sh", ["--apply"], "", { DEPLOY_STATE_FILE: okFile }).code, 0);
  assert.equal(readFileSync(okFile, "utf8"), `prev=${PREV}\nnew=${NEW}\ndone=1\n`);
  const bad = setup();
  t.after(bad.cleanup);
  const badFile = join(bad.root, "deploy-state");
  assert.equal(bad.run("deploy.sh", ["--apply"], "fail-at-50", { DEPLOY_STATE_FILE: badFile }).code, 1);
  assert.equal(readFileSync(badFile, "utf8"), `prev=${PREV}\nnew=${NEW}\n`, "no done= after a rollback");
});

test("deploy.sh reads the logs: a 500 during the candidate checks refuses, one at 10 percent rolls back", (t) => {
  const early = setup();
  t.after(early.cleanup);
  let result = early.run("deploy.sh", ["--apply"], "logs-5xx");
  assert.equal(result.code, 1);
  assert.match(result.err, new RegExp(`${NEW} logged 1 answers of 500 or more during its checks`));
  assert.ok(!changes(early.calls()).some((line) => line.includes(`--to-revisions=${NEW}`)));

  const live = setup();
  t.after(live.cleanup);
  result = live.run("deploy.sh", ["--apply"], "logs-5xx-live");
  assert.equal(result.code, 1);
  assert.match(result.err, /step gate failed: .* logged 1 answers of 500 or more at 10 percent/);
  assert.ok(!changes(live.calls()).some((line) => line.includes(`--to-revisions=${NEW}=50`)), "no step after a failed one");
  assert.deepEqual(live.serving(), [`${PREV}=100`]);
});

test("deploy.sh stops on any settings change other than the image and APP_COMMIT", (t) => {
  const box = setup();
  t.after(box.cleanup);
  const { code, err } = box.run("deploy.sh", ["--apply"], "drift");
  assert.equal(code, 1);
  assert.match(err, /settings differ .*spec\.containers\[0\]\.resources\.limits\.memory changed/);
  assert.doesNotMatch(err, /2Gi/, "values are never printed");
  assert.ok(!box.calls().some((line) => line.startsWith("curl")), "no candidate check after drift");
  assert.deepEqual(box.serving(), [`${PREV}=100`]);
});

test("deploy.sh stops before building when it cannot read the logs it gates on", (t) => {
  const box = setup();
  t.after(box.cleanup);
  const { code, err } = box.run("deploy.sh", ["--apply"], "no-logs");
  assert.equal(code, 2);
  assert.match(err, /Cannot read the logs of diamondecho-api-00028-zin.*Nothing was changed/);
  assert.deepEqual(changes(box.calls()), [], "nothing was built");
  assert.equal(box.run("deploy.sh", [], "no-logs").code, 2, "the dry run finds it too");
  const off = setup();
  t.after(off.cleanup);
  assert.equal(off.run("deploy.sh", ["--apply"], "no-logs", { DEPLOY_LOG_GATE: "off" }).code, 0, "the log gate can be switched off");
});

test("deploy.sh changes nothing from a dirty checkout, the wrong commit, or a commit not on main", (t) => {
  const dirty = setup();
  t.after(dirty.cleanup);
  writeFileSync(join(dirty.repo, "backend", "deal_intelligence", "engine.py"), 'FORMULA_VERSION = "x"\n# edited\n');
  let result = dirty.run("deploy.sh", ["--apply"]);
  assert.equal(result.code, 2);
  assert.match(result.err, /uncommitted or untracked/);
  assert.deepEqual(changes(dirty.calls()), []);

  const stray = setup();
  t.after(stray.cleanup);
  writeFileSync(join(stray.repo, ".git", "info", "exclude"), "*.env\n");
  writeFileSync(join(stray.repo, "backend", "local.env"), "NOT_A_REAL_SETTING=1\n");
  result = stray.run("deploy.sh", ["--apply"]);
  assert.equal(result.code, 2);
  assert.match(result.err, /backend\/ holds files git ignores/);

  const wrong = setup();
  t.after(wrong.cleanup);
  result = wrong.run("deploy.sh", ["--apply", "--commit", "abcdef1"]);
  assert.equal(result.code, 2);
  assert.match(result.err, /not abcdef1/);

  const offMain = setup({ onMain: false });
  t.after(offMain.cleanup);
  result = offMain.run("deploy.sh", ["--apply"]);
  assert.equal(result.code, 2);
  assert.match(result.err, /No origin\/main/);
  for (const box of [wrong, offMain]) assert.deepEqual(changes(box.calls()), []);
});

test("deploy.sh will not start while traffic is split, and reports a failed build", (t) => {
  const state = initialState();
  state.service.status.traffic = [{ revisionName: PREV, percent: 90 }, { revisionName: "diamondecho-api-00025-sij", percent: 10 }];
  const split = setup({ state });
  t.after(split.cleanup);
  let result = split.run("deploy.sh", ["--apply"]);
  assert.equal(result.code, 2);
  assert.match(result.err, /traffic is split/);
  assert.deepEqual(changes(split.calls()), []);

  const broken = setup();
  t.after(broken.cleanup);
  result = broken.run("deploy.sh", ["--apply"], "deploy-fails");
  assert.equal(result.code, 2);
  assert.match(result.err, /deploy command failed. No traffic was moved/);
  assert.deepEqual(broken.serving(), [`${PREV}=100`]);
});

test("deploy.sh refuses bad step settings", (t) => {
  const box = setup();
  t.after(box.cleanup);
  for (const steps of ["50 10 100", "10 50", "0 100", "10;rm 100"]) {
    const { code, err } = box.run("deploy.sh", [], "", { DEPLOY_STEPS: steps });
    assert.equal(code, 2, steps);
    assert.match(err, /DEPLOY_STEPS/);
  }
});

test("deploy.sh rolls back when it is interrupted during a gate", async (t) => {
  const box = setup();
  t.after(box.cleanup);
  const child = box.start("deploy.sh", ["--apply"], "", { DEPLOY_GATE_SECONDS: "3", DEPLOY_GATE_PROBES: "1" });
  const seen = collect(child);
  await until(() => box.serving().includes(`${NEW}=10`), "the 10 percent step");
  child.kill("SIGTERM");
  assert.equal(await seen.closed, 1, seen.err);
  assert.deepEqual(box.serving(), [`${PREV}=100`]);
  assert.match(seen.out, /Refused: the deploy was interrupted/);
  assert.match(seen.out, /Result: rolled back/);
  assert.ok(box.state().service.status.traffic.every((entry) => !entry.tag));
});

test("deploy.sh interrupted during a traffic command still rolls back and prints its record on standard output", async (t) => {
  // The trap then runs inside `change … >&2`; the record must not follow it there.
  const box = setup();
  t.after(box.cleanup);
  const child = box.start("deploy.sh", ["--apply"], "slow-traffic", { DEPLOY_GATE_SECONDS: "0", DEPLOY_GATE_PROBES: "1" });
  const seen = collect(child);
  await until(() => box.calls().includes("MARK traffic-step"), "the first traffic command");
  child.kill("SIGTERM");
  assert.equal(await seen.closed, 1, seen.err);
  assert.deepEqual(box.serving(), [`${PREV}=100`]);
  assert.match(seen.out, /^### API redeploy from/);
  assert.match(seen.out, /Refused: the deploy was interrupted/);
});

test("deploy.sh: a second Ctrl-C does not stop the rollback", async (t) => {
  const box = setup();
  t.after(box.cleanup);
  // detached: a group of its own, so the signals reach every process in it,
  // as Ctrl-C in a terminal does.
  const child = spawn("bash", [join(box.repo, "scripts", "sre", "cloudrun", "deploy.sh"), "--apply"], {
    cwd: box.repo, detached: true,
    env: { ...process.env, PATH: `${join(box.root, "bin")}:${process.env.PATH}`, TMPDIR: box.root, FAKE_STATE: join(box.root, "state.json"),
      FAKE_LOG: join(box.root, "calls.log"), FAKE_SCENARIO: "slow-rollback", DEPLOY_GATE_SECONDS: "30", DEPLOY_GATE_PROBES: "1",
      DEPLOY_RETRY_SECONDS: "0", ROLLBACK_RETRY_SECONDS: "0", SRE_NOW: "2026-11-13T10:00:00Z" },
  });
  const seen = collect(child);
  await until(() => box.serving().includes(`${NEW}=10`), "the 10 percent step");
  process.kill(-child.pid, "SIGINT");
  await until(() => box.calls().includes("MARK rollback"), "the rollback command");
  process.kill(-child.pid, "SIGINT"); // impatient second Ctrl-C, mid-rollback
  assert.equal(await seen.closed, 1, seen.err);
  assert.deepEqual(box.serving(), [`${PREV}=100`]);
  assert.ok(box.state().service.status.traffic.every((entry) => !entry.tag), "the tag is removed");
  assert.match(seen.out, /Rolled back at .*: all traffic to `diamondecho-api-00028-zin`/);
});
