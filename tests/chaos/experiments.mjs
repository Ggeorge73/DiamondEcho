// The chaos experiments. Each one states what we believe (hypothesis), what
// it can touch (blast radius), when it stops on its own (abort condition) and
// then tries to prove the belief wrong against the real API started on this
// machine by serve.py. run.mjs runs them and writes the results as JSON.
//
// A check marked `known` is a weakness already written down (in
// docs/sre/chaos-and-game-days.md and as an xfail in
// backend/tests/test_resilience.py). While it still fails it is reported as
// confirmed and does not fail the run; the day it passes, the run fails so
// the mark is removed and the fix stays protected, as pytest's strict xfail.

import { freePort, unsignedStaffToken } from "./lib.mjs";

export const DEAL = {
  strategy: "rental",
  property: { property_type: "multifamily", unit_count: 4 },
  acquisition: { purchase_price: 1_000_000, closing_costs: 20_000, hold_months: 60 },
  debt: [{ loan_to_value: 0.7, annual_interest_rate: 0.06, amortization_years: 30, term_months: 120 }],
  operating: {
    gross_scheduled_rent: 120_000, other_income: 5_000, vacancy_rate: 0.05, operating_expenses: 40_000,
    replacement_reserves: 5_000, annual_income_growth_rate: 0.03, annual_expense_growth_rate: 0.03,
  },
  exit: { exit_cap_rate: 0.06 },
};

const DRIVERS = {
  rent_change: { minimum: -0.1, mode: 0, maximum: 0.05 },
  vacancy_rate: { minimum: 0.03, mode: 0.05, maximum: 0.12 },
  exit_cap_rate: { minimum: 0.055, mode: 0.06, maximum: 0.075 },
};

// The most work one request may ask for (50,000 iterations), so it runs until
// the service's time budget stops it.
export const LONGEST_SIMULATION = {
  deal: DEAL,
  scenarios: [
    { name: "Chaos case A", iterations: 20_000, seed: 1, drivers: DRIVERS },
    { name: "Chaos case B", iterations: 20_000, seed: 2, drivers: DRIVERS },
    { name: "Chaos case C", iterations: 10_000, seed: 3, drivers: DRIVERS },
  ],
};

// A synthetic visitor. Only ever sent to a local process whose queue is a
// list in memory (serve.py --memory-queue); example.com is a reserved name.
export const SYNTHETIC_VISITOR = {
  kind: "buyer", full_name: "Chaos Test Visitor", email: "chaos-visitor@example.com",
  message: "Synthetic local chaos test. Not a real person.", consent: true,
};

const PROJECT = "demo-diamondecho";
const QUEUE_ON = {
  INQUIRY_STAFF_QUEUE_ENABLED: "true", FIREBASE_PROJECT_ID: PROJECT, INQUIRY_STAFF_UIDS: "staff-1",
  PUBLIC_ORIGIN: "https://public.example.com", STAFF_ORIGIN: "https://staff.example.com",
};
// Every feature switched on, with values that open nothing: a demo project,
// placeholder provider keys. Nothing can leave the machine anyway.
const EVERYTHING_ON = {
  ...QUEUE_ON, MARKET_BRIEF_ENABLED: "true", PODCAST_BUCKET: "demo-diamondecho-podcast",
  RENTCAST_API_KEY: "chaos-placeholder-not-a-key", MAPBOX_ACCESS_TOKEN: "chaos-placeholder-not-a-token",
};

// Cloud Run ends a request after 30 seconds (deploy/cloud-run.service.yaml)
// and gives an instance 10 seconds between SIGTERM and SIGKILL.
export const REQUEST_TIMEOUT_MS = 30_000;
export const SHUTDOWN_GRACE_MS = 10_000;
// The liveness probe gives /health 5 seconds; we want a wide margin.
const HEALTH_LIMIT_MS = 2_000;

