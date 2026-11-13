// Edge behaviours: what Cloudflare does in front of the site that no page
// test notices. Plain http is sent on to https, the HTTPS-only header (HSTS)
// is there, www lands on the same page of the bare name, and Cloudflare has
// not put its analytics beacon back into the page (the Privacy page promises
// no analytics; docs/de13-production-setup.md records it being switched off).
// DNSSEC and CAA are reported for information and never fail.
//
// The strength of the security headers is checked daily by
// scripts/security-headers-check.mjs and is not repeated here.
import { makeCheck } from "../lib/schema.mjs";
import { request } from "../lib/http.mjs";
import { createAsker } from "./dns.mjs";

// A merge can change the headers file and the page, so these also run after
// a deploy.
export const suites = ["slow", "post-deploy"];

const REDIRECTS = [301, 302, 307, 308];
// The path asked of www, to prove a deep link keeps its page.
const WWW_PROBE_PATH = "/search";

// Scripts that would break the Privacy page's promise if they showed up in
// the page as served.
export const ANALYTICS_MARKERS = [
  { name: "the Cloudflare analytics beacon", pattern: /cloudflareinsights\.com|data-cf-beacon/i },
  { name: "a Google Analytics or Tag Manager script", pattern: /googletagmanager\.com|google-analytics\.com/i },
];
// Cloudflare's bot-detection script. Not analytics, but worth knowing about:
// it only appears while a bot setting such as Bot Fight Mode is on.
const BOT_SCRIPT = /\/cdn-cgi\/challenge-platform\//;

// Cloudflare's own refusal pages. A challenge carries the cf-mitigated
// header; a block ("Access denied", error 1010 and the like) does not, so the
// page itself is recognised. Only the four-digit error number is kept: the
// page also prints the requester's address, which must never be copied.
const BLOCK_PAGE = /used Cloudflare to restrict access|id="cf-error-details"|<title>Attention Required! \| Cloudflare/i;
const BLOCK_CODE = [/<span data-translate="error">Error<\/span>\s*<span>(\d{4})<\/span>/, /errorCode:\s*(\d{4})\b/];

// One read-only GET through lib/http.mjs: never follows a redirect, never
// throws, keeps a human pace, and tries once more when nothing came back.
// One retry, not lib/http.mjs's two: the three addresses are separate origins,
// so a hanging site would otherwise cost three full rounds and push the module
// past the runner's 90 s limit (synthetic-checks.mjs).
function get(ctx, url) {
  return request(ctx, url, { read: "text", retries: 1 });
}

// If Cloudflare answered in place of the site, one sentence saying so, and
// the error number for `observed`. The fault is then a Cloudflare setting,
// not the site (docs/sre/runbooks/cloudflare-outage.md).
export function cloudflareRefusal(result) {
  if (!result.answered) return null;
  const mitigated = result.headers.get("cf-mitigated");
  if (mitigated) {
    return { code: "challenge", text: `Cloudflare answered the monitor with a "${String(mitigated).replace(/[^a-z-]/gi, "").slice(0, 20)}" page instead of the site (status ${result.status}). A Cloudflare bot or firewall setting is stopping the monitor, and may stop real visitors too.` };
  }
  if (![403, 429, 503].includes(result.status) || !BLOCK_PAGE.test(result.body)) return null;
  const code = BLOCK_CODE.map((pattern) => pattern.exec(result.body)?.[1]).find(Boolean) ?? null;
  const which = code === "1010" ? " (error 1010: blocked for the browser signature, usually Browser Integrity Check)" : code ? ` (error ${code})` : "";
  return { code: code ?? "unknown", text: `Cloudflare refused the monitor with its own "Access denied" page, status ${result.status}${which}, instead of the site. A Cloudflare security setting is stopping the monitor, and may stop real visitors too.` };
}

function unreachable(result, what) {
  return `Could not reach ${what} (${result.error}), so this was not checked.`;
}

function baseOf(id, name, result) {
  return { id, name, component: "public-site", severity: "sev3", status: result.status, latency_ms: result.latency_ms, attempts: Math.max(1, result.attempts), slis: [] };
}

function redirectCheck({ id, name, result, from, to }) {
  const base = baseOf(id, name, result);
  if (!result.answered) return makeCheck({ ...base, ok: false, detail: unreachable(result, from) });
  const refused = cloudflareRefusal(result);
  if (refused) return makeCheck({ ...base, ok: false, detail: refused.text, observed: { "cloudflare-refusal": refused.code } });
  const location = result.headers.get("location") ?? "";
  if (!REDIRECTS.includes(result.status)) return makeCheck({ ...base, ok: false, detail: `${from} answered ${result.status} instead of redirecting to ${to}.` });
  // Compare without any query string, and never copy one into the detail.
  const target = location.split("?")[0].split("#")[0];
  if (target !== to) return makeCheck({ ...base, ok: false, detail: `${from} redirects to ${target.slice(0, 120) || "nowhere"}, not to ${to}.` });
  return makeCheck({ ...base, ok: true, detail: "" });
}

