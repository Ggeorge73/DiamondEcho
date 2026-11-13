// pages-rollback.sh against a fake `curl` that plays the Cloudflare Pages
// API (fakes/curl.mjs), and the choosing logic in lib.mjs. No network.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rollbackChoice } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ACCOUNT = "0123456789abcdef0123456789abcdef";
const TOKEN = "fake-token-for-tests-only";
const id = (n) => `0000000${n}-aaaa-bbbb-cccc-dddddddddddd`;
const deployment = (n, commit, created, status = "success") => ({
  id: id(n), environment: "production", created_on: created,
  latest_stage: { name: "deploy", status }, deployment_trigger: { type: "github:push", metadata: { branch: "main", commit_hash: commit } },
});
const BAD = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const GOOD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OLDER = "cccccccccccccccccccccccccccccccccccccccc";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "sre-pages-test-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "curl"), `#!/bin/sh\nexec "${process.execPath}" "${join(here, "fakes", "curl.mjs")}" "$@"\n`);
  chmodSync(join(bin, "curl"), 0o755);
  const statePath = join(root, "state.json");
  writeFileSync(statePath, JSON.stringify({
    account: ACCOUNT, project: "diamondecho", token: TOKEN, live: id(4),
    deployments: [
      deployment(4, BAD, "2026-11-13T10:00:00Z"),
      deployment(3, BAD, "2026-11-13T09:58:00Z"),          // a retry of the same bad commit
      deployment(2, GOOD, "2026-11-12T10:00:00Z", "failure"), // a failed build
      deployment(1, GOOD, "2026-11-12T09:00:00Z"),
      deployment(0, OLDER, "2026-11-11T09:00:00Z"),
    ],
  }));
  const logPath = join(root, "calls.log");
  writeFileSync(logPath, "");
  return {
    run(args = [], extra = {}, scenario = "") {
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(CLOUDFLARE_|PAGES_PROJECT)/.test(key)));
      const result = spawnSync("bash", [join(here, "pages-rollback.sh"), ...args], {
        env: { ...env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: root, FAKE_STATE: statePath, FAKE_LOG: logPath, FAKE_SCENARIO: scenario,
          CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT, ...extra },
        encoding: "utf8",
      });
      return { code: result.status, out: result.stdout, err: result.stderr, last: () => JSON.parse(result.stdout.trim().split("\n").pop()) };
    },
    state: () => JSON.parse(readFileSync(statePath, "utf8")),
    log: () => readFileSync(logPath, "utf8"),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("without --apply it names the build it would put back and changes nothing", (t) => {
  const box = setup();
  t.after(box.cleanup);
  const result = box.run();
  assert.equal(result.code, 0, result.err);
  assert.deepEqual(result.last(), {
    action: "pages-rollback", applied: false, project: "diamondecho",
    from: { id: id(4), commit: BAD }, to: { id: id(1), commit: GOOD }, verified: null,
  });
  assert.match(result.err, /Dry run: nothing was changed/);
  assert.equal(box.state().rollbacks, undefined);
  assert.doesNotMatch(box.log(), / POST /);
});

test("--apply rolls back, reads it back, and never shows the token", (t) => {
  const box = setup();
  t.after(box.cleanup);
  const result = box.run(["--apply", "--expect-live-commit", BAD.slice(0, 7)]);
  assert.equal(result.code, 0, result.err);
  assert.equal(result.last().verified, true);
  assert.equal(box.state().live, id(1));
  assert.deepEqual(box.state().rollbacks, [id(1)]);
  for (const text of [result.out, result.err, box.log()]) assert.ok(!text.includes(TOKEN), "the token stays out of output and argv");
});

test("it refuses when the live build is not the one expected", (t) => {
  const box = setup();
  t.after(box.cleanup);
  const result = box.run(["--apply", "--expect-live-commit", GOOD]);
  assert.equal(result.code, 2);
  assert.match(result.err, /live build is from b{40}, not a{40}/);
  assert.equal(box.state().rollbacks, undefined);
});

test("--to names a build; a failed or unknown build is refused", (t) => {
  const box = setup();
  t.after(box.cleanup);
  assert.equal(box.run(["--apply", "--to", id(0)]).code, 0);
  assert.equal(box.state().live, id(0));
  for (const wanted of [id(2), id(9)]) {
    const result = box.run(["--apply", "--to", wanted]);
    assert.equal(result.code, 2, wanted);
    assert.match(result.err, /No earlier successful production build/);
  }
  assert.equal(box.run(["--to", "not-an-id"]).code, 2);
});

test("without the two settings it stops and calls nothing", (t) => {
  const box = setup();
  t.after(box.cleanup);
  for (const missing of [{ CLOUDFLARE_API_TOKEN: "" }, { CLOUDFLARE_ACCOUNT_ID: "" }]) {
    const result = box.run(["--apply"], missing);
    assert.equal(result.code, 2);
    assert.match(result.err, /Not set up/);
  }
  assert.equal(box.log(), "");
});

test("a refused token or an ignored rollback is reported, not hidden", (t) => {
  const box = setup();
  t.after(box.cleanup);
  let result = box.run(["--apply"], {}, "bad-token");
  assert.equal(result.code, 2);
  assert.match(result.err, /Cloudflare refused to read the project diamondecho \(HTTP 403\): 10000 Authentication error/);
  result = box.run(["--apply"], {}, "rollback-ignored");
  assert.equal(result.code, 1);
  assert.equal(result.last().verified, false);
});

test("rollbackChoice skips previews, failed builds and retries of the live commit", () => {
  const live = { id: id(4), commit: BAD, created: "2026-11-13T10:00:00Z" };
  const list = { result: [
    { ...deployment(5, GOOD, "2026-11-13T11:00:00Z") },            // newer than live: never
    deployment(4, BAD, "2026-11-13T10:00:00Z"),
    { ...deployment(3, GOOD, "2026-11-13T09:00:00Z"), environment: "preview" },
    deployment(2, BAD, "2026-11-13T08:00:00Z"),
    deployment(1, OLDER, "2026-11-12T08:00:00Z"),
  ] };
  assert.deepEqual(rollbackChoice(list, live), { id: id(1), commit: OLDER, created: "2026-11-12T08:00:00Z" });
  assert.equal(rollbackChoice({ result: [deployment(4, BAD, "2026-11-13T10:00:00Z")] }, live), null);
  assert.equal(rollbackChoice(list, live, id(4)), null, "not the live build itself");
});
