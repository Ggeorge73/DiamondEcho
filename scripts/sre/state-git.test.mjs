// state-git.sh against a temporary local bare repository: no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, appendFile, mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "state-git.sh");
const GIT_ENV = {
  GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.invalid",
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
};

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "sre-state-git-"));
  const origin = path.join(root, "origin.git");
  const repo = path.join(root, "repo");
  const env = { ...process.env, ...GIT_ENV, SRE_STATE_RETRY_SLEEP: "0", GITHUB_TOKEN: "" };
  await exec("git", ["init", "-q", "--bare", "-b", "main", origin], { env });
  await exec("git", ["init", "-q", "-b", "main", repo], { env });
  await writeFile(path.join(repo, "README.md"), "main\n");
  await exec("git", ["-C", repo, "add", "."], { env });
  await exec("git", ["-C", repo, "commit", "-q", "-m", "main"], { env });
  await exec("git", ["-C", repo, "remote", "add", "origin", origin], { env });
  await exec("git", ["-C", repo, "push", "-q", "origin", "main"], { env });
  const sh = (args, extra = {}) => exec("bash", [SCRIPT, ...args], { cwd: repo, env: { ...env, ...extra } });
  const git = (...args) => exec("git", args, { env }).then((out) => out.stdout.trim());
  const mainBefore = await git("--git-dir", origin, "rev-parse", "main");
  return { root, origin, repo, sh, git, mainBefore, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("first run creates the orphan branch; main is never touched; commits are the bot's", async () => {
  const t = await setup();
  try {
    const dir = path.join(t.root, "state");
    const out = await t.sh(["checkout", dir]);
    assert.match(out.stdout, /does not exist yet/);
    assert.ok((await stat(path.join(dir, ".git"))).isDirectory(), "a real .git folder (the workflow tests -d)");
    await writeFile(path.join(dir, "status.json"), "{}\n");
    await t.sh(["commit", dir, "fast checks, run 1"]);
    assert.equal(await t.git("--git-dir", t.origin, "rev-parse", "main"), t.mainBefore);
    assert.equal(await t.git("--git-dir", t.origin, "log", "-1", "--format=%an <%ae> %s", "sre-status"),
      "github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com> fast checks, run 1");
    // Orphan: no shared history with main.
    const roots = await t.git("--git-dir", t.origin, "rev-list", "--max-parents=0", "sre-status");
    assert.notEqual(roots, t.mainBefore);
    assert.equal(await t.git("--git-dir", t.origin, "rev-list", "--count", "sre-status"), "1");

    // A second checkout sees the saved state; saving nothing is a no-op.
    const again = path.join(t.root, "state2");
    await t.sh(["checkout", again]);
    assert.equal(await readFile(path.join(again, "status.json"), "utf8"), "{}\n");
    const none = await t.sh(["commit", again, "no change"]);
    assert.match(none.stdout, /nothing changed/);
  } finally {
    await t.cleanup();
  }
});

test("push race: the later run rebases, both history lines survive, the newer snapshot wins", async () => {
  const t = await setup();
  try {
    const seed = path.join(t.root, "seed");
    await t.sh(["checkout", seed]);
    await mkdir(path.join(seed, "history"));
    await writeFile(path.join(seed, "history", "2026-11-13.jsonl"), '{"t":"00:00"}\n');
    await writeFile(path.join(seed, "status.json"), '{"run":0}\n');
    await t.sh(["commit", seed, "seed"]);

    const a = path.join(t.root, "a");
    const b = path.join(t.root, "b");
    await t.sh(["checkout", a]);
    await t.sh(["checkout", b]);
    await appendFile(path.join(a, "history", "2026-11-13.jsonl"), '{"t":"00:05","by":"a"}\n');
    await writeFile(path.join(a, "status.json"), '{"run":"a"}\n');
    await writeFile(path.join(a, "report-a.md"), "a\n");
    await appendFile(path.join(b, "history", "2026-11-13.jsonl"), '{"t":"00:06","by":"b"}\n');
    await writeFile(path.join(b, "status.json"), '{"run":"b"}\n');

    await t.sh(["commit", a, "run a"]);
    const out = await t.sh(["commit", b, "run b"]);
    assert.match(out.stdout, /refused/);
    assert.match(out.stdout, /status\.json/);

    const check = path.join(t.root, "check");
    await t.sh(["checkout", check]);
    const history = await readFile(path.join(check, "history", "2026-11-13.jsonl"), "utf8");
    assert.match(history, /"by":"a"/);
    assert.match(history, /"by":"b"/);
    assert.equal(history.trim().split("\n").length, 3);
    assert.equal(await readFile(path.join(check, "status.json"), "utf8"), '{"run":"b"}\n');
    assert.equal(await readFile(path.join(check, "report-a.md"), "utf8"), "a\n");
    assert.equal(await t.git("--git-dir", t.origin, "log", "--format=%s", "sre-status"), "run b\nrun a\nseed");
    assert.equal(await t.git("--git-dir", t.origin, "rev-parse", "main"), t.mainBefore);
  } finally {
    await t.cleanup();
  }
});

test("two first runs racing to create the branch both land", async () => {
  const t = await setup();
  try {
    const a = path.join(t.root, "a");
    const b = path.join(t.root, "b");
    await t.sh(["checkout", a]);
    await t.sh(["checkout", b]);
    await writeFile(path.join(a, "deploys.jsonl"), '{"by":"a"}\n');
    await writeFile(path.join(b, "deploys.jsonl"), '{"by":"b"}\n');
    await t.sh(["commit", a, "run a"]);
    await t.sh(["commit", b, "run b"]);
    const check = path.join(t.root, "check");
    await t.sh(["checkout", check]);
    const lines = await readFile(path.join(check, "deploys.jsonl"), "utf8");
    assert.match(lines, /"by":"a"/);
    assert.match(lines, /"by":"b"/);
  } finally {
    await t.cleanup();
  }
});

test("refuses main, a non-empty folder, an unreachable remote and a foreign folder", async () => {
  const t = await setup();
  try {
    const dir = path.join(t.root, "state");
    const refused = await t.sh(["checkout", dir], { SRE_STATUS_BRANCH: "main" }).catch((error) => error);
    assert.equal(refused.code, 2);
    assert.match(refused.stderr, /refusing/);

    await mkdir(dir);
    await writeFile(path.join(dir, "x"), "x");
    const busy = await t.sh(["checkout", dir]).catch((error) => error);
    assert.equal(busy.code, 2);

    // A remote that cannot be reached must not be taken for "no branch yet".
    const lost = await t.sh(["checkout", path.join(t.root, "lost")], { SRE_STATE_REMOTE: path.join(t.root, "missing.git") }).catch((error) => error);
    assert.equal(lost.code, 2);
    assert.match(lost.stderr, /could not reach/);
    await assert.rejects(stat(path.join(t.root, "lost")));

    const foreign = await t.sh(["commit", t.repo, "x"]).catch((error) => error);
    assert.equal(foreign.code, 2);
    assert.match(foreign.stderr, /not sre-status|not a checkout/);
    assert.equal(await t.git("--git-dir", t.origin, "rev-parse", "main"), t.mainBefore);
  } finally {
    await t.cleanup();
  }
});
