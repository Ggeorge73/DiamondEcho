// The public website: every page a visitor can land on, the "Page not found"
// answer, the www redirect, and the script and stylesheet the home page needs.
// All of it is GET, one request each, in order.
import { request, toCheck, notRun, firstProblem, expectStatus, expectType, expectBody, jsonOrNull, cloudflareRefused } from "../lib/http.mjs";

export const suites = ["fast", "post-deploy"];

const PUBLIC = ["public-availability", "public-latency"];

// Every public page, by address. This mirrors PAGES in
// frontend/src/lib/pageMeta.js (that file cannot be imported here: it is
// written for the site's bundler). pages.test.mjs reads pageMeta.js and fails
// when a page is added or removed there and not here.
//
// `module` is the check module that reports the page, so a failing calculator
// page is filed under "Intelligence calculators" and not under "Website".
export const PAGES = Object.freeze([
  { path: "/", module: "pages", id: "public-home", name: "Home page", component: "public-site", severity: "sev1", slis: PUBLIC },
  { path: "/agents", module: "pages", id: "public-page-agents", name: "Advisory page", component: "public-site", severity: "sev2", slis: PUBLIC },
  { path: "/about", module: "pages", id: "public-page-about", name: "About page", component: "public-site", severity: "sev2", slis: PUBLIC },
  { path: "/podcast", module: "pages", id: "public-page-podcast", name: "Podcast page", component: "public-site", severity: "sev3", slis: PUBLIC },
  { path: "/privacy", module: "pages", id: "public-page-privacy", name: "Privacy page", component: "public-site", severity: "sev3", slis: PUBLIC },
  { path: "/terms", module: "pages", id: "public-page-terms", name: "Terms of use page", component: "public-site", severity: "sev3", slis: PUBLIC },
  { path: "/search", module: "search", id: "search-page", name: "Property search page", component: "search", severity: "sev2", slis: PUBLIC },
  { path: "/investment-calculator", module: "calculators", id: "calculators-deal-page", name: "Deal Studio page", component: "calculators", severity: "sev2", slis: ["calculators-availability"] },
  { path: "/mortgage-calculator", module: "calculators", id: "calculators-mortgage-page", name: "Mortgage simulator page", component: "calculators", severity: "sev2", slis: ["calculators-availability"] },
  { path: "/seller-net-sheet", module: "calculators", id: "calculators-net-sheet-page", name: "Seller net sheet page", component: "calculators", severity: "sev2", slis: ["calculators-availability"] },
  { path: "/inquire", module: "inquiry", id: "inquiry-page", name: "Contact page", component: "inquiry", severity: "sev2", slis: ["inquiry-availability"] },
].map(Object.freeze));

export const pagesFor = (module) => PAGES.filter((page) => page.module === module);

// An address nobody will ever publish a page at.
export const UNKNOWN_PATH = "/sre-monitor-no-such-page";

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The build saves each page as its own HTML file with the page's one listed
// address in it (the "canonical" link). Finding that address proves the answer
// is this page, and not the empty shell or another page served in its place.
export const hasCanonical = (origin, path) => {
  const pattern = new RegExp(`<link[^>]+rel="canonical"[^>]+href="${escapeRegExp(origin + path)}"`);
  return (body) => pattern.test(body);
};

// One saved page: 200, HTML, its own canonical address, and a heading, which
// the empty shell does not have. `more` holds expectations of one page only.
export async function checkPage(ctx, page, more = []) {
  const result = await request(ctx, ctx.targets.publicOrigin + page.path);
  const problem = firstProblem(result, [
    expectStatus(200),
    expectType("text/html"),
    expectBody(hasCanonical(ctx.targets.publicOrigin, page.path), "The page came back without its own address in it: it may be the empty shell."),
    expectBody("<h1", "The page came back without a heading: its content was not saved by the build."),
    ...more,
  ]);
  const { id, name, component, severity, slis } = page;
  return { result, problem, check: (observed = {}) => toCheck({ id, name, component, severity, slis }, result, problem, observed) };
}

