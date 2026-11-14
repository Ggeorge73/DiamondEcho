// Tests of the chaos runner and its safety rails. They start no API and send
// nothing over the network: requests go to a fake fetch, servers are fakes,
// and the socket guard is tried on an address that is never contacted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { EXPERIMENTS } from "./experiments.mjs";
import { childEnv, isLoopbackUrl, isProductionUrl, makeRequester, unsignedStaffToken, HERE } from "./lib.mjs";
import { UsageError, chooseTarget, clockFrom, parseArgs, runExperiment, selectExperiments, summarise } from "./run.mjs";

test("production is refused as a target, with or without approval", () => {
  for (const url of [
    "https://diamondecho.com", "https://www.diamondecho.com", "https://staff.diamondecho.com",
    "https://diamondecho-api-180189726732.us-east1.run.app", "https://anything.diamondecho.com",
    "https://diamondecho-api-abcdef-ue.a.run.app",
  ]) {
    assert.equal(isProductionUrl(url), true, url);
    assert.throws(() => chooseTarget({ staging: url, approved: true }), /production/, url);
  }
});

test("a staging run needs a bare https origin and the approval flag", () => {
  assert.throws(() => chooseTarget({ staging: "https://staging-api.example.run.app", approved: false }), /approved-by-gbenga/);
  assert.throws(() => chooseTarget({ staging: "http://staging-api.example.run.app", approved: true }), /bare https origin/);
  assert.throws(() => chooseTarget({ staging: "https://staging-api.example.run.app/api?x=1", approved: true }), /bare https origin/);
  assert.deepEqual(chooseTarget({ staging: "https://staging-api.example.run.app", approved: true }),
    { kind: "staging", allowed: "https://staging-api.example.run.app", origin: "https://staging-api.example.run.app" });
  assert.deepEqual(chooseTarget({}), { kind: "local", allowed: "loopback" });
});

test("a staging run gets only the experiments marked safe for a deployed service", () => {
  const chosen = selectExperiments(EXPERIMENTS, { only: null, target: { kind: "staging" } });
  assert.ok(chosen.length > 0);
  assert.ok(chosen.every((e) => e.remote_safe === true && !e.local_only));
  assert.ok(!chosen.some((e) => e.id === "inquiry-burst"), "an inquiry burst must never reach a deployed queue");
  assert.throws(() => selectExperiments(EXPERIMENTS, { only: ["nope"], target: { kind: "local" } }), UsageError);
});

test("every experiment states its hypothesis, blast radius, abort condition and a time limit", () => {
  const ids = new Set();
  for (const e of EXPERIMENTS) {
    assert.ok(!ids.has(e.id), e.id);
    ids.add(e.id);
    for (const field of ["title", "hypothesis", "blast_radius", "abort_condition"]) assert.ok(e[field]?.length > 20, `${e.id} ${field}`);
    assert.ok(Number.isFinite(e.deadline_ms) && e.deadline_ms <= 120_000, `${e.id} deadline`);
    assert.equal(typeof e.run, "function");
  }
});

test("the local requester never sends anywhere but this machine", async () => {
  const sent = [];
  const request = makeRequester({ allowed: "loopback", fetchImpl: async (url) => { sent.push(url); return new Response("ok"); } });
  await assert.rejects(request("https://diamondecho.com/health"), /not the allowed target/);
  await assert.rejects(request("http://10.0.0.7:8080/health"), /not the allowed target/);
  const answer = await request("http://127.0.0.1:9/health");
  assert.equal(answer.status, 200);
  assert.deepEqual(sent, ["http://127.0.0.1:9/health"]);
  assert.equal(isLoopbackUrl("https://127.0.0.1/"), false, "only plain http to this machine");
});

test("a refused or silent connection is an answer with an error, never a throw", async () => {
  const refused = makeRequester({ allowed: "loopback", fetchImpl: async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); } });
  assert.deepEqual((({ status, error }) => ({ status, error }))(await refused("http://127.0.0.1:9/")), { status: null, error: "ECONNREFUSED" });
  const silent = makeRequester({ allowed: "loopback", fetchImpl: async () => { throw new DOMException("timed out", "TimeoutError"); } });
  assert.equal((await silent("http://127.0.0.1:9/")).error, "no answer in time");
});

test("the API process gets no setting, key or token of the person running the experiments", () => {
  const env = childEnv({ home: "/tmp/chaos-home", extra: { FIREBASE_PROJECT_ID: "demo-diamondecho" }, path: "/usr/bin" });
  for (const key of Object.keys(env)) assert.ok(!/TOKEN|SECRET|PASSWORD|GITHUB|WEBHOOK|AWS_|CLOUDSDK/.test(key), key);
  assert.equal(env.GOOGLE_APPLICATION_CREDENTIALS, path.join("/tmp/chaos-home", "no-credentials-here.json"));
  assert.equal(env.grpc_proxy, "http://127.0.0.1:9");
  assert.equal(env.FIREBASE_PROJECT_ID, "demo-diamondecho");
});

test("the staff token used in experiments is unsigned and names only the demo project", () => {
  const [header, payload, signature] = unsignedStaffToken("demo-diamondecho", 1_800_000_000).split(".");
  assert.equal(JSON.parse(Buffer.from(header, "base64url")).kid, "chaos-local");
  const claims = JSON.parse(Buffer.from(payload, "base64url"));
  assert.equal(claims.aud, "demo-diamondecho");
  assert.equal(claims.exp, 1_800_003_600);
  assert.equal(Buffer.from(signature, "base64url").toString(), "not-a-signature");
});

