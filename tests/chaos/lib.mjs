// Plumbing for the chaos experiments: start the real API on this machine,
// talk to it, stop it. A request goes only to the one origin the runner
// allows (127.0.0.1 for local runs), checked on every call, so a typo can
// never point an experiment at production.
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TARGETS } from "../../scripts/sre/targets.mjs";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SERVE = path.join(HERE, "serve.py");

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Thrown when an experiment's abort condition is met: the experiment stops,
// its servers are killed and the result is "aborted", not "failed".
export class AbortCondition extends Error {
  constructor(message) {
    super(message);
    this.name = "AbortCondition";
  }
}

export function isLoopbackUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  return parsed.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(parsed.hostname);
}

// Every production host, and anything under the production domain.
export function isProductionUrl(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return true; }
  const prod = TARGETS.production;
  const hosts = [prod.publicOrigin, prod.wwwOrigin, prod.staffOrigin, prod.apiOrigin, prod.idxOrigin]
    .map((origin) => new URL(origin).hostname.toLowerCase());
  return hosts.includes(host) || host === prod.domain || host.endsWith("." + prod.domain)
    || host.startsWith("diamondecho-api-");
}

// The function every experiment uses to send a request. It never throws for
// a network failure: it returns `status: null` and what went wrong, because a
// refused or cut connection is exactly what a chaos experiment looks for.
export function makeRequester({ allowed, fetchImpl = globalThis.fetch }) {
  const permitted = (url) => (allowed === "loopback" ? isLoopbackUrl(url) : new URL(url).origin === allowed);
  return async function request(url, { method = "GET", json, body, headers = {}, timeoutMs = 10_000 } = {}) {
    if (!permitted(url)) throw new Error(`refusing to send a chaos request to ${safeHost(url)}: not the allowed target`);
    const started = performance.now();
    const sendHeaders = json === undefined ? headers : { "content-type": "application/json", ...headers };
    try {
      const response = await fetchImpl(url, {
        method, headers: sendHeaders, body: json === undefined ? body : JSON.stringify(json),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      return { status: response.status, headers: Object.fromEntries(response.headers), text, ms: elapsed(started), error: null };
    } catch (error) {
      return { status: null, headers: {}, text: "", ms: elapsed(started), error: describe(error) };
    }
  };
}

function safeHost(url) {
  try { return new URL(url).host; } catch { return "an unreadable address"; }
}

export const elapsed = (started) => Math.round(performance.now() - started);

export function describe(error) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "no answer in time";
  const code = error?.cause?.code || error?.code;
  if (code) return code;
  if (error?.cause?.name === "SocketError" || /other side closed/i.test(String(error?.cause?.message))) return "connection closed";
  return error?.name || "error";
}

export async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// A local port that accepts connections and never answers: a database or a
// provider on its worst day. Every socket is held open until close().
export async function startBlackhole() {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    port: server.address().port,
    connections: () => sockets.size,
    close: () => new Promise((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    }),
  };
}

// The environment the API process gets. Built from nothing, so no setting,
// key or token of the person or runner starting it is passed on. Every
// Google client library is pointed at addresses that refuse at once, as a
// second fence behind the socket guard in serve.py (gRPC opens its own
// sockets, which that guard cannot see).
export function childEnv({ home, extra = {}, path: searchPath = process.env.PATH }) {
  return {
    PATH: searchPath || "/usr/local/bin:/usr/bin:/bin",
    HOME: home,
    LANG: "C.UTF-8",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONUNBUFFERED: "1",
    GOOGLE_APPLICATION_CREDENTIALS: path.join(home, "no-credentials-here.json"),
    GCE_METADATA_HOST: "127.0.0.1:9",
    GCE_METADATA_IP: "127.0.0.1:9",
    NO_GCE_CHECK: "True",
    grpc_proxy: "http://127.0.0.1:9",
    no_proxy: "127.0.0.1,localhost",
    NO_PROXY: "127.0.0.1,localhost",
    ...extra,
  };
}

// Start serve.py and wait until /health answers. Returns a handle the
// experiment uses to talk to the process, kill it and read what it printed.
export async function startServer({ python, home, env = {}, flags = [], request, healthTimeoutMs = 30_000, clockFile = null }) {
  const port = await freePort();
  const args = ["-I", SERVE, "--port", String(port), ...flags];
  if (clockFile) {
    writeFileSync(clockFile, "0");
    args.push("--clock-file", clockFile);
  }
  const spawnedAt = performance.now();
  const proc = spawn(python, args, { env: childEnv({ home, extra: env }), stdio: ["ignore", "ignore", "pipe"] });
  const handle = {
    proc, port, baseUrl: `http://127.0.0.1:${port}`, spawnedAt, healthyMs: null,
    blocked: [], stored: 0, log: [], exit: null, spawnError: null,
    kill(signal = "SIGKILL") {
      if (handle.exit) return false;
      try { return proc.kill(signal); } catch { return false; }
    },
    url: (route) => `http://127.0.0.1:${port}${route}`,
  };
  handle.exited = new Promise((resolve) => {
    proc.on("exit", (code, signal) => {
      handle.exit = { code, signal, at: performance.now() };
      resolve(handle.exit);
    });
  });
  proc.on("error", (error) => { handle.spawnError = error.code || error.message; });
  let pending = "";
  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (chunk) => {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop();
    for (const line of lines) readLine(handle, line);
  });

  const deadline = spawnedAt + healthTimeoutMs;
  while (performance.now() < deadline) {
    if (handle.spawnError) throw new AbortCondition(`could not start ${python}: ${handle.spawnError}`);
    if (handle.exit) throw new AbortCondition(`the API process stopped before answering /health: ${handle.log.slice(-5).join(" | ")}`);
    const answer = await request(handle.url("/health"), { timeoutMs: 1000 });
    if (answer.status === 200) {
      handle.healthyMs = elapsed(spawnedAt);
      return handle;
    }
    await sleep(100);
  }
  handle.kill("SIGKILL");
  throw new AbortCondition(`the API did not answer /health within ${healthTimeoutMs / 1000} s`);
}

function readLine(handle, line) {
  const blocked = /^chaos-guard: blocked outbound connection to (.+)$/.exec(line);
  if (blocked) handle.blocked.push(blocked[1]);
  const stored = /^chaos-memory-queue: stored (\d+)$/.exec(line);
  if (stored) handle.stored = Number(stored[1]);
  handle.log.push(line.slice(0, 300));
  if (handle.log.length > 200) handle.log.shift();
}

// A Firebase ID token in the shape the SDK checks before it fetches Google's
// signing keys or asks the sign-in service. It is signed by nobody and is
// accepted by nothing: it exists so a staff route gets as far as the
// dependency the experiment has taken away.
export function unsignedStaffToken(project, nowSeconds = Math.floor(Date.now() / 1000)) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return [
    part({ alg: "RS256", kid: "chaos-local", typ: "JWT" }),
    part({
      aud: project, iss: `https://securetoken.google.com/${project}`, sub: "staff-1", user_id: "staff-1",
      iat: nowSeconds - 60, auth_time: nowSeconds - 60, exp: nowSeconds + 3600,
      email_verified: true, firebase: { sign_in_provider: "password", sign_in_second_factor: "totp" },
    }),
    Buffer.from("not-a-signature").toString("base64url"),
  ].join(".");
}