// The script and stylesheet the home page asks the browser to load. Their
// names change with every build, so they are read from the page, not kept here.
export function homeAssets(body) {
  const script = /<script[^>]+type="module"[^>]+src="(\/assets\/[A-Za-z0-9._-]+\.js)"/.exec(body);
  const style = /<link[^>]+rel="stylesheet"[^>]+href="(\/assets\/[A-Za-z0-9._-]+\.css)"/.exec(body);
  return { script: script ? script[1] : null, style: style ? style[1] : null };
}

// Which commit the site was built from. scripts/copy-build.mjs writes
// /version.json into the published folder. A site built before that file
// existed, or on someone's own machine, has no commit to report: that is not
// a failure, the fact is left out.
async function builtFrom(ctx) {
  const result = await request(ctx, `${ctx.targets.publicOrigin}/version.json`, { retries: 0 });
  if (!result.answered || result.status !== 200) return {};
  const commit = jsonOrNull(result.body)?.commit;
  return typeof commit === "string" && /^[0-9a-f]{7,40}$/.test(commit) ? { commit } : {};
}

async function checkAsset(ctx, base, path, types, missing) {
  if (!path) return notRun(base, missing);
  // The headers are enough to know the file is there and is what it says it
  // is; the body (hundreds of kilobytes) is not downloaded.
  const result = await request(ctx, ctx.targets.publicOrigin + path, { read: "none" });
  return toCheck(base, result, firstProblem(result, [expectStatus(200), expectType(...types)]));
}

export async function run(ctx) {
  const { publicOrigin, wwwOrigin } = ctx.targets;
  const checks = [];

  const [homePage, ...otherPages] = pagesFor("pages");
  const home = await checkPage(ctx, homePage);
  const assets = home.result.status === 200 ? homeAssets(home.result.body) : { script: null, style: null };
  checks.push(home.check(home.problem ? {} : await builtFrom(ctx)));

  for (const page of otherPages) checks.push((await checkPage(ctx, page)).check());

  // An unknown address must answer 404. If it answers 200, search engines
  // list pages that do not exist (launch audit finding F6).
  const unknown = await request(ctx, publicOrigin + UNKNOWN_PATH);
  checks.push(toCheck(
    { id: "public-not-found", name: "Unknown address answers Page not found", component: "public-site", severity: "sev3", slis: [] },
    unknown, firstProblem(unknown, [expectStatus(404), expectType("text/html")])));

  // www must send the visitor to the same page on the bare domain.
  const www = await request(ctx, `${wwwOrigin}/about`, { read: "none" });
  checks.push(toCheck(
    { id: "public-www-redirect", name: "www address redirects to the site", component: "public-site", severity: "sev2", slis: [] },
    www, firstProblem(www, [
      expectStatus(301),
      (result) => result.headers.get("location") === `${publicOrigin}/about` ? "" : "The redirect does not point at the same page on the bare domain.",
    ])));

  // Why the script and stylesheet could not be checked, when the home page
  // gave nothing to read them from.
  const homeFailed = cloudflareRefused(home.result)
    ? "The home page was refused by Cloudflare, so the file it asks for is not known. See docs/sre/runbooks/cloudflare-outage.md."
    : home.result.notTried ? "Not tried: the module's time ran out."
      : "The home page did not load, so the file it asks for is not known.";
  checks.push(await checkAsset(ctx,
    { id: "public-asset-js", name: "Site script loads", component: "public-site", severity: "sev1", slis: ["public-availability"] },
    assets.script, ["application/javascript", "text/javascript"],
    home.result.status === 200 ? "The home page names no script to load." : homeFailed));
  checks.push(await checkAsset(ctx,
    { id: "public-asset-css", name: "Site stylesheet loads", component: "public-site", severity: "sev2", slis: ["public-availability"] },
    assets.style, ["text/css"],
    home.result.status === 200 ? "The home page names no stylesheet to load." : homeFailed));

  return checks;
}