const TOO_MANY_FROM_ADDRESS = "Too many requests were sent from this connection. Please wait a few minutes and try again, or call or email us.";
const QUEUE_BUSY = "Online requests are busy right now. Please try again later, or call or email us.";
const LEAKS = ["Traceback", "site-packages", 'File "', "googleapis.com", "chaos-placeholder", "127.0.0.1"];

const uuid = () => crypto.randomUUID();
const detailOf = (answer) => { try { return JSON.parse(answer.text).detail; } catch { return undefined; } };
const leaks = (answer) => LEAKS.filter((needle) => answer.text.includes(needle));
const short = (answer) => (answer.status === null ? `no answer (${answer.error}) after ${answer.ms} ms` : `${answer.status} in ${answer.ms} ms`);

// Weaknesses already written down, which make a route hang when its
// dependency hangs. Named in the results; see docs/sre/chaos-and-game-days.md.
const STAFF_SIGN_IN = "staff-sign-in-no-deadline: backend/inquiries/firebase.py:40 starts Firebase without httpTimeout, so the staff sign-in check waits up to 120 s";
const FIRESTORE_RETRY = "firestore-retry: Firestore calls pass timeout=5 or 10 per attempt but keep the client's default retry: against an unreachable database a read took 293 s and a write 57 s before giving up (market_brief/service.py:99, podcast/service.py:79 and :86, inquiries/firebase.py:73 and :80, server.py:90; writes at inquiries/firebase.py:68 and the other create/set/update calls)";

// The routes that need a dependency, with the answer each documents for an
// outage, and the known weakness that makes it slow when the dependency
// hangs or refuses at call time.
function dependentRoutes(token) {
  const staff = { authorization: `Bearer ${token}` };
  return [
    { name: "inquiry submit", method: "POST", path: "/api/v1/inquiries", json: SYNTHETIC_VISITOR, headers: { "x-idempotency-key": uuid() }, status: [503], refuse: FIRESTORE_RETRY },
    { name: "staff inquiry list", path: "/api/v1/inquiries/staff", headers: staff, status: [503], hang: STAFF_SIGN_IN },
    { name: "staff status list", path: "/api/status", headers: staff, status: [503], hang: STAFF_SIGN_IN },
    { name: "market brief", path: "/api/v1/market-brief", status: [503], hang: FIRESTORE_RETRY, refuse: FIRESTORE_RETRY },
    { name: "market brief audio", path: "/api/v1/market-brief/audio/2026-10-09.mp3", status: [503], hang: FIRESTORE_RETRY, refuse: FIRESTORE_RETRY },
    { name: "podcast episodes", path: "/api/v1/podcast/episodes", status: [503], hang: FIRESTORE_RETRY, refuse: FIRESTORE_RETRY },
    { name: "staff podcast episodes", path: "/api/v1/podcast/staff/episodes", headers: staff, status: [503], hang: STAFF_SIGN_IN },
    { name: "property lookup", path: "/api/v1/properties/lookup?address=1+Main+St+Atlanta+GA", status: [502] },
    { name: "address suggestions", path: `/api/v1/properties/suggest?q=1+Main&session_token=${uuid()}`, status: [502] },
  ];
}

// Ask /health every `everyMs` until `until` settles; return the latencies.
async function watchHealth(ctx, server, until, everyMs = 500) {
  const seen = [];
  let done = false;
  until.finally(() => { done = true; });
  while (!done) {
    const answer = await ctx.request(server.url("/health"), { timeoutMs: 10_000 });
    seen.push(answer.status === 200 ? answer.ms : Infinity);
    if (!done) await ctx.sleep(everyMs);
  }
  return seen;
}

const worst = (values) => (values.length ? Math.max(...values) : null);

