// Browser entry for the status page. All the decisions are in render.mjs
// (tested with `node --test status-page/render.test.mjs`); this file only
// fetches the data files, asks render.mjs what to show, and writes it in.

import { buildView, loadData, renderSections } from "./render.mjs";

// How often to ask for new data, and how often to redraw from the data
// already held so that "4 minutes ago" and the stale warning keep up with the
// clock on a page left open.
const RELOAD_EVERY_MS = 2 * 60 * 1000;
const REDRAW_EVERY_MS = 30 * 1000;

let loaded = null;
const written = {};

function draw() {
  if (!loaded) return;
  const sections = renderSections(buildView(loaded, { now: Date.now() }));
  for (const [id, html] of Object.entries(sections)) {
    // Write only what changed. A screen reader announces the banner each
    // time it is rewritten, and an open "Updates" list would snap shut.
    if (written[id] === html) continue;
    const element = document.getElementById(id);
    if (!element) continue;
    element.innerHTML = html;
    written[id] = html;
  }
  document.getElementById("main").dataset.ready = "true";
}

async function reload() {
  loaded = await loadData((url, options) => fetch(url, options));
  draw();
}

reload();
setInterval(() => { if (!document.hidden) reload(); }, RELOAD_EVERY_MS);
setInterval(() => { if (!document.hidden) draw(); }, REDRAW_EVERY_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden) reload(); });
