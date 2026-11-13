// The public status page's logic, as pure functions: data in, text out.
// The browser entry (status.js) fetches four JSON files, hands them to
// buildView and writes renderSections' strings into the page. Node imports
// this same file for the tests (render.test.mjs), so nothing here touches the
// document, the network or the clock: `now` and `fetch` are passed in.
//
// The data shapes are the contract in scripts/sre/README.md. The page shows
// only what those files say. Where a file is missing it says so; it never
// fills a gap with a number or a state that was not measured.

// The fast checks run every 5 minutes, but GitHub starts scheduled jobs late
// when it is busy and GitHub Pages serves a file for up to 10 minutes after
// it changes. Half an hour without a new result is past both delays, so from
// then on the page stops presenting the last result as the current state.
export const STALE_AFTER_MINUTES = 30;
export const DAYS_SHOWN = 90;
export const RECENT_INCIDENT_DAYS = 30;
// A day is drawn in the stronger colour when this share of its runs failed:
// 2% of a day checked every 5 minutes is about half an hour.
export const MAJOR_DAY_SHARE = 0.02;

// The files the page reads, relative to its own folder on the sre-status
// branch.
export const DATA_FILES = {
  status: "status.json",
  uptime: "uptime/daily.json",
  incidents: "incidents.json",
  slo: "slo.json",
};

// A copy of COMPONENTS in scripts/sre/lib/schema.mjs, which is not published
// with the page. It gives the display order, and a name when status.json has
// not been loaded. render.test.mjs fails if the two drift apart.
export const COMPONENT_NAMES = {
  "public-site": "Website",
  search: "Property search",
  calculators: "Intelligence calculators",
  inquiry: "Inquiry form",
  api: "API",
  "staff-site": "Staff site",
  dns: "DNS",
  tls: "TLS certificates",
  domain: "Domain registration",
};

// Incidents may name parts that are not components on the page. The alert
// engine (scripts/sre/alert-policy.mjs, MONITORING) opens a "monitoring"
// incident when the monitor itself cannot see the site.
const INCIDENT_ONLY_NAMES = {
  monitoring: "Monitoring",
};

const STATE_LABELS = {
  operational: "Operational",
  degraded: "Degraded",
  outage: "Outage",
  unknown: "Unknown",
};

// Severity in words a visitor understands. The definitions are in
// docs/sre/severity-and-escalation.md.
const SEVERITY_LABELS = {
  sev1: "Major outage",
  sev2: "Partial outage",
  sev3: "Minor problem",
  sev4: "Notice",
};

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

// ---------------------------------------------------------------- loading

// Fetch the four data files. A 404 means "not written yet" and is a normal
// state on a new branch; anything else that fails is an error. Never throws.
export async function loadData(fetchFn, files = DATA_FILES) {
  const entries = await Promise.all(
    Object.entries(files).map(async ([key, url]) => [key, await loadOne(fetchFn, url)]),
  );
  return Object.fromEntries(entries);
}

async function loadOne(fetchFn, url) {
  try {
    const response = await fetchFn(url, { cache: "no-store" });
    if (response.status === 404) return { state: "missing" };
    if (!response.ok) return { state: "error" };
    const data = await response.json();
    return isObject(data) ? { state: "ok", data } : { state: "error" };
  } catch {
    return { state: "error" };
  }
}

