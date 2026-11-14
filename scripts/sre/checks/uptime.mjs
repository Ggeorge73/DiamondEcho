// The pages of diamondecho.com and staff.diamondecho.com, as seen by an
// outside uptime service (UptimeRobot).
//
// Why not ask the pages ourselves: Cloudflare's Bot Fight Mode is on for the
// zone (Gbenga's decision, 2026-11-14), and it answers 403 to anything that
// comes from a cloud provider's network, GitHub's runners included. On the
// Free plan it cannot be skipped by a rule. It lets through the services on
// Cloudflare's verified-bot list, and UptimeRobot is on that list. So
// UptimeRobot loads each page every five minutes, and this module only reads
// UptimeRobot's verdicts, with a read-only key, from api.uptimerobot.com
// (not behind our Cloudflare). Nothing is sent to our own site from here.
//
// Each UptimeRobot monitor is NAMED AFTER THE CHECK it stands for
// ("public-home", "search-page", ...: the list is EXPECTED_MONITORS below,
// and the setup steps are in docs/sre/needs-from-gbenga.md 1.1). Its verdict
// is filed under that check's id, component, severity and SLIs, so the alert
// engine, the error budgets and the status page treat it exactly like a check
// the monitor made itself.
//
// What is filed:
//   up (2)                  the check passes, with UptimeRobot's last
//                           response time as its latency when it gives one
//   seems down (8), down (9) the check fails
//   paused (0), not checked yet (1), missing, or the wrong address
//                           no check is filed for that page (nothing was
//                           measured), and "uptime-service" fails, naming it
// "uptime-service" (sev3, feeds no SLO) says whether the service could be
// read and reported every page. When it fails, the pages are not being
// watched; their last results go stale and the status page says "unknown".
//
// Settings (environment): UPTIMEROBOT_API_KEY, the account's READ-ONLY API
// key (a GitHub secret). It is sent only in the body of the one request
// below and is never printed, filed or put in a check.
import { request, jsonOrNull } from "../lib/http.mjs";
import { makeCheck } from "../lib/schema.mjs";
import { PAGES } from "./pages.mjs";

export const suites = ["fast"];

export const UPTIME_API = "https://api.uptimerobot.com/v2/getMonitors";
export const SERVICE_NAME = "UptimeRobot";
// UptimeRobot's monitor states (API v2).
const UP = 2;
const DOWN = new Set([8, 9]);
const STATE_WORDS = { 0: "paused", 1: "not checked yet", 8: "seems down", 9: "down" };

const STAFF_SLIS = ["staff-availability"];

// One monitor per page. `name` is what the monitor must be called in
// UptimeRobot; `keyword` is the text a keyword monitor looks for (the steps in
// needs-from-gbenga.md give it), kept here so uptime.test.mjs can hold the
// steps and the code together.
export function expectedMonitors(targets) {
  const pages = PAGES.map((page) => ({
    id: page.id, name: page.name, component: page.component, severity: page.severity, slis: page.slis,
    url: targets.publicOrigin + page.path,
  }));
  return [
    ...pages,
    { id: "staff-home", name: "Staff site loads", component: "staff-site", severity: "sev2", slis: STAFF_SLIS, url: `${targets.staffOrigin}/` },
  ];
}

const sameAddress = (a, b) => String(a ?? "").trim().replace(/\/+$/, "").toLowerCase() === String(b ?? "").trim().replace(/\/+$/, "").toLowerCase();

// UptimeRobot's last response time for a monitor, in milliseconds, or null.
function lastResponseTime(monitor) {
  const value = Number(monitor?.response_times?.[0]?.value);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

// Pure: UptimeRobot's answer (parsed JSON) to the checks to file and the
// pages that could not be reported, each with a reason.
export function readMonitors(answer, targets) {
  const monitors = Array.isArray(answer?.monitors) ? answer.monitors : [];
  const checks = [];
  const unreported = [];
  for (const expected of expectedMonitors(targets)) {
    const monitor = monitors.find((item) => String(item?.friendly_name ?? "").trim() === expected.id);
    if (!monitor) { unreported.push(`${expected.id} (no monitor with this name)`); continue; }
    if (!sameAddress(monitor.url, expected.url)) { unreported.push(`${expected.id} (the monitor watches another address)`); continue; }
    const state = Number(monitor.status);
    if (state !== UP && !DOWN.has(state)) { unreported.push(`${expected.id} (${STATE_WORDS[state] ?? "state unknown"})`); continue; }
    const ok = state === UP;
    checks.push(makeCheck({
      id: expected.id, name: expected.name, component: expected.component, severity: expected.severity, slis: expected.slis,
      ok, status: null, latency_ms: ok ? lastResponseTime(monitor) : null, attempts: 1,
      detail: ok ? "" : `${SERVICE_NAME} reports this page ${STATE_WORDS[state]}: it did not load, or loaded without the text it must contain.`,
      observed: { source: "uptimerobot" },
    }));
  }
  return { checks, unreported };
}

const SERVICE_CHECK = { id: "uptime-service", name: "Uptime service reports every page", component: "public-site", severity: "sev3", slis: [] };
const NOT_WATCHED = "Until this is fixed the pages are not being watched (docs/sre/runbooks/monitoring-is-blind.md).";

export async function run(ctx) {
  // The monitor is loading the pages itself: nothing is reported twice.
  if (ctx.pageSource === "direct") return [];
  const key = String(ctx.env?.UPTIMEROBOT_API_KEY ?? "").trim();
  const service = (ok, detail, result = null, observed = {}) => makeCheck({
    ...SERVICE_CHECK, ok, status: result?.status ?? null, latency_ms: result?.latency_ms ?? null,
    attempts: Math.max(1, result?.attempts ?? 1), detail, observed,
  });
  if (!key) {
    return [service(false, `Monitor fault, not the site: the ${SERVICE_NAME} key is not set up (the secret UPTIMEROBOT_API_KEY, docs/sre/needs-from-gbenga.md 1.1). ${NOT_WATCHED}`)];
  }

  const body = new URLSearchParams({ api_key: key, format: "json", response_times: "1", response_times_limit: "1" }).toString();
  const result = await request(ctx, UPTIME_API, {
    method: "POST", body, retries: 1,
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
  });
  if (result.notTried) return [service(false, "Not tried: the module's time ran out.", result)];
  if (!result.answered) return [service(false, `${SERVICE_NAME} did not answer (${result.error}). ${NOT_WATCHED}`, result)];
  const answer = jsonOrNull(result.body);
  if (result.status !== 200 || answer?.stat !== "ok") {
    // Only the status and UptimeRobot's short error type are filed: its
    // message can repeat what was sent.
    const type = typeof answer?.error?.type === "string" && /^[a-z_]{1,40}$/.test(answer.error.type) ? `, ${answer.error.type}` : "";
    return [service(false, `${SERVICE_NAME} refused the read (HTTP ${result.status}${type}): check the read-only key. ${NOT_WATCHED}`, result)];
  }

  const { checks, unreported } = readMonitors(answer, ctx.targets);
  const total = expectedMonitors(ctx.targets).length;
  const observed = { monitors: String(checks.length), expected: String(total) };
  if (unreported.length) {
    const shown = unreported.slice(0, 4).join("; ");
    const more = unreported.length > 4 ? `; and ${unreported.length - 4} more` : "";
    return [...checks, service(false, `${SERVICE_NAME} did not report ${unreported.length} of ${total} pages: ${shown}${more}. Those pages are not being watched (docs/sre/needs-from-gbenga.md 1.1).`, result, observed)];
  }
  return [...checks, service(true, "", result, observed)];
}