// A fake experiment runner world: no process is started.
function fakeServer() {
  let resolveExit;
  const server = { killed: [], exited: new Promise((resolve) => { resolveExit = resolve; }), url: (r) => `http://127.0.0.1:1${r}` };
  server.kill = (signal) => { server.killed.push(signal); resolveExit({ code: null, signal }); };
  return server;
}
const target = { kind: "local", allowed: "loopback" };
const experiment = (run, extra = {}) => ({ id: "fake", title: "Fake", hypothesis: "h", blast_radius: "b", abort_condition: "a", deadline_ms: 2_000, run, ...extra });

test("an experiment holds when every check passes, fails when one does not, and its servers are always killed", async () => {
  const servers = [];
  const startServerImpl = async () => { const s = fakeServer(); servers.push(s); return s; };
  const held = await runExperiment(experiment(async (ctx) => { await ctx.start(); ctx.check("fine", true); }), { python: "x", target, request: null, startServerImpl });
  assert.equal(held.outcome, "held");
  const failed = await runExperiment(experiment(async (ctx) => { await ctx.start(); ctx.check("broken", false, { expected: 1, observed: 2 }); }), { python: "x", target, request: null, startServerImpl });
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.reason, "broken");
  assert.ok(servers.every((s) => s.killed.includes("SIGKILL")));
  for (const field of ["hypothesis", "blast_radius", "abort_condition", "started_at", "finished_at", "duration_ms", "checks", "measurements"]) assert.ok(field in held, field);
});

test("a known weakness that still fails is confirmed; one that passes fails the run so its mark is removed", async () => {
  const still = await runExperiment(experiment(async (ctx) => ctx.check("hangs", false, { known: "w1" })), { python: "x", target, request: null });
  assert.equal(still.outcome, "held");
  assert.deepEqual(still.known_weaknesses_confirmed, ["w1"]);
  const fixed = await runExperiment(experiment(async (ctx) => ctx.check("hangs", true, { known: "w1" })), { python: "x", target, request: null });
  assert.equal(fixed.outcome, "failed");
  assert.match(fixed.reason, /no longer seen/);
});

test("an experiment past its time limit is aborted and its servers are killed", async () => {
  const servers = [];
  const result = await runExperiment(experiment(async (ctx) => { await ctx.start(); await new Promise(() => {}); }, { deadline_ms: 50 }),
    { python: "x", target, request: null, startServerImpl: async () => { const s = fakeServer(); servers.push(s); return s; } });
  assert.equal(result.outcome, "aborted");
  assert.match(result.reason, /limit/);
  assert.deepEqual(servers[0].killed, ["SIGKILL"]);
});

test("a bug in an experiment is 'error', and the run exits 2; a failure exits 1", async () => {
  const result = await runExperiment(experiment(async () => { throw new TypeError("oops"); }), { python: "x", target, request: null });
  assert.equal(result.outcome, "error");
  assert.equal(summarise([{ outcome: "held" }]).exitCode, 0);
  assert.equal(summarise([{ outcome: "held" }, { outcome: "aborted" }]).exitCode, 1);
  assert.equal(summarise([{ outcome: "failed" }, { outcome: "error" }]).exitCode, 2);
});

test("a staging run may not start processes", async () => {
  const result = await runExperiment(experiment(async (ctx) => ctx.start()), { python: "x", target: { kind: "staging", allowed: "https://s.example", origin: "https://s.example" }, request: null });
  assert.equal(result.outcome, "error");
  assert.match(result.reason, /only a local run/);
});

test("arguments and the clock", () => {
  assert.equal(parseArgs([], { CHAOS_PYTHON: "/venv/bin/python" }).python, "/venv/bin/python");
  assert.deepEqual(parseArgs(["--only", "a,b"], {}).only, ["a", "b"]);
  assert.throws(() => parseArgs(["--target", "prod"], {}), UsageError);
  assert.throws(() => parseArgs(["--out"], {}), UsageError);
  assert.match(clockFrom({ SRE_NOW: "2026-11-13T00:00:00Z" })(), /^2026-11-13T00:00:0/);
  assert.throws(() => clockFrom({ SRE_NOW: "soon" }), UsageError);
});

// serve.py's guard, with the standard library only (no backend packages).
const python = process.env.CHAOS_PYTHON || "python3";
const hasPython = spawnSync(python, ["-c", "print(1)"]).status === 0;
test("serve.py refuses every outbound connection and allows this machine", { skip: !hasPython && "no python" }, () => {
  const script = `
import sys, socket
sys.path.insert(0, ${JSON.stringify(HERE)})
import serve
assert serve.loopback(("127.0.0.1", 1)) and serve.loopback(("::1", 1)) and serve.loopback(("localhost", 1))
assert not serve.loopback(("192.0.2.1", 443)) and not serve.loopback(("api.rentcast.io", 443))
serve.install_guard()
for target in [("192.0.2.1", 443), ("2001:db8::1", 443)]:
    family = socket.AF_INET6 if ":" in target[0] else socket.AF_INET
    try:
        s = socket.socket(family, socket.SOCK_STREAM)
    except OSError:
        continue  # this machine has no IPv6
    try:
        s.connect(target)
        raise SystemExit("connected")
    except ConnectionRefusedError:
        pass
    finally:
        s.close()
try:
    socket.getaddrinfo("api.rentcast.io", 443)
    raise SystemExit("looked up")
except socket.gaierror:
    pass
print("guarded")
`;
  const answer = spawnSync(python, ["-I", "-c", script], { encoding: "utf8" });
  assert.equal(answer.status, 0, answer.stderr);
  assert.match(answer.stdout, /guarded/);
  assert.match(answer.stderr, /chaos-guard: blocked outbound connection to 192\.0\.2\.1:443/);
});
