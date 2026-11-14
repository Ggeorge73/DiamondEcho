// Property search. Two different things are checked, at two different paces:
//
// - Every five minutes and after a merge: OUR page, /search, loads and has the
//   Georgia MLS search frame in it.
// - Once an hour: the Georgia MLS search itself answers and may still be shown
//   inside another site's page. It belongs to Georgia MLS, not to us, so it
//   gets one plain GET an hour with at most one retry, and a failure is sev3:
//   nothing here can fix it (docs/sre/runbooks/search-provider-down.md).
import { request, toCheck, firstProblem, expectStatus, expectType, expectBody } from "../lib/http.mjs";
import { pagesFor, checkPage, pagesElsewhere } from "./pages.mjs";

export const suites = ["fast", "slow", "post-deploy"];

// The address of the search inside the frame. The site's copy is
// GAMLS_SEARCH_URL in frontend/src/components/GamlsSearch.jsx;
// search.test.mjs fails when the two differ.
export const IDX_SEARCH_PATH = "/idxsearch/";

// Would a browser refuse to show this answer inside diamondecho.com? Two
// headers can say so. Returns "" when neither does.
export function framingProblem(headers, publicOrigin) {
  const frameOptions = (headers.get("x-frame-options") || "").trim().toLowerCase();
  if (frameOptions === "deny" || frameOptions === "sameorigin") return "Georgia MLS now forbids showing its search inside another site (X-Frame-Options).";
  const policy = (headers.get("content-security-policy") || "").toLowerCase();
  const ancestors = /(?:^|;)\s*frame-ancestors\s+([^;]*)/.exec(policy);
  if (ancestors) {
    const allowed = ancestors[1].trim().split(/\s+/);
    const host = new URL(publicOrigin).host;
    const permits = allowed.some((source) => source === "*" || source === "https:" || source === publicOrigin || source === host || source === `*.${host}`);
    if (!permits) return "Georgia MLS now limits which sites may show its search, and this site is not on the list (frame-ancestors).";
  }
  return "";
}

async function ourPage(ctx) {
  const [page] = pagesFor("search");
  const frame = ctx.targets.idxOrigin + IDX_SEARCH_PATH;
  return [(await checkPage(ctx, page, [
    expectBody(frame, "The page came back without the Georgia MLS search frame."),
  ])).check()];
}

async function provider(ctx) {
  // One attempt and one retry, no more: it is somebody else's server. This
  // check feeds no SLO, so a server error is tried once more too, to spare
  // Georgia MLS's support desk a report about a single hiccup.
  const result = await request(ctx, ctx.targets.idxOrigin + IDX_SEARCH_PATH, { read: "none", retries: 1, retryStatus: (status) => status >= 500 });
  return [toCheck(
    { id: "search-idx-provider", name: "Georgia MLS search (outside provider)", component: "search", severity: "sev3", slis: [] },
    result, firstProblem(result, [
      expectStatus(200),
      expectType("text/html"),
      (answer) => framingProblem(answer.headers, ctx.targets.publicOrigin),
    ]))];
}

export async function run(ctx) {
  if ((ctx.suite || "fast") === "slow") return provider(ctx);
  // Our own /search page is on Cloudflare: reported by checks/uptime.mjs.
  return pagesElsewhere(ctx) ? [] : ourPage(ctx);
}
