// The staff site (where requests are read and acknowledged) and the staff
// part of the API. Nothing here signs in: the checks prove the page loads
// with its protections on, and that the API turns away a caller with no
// sign-in. GET only.
import { pagesNotAsked } from "./pages.mjs";
import { request, toCheck, firstProblem, expectStatus, expectType, expectHeader, expectBody } from "../lib/http.mjs";

export const suites = ["fast", "post-deploy"];

const SLIS = ["staff-availability"];

export async function run(ctx) {
  const { staffOrigin, apiOrigin } = ctx.targets;
  const checks = [];

  // The same three protections scripts/staging-smoke.mjs asks of staging: the
  // page is never stored, loads nothing from elsewhere by default, and cannot
  // be shown inside another site.
  // (The page is on Cloudflare, which turns the monitor away: it is not asked
  // for. Its three headers are then not checked by the monitor;
  // scripts/staging-smoke.mjs still checks them on staging.)
  const home = pagesNotAsked(ctx) ? null : await request(ctx, `${staffOrigin}/`);
  if (home) checks.push(toCheck(
    { id: "staff-home", name: "Staff site loads with its protections", component: "staff-site", severity: "sev2", slis: SLIS },
    home, firstProblem(home, [
      expectStatus(200),
      expectType("text/html"),
      expectBody((body) => body.toLowerCase().includes("<html"), "The answer is not a page."),
      expectHeader("cache-control", (value) => value.includes("no-store"), "expected no-store"),
      expectHeader("content-security-policy", (value) => value.includes("default-src 'none'"), "expected default-src 'none'"),
      expectHeader("x-frame-options", (value) => value.toUpperCase() === "DENY", "expected DENY"),
    ])));

  // Asked the way the staff page asks (with its own Origin) but with no
  // sign-in. 401 is the healthy answer. 200 would be a leak; 403 means the
  // API no longer knows the staff site's address; 503 means the queue is off.
  // The body is never read: if the route ever answered without a sign-in,
  // what it sent would be the queue itself, and the monitor must not hold it.
  const api = await request(ctx, `${apiOrigin}/api/v1/inquiries/staff`, { headers: { Origin: staffOrigin }, read: "none" });
  checks.push(toCheck(
    { id: "staff-api-auth", name: "Staff API asks for sign-in", component: "staff-site", severity: "sev2", slis: SLIS },
    api, firstProblem(api, [
      (result) => result.status === 200 ? "The staff API answered without a sign-in. Treat this as a security incident." : "",
      expectStatus(401),
      expectHeader("cache-control", (value) => value.includes("no-store"), "expected no-store"),
      (result) => result.headers.get("access-control-allow-origin") === staffOrigin ? "" : "The API did not give the staff site permission to read its answer (CORS).",
    ])));

  return checks;
}
