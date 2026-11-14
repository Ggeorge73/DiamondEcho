// Reads the JSON that `gcloud run ... --format json` prints, for status.sh,
// rollback.sh and deploy.sh. The shell scripts do the talking to Google Cloud;
// everything that has to understand an answer is here, as plain functions, so
// it can be tested without Google Cloud (lib.test.mjs).
//
// Nothing here prints a setting's value. A service description holds the
// environment variable values (docs/de13-production-setup.md says so of the
// files left in Cloud Shell), so a difference is reported by name only.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Which revisions answer visitors now, and with what share. Entries with no
// share (a tagged candidate at 0 percent) are left out; two entries for the
// same revision are added together.
export function servingOf(service) {
  const shares = new Map();
  for (const entry of service?.status?.traffic ?? []) {
    const percent = Number(entry.percent ?? 0);
    if (!entry.revisionName || !(percent > 0)) continue;
    shares.set(entry.revisionName, (shares.get(entry.revisionName) ?? 0) + percent);
  }
  return [...shares].map(([revision, percent]) => ({ revision, percent })).sort((a, b) => b.percent - a.percent);
}

export function revisionReady(revision) {
  return (revision?.status?.conditions ?? []).some((condition) => condition.type === "Ready" && condition.status === "True");
}

// The container image a revision runs: the same image means the same code,
// so a revision that differs from the one before only in settings can be told
// apart (remediation-policy.mjs uses it). "" when Cloud Run does not say.
export function imageOf(revision) {
  const image = revision?.spec?.containers?.[0]?.image;
  return typeof image === "string" ? image : "";
}

// The value of APP_COMMIT a revision was given, or "".
export function appCommitOf(revision) {
  const entry = (revision?.spec?.containers?.[0]?.env ?? []).find((item) => item?.name === "APP_COMMIT");
  return typeof entry?.value === "string" && /^[0-9a-f]{7,40}$/.test(entry.value) ? entry.value : "";
}