// Two ways a dependency can fail at call time rather than at start: it
// accepts the connection and never answers ("hang"), or it refuses at once
// ("refuse", which gRPC reports as UNAVAILABLE and the Google client retries).
// `known` says which routes a written-down weakness makes slow in each mode.
function slowDependencies(mode) {
  const hang = mode === "hang";
  return {
    id: hang ? "dependencies-hang" : "dependencies-refuse-at-call-time",
    title: hang
      ? "The database, sign-in service, storage and providers accept connections and never answer"
      : "The database, sign-in service, storage and providers refuse every call after the API has started",
    hypothesis: `When every dependency ${hang ? "hangs" : "refuses each call"}, each route still gives up on its own deadline and answers 502 or 503 well inside Cloud Run's 30 second limit (under 25 s), and /health keeps answering within 2 s the whole time.`,
    blast_radius: hang
      ? "One API process on 127.0.0.1 and one local port that accepts connections and never replies, used as the Firestore and sign-in emulator address, the storage emulator address and the web proxy. Firebase is given anonymous credentials (serve.py --anonymous-credentials). Nothing leaves the machine."
      : "One API process on 127.0.0.1 whose Firestore, sign-in, storage and proxy addresses are a local port nobody listens on. Firebase is given anonymous credentials (serve.py --anonymous-credentials). Nothing leaves the machine.",
    abort_condition: "The API does not answer /health within 30 s, or the experiment runs past 75 s.",
    deadline_ms: 75_000,
    async run(ctx) {
      let at;
      let hole = null;
      if (hang) {
        hole = await ctx.blackhole();
        at = `127.0.0.1:${hole.port}`;
      } else {
        at = `127.0.0.1:${await freePort()}`; // free means nobody listens there
      }
      const server = await ctx.start({
        flags: ["--anonymous-credentials"],
        env: {
          ...EVERYTHING_ON, FIRESTORE_EMULATOR_HOST: at, FIREBASE_AUTH_EMULATOR_HOST: at,
          STORAGE_EMULATOR_HOST: `http://${at}`, HTTPS_PROXY: `http://${at}`, https_proxy: `http://${at}`,
          HTTP_PROXY: `http://${at}`, http_proxy: `http://${at}`,
        },
      });
      const routes = dependentRoutes(unsignedStaffToken(PROJECT));
      const all = Promise.all(routes.map((route) => ctx.request(server.url(route.path),
        { method: route.method, json: route.json, headers: route.headers, timeoutMs: 35_000 })));
      const health = await watchHealth(ctx, server, all);
      const answers = await all;
      if (hole) ctx.measure("connections_held_by_the_silent_port", hole.connections());
      ctx.measure("health_checks", health.length);
      ctx.measure("slowest_health_ms", worst(health));
      ctx.check(`/health answers within 2 s while every dependency ${hang ? "hangs" : "refuses"}`, health.every((ms) => ms < HEALTH_LIMIT_MS),
        { expected: `< ${HEALTH_LIMIT_MS} ms each`, observed: `slowest ${worst(health)} ms over ${health.length} checks` });
      routes.forEach((route, i) => {
        const answer = answers[i];
        ctx.measure(route.name, short(answer));
        ctx.check(`${route.name}: a clean ${route.status.join(" or ")} in under 25 s`,
          route.status.includes(answer.status) && answer.ms < 25_000 && leaks(answer).length === 0,
          { expected: `${route.status.join("/")} in < 25000 ms`, observed: `${short(answer)} ${JSON.stringify(detailOf(answer) ?? "")}`, known: route[mode] });
      });
    },
  };
}

