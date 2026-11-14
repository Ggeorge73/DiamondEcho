// The published folder carries version.json, the site's build identity
// (scripts/sre reads it to tell when a merge is live). Runs the real script in
// a scratch folder; nothing here touches the network or the real build.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const script = resolve(dirname(fileURLToPath(import.meta.url)), "copy-build.mjs");

function copyBuild(settings, { withBuild = true } = {}) {
  const work = mkdtempSync(join(tmpdir(), "copy-build-test-"));
  try {
    if (withBuild) {
      mkdirSync(join(work, "frontend", "build", "assets"), { recursive: true });
      writeFileSync(join(work, "frontend", "build", "index.html"), "<html>home</html>");
      writeFileSync(join(work, "frontend", "build", "assets", "index-abc.js"), "console.log(1)");
      // A stale file from an earlier build must not survive.
      mkdirSync(join(work, "build"));
      writeFileSync(join(work, "build", "stale.html"), "old");
    }
    const env = { PATH: process.env.PATH, ...settings };
    const result = spawnSync(process.execPath, [script], { cwd: work, env, encoding: "utf8" });
    const file = join(work, "build", "version.json");
    return {
      status: result.status,
      version: existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null,
      files: ["index.html", "assets/index-abc.js", "stale.html"].filter((name) => existsSync(join(work, "build", name))),
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const SHA = "59f8d46b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f";
const OTHER = "0123456789abcdef0123456789abcdef01234567";

test("the published folder is a fresh copy of the frontend build plus version.json", () => {
  const { status, version, files } = copyBuild({ CF_PAGES_COMMIT_SHA: SHA });
  assert.equal(status, 0);
  assert.deepEqual(files, ["index.html", "assets/index-abc.js"]);
  assert.deepEqual(Object.keys(version), ["commit", "built_at"]);
  assert.equal(version.commit, SHA);
  assert.ok(Math.abs(Date.now() - Date.parse(version.built_at)) < 60_000, "built_at is the time of this build");
});

test("the commit comes from Cloudflare Pages first, then GitHub Actions, else unknown", () => {
  assert.equal(copyBuild({ CF_PAGES_COMMIT_SHA: SHA, GITHUB_SHA: OTHER }).version.commit, SHA);
  assert.equal(copyBuild({ GITHUB_SHA: OTHER.toUpperCase() }).version.commit, OTHER);
  assert.equal(copyBuild({}).version.commit, "unknown");
});

test("a value that is not a commit is never published", () => {
  assert.equal(copyBuild({ CF_PAGES_COMMIT_SHA: "main; rm -rf", GITHUB_SHA: "<script>" }).version.commit, "unknown");
  assert.equal(copyBuild({ CF_PAGES_COMMIT_SHA: "", GITHUB_SHA: OTHER }).version.commit, OTHER);
});

test("without a frontend build the script fails and publishes nothing", () => {
  const { status, version } = copyBuild({ CF_PAGES_COMMIT_SHA: SHA }, { withBuild: false });
  assert.notEqual(status, 0);
  assert.equal(version, null);
});

test("built_at follows SRE_NOW when it is set, as every SRE clock does", () => {
  assert.equal(copyBuild({ CF_PAGES_COMMIT_SHA: SHA, SRE_NOW: "2026-11-13T10:00:00Z" }).version.built_at, "2026-11-13T10:00:00.000Z");
  const { version } = copyBuild({ CF_PAGES_COMMIT_SHA: SHA, SRE_NOW: "not a time" });
  assert.ok(Math.abs(Date.now() - Date.parse(version.built_at)) < 60_000, "a bad SRE_NOW falls back to the clock");
});