function hstsCheck(home, origin) {
  const base = baseOf("edge-hsts", "HTTPS-only header (HSTS)", home);
  if (!home.answered) return makeCheck({ ...base, ok: false, detail: unreachable(home, origin) });
  const refused = cloudflareRefusal(home);
  if (refused) return makeCheck({ ...base, ok: false, detail: refused.text, observed: { "cloudflare-refusal": refused.code } });
  const value = home.headers.get("strict-transport-security");
  const maxAge = Number(/max-age=(\d+)/i.exec(value ?? "")?.[1] ?? NaN);
  if (value === null) return makeCheck({ ...base, ok: false, detail: `${origin} answered ${home.status} without a Strict-Transport-Security header. Compare frontend/public/_headers with the live response.` });
  if (!(maxAge > 0)) return makeCheck({ ...base, ok: false, detail: `${origin} sends a Strict-Transport-Security header that switches the protection off (max-age ${Number.isNaN(maxAge) ? "missing" : maxAge}).` });
  return makeCheck({ ...base, ok: true, detail: "", observed: { "max-age": String(maxAge) } });
}

function analyticsCheck(home, origin) {
  const base = baseOf("edge-no-analytics-beacon", "No analytics script in the home page", home);
  if (!home.answered) return makeCheck({ ...base, ok: false, detail: unreachable(home, origin) });
  const refused = cloudflareRefusal(home);
  if (refused) return makeCheck({ ...base, ok: false, detail: refused.text, observed: { "cloudflare-refusal": refused.code } });
  if (home.status !== 200) return makeCheck({ ...base, ok: false, detail: `${origin} answered ${home.status}, so the page was not read.` });
  const found = ANALYTICS_MARKERS.filter((marker) => marker.pattern.test(home.body)).map((marker) => marker.name);
  const botScript = BOT_SCRIPT.test(home.body);
  const observed = { "bot-script": botScript ? "present" : "absent" };
  if (found.length) return makeCheck({ ...base, ok: false, observed, detail: `The home page as served contains ${found.join(" and ")}. The Privacy page says the site uses no analytics. At Cloudflare: Speed, Real User Monitoring, "Disable completely".` });
  return makeCheck({ ...base, ok: true, observed, detail: botScript ? "No analytics script. Cloudflare is adding its bot-detection script to the page (a bot setting such as Bot Fight Mode is on); see docs/sre/edge.md." : "" });
}

// DNSSEC and CAA are optional hardening. Their absence is worth one line on
// the report, never an incident.
async function informationCheck({ ask, now, id, name, domain, type, present, absent }) {
  const started = now();
  const answers = await ask(domain, type);
  const reachable = answers.filter((answer) => answer.reachable);
  const state = reachable.length === 0 ? "unknown" : reachable.some((answer) => answer.values.length > 0) ? "present" : "absent";
  const detail = { present, absent, unknown: `Neither resolver could be asked, so this is not known for this run. Information only.` }[state];
  return makeCheck({
    id, name, component: "dns", severity: "sev4", ok: true, detail,
    latency_ms: Math.max(0, now() - started), attempts: Math.max(...answers.map((answer) => answer.attempts)), slis: [],
    observed: { [id.replace("edge-", "")]: state },
  });
}

export async function run(ctx) {
  const { domain, publicOrigin, wwwOrigin } = ctx.targets;
  const ask = createAsker(ctx);
  // The two DNS questions go out first and are answered while the pages load.
  const dnssec = informationCheck({
    ask, now: ctx.now, id: "edge-dnssec", name: "DNSSEC (information)", domain, type: "DS",
    present: "DNSSEC is on: the registry holds a signing record for the domain.",
    absent: "DNSSEC is not switched on: DNS answers for the domain are not signed. Information only; see docs/sre/edge.md.",
  });
  const caa = informationCheck({
    ask, now: ctx.now, id: "edge-caa", name: "CAA record (information)", domain, type: "CAA",
    present: "A CAA record limits which authorities may issue certificates for the domain.",
    absent: "No CAA record: any certificate authority may issue for the domain. Information only; see docs/sre/edge.md.",
  });
  const plain = await get(ctx, `http://${domain}/`);
  const home = await get(ctx, `${publicOrigin}/`);
  const www = await get(ctx, `${wwwOrigin}${WWW_PROBE_PATH}`);
  return [
    redirectCheck({ id: "edge-http-redirect", name: "Plain http is sent to https", result: plain, from: `http://${domain}/`, to: `${publicOrigin}/` }),
    hstsCheck(home, publicOrigin),
    redirectCheck({ id: "edge-www-redirect", name: "www is sent to the bare name", result: www, from: `${wwwOrigin}${WWW_PROBE_PATH}`, to: `${publicOrigin}${WWW_PROBE_PATH}` }),
    analyticsCheck(home, publicOrigin),
    await dnssec,
    await caa,
  ];
}