// ------------------------------------------------------------- formatting

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseTime(value) {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function text(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

// "Nov 13, 2026, 12:05 AM UTC". With no timeZone the reader's own zone is
// used, and named, so the time can be compared with a clock on the wall.
export function formatDateTime(time, { timeZone, locale = "en-US" } = {}) {
  const formatted = formatter(locale, {
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone,
  }).format(new Date(time));
  // Some browsers put a narrow no-break space before AM/PM. A plain space
  // reads the same and keeps the text identical everywhere.
  return formatted.replace(/[  ]/g, " ");
}

// A UTC day key ("2026-11-12") as "Nov 12, 2026". Uptime days are UTC days.
export function formatDay(day, { locale = "en-US" } = {}) {
  return formatter(locale, {
    year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

// Building a date formatter is slow and the page formats some 800 days on
// every redraw, so each distinct formatter is built once and kept.
const formatters = new Map();
function formatter(locale, options) {
  const key = JSON.stringify([locale, options]);
  if (!formatters.has(key)) formatters.set(key, new Intl.DateTimeFormat(locale, options));
  return formatters.get(key);
}

function plural(count, word) {
  return `${formatCount(count)} ${word}${count === 1 ? "" : "s"}`;
}

const counts = new Intl.NumberFormat("en-US");
export function formatCount(count) {
  return counts.format(count);
}

export function formatAge(milliseconds) {
  const minutes = Math.floor(Math.max(0, milliseconds) / MINUTE);
  if (minutes < 1) return "less than a minute ago";
  if (minutes < 60) return `${plural(minutes, "minute")} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${plural(hours, "hour")} ago`;
  return `${plural(Math.floor(hours / 24), "day")} ago`;
}

export function formatDuration(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0) return null;
  const whole = Math.round(minutes);
  if (whole < 1) return "less than a minute";
  if (whole < 60) return plural(whole, "minute");
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours < 24) return rest ? `${plural(hours, "hour")} ${plural(rest, "minute")}` : plural(hours, "hour");
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${plural(days, "day")} ${plural(restHours, "hour")}` : plural(days, "day");
}

// A share as a percentage that never rounds a failure away: 8,417 of 8,418
// is "99.98%", not "100%". Only a clean record reads "100%".
export function formatShare(good, total) {
  if (!Number.isFinite(good) || !Number.isFinite(total) || total <= 0 || good < 0 || good > total) return null;
  if (good === total) return "100%";
  return `${(Math.floor((good * 10000) / total) / 100).toFixed(2)}%`;
}

function formatTarget(target) {
  if (!Number.isFinite(target) || target <= 0 || target > 1) return null;
  return `${Number((target * 100).toFixed(3))}%`;
}

function dayKey(time) {
  return new Date(time).toISOString().slice(0, 10);
}

// ------------------------------------------------------------- the view

// Turn the loaded files into everything the page shows. `loaded` is the
// result of loadData; `now` is the current time in milliseconds.
export function buildView(loaded, { now, timeZone, locale } = {}) {
  if (!Number.isFinite(now)) throw new Error("buildView needs the current time");
  const format = { timeZone, locale };
  const status = readStatus(loaded?.status);
  const checkedAt = status.ok ? status.checkedAt : null;
  const age = checkedAt === null ? null : Math.max(0, now - checkedAt);

  let mode = "live";
  if (status.problem === "missing") mode = "no-data";
  else if (!status.ok) mode = "error";
  else if (age > STALE_AFTER_MINUTES * MINUTE) mode = "stale";

  const names = { ...INCIDENT_ONLY_NAMES, ...COMPONENT_NAMES, ...(status.ok ? status.names : {}) };
  const uptime = readUptime(loaded?.uptime);
  const components = status.ok
    ? status.components.map((component) => ({
      ...describeComponent(component, mode, format),
      history: describeHistory(uptime, component.key, now, format),
    }))
    : [];

  return {
    mode,
    banner: describeBanner(mode, status, checkedAt, format),
    updated: checkedAt === null ? null : {
      iso: new Date(checkedAt).toISOString(),
      text: formatDateTime(checkedAt, format),
      age: formatAge(age),
    },
    components,
    history: {
      daysShown: DAYS_SHOWN,
      state: uptime.state,
      firstDay: uptime.firstDay && uptime.firstDay > dayKey(now - (DAYS_SHOWN - 1) * DAY)
        ? { day: uptime.firstDay, text: formatDay(uptime.firstDay, format) } : null,
    },
    incidents: describeIncidents(loaded?.incidents, names, now, mode, format),
    reliability: describeReliability(loaded?.slo, format),
  };
}

function readStatus(loaded) {
  if (!loaded || loaded.state === "missing") return { ok: false, problem: "missing" };
  if (loaded.state !== "ok" || !isObject(loaded.data)) return { ok: false, problem: "error" };
  const data = loaded.data;
  if (data.schema !== 1 || !isObject(data.components)) return { ok: false, problem: "format" };

  // The fast checks are the ones that say whether visitors can use the site,
  // so their last run decides how fresh the page is. Before the first fast
  // run, the file's own time is the best there is.
  const checkedAt = parseTime(data.last_runs?.fast?.at) ?? parseTime(data.updated_at);
  if (checkedAt === null) return { ok: false, problem: "format" };
  // state.mjs marks a run "blind" when the monitor reached nothing at all,
  // not even outside services: its own network failed, so that run measured
  // nothing about the site and the states still come from earlier runs.
  const blind = data.last_runs?.fast?.blind === true;

  const names = {};
  const components = [];
  for (const [key, value] of Object.entries(data.components)) {
    if (!isObject(value)) continue;
    const name = text(value.name, COMPONENT_NAMES[key] ?? key);
    names[key] = name;
    components.push({
      key, name,
      state: Object.hasOwn(STATE_LABELS, value.state) ? value.state : "unknown",
      since: parseTime(value.since),
    });
  }
  const order = Object.keys(COMPONENT_NAMES);
  const rank = (key) => (order.includes(key) ? order.indexOf(key) : order.length);
  components.sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));

  // Trust the file's own summary when it is valid; otherwise take the worst
  // component state, so a malformed summary cannot read as "all working".
  const worst = ["outage", "degraded", "unknown", "operational"].find((state) => components.some((component) => component.state === state));
  const overall = Object.hasOwn(STATE_LABELS, data.overall) ? data.overall : (worst ?? "unknown");
  return { ok: true, checkedAt, overall, components, names, blind };
}

function describeComponent(component, mode, format) {
  const since = component.since === null ? null : {
    iso: new Date(component.since).toISOString(),
    text: formatDateTime(component.since, format),
  };
  // Stale data cannot say what the state is now, only what it last was.
  if (mode === "stale") {
    return {
      key: component.key, name: component.name, state: "unknown", label: STATE_LABELS.unknown,
      note: `Last known state: ${STATE_LABELS[component.state]}`, since: null,
    };
  }
  return {
    key: component.key, name: component.name, state: component.state, label: STATE_LABELS[component.state],
    note: component.state === "unknown" ? "No monitoring result yet" : null, since,
  };
}

function describeBanner(mode, status, checkedAt, format) {
  if (mode === "no-data") {
    return {
      tone: "unknown", title: "No monitoring data yet",
      lines: ["Monitoring has not published a result yet. This page fills in when it does."],
    };
  }
  if (mode === "error") {
    return {
      tone: "unknown", title: "Status data could not be loaded",
      lines: [
        status.problem === "format"
          ? "The status data is in a form this page does not understand."
          : "Reload the page in a few minutes.",
        "This says nothing about whether the website itself is working.",
      ],
    };
  }
  if (mode === "stale") {
    return {
      tone: "unknown", title: "Monitoring data is stale",
      lines: [
        `The last monitoring result arrived on ${formatDateTime(checkedAt, format)}. Nothing newer has been published.`,
        "The states below are the last known ones and may be out of date.",
      ],
    };
  }
  const named = (state) => status.components.filter((component) => component.state === state).map((component) => component.name);
  const lines = [];
  if (named("outage").length) lines.push(`Down: ${named("outage").join(", ")}.`);
  if (named("degraded").length) lines.push(`Degraded: ${named("degraded").join(", ")}.`);
  if (named("unknown").length) lines.push(`No current result for: ${named("unknown").join(", ")}.`);
  if (status.blind) {
    lines.push("The latest automatic check could not reach anything, including outside services, so it says nothing about the website. The states shown come from earlier checks.");
  }
  const titles = {
    operational: "All services are working",
    degraded: "Some services are degraded",
    outage: "There is an outage",
    unknown: "The current state is not known",
  };
  return { tone: status.overall, title: titles[status.overall], lines };
}

// ----------------------------------------------------------- day history

function readUptime(loaded) {
  if (!loaded || loaded.state === "missing") return { state: "missing", components: {}, firstDay: null };
  if (loaded.state !== "ok" || !isObject(loaded.data)) return { state: "error", components: {}, firstDay: null };
  const source = isObject(loaded.data.components) ? loaded.data.components : loaded.data;
  const components = {};
  let firstDay = null;
  for (const [key, days] of Object.entries(source)) {
    if (!isObject(days)) continue;
    components[key] = {};
    for (const [day, entry] of Object.entries(days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !validDay(entry)) continue;
      components[key][day] = { runs: entry.runs, failed: entry.failed };
      if (firstDay === null || day < firstDay) firstDay = day;
    }
  }
  return { state: "ok", components, firstDay };
}

function validDay(entry) {
  return isObject(entry) && Number.isInteger(entry.runs) && entry.runs > 0
    && Number.isInteger(entry.failed) && entry.failed >= 0 && entry.failed <= entry.runs;
}

// One day's level for the bar: "none" (no runs recorded), "ok", "minor" or
// "major".
export function dayLevel(entry) {
  if (!validDay(entry)) return "none";
  if (entry.failed === 0) return "ok";
  return entry.failed / entry.runs >= MAJOR_DAY_SHARE ? "major" : "minor";
}

function describeHistory(uptime, key, now, format) {
  if (uptime.state !== "ok") return { state: uptime.state, days: [], problemDays: [], summary: null, label: null };
  const recorded = uptime.components[key] ?? {};
  const days = [];
  const problemDays = [];
  let runs = 0;
  let failed = 0;
  let daysWithData = 0;
  for (let back = DAYS_SHOWN - 1; back >= 0; back -= 1) {
    const day = dayKey(now - back * DAY);
    const entry = recorded[day];
    const level = dayLevel(entry);
    const dayText = formatDay(day, format);
    let title = `${dayText}: no data`;
    if (level !== "none") {
      runs += entry.runs;
      failed += entry.failed;
      daysWithData += 1;
      title = entry.failed === 0
        ? `${dayText}: no failed runs (${plural(entry.runs, "run")})`
        : `${dayText}: ${formatCount(entry.failed)} of ${plural(entry.runs, "run")} failed`;
      if (entry.failed > 0) problemDays.push({ day, level, text: title });
    }
    days.push({ day, level, title });
  }
  problemDays.reverse();
  if (daysWithData === 0) {
    return { state: "empty", days, problemDays, summary: null, label: `Last ${DAYS_SHOWN} days: no data yet.` };
  }
  const summary = `${formatCount(runs - failed)} of ${plural(runs, "monitoring run")} passed (${formatShare(runs - failed, runs)}) on ${plural(daysWithData, "day")} with data in the last ${DAYS_SHOWN} days.`;
  const label = `Last ${DAYS_SHOWN} days: ${plural(daysWithData, "day")} with data, ${
    problemDays.length ? `${plural(problemDays.length, "day")} with failed runs, most recently ${formatDay(problemDays[0].day, format)}` : "no days with failed runs"
  }.`;
  return { state: "ok", days, problemDays, summary, label };
}

// -------------------------------------------------------------- incidents

function describeIncidents(loaded, names, now, mode, format) {
  if (!loaded || loaded.state === "missing") return { state: "missing", open: [], recent: [] };
  if (loaded.state !== "ok" || !isObject(loaded.data)) return { state: "error", open: [], recent: [] };
  const describe = (incident) => {
    const opened = parseTime(incident.opened_at);
    const resolved = parseTime(incident.resolved_at);
    const updates = (Array.isArray(incident.updates) ? incident.updates : [])
      .filter((update) => isObject(update) && text(update.text) && parseTime(update.at) !== null)
      .map((update) => ({ time: parseTime(update.at), iso: new Date(parseTime(update.at)).toISOString(), at: formatDateTime(parseTime(update.at), format), text: text(update.text) }))
      .sort((a, b) => b.time - a.time);
    return {
      title: text(incident.title, "Incident"),
      component: names[incident.component] ?? text(incident.component, "Service"),
      severity: SEVERITY_LABELS[incident.severity] ?? null,
      // Only a known severity becomes a class name.
      level: Object.hasOwn(SEVERITY_LABELS, incident.severity) ? incident.severity : null,
      opened: opened === null ? null : { time: opened, iso: new Date(opened).toISOString(), text: formatDateTime(opened, format) },
      resolved: resolved === null ? null : { time: resolved, iso: new Date(resolved).toISOString(), text: formatDateTime(resolved, format) },
      duration: formatDuration(incident.duration_minutes),
      updates,
    };
  };
  const list = (value) => (Array.isArray(value) ? value.filter(isObject).map(describe) : []);
  const open = list(loaded.data.open).sort((a, b) => (b.opened?.time ?? 0) - (a.opened?.time ?? 0));
  const recent = list(loaded.data.recent)
    .filter((incident) => incident.resolved && incident.resolved.time >= now - RECENT_INCIDENT_DAYS * DAY)
    .sort((a, b) => b.resolved.time - a.resolved.time);
  return { state: "ok", stale: mode === "stale", open, recent, recentDays: RECENT_INCIDENT_DAYS };
}

// ------------------------------------------------------------ reliability

function describeReliability(loaded, format) {
  if (!loaded || loaded.state === "missing") return { state: "missing", items: [] };
  if (loaded.state !== "ok" || !isObject(loaded.data) || !Array.isArray(loaded.data.slos)) return { state: "error", items: [] };
  const generated = parseTime(loaded.data.generated_at);
  const items = loaded.data.slos.filter(isObject).map((slo) => {
    const share = slo.enough_data === true ? formatShare(slo.good, slo.total) : null;
    return {
      name: text(slo.name, text(slo.id, "Measure")),
      share,
      counts: share ? `${formatCount(slo.good)} of ${formatCount(slo.total)} measurements were good` : null,
      // A target is shown only once Gbenga has accepted it. Until then it is
      // a proposal, and a public page must not present it as a promise.
      target: slo.accepted === true ? formatTarget(slo.target) : null,
    };
  });
  return {
    state: "ok", items,
    windowDays: Number.isInteger(loaded.data.window_days) && loaded.data.window_days > 0 ? loaded.data.window_days : null,
    generated: generated === null ? null : { iso: new Date(generated).toISOString(), text: formatDateTime(generated, format) },
  };
}

// --------------------------------------------------------------- the HTML

const ICONS = {
  operational: '<path d="M6 12.5l4 4 8-9"/>',
  degraded: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  outage: '<path d="M7 7l10 10M17 7L7 17"/>',
  unknown: '<path d="M9 9.5a3 3 0 1 1 4.2 2.7c-.8.4-1.2 1-1.2 1.8M12 17.5v.01"/>',
};

function icon(state) {
  return `<svg class="icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[state] ?? ICONS.unknown}</svg>`;
}

function time(stamp) {
  return `<time datetime="${escapeHtml(stamp.iso)}">${escapeHtml(stamp.text)}</time>`;
}

// The page's sections as HTML strings, keyed by the id of the element each
// one fills. Every value that came from a data file passes through
// escapeHtml; the page's Content-Security-Policy is the second line of
// defence.
export function renderSections(view) {
  return {
    banner: renderBanner(view),
    updated: renderUpdated(view),
    incidents: renderOpenIncidents(view),
    components: renderComponents(view),
    reliability: renderReliability(view),
    history: renderRecentIncidents(view),
  };
}

function renderBanner(view) {
  const { tone, title, lines } = view.banner;
  return `<div class="banner banner--${tone}">${icon(tone)}<div><p class="banner__title">${escapeHtml(title)}</p>${
    lines.map((line) => `<p class="banner__line">${escapeHtml(line)}</p>`).join("")
  }</div></div>`;
}

function renderUpdated(view) {
  if (!view.updated) return "";
  return `Last monitoring result: ${time(view.updated)} <span class="updated__age">(${escapeHtml(view.updated.age)})</span>`;
}

function renderUpdates(updates) {
  if (!updates.length) return "";
  return `<ol class="updates">${updates.map((update) => `<li><p class="updates__time">${time({ iso: update.iso, text: update.at })}</p><p>${escapeHtml(update.text)}</p></li>`).join("")}</ol>`;
}

function renderIncidentHead(incident) {
  const facts = [incident.severity, incident.component].filter(Boolean).map(escapeHtml);
  return `<h3 class="incident__title">${escapeHtml(incident.title)}</h3><p class="incident__facts">${facts.join(" · ")}</p>`;
}

function renderOpenIncidents(view) {
  const { incidents } = view;
  if (incidents.state === "missing") return '<p class="empty">No incident data yet.</p>';
  if (incidents.state === "error") return '<p class="empty">Incident data could not be loaded.</p>';
  if (!incidents.open.length) {
    return `<p class="empty">${incidents.stale ? "No open incidents in the last data received." : "No open incidents."}</p>`;
  }
  return incidents.open.map((incident) => `<article class="incident incident--open${incident.level ? ` incident--${incident.level}` : ""}">${renderIncidentHead(incident)}${
    incident.opened ? `<p class="incident__when">Started ${time(incident.opened)}</p>` : ""
  }${renderUpdates(incident.updates)}</article>`).join("");
}

function renderRecentIncidents(view) {
  const { incidents } = view;
  if (incidents.state === "missing") return '<p class="empty">No incident data yet.</p>';
  if (incidents.state === "error") return '<p class="empty">Incident data could not be loaded.</p>';
  if (!incidents.recent.length) return `<p class="empty">No resolved incidents on record in the last ${incidents.recentDays} days.</p>`;
  return incidents.recent.map((incident) => {
    const when = [
      `Resolved ${time(incident.resolved)}`,
      incident.duration ? `lasted ${escapeHtml(incident.duration)}` : null,
    ].filter(Boolean).join(" · ");
    const updates = incident.updates.length
      ? `<details><summary>Updates (${incident.updates.length})</summary>${renderUpdates(incident.updates)}</details>` : "";
    return `<article class="incident">${renderIncidentHead(incident)}<p class="incident__when">${when}</p>${updates}</article>`;
  }).join("");
}

function renderHistory(history, daysShown) {
  if (history.state === "missing") return '<p class="history__note">No day-by-day history yet.</p>';
  if (history.state === "error") return '<p class="history__note">Day-by-day history could not be loaded.</p>';
  const cells = history.days.map((day) => `<span class="day day--${day.level}" title="${escapeHtml(day.title)}"></span>`).join("");
  const bar = `<div class="days" role="img" aria-label="${escapeHtml(history.label)}">${cells}</div>`
    + `<p class="days__axis" aria-hidden="true"><span class="days__from days__from--all">${daysShown} days ago</span><span class="days__from days__from--short">30 days ago</span><span>Today</span></p>`;
  if (history.state === "empty") return `${bar}<p class="history__note">No day-by-day history yet.</p>`;
  const problems = history.problemDays.length
    ? `<details><summary>Days with failed runs (${history.problemDays.length})</summary><ul class="problem-days">${
      history.problemDays.map((day) => `<li>${escapeHtml(day.text)}</li>`).join("")
    }</ul></details>` : "";
  return `${bar}<p class="history__note">${escapeHtml(history.summary)}</p>${problems}`;
}

function renderComponents(view) {
  if (!view.components.length) return '<p class="empty">No services to show yet.</p>';
  const items = view.components.map((component) => {
    const notes = [
      component.note ? escapeHtml(component.note) : null,
      component.since && component.state !== "unknown" ? `Since ${time(component.since)}` : null,
    ].filter(Boolean).join(" · ");
    return `<li class="component component--${component.state}"><div class="component__head"><h3 class="component__name">${escapeHtml(component.name)}</h3><p class="state state--${component.state}">${icon(component.state)}<span>${escapeHtml(component.label)}</span></p></div>${
      notes ? `<p class="component__note">${notes}</p>` : ""
    }${renderHistory(component.history, view.history.daysShown)}</li>`;
  }).join("");
  const firstDay = view.history.firstDay ? ` Monitoring records begin on ${escapeHtml(view.history.firstDay.text)}.` : "";
  const legend = view.history.state === "ok"
    ? `<p class="legend"><span class="legend__item"><span class="day day--ok"></span>No failed runs</span><span class="legend__item"><span class="day day--minor"></span>Some failed runs</span><span class="legend__item"><span class="day day--major"></span>${MAJOR_DAY_SHARE * 100}% or more of the day's runs failed</span><span class="legend__item"><span class="day day--none"></span>No data</span></p><p class="legend__text">Each bar is one day, counted in UTC. A run is one automatic check of the service from outside.${firstDay}</p>`
    : "";
  return `<ul class="components">${items}</ul>${legend}`;
}

function renderReliability(view) {
  const { reliability } = view;
  if (reliability.state === "missing") return '<p class="empty">Not measured yet.</p>';
  if (reliability.state === "error") return '<p class="empty">Reliability figures could not be loaded.</p>';
  if (!reliability.items.length) return '<p class="empty">Not measured yet.</p>';
  const intro = [
    reliability.windowDays ? `Measured over the last ${reliability.windowDays} days.` : null,
    reliability.generated ? `Calculated ${time(reliability.generated)}.` : null,
  ].filter(Boolean).join(" ");
  const rows = reliability.items.map((item) => `<li class="measure"><span class="measure__name">${escapeHtml(item.name)}</span>${
    item.share
      ? `<span class="measure__value">${escapeHtml(item.share)}</span><span class="measure__detail">${escapeHtml(item.counts)}${item.target ? `. Target: ${escapeHtml(item.target)}` : ""}</span>`
      : '<span class="measure__value measure__value--none">Not enough data yet</span>'
  }</li>`).join("");
  return `${intro ? `<p class="section__intro">${intro}</p>` : ""}<ul class="measures">${rows}</ul>`;
}
