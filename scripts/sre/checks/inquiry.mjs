// The inquiry form: can a visitor reach the form, and would the service take
// what the form sends? Answered WITHOUT sending anything to the form's route.
//
// The rule (scripts/sre/README.md, rule 2): POST /api/v1/inquiries counts
// every well-formed attempt against 5 per 10 minutes per sender and 30 per
// hour per instance. A monitor that posts there every five minutes would use
// up visitors' allowance. So this module never POSTs. It asks four questions
// with GET and OPTIONS, none of which reaches the code that counts:
//
//   1. GET /inquire             the page loads and offers the form
//   2. OPTIONS /api/v1/inquiries the browser's permission question (the "CORS
//                               preflight") is answered by the CORS layer,
//                               before any route runs
//   3. GET /api/v1/inquiries     the route exists: the router answers
//                               "405, allowed: POST" from its route table and
//                               runs no handler and no dependency
//   4. GET /api/v1/inquiries/staff with no sign-in: 401 means the queue is
//                               switched on and configured; 503 means it is
//                               off and the form is turning visitors away
//
// backend/tests/test_monitor_probe.py proves that 2, 3 and 4 leave the
// limiter's counters untouched.
//
// What this cannot tell: whether a request would be stored. That is proven
// only by a real submission, which the arrival alert covers
// (docs/sre/runbooks/inquiry-not-delivered.md).
import { request, toCheck, firstProblem, expectStatus, expectBody } from "../lib/http.mjs";
import { pagesFor, checkPage, pagesElsewhere } from "./pages.mjs";

export const suites = ["fast", "post-deploy"];

const SLIS = ["inquiry-availability"];
export const INQUIRY_PATH = "/api/v1/inquiries";

// Class names in the saved /inquire page. The form's submit button carries
// FORM_MARKER (frontend/src/components/InquiryForm.jsx). A site built without
// the API's address shows a "call or email us" card instead, which carries
// CLOSED_MARKER (frontend/src/pages/Inquire.jsx). inquiry.test.mjs fails if
// either name leaves the source.
export const FORM_MARKER = "de-inquiry-submit";
export const CLOSED_MARKER = "de-inquiry-closed";

const listed = (value) => (value || "").toLowerCase().split(",").map((item) => item.trim());

export async function run(ctx) {
  const { apiOrigin, publicOrigin } = ctx.targets;
  const checks = [];

  // 1. The page, with the form in it.
  // (The page is on Cloudflare: when an uptime service loads the pages, its
  // keyword monitor looks for FORM_MARKER and checks/uptime.mjs reports it.)
  const [page] = pagesFor("inquiry");
  if (!pagesElsewhere(ctx)) checks.push((await checkPage(ctx, page, [
    expectBody((body) => !body.includes(CLOSED_MARKER), "The page shows the \"call or email us\" card instead of the form: the site was built without the API's address."),
    expectBody(FORM_MARKER, "The page came back without the request form."),
  ])).check());

  // 2. The preflight a browser sends before the form's POST.
  const preflight = await request(ctx, apiOrigin + INQUIRY_PATH, {
    method: "OPTIONS",
    headers: {
      Origin: publicOrigin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type,x-idempotency-key",
    },
  });
  checks.push(toCheck(
    { id: "inquiry-preflight", name: "Inquiry form is allowed to send from the website", component: "inquiry", severity: "sev2", slis: SLIS },
    preflight, firstProblem(preflight, [
      expectStatus(200),
      (result) => result.headers.get("access-control-allow-origin") === publicOrigin ? "" : "The API did not give the website permission to send the form (CORS).",
      (result) => listed(result.headers.get("access-control-allow-methods")).includes("post") ? "" : "The API does not allow the website to POST.",
      (result) => ["content-type", "x-idempotency-key"].every((name) => listed(result.headers.get("access-control-allow-headers")).includes(name))
        ? "" : "The API does not allow the headers the form sends.",
    ])));

  // 3. The route is there. GET is not POST: nothing is submitted or counted.
  const route = await request(ctx, apiOrigin + INQUIRY_PATH);
  checks.push(toCheck(
    { id: "inquiry-route", name: "Inquiry route exists", component: "inquiry", severity: "sev2", slis: SLIS },
    route, firstProblem(route, [
      (result) => result.status === 405 ? "" : `Answered ${result.status} to a GET; 405 is the sign that the route is there and takes POST only.`,
      (result) => listed(result.headers.get("allow")).includes("post") ? "" : "The route does not list POST as allowed.",
    ])));

  // 4. The queue is switched on. No Origin and no sign-in are sent.
  // Its body is read only for a 503, the one answer whose words matter: a
  // 200 here would be the queue itself, which the monitor must never hold.
  const queue = await request(ctx, `${apiOrigin}${INQUIRY_PATH}/staff`, { readWhen: (status) => status === 503 });
  checks.push(toCheck(
    { id: "inquiry-queue", name: "Inquiry queue is switched on", component: "inquiry", severity: "sev2", slis: SLIS },
    queue, firstProblem(queue, [
      // The service's own 503 says so in words; any other 503 is the platform's.
      (result) => result.status === 503 && /queue is not configured/i.test(result.body)
        ? "The queue is switched off or not configured: the form is answering visitors with \"unavailable\"." : "",
      expectStatus(401),
    ])));

  return checks;
}