export const EXPERIMENTS = [
  {
    id: "kill-mid-request",
    title: "The API process is killed in the middle of a calculation",
    hypothesis: "When the process dies (SIGKILL) during a long calculation, the caller is told at once (connection closed, not a hang), and a fresh process answers /health within 15 seconds and calculates correctly.",
    blast_radius: "One API process on 127.0.0.1 started for this experiment, and the one request it was answering. Outbound connections are refused by serve.py.",
    abort_condition: "The API does not answer /health within 30 s of starting, or the experiment runs past 60 s.",
    deadline_ms: 60_000,
    async run(ctx) {
      const first = await ctx.start({});
      const inflight = ctx.request(first.url("/api/v1/deals/monte-carlo"), { method: "POST", json: LONGEST_SIMULATION, timeoutMs: 35_000 });
      await ctx.sleep(1_000);
      const killedAt = performance.now();
      first.kill("SIGKILL");
      const answer = await inflight;
      const toldAfter = Math.round(performance.now() - killedAt);
      ctx.measure("caller_told_after_ms", toldAfter);
      ctx.measure("caller_saw", answer.status === null ? answer.error : answer.status);
      ctx.check("the caller gets a closed connection, not an answer and not a hang", answer.status === null && toldAfter < 2_000,
        { expected: "no answer, within 2 s of the kill", observed: short(answer) });

      const second = await ctx.start({});
      ctx.measure("restart_to_healthy_ms", second.healthyMs);
      ctx.check("a fresh process answers /health within 15 s", second.healthyMs < 15_000,
        { expected: "< 15000 ms", observed: `${second.healthyMs} ms` });
      const after = await ctx.request(second.url("/api/v1/deals/analyze"), { method: "POST", json: DEAL });
      ctx.check("the fresh process calculates", after.status === 200, { expected: 200, observed: short(after) });
    },
  },

  {
    id: "sigterm-mid-request",
    title: "The API process is asked to stop (SIGTERM) in the middle of a calculation",
    hypothesis: "On SIGTERM, which Cloud Run sends 10 seconds before it kills an instance, the process stops taking new connections, finishes the calculation it is running and exits inside those 10 seconds. Run with a 5 second calculation budget so it can fit; with production's 20 second budget a calculation would be cut (see the note).",
    blast_radius: "One API process on 127.0.0.1 started for this experiment and one calculation. Outbound connections are refused.",
    abort_condition: "The API does not answer /health within 30 s, or the experiment runs past 45 s.",
    deadline_ms: 45_000,
    async run(ctx) {
      const server = await ctx.start({ env: { MONTE_CARLO_TIME_BUDGET_SECONDS: "5" } });
      const inflight = ctx.request(server.url("/api/v1/deals/monte-carlo"), { method: "POST", json: LONGEST_SIMULATION, timeoutMs: 35_000 });
      await ctx.sleep(1_000);
      const stoppedAt = performance.now();
      server.kill("SIGTERM");
      await ctx.sleep(300);
      const newcomer = await ctx.request(server.url("/health"), { timeoutMs: 3_000 });
      const answer = await inflight;
      const exit = await Promise.race([server.exited, ctx.sleep(15_000).then(() => null)]);
      const exitAfter = exit ? Math.round(exit.at - stoppedAt) : null;
      ctx.measure("in_flight_answer", short(answer));
      ctx.measure("exit_after_sigterm_ms", exitAfter);
      ctx.measure("new_request_during_shutdown", short(newcomer));
      ctx.check("the calculation running at SIGTERM is answered", answer.status === 200, { expected: 200, observed: short(answer) });
      // Locally the request may ride on a kept-alive connection and be reset
      // when the process exits; on Cloud Run the front end stops sending new
      // requests to an instance it is stopping. What matters here is that the
      // stopping process gives no answer it cannot stand behind and holds
      // nobody past its own exit.
      ctx.check("a request sent during shutdown is not answered by the stopping process and is let go by its exit",
        newcomer.status === null && (exitAfter === null || newcomer.ms <= exitAfter + 1_000),
        { expected: "refused or reset, no later than the exit", observed: short(newcomer) });
      ctx.check("the process exits within Cloud Run's 10 s grace", exitAfter !== null && exitAfter < SHUTDOWN_GRACE_MS,
        { expected: `< ${SHUTDOWN_GRACE_MS} ms after SIGTERM`, observed: exitAfter === null ? "still running after 15 s" : `${exitAfter} ms` });
      ctx.note("uvicorn waits for running requests before it exits and has no limit on that wait (no --timeout-graceful-shutdown in the Dockerfile). A calculation that started less than 20 s before Cloud Run stops an instance can outlast the 10 s grace and is then cut by SIGKILL; the visitor's browser simulator is unaffected because it does not use this route.");
    },
  },

  {
    id: "kill-during-burst",
    title: "The API process is killed while it is answering a burst of requests",
    hypothesis: "Every request in flight when the process dies gets either a correct 200 or a prompt connection error, never a wrong status and never a wait of more than 5 seconds; after a restart the same burst is answered in full.",
    blast_radius: "One API process on 127.0.0.1 and about a hundred requests to the cheap /api/v1/deals/analyze route. Outbound connections are refused.",
    abort_condition: "The API does not answer /health within 30 s, or the experiment runs past 60 s.",
    deadline_ms: 60_000,
    async run(ctx) {
      const server = await ctx.start({});
      const answers = [];
      const loop = async () => {
        for (;;) {
          const answer = await ctx.request(server.url("/api/v1/deals/analyze"), { method: "POST", json: DEAL, timeoutMs: 10_000 });
          answers.push(answer);
          if (answer.status !== 200) return;
        }
      };
      const loops = Array.from({ length: 8 }, loop);
      await ctx.sleep(1_500);
      server.kill("SIGKILL");
      await Promise.all(loops);
      const ok = answers.filter((a) => a.status === 200).length;
      const failed = answers.filter((a) => a.status === null);
      const wrong = answers.filter((a) => a.status !== null && a.status !== 200);
      ctx.measure("requests_sent", answers.length);
      ctx.measure("answered_200", ok);
      ctx.measure("connection_errors", Object.fromEntries([...new Set(failed.map((a) => a.error))].map((kind) => [kind, failed.filter((a) => a.error === kind).length])));
      ctx.measure("slowest_ms", worst(answers.map((a) => a.ms)));
      ctx.check("requests were being answered before the kill", ok > 0, { expected: "> 0", observed: ok });
      ctx.check("no request got a wrong status", wrong.length === 0, { expected: "only 200 or no answer", observed: wrong.map(short).slice(0, 5) });
      ctx.check("no request waited more than 5 s", answers.every((a) => a.ms < 5_000), { expected: "< 5000 ms", observed: `${worst(answers.map((a) => a.ms))} ms` });

      const again = await ctx.start({});
      ctx.measure("restart_to_healthy_ms", again.healthyMs);
      const burst = await Promise.all(Array.from({ length: 8 }, () => ctx.request(again.url("/api/v1/deals/analyze"), { method: "POST", json: DEAL })));
      ctx.check("after a restart the whole burst is answered", burst.every((a) => a.status === 200), { expected: "8 x 200", observed: burst.map((a) => a.status) });
    },
  },

  {
    id: "dependencies-refused",
    title: "The API starts with every dependency unreachable",
    hypothesis: "With Firestore, Google sign-in, Cloud Storage, RentCast, Mapbox, FRED and the voice all refusing connections, the API still starts, /health and the calculators answer 200, and every route that needs a dependency answers its documented 502 or 503 in JSON within 2 seconds, with no 500 and no internal detail.",
    blast_radius: "One API process on 127.0.0.1 with every feature switched on against a demo project and placeholder keys. Its outbound connections are refused by serve.py and by unreachable proxy and metadata addresses.",
    abort_condition: "The API does not answer /health within 30 s, or the experiment runs past 60 s.",
    deadline_ms: 60_000,
    async run(ctx) {
      const server = await ctx.start({ env: EVERYTHING_ON });
      ctx.measure("start_to_healthy_ms", server.healthyMs);
      for (const route of [["health", "/health"], ["build identity", "/api/"], ["calculator profiles", "/api/v1/deals/assumption-profiles"]]) {
        const answer = await ctx.request(server.url(route[1]));
        ctx.check(`${route[0]} answers 200`, answer.status === 200, { expected: 200, observed: short(answer) });
      }
      const analysis = await ctx.request(server.url("/api/v1/deals/analyze"), { method: "POST", json: DEAL });
      ctx.check("the deal calculator answers 200", analysis.status === 200, { expected: 200, observed: short(analysis) });
      for (const route of dependentRoutes(unsignedStaffToken(PROJECT))) {
        const answer = await ctx.request(server.url(route.path), { method: route.method, json: route.json, headers: route.headers, timeoutMs: 35_000 });
        ctx.check(`${route.name}: a clean ${route.status.join(" or ")} within 2 s`,
          route.status.includes(answer.status) && answer.ms < 2_000 && (answer.headers["content-type"] || "").startsWith("application/json") && leaks(answer).length === 0,
          { expected: `${route.status.join("/")} JSON, < 2000 ms, no internal detail`, observed: `${short(answer)} ${JSON.stringify(detailOf(answer) ?? "")}${leaks(answer).length ? " leaks " + leaks(answer).join(",") : ""}` });
      }
      const health = await ctx.request(server.url("/health"));
      ctx.check("/health still answers after all that", health.status === 200, { expected: 200, observed: short(health) });
      ctx.measure("outbound_attempts_blocked", server.blocked.length);
      ctx.measure("outbound_hosts_tried", [...new Set(server.blocked.map((where) => where.replace(/:\d*$/, "")))].sort());
    },
  },

  slowDependencies("hang"),
  slowDependencies("refuse"),

  {
    id: "busy-worker",
    title: "The one API process is filled with the longest calculations one sender may ask for",
    hypothesis: "With ten simulations of the maximum size running at once (the most one sender may start in ten minutes) under production's 20 second budget, /health answers every check within 2 s, the everyday deal calculator still answers, every simulation finishes inside 30 s, and an eleventh is refused with 429 and Retry-After.",
    blast_radius: "One API process on 127.0.0.1 and this machine's CPU for about 25 seconds. Outbound connections are refused.",
    abort_condition: "The API does not answer /health within 30 s, or the experiment runs past 70 s.",
    deadline_ms: 70_000,
    async run(ctx) {
      const server = await ctx.start({});
      const sims = Promise.all(Array.from({ length: 10 }, () => ctx.request(server.url("/api/v1/deals/monte-carlo"),
        { method: "POST", json: LONGEST_SIMULATION, timeoutMs: 40_000 })));
      await ctx.sleep(500);
      const eleventh = await ctx.request(server.url("/api/v1/deals/monte-carlo"), { method: "POST", json: LONGEST_SIMULATION, timeoutMs: 10_000 });
      // The everyday calculator, asked while all ten are running.
      const during = ctx.sleep(3_000).then(() => ctx.request(server.url("/api/v1/deals/analyze"),
        { method: "POST", json: DEAL, timeoutMs: 40_000 }));
      const health = await watchHealth(ctx, server, sims, 500);
      const results = await sims;
      const everyday = [await during];
      ctx.measure("everyday_calculator_ms", everyday[0].ms);
      ctx.measure("slowest_health_ms", worst(health));
      ctx.measure("health_checks", health.length);
      ctx.measure("simulation_ms", results.map((a) => a.ms));
      ctx.check("/health answers within 2 s while ten simulations run", health.every((ms) => ms < HEALTH_LIMIT_MS),
        { expected: `< ${HEALTH_LIMIT_MS} ms each`, observed: `slowest ${worst(health)} ms over ${health.length} checks` });
      ctx.check("every simulation answers 200 inside Cloud Run's 30 s", results.every((a) => a.status === 200 && a.ms < REQUEST_TIMEOUT_MS),
        { expected: `10 x 200 in < ${REQUEST_TIMEOUT_MS} ms`, observed: results.map(short) });
      ctx.check("an eleventh simulation is refused with 429 and a Retry-After", eleventh.status === 429 && Number(eleventh.headers["retry-after"]) > 0,
        { expected: "429 with Retry-After", observed: `${short(eleventh)} Retry-After ${eleventh.headers["retry-after"]}` });
      ctx.check("the everyday calculator still answers", everyday[0].status === 200, { expected: 200, observed: short(everyday[0]) });
    },
  },

  {
    id: "inquiry-burst",
    title: "A burst of inquiries over the submission limits",
    hypothesis: "A sender's sixth inquiry in ten minutes is refused with 429, the documented message, Retry-After and no-store; waiting exactly as long as Retry-After says lets the sender back in; senders who rotate addresses are held at 30 per hour per instance with a 503, the documented message and Retry-After; other routes keep working; nothing refused is stored.",
    blast_radius: "One API process on 127.0.0.1 whose inquiry queue is a list in memory (serve.py --memory-queue) and whose limiters' clock is stepped forward by the experiment (--clock-file). Senders are documentation addresses (198.51.100.0/24) passed in X-Forwarded-For, which the service reads only when K_SERVICE is set, as on Cloud Run. Never run against a deployed service: it would fill a real queue.",
    abort_condition: "The API does not answer /health within 30 s, more than 45 inquiries would be sent, or the experiment runs past 60 s.",
    deadline_ms: 60_000,
    local_only: true,
    async run(ctx) {
      const server = await ctx.start({ flags: ["--memory-queue"], clock: true, env: { ...QUEUE_ON, K_SERVICE: "chaos-local" } });
      let sent = 0;
      let admitted = 0;
      const send = async (sender) => {
        if (++sent > 45) throw new ctx.AbortCondition("more than 45 inquiries would have been sent");
        const answer = await ctx.request(server.url("/api/v1/inquiries"), {
          method: "POST", json: SYNTHETIC_VISITOR, headers: { "x-idempotency-key": uuid(), "x-forwarded-for": sender },
        });
        if (answer.status === 201) admitted += 1;
        return answer;
      };
      const first = [];
      for (let i = 0; i < 6; i += 1) first.push(await send("198.51.100.7"));
      const refused = first[5];
      const wait = Number(refused.headers["retry-after"]);
      ctx.check("one sender's first five are taken", first.slice(0, 5).every((a) => a.status === 201), { expected: "5 x 201", observed: first.slice(0, 5).map((a) => a.status) });
      ctx.check("the sixth is refused with 429, the documented message, Retry-After and no-store",
        refused.status === 429 && detailOf(refused) === TOO_MANY_FROM_ADDRESS && wait >= 1 && wait <= 600 && refused.headers["cache-control"] === "no-store",
        { expected: "429, Retry-After 1-600, no-store", observed: `${short(refused)} Retry-After ${refused.headers["retry-after"]} Cache-Control ${refused.headers["cache-control"]}` });
      ctx.measure("retry_after_seconds_for_one_sender", wait);

      const health = await ctx.request(server.url("/health"));
      const analysis = await ctx.request(server.url("/api/v1/deals/analyze"), { method: "POST", json: DEAL });
      ctx.check("other routes keep working while the sender is refused", health.status === 200 && analysis.status === 200,
        { expected: "200 and 200", observed: `${health.status} and ${analysis.status}` });

      await ctx.advanceClock(Math.max(0, wait - 2));
      const early = await send("198.51.100.7");
      await ctx.advanceClock(wait);
      const back = await send("198.51.100.7");
      ctx.check("two seconds before Retry-After the sender is still refused", early.status === 429, { expected: 429, observed: short(early) });
      ctx.check("after waiting as long as Retry-After said, the sender is let back in", back.status === 201, { expected: 201, observed: short(back) });

      let busy = null;
      for (let n = 10; n < 60 && !busy; n += 1) {
        const answer = await send(`198.51.100.${n}`);
        if (answer.status !== 201) busy = answer;
      }
      const busyWait = Number(busy?.headers["retry-after"]);
      ctx.measure("admitted_before_the_instance_cap", admitted);
      ctx.check("rotating senders are held at 30 per hour on this instance", admitted === 30, { expected: 30, observed: admitted });
      ctx.check("the instance cap answers 503 with the documented message and Retry-After",
        busy?.status === 503 && detailOf(busy) === QUEUE_BUSY && busyWait >= 1 && busyWait <= 3600,
        { expected: "503, Retry-After 1-3600", observed: busy ? `${short(busy)} Retry-After ${busy.headers["retry-after"]}` : "never refused" });
      await ctx.advanceClock(wait + (Number.isFinite(busyWait) ? busyWait : 3600));
      const later = await send("198.51.100.250");
      ctx.check("after the hour a new sender is taken again", later.status === 201, { expected: 201, observed: short(later) });
      await ctx.sleep(200);
      ctx.measure("inquiries_sent", sent);
      ctx.measure("inquiries_stored", server.stored);
      ctx.check("nothing refused was stored", server.stored === admitted, { expected: admitted, observed: server.stored });
    },
  },

  {
    id: "heavy-route-burst",
    title: "A burst over the limit on the heavy calculation routes",
    hypothesis: "The heavy routes (/deals/scenarios, /sensitivity, /monte-carlo) share one allowance of 10 per 10 minutes per sender: the eleventh is refused with 429 and Retry-After on all three, the everyday calculator and /health are unaffected, and waiting as long as Retry-After says lets the sender back in.",
    blast_radius: "One API process on 127.0.0.1 with its limiters' clock stepped forward by the experiment. Every request has an empty body, so it is counted and refused by validation without any calculation. With --staging and approval it can run against a staging service (no clock step there).",
    abort_condition: "The API does not answer /health within 30 s, or the experiment runs past 45 s.",
    deadline_ms: 45_000,
    remote_safe: true,
    async run(ctx) {
      const server = ctx.remote ? ctx.remote : await ctx.start({ clock: true });
      const counted = [];
      for (let i = 0; i < 10; i += 1) counted.push(await ctx.request(server.url("/api/v1/deals/monte-carlo"), { method: "POST", json: {} }));
      ctx.check("the first ten are counted and refused by validation (422)", counted.every((a) => a.status === 422),
        { expected: "10 x 422", observed: counted.map((a) => a.status) });
      const refused = {};
      for (const route of ["monte-carlo", "scenarios", "sensitivity"]) {
        refused[route] = await ctx.request(server.url(`/api/v1/deals/${route}`), { method: "POST", json: {} });
      }
      const wait = Number(refused["monte-carlo"].headers["retry-after"]);
      ctx.measure("retry_after_seconds", wait);
      ctx.check("the eleventh is refused with 429 and Retry-After on all three heavy routes",
        Object.values(refused).every((a) => a.status === 429 && Number(a.headers["retry-after"]) >= 1 && Number(a.headers["retry-after"]) <= 600),
        { expected: "429 with Retry-After 1-600 on each", observed: Object.entries(refused).map(([r, a]) => `${r} ${short(a)} Retry-After ${a.headers["retry-after"]}`) });
      const analysis = await ctx.request(server.url("/api/v1/deals/analyze"), { method: "POST", json: DEAL });
      const health = await ctx.request(server.url("/health"));
      ctx.check("the everyday calculator and /health are unaffected", analysis.status === 200 && health.status === 200,
        { expected: "200 and 200", observed: `${analysis.status} and ${health.status}` });
      if (!ctx.canTimeTravel) {
        ctx.note("Recovery after Retry-After was not checked: this run cannot step the service's clock, and waiting ten minutes is not worth a staging slot.");
        return;
      }
      await ctx.advanceClock(wait);
      const back = await ctx.request(server.url("/api/v1/deals/monte-carlo"), { method: "POST", json: {} });
      ctx.check("after waiting as long as Retry-After said, the sender is let back in", back.status === 422, { expected: "422 (counted again)", observed: short(back) });
    },
  },
];
