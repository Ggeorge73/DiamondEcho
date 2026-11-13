// The API on Cloud Run: is it up, which build is answering, does it let the
// website's pages call it and nobody else's, and is its route list still off.
// GET only.
import { request, toCheck, firstProblem, expectStatus, expectType, jsonOrNull } from "../lib/http.mjs";

// The route list (three more requests) only changes with a deploy or a
// setting, so it is looked at hourly and after a merge, not every five minutes.
export const suites = ["fast", "slow", "post-deploy"];

const API = ["api-availability", "api-latency"];

// An origin that is not on the API's list and never will be (.invalid cannot
// be registered).
export const STRANGER_ORIGIN = "https://sre-monitor.invalid";

// Only a value shaped like a revision name or a commit is passed on, so
// nothing else the route might one day say ends up in the status file.
const REVISION = /^[a-z][a-z0-9-]{0,62}$/;
const COMMIT = /^[0-9a-f]{7,40}$/;

export function identityFacts(body) {
  const facts = {};
  if (typeof body?.revision === "string" && REVISION.test(body.revision)) facts.revision = body.revision;
  if (typeof body?.commit === "string" && COMMIT.test(body.commit)) facts.commit = body.commit;
  return facts;
}

async function everyFiveMinutes(ctx) {
  const { apiOrigin, publicOrigin } = ctx.targets;
  const checks = [];

  // Liveness. /health, not /healthz: Cloud Run answers /healthz itself (DE-33).
  const health = await request(ctx, `${apiOrigin}/health`);
  checks.push(toCheck(
    { id: "api-health", name: "API is up", component: "api", severity: "sev2", slis: API },
    health, firstProblem(health, [
      expectStatus(200),
      (result) => jsonOrNull(result.body)?.status === "ok" ? "" : "The health route did not say ok.",
    ])));

  // Identity, asked the way the website's pages ask: with the site as Origin.
  // One request answers two questions: is this our service (and which build),
  // and does it allow the site to read the answer (CORS).
  const identity = await request(ctx, `${apiOrigin}/api/`, { headers: { Origin: publicOrigin } });
  const body = jsonOrNull(identity.body);
  const identityProblem = firstProblem(identity, [
    expectStatus(200),
    expectType("application/json"),
    () => body?.service === "DiamondEcho API" ? "" : "The answer does not name the DiamondEcho API.",
  ]);
  checks.push(toCheck(
    { id: "api-identity", name: "API identity", component: "api", severity: "sev2", slis: API },
    identity, identityProblem, identityProblem ? {} : identityFacts(body)));
  checks.push(toCheck(
    { id: "api-cors-allowed", name: "API accepts calls from the website", component: "api", severity: "sev2", slis: [] },
    identity, firstProblem(identity, [
      expectStatus(200),
      (result) => result.headers.get("access-control-allow-origin") === publicOrigin ? "" : "The API did not give the website permission to read its answer (CORS).",
    ])));

  const stranger = await request(ctx, `${apiOrigin}/api/`, { headers: { Origin: STRANGER_ORIGIN } });
  checks.push(toCheck(
    { id: "api-cors-refused", name: "API refuses calls from other sites", component: "api", severity: "sev3", slis: [] },
    stranger, firstProblem(stranger, [
      expectStatus(200),
      (result) => result.headers.get("access-control-allow-origin") === null ? "" : "The API gave an unknown site permission to read its answer (CORS).",
    ])));

  return checks;
}

// /docs, /redoc and /openapi.json publish the full route list unless switched
// off (launch audit finding F4). One check, three requests; the first one that
// is wrong is reported.
async function routeListOff(ctx) {
  const base = { id: "api-docs-off", name: "API route list is not published", component: "api", severity: "sev3", slis: [] };
  let last = null;
  for (const path of ["/docs", "/redoc", "/openapi.json"]) {
    last = await request(ctx, ctx.targets.apiOrigin + path, { read: "none" });
    const problem = firstProblem(last, [(result) => result.status === 404 ? "" : `${path} answered ${result.status}, expected 404.`]);
    if (problem) return [toCheck(base, last, problem)];
  }
  return [toCheck(base, last)];
}

export async function run(ctx) {
  const suite = ctx.suite || "fast";
  if (suite === "slow") return routeListOff(ctx);
  if (suite === "post-deploy") return [...await everyFiveMinutes(ctx), ...await routeListOff(ctx)];
  return everyFiveMinutes(ctx);
}