// A short fingerprint of every setting of a revision except the image and
// APP_COMMIT (the same list settingsDiff compares). Two revisions with the
// same fingerprint differ at most in code; a different fingerprint means a
// setting changed. One-way: it reveals no value.
export function settingsFingerprint(revision) {
  const entries = [...settingsOf(revision)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex").slice(0, 16);
}

// Every traffic tag and the revision behind it. A "candidate" tag means a
// deploy is in progress (or was left behind by one).
export function tagsOf(service) {
  return (service?.status?.traffic ?? [])
    .filter((entry) => typeof entry?.tag === "string" && entry.tag)
    .map((entry) => ({ tag: entry.tag, revision: entry.revisionName ?? "" }));
}

// The document status.sh prints (shape fixed by scripts/sre/README.md:
// serving, tags, and the revisions with their image and settings
// fingerprint). Revisions are newest first.
export function statusDocument(service, revisions) {
  return {
    serving: servingOf(service),
    tags: tagsOf(service),
    revisions: [...(revisions ?? [])]
      .map((revision) => ({
        name: revision?.metadata?.name ?? "",
        created: revision?.metadata?.creationTimestamp ?? "",
        ready: revisionReady(revision),
        image: imageOf(revision),
        settings: settingsFingerprint(revision),
      }))
      .filter((revision) => revision.name)
      .sort((a, b) => (a.created < b.created ? 1 : a.created > b.created ? -1 : 0)),
  };
}

// Why a revision cannot be given the traffic, or "ok" / "already".
export function rollbackTarget(service, revisions, name) {
  const status = statusDocument(service, revisions);
  const revision = status.revisions.find((item) => item.name === name);
  if (!revision) return "unknown";
  if (!revision.ready) return "not-ready";
  const [first, ...rest] = status.serving;
  if (first && rest.length === 0 && first.revision === name && first.percent === 100) return "already";
  return "ok";
}

// The revision behind a traffic tag and its temporary address.
export function taggedRevision(service, tag) {
  const entry = (service?.status?.traffic ?? []).find((item) => item.tag === tag);
  return entry ? { revision: entry.revisionName ?? "", url: entry.url ?? "" } : null;
}

// Settings that change on every deploy without changing how the service
// behaves: which tool made the change, and who, the name of the image (the
// image is meant to change), and the routing notes Cloud Run keeps on a
// revision that is or is not serving. Everything else counts, so a setting
// this list does not know stops a deploy rather than slipping through.
const VOLATILE_ANNOTATIONS = new Set([
  "client.knative.dev/user-image",
  "run.googleapis.com/client-name",
  "run.googleapis.com/client-version",
  "run.googleapis.com/operation-id",
  "serving.knative.dev/creator",
  "serving.knative.dev/lastModifier",
  "serving.knative.dev/routes",
  "serving.knative.dev/routingStateModified",
]);
const VOLATILE_ANNOTATION_PREFIXES = ["run.googleapis.com/build-"];
const IMAGE = /^spec\.containers\[\d+\]\.image$/;
const APP_COMMIT = /^spec\.containers\[\d+\]\.env\.APP_COMMIT$/;

function flatten(value, path, out) {
  if (Array.isArray(value)) {
    // Environment variables are compared by name, not by position.
    if (/\.env$/.test(path) && value.every((item) => item && typeof item.name === "string")) {
      for (const { name, ...rest } of value) out.set(`${path}.${name}`, JSON.stringify(rest));
      return;
    }
    value.forEach((item, index) => flatten(item, `${path}[${index}]`, out));
  } else if (value && typeof value === "object") {
    for (const key of Object.keys(value).sort()) flatten(value[key], `${path}.${key}`, out);
  } else {
    out.set(path, JSON.stringify(value ?? null));
  }
}

// Every setting of a revision (or of a service's template) as path -> value:
// the whole `spec` (containers, memory, CPU, concurrency, timeout, identity,
// environment, port, probes) and the annotations (instance limits and the
// like). The image and APP_COMMIT are left out: a deploy is meant to change
// those two.
export function settingsOf(resource, extraIgnore = []) {
  const template = resource?.spec?.template ?? resource ?? {};
  const out = new Map();
  flatten(template.spec ?? {}, "spec", out);
  for (const [name, value] of Object.entries(template.metadata?.annotations ?? {})) {
    if (VOLATILE_ANNOTATIONS.has(name) || VOLATILE_ANNOTATION_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    out.set(`annotations[${name}]`, JSON.stringify(value));
  }
  for (const path of [...out.keys()]) {
    if (IMAGE.test(path) || APP_COMMIT.test(path) || extraIgnore.includes(path)) out.delete(path);
  }
  return out;
}

// The settings that differ between two revisions, as sentences that name the
// setting and never show its value.
export function settingsDiff(before, after, extraIgnore = []) {
  const a = settingsOf(before, extraIgnore);
  const b = settingsOf(after, extraIgnore);
  const differences = [];
  for (const path of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    if (!a.has(path)) differences.push(`${path} was added`);
    else if (!b.has(path)) differences.push(`${path} was removed`);
    else if (a.get(path) !== b.get(path)) differences.push(`${path} changed`);
  }
  return differences;
}

// What GET /api/ said, or blanks when it was not the identity document.
const REVISION_NAME = /^[a-z][a-z0-9-]{0,62}$/;
const COMMIT_HASH = /^[0-9a-f]{7,40}$/;
export function identityOf(text) {
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  const pick = (value, pattern) => (typeof value === "string" && pattern.test(value) ? value : "");
  return {
    service: body && typeof body.service === "string" ? body.service : "",
    revision: pick(body?.revision, REVISION_NAME),
    commit: pick(body?.commit, COMMIT_HASH),
  };
}

// The formula and headline figures of an analysis answer, for the record.
export function analysisSummary(text) {
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  const figure = (name) => {
    const value = body?.metrics?.[name]?.value;
    return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  };
  return {
    formula: typeof body?.formula_version === "string" && /^[a-z0-9.-]{1,60}$/.test(body.formula_version) ? body.formula_version : "",
    residual: figure("residual_land_value"),
    profit: figure("development_profit"),
    margin: figure("development_margin"),
    irr: figure("irr"),
  };
}

// The traffic steps of a rollout: whole percentages, rising, ending at 100.
export function rolloutSteps(text) {
  const steps = String(text).trim().split(/[\s,]+/).filter(Boolean).map((item) => (/^\d{1,3}$/.test(item) ? Number(item) : NaN));
  const valid = steps.length > 0 && steps.every((step, index) => step >= 1 && step <= 100 && (index === 0 || step > steps[index - 1]))
    && steps[steps.length - 1] === 100;
  return valid ? steps : null;
}

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const readText = (file) => { try { return readFileSync(file, "utf8"); } catch { return ""; } };
// One fact per line, tab separated, with "-" for a blank so the shell's
// `read` keeps the columns apart.
const line = (...facts) => `${facts.map((fact) => (fact === "" || fact == null ? "-" : String(fact))).join("\t")}\n`;

const commands = {
  // status SERVICE.json REVISIONS.json
  status: ([service, revisions]) => `${JSON.stringify(statusDocument(readJson(service), readJson(revisions)))}\n`,
  // serving-json SERVICE.json -> the "serving" list of the status document
  "serving-json": ([service]) => `${JSON.stringify(servingOf(readJson(service)))}\n`,
  // serving SERVICE.json -> "revision<TAB>percent" per line
  serving: ([service]) => servingOf(readJson(service)).map(({ revision, percent }) => line(revision, percent)).join(""),
  // service-facts SERVICE.json -> url, latest created, latest ready, ingress
  "service-facts": ([service]) => {
    const doc = readJson(service);
    return line(doc?.status?.url, doc?.status?.latestCreatedRevisionName, doc?.status?.latestReadyRevisionName,
      doc?.metadata?.annotations?.["run.googleapis.com/ingress"]);
  },
  // rollback-target SERVICE.json REVISIONS.json NAME -> ok | already | unknown | not-ready
  "rollback-target": ([service, revisions, name]) => `${rollbackTarget(readJson(service), readJson(revisions), name)}\n`,
  // tagged SERVICE.json TAG -> revision, url
  tagged: ([service, tag]) => {
    const found = taggedRevision(readJson(service), tag);
    return found ? line(found.revision, found.url) : line("", "");
  },
  // revision-facts REVISION.json -> image, APP_COMMIT
  "revision-facts": ([revision]) => { const doc = readJson(revision); return line(imageOf(doc), appCommitOf(doc)); },
  // ready REVISION.json -> yes | no
  ready: ([revision]) => `${revisionReady(readJson(revision)) ? "yes" : "no"}\n`,
  // settings-diff BEFORE.json AFTER.json [IGNORED,PATHS] -> one sentence per difference
  "settings-diff": ([before, after, ignore = ""]) => settingsDiff(readJson(before), readJson(after),
    ignore.split(",").map((item) => item.trim()).filter(Boolean)).map((item) => `${item}\n`).join(""),
  // identity BODY -> service, revision, commit
  identity: ([body]) => { const id = identityOf(readText(body)); return line(id.service, id.revision, id.commit); },
  // health BODY -> ok | no
  health: ([body]) => {
    let status = null;
    try { status = JSON.parse(readText(body))?.status; } catch { /* not JSON */ }
    return `${status === "ok" ? "ok" : "no"}\n`;
  },
  // analysis BODY -> formula, residual, profit, margin, irr
  analysis: ([body]) => { const a = analysisSummary(readText(body)); return line(a.formula, a.residual, a.profit, a.margin, a.irr); },
  // steps "10 50 100" -> the steps on one line, or nothing when they are not valid
  steps: ([text = ""]) => { const steps = rolloutSteps(text); return steps ? `${steps.join(" ")}\n` : ""; },
  // json-string TEXT -> the text as a JSON string (for the one-line results)
  "json-string": ([text = ""]) => `${JSON.stringify(text)}\n`,
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [name, ...rest] = process.argv.slice(2);
  const command = commands[name];
  if (!command) {
    console.error(`lib.mjs: unknown command ${name ?? ""}`);
    process.exit(2);
  }
  try {
    process.stdout.write(command(rest));
  } catch (error) {
    console.error(`lib.mjs ${name}: ${error.message}`);
    process.exit(2);
  }
}
