#!/usr/bin/env node
// Page-weight budget for the public site. Run after `npm run build`:
//
//   node scripts/sre/perf-budget.mjs                       check build/ against perf-budget.json
//   node scripts/sre/perf-budget.mjs --summary "$GITHUB_STEP_SUMMARY"
//   node scripts/sre/perf-budget.mjs --propose             print a budget made from this build
//
// Why: every visitor downloads the script and style files before the page
// can respond to a tap. They only grow, a little at a time, and nobody
// notices until phones on a weak signal do. This check makes growth a
// decision: a change that pushes a file past its budget fails, and either the
// change is slimmed or the budget is raised on purpose in a reviewed commit.
//
// Sizes are measured twice: as stored ("bytes") and gzip-compressed ("gzip",
// Node's default level, which gives the same figures as Vite's build report).
// Cloudflare compresses what it sends, so gzip is closer to what a visitor
// downloads; the stored size is what the phone has to parse.
//
// Exit codes: 0 within budget; 1 over budget; 2 the check itself could not
// run (no build folder, unreadable budget file, bad option).
import { readdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
export const DEFAULT_BUILD = resolve(repoRoot, "build");
export const DEFAULT_BUDGET = resolve(here, "perf-budget.json");
export const HEADROOM = 0.1; // a proposed budget is today's size plus 10 percent
const LARGEST_SHOWN = 8;

export class UsageError extends Error {}

const KINDS = {
  ".js": "js", ".mjs": "js",
  ".css": "css",
  ".html": "html",
  ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image", ".webp": "image", ".avif": "image", ".svg": "image", ".ico": "image",
  ".woff": "font", ".woff2": "font", ".ttf": "font", ".otf": "font",
};
export const kindOf = (path) => KINDS[extname(path).toLowerCase()] ?? "other";

// What each budget line measures. A budget file names lines by these ids.
export const MEASURES = {
  "js-total-bytes": { files: "js", measure: "total", size: "bytes", what: "all script files together (stored)" },
  "js-total-gzip": { files: "js", measure: "total", size: "gzip", what: "all script files together (compressed)" },
  "js-largest-bytes": { files: "js", measure: "largest", size: "bytes", what: "the largest script file (stored)" },
  "js-largest-gzip": { files: "js", measure: "largest", size: "gzip", what: "the largest script file (compressed)" },
  "css-total-bytes": { files: "css", measure: "total", size: "bytes", what: "all style files together (stored)" },
  "css-total-gzip": { files: "css", measure: "total", size: "gzip", what: "all style files together (compressed)" },
  "css-largest-gzip": { files: "css", measure: "largest", size: "gzip", what: "the largest style file (compressed)" },
  "html-largest-bytes": { files: "html", measure: "largest", size: "bytes", what: "the largest prerendered page (stored)" },
  "html-largest-gzip": { files: "html", measure: "largest", size: "gzip", what: "the largest prerendered page (compressed)" },
  "image-largest-bytes": { files: "image", measure: "largest", size: "bytes", what: "the largest image (stored)" },
  "all-total-bytes": { files: "all", measure: "total", size: "bytes", what: "everything in the published folder (stored)" },
};

// Every file path under `dir`. A plain walk rather than readdirSync's
// `recursive` option, whose entries differ between Node 20 minor versions.
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() ? [full] : [];
  });
}

/** Every file under `dir`, with its size as stored and compressed. */
export function scanBuild(dir) {
  let paths;
  try {
    if (!statSync(dir).isDirectory()) throw new Error("not a folder");
    paths = walk(dir);
  } catch {
    throw new UsageError(`No build folder at ${dir}. Run "npm run build" first.`);
  }
  const files = paths.map((full) => {
    const data = readFileSync(full);
    return {
      path: relative(dir, full).split(sep).join("/"),
      kind: kindOf(full),
      bytes: data.length,
      gzip: gzipSync(data).length,
    };
  });
  files.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));
  if (files.length === 0) throw new UsageError(`The build folder ${dir} is empty. Run "npm run build" first.`);
  return files;
}

/** The figure a budget line measures, and the file it came from (largest only). */
export function measure(files, id) {
  const spec = MEASURES[id];
  if (!spec) throw new UsageError(`Unknown budget line "${id}". Known: ${Object.keys(MEASURES).join(", ")}.`);
  const chosen = spec.files === "all" ? files : files.filter((file) => file.kind === spec.files);
  if (spec.measure === "total") return { value: chosen.reduce((sum, file) => sum + file[spec.size], 0), file: null, count: chosen.length };
  const largest = chosen.reduce((best, file) => (!best || file[spec.size] > best[spec.size] ? file : best), null);
  return { value: largest ? largest[spec.size] : 0, file: largest?.path ?? null, count: chosen.length };
}

/** Totals by kind, for the report. */
export function totalsByKind(files) {
  const totals = {};
  for (const file of files) {
    const entry = (totals[file.kind] ??= { files: 0, bytes: 0, gzip: 0 });
    entry.files += 1;
    entry.bytes += file.bytes;
    entry.gzip += file.gzip;
  }
  return totals;
}

/** Read and check a budget file. */
export function loadBudget(path) {
  let budget;
  try {
    budget = JSON.parse(readFileSync(path, "utf8"));
  } catch (problem) {
    throw new UsageError(`Could not read the budget ${path}: ${problem.message}`);
  }
  if (budget?.schema !== 1 || !budget.limits || typeof budget.limits !== "object") {
    throw new UsageError(`The budget ${path} needs "schema": 1 and a "limits" object.`);
  }
  for (const [id, line] of Object.entries(budget.limits)) {
    if (!MEASURES[id]) throw new UsageError(`The budget ${path} has an unknown line "${id}".`);
    if (!Number.isInteger(line?.limit_bytes) || line.limit_bytes <= 0) {
      throw new UsageError(`The budget line "${id}" needs a whole, positive limit_bytes.`);
    }
  }
  return budget;
}

/** Compare a build with a budget. */
export function evaluate(files, budget) {
  const lines = Object.entries(budget.limits).map(([id, line]) => {
    const spec = MEASURES[id];
    const { value, file } = measure(files, id);
    return {
      id,
      what: spec.what,
      file,
      actual_bytes: value,
      limit_bytes: line.limit_bytes,
      baseline_bytes: line.measured_bytes ?? null,
      ok: value <= line.limit_bytes,
    };
  });
  return { ok: lines.every((line) => line.ok), lines };
}

const kB = (bytes) => (bytes === null || bytes === undefined ? "no data" : `${(bytes / 1000).toFixed(1)} kB`);

/** One plain sentence per missed line. */
export function failureMessages(evaluation) {
  return evaluation.lines.filter((line) => !line.ok).map((line) => {
    const over = line.actual_bytes - line.limit_bytes;
    const overText = over < 1000 ? `${over} byte${over === 1 ? "" : "s"}` : kB(over);
    const source = line.file ? ` in ${line.file}` : "";
    return `Over budget: ${line.what} is ${kB(line.actual_bytes)}${source}, ${overText} over its limit of ${kB(line.limit_bytes)}. Slim the change, or raise "${line.id}" in scripts/sre/perf-budget.json in a reviewed commit that says why.`;
  });
}

/** A budget made from this build: each line is today's figure plus headroom, rounded up to 1 kB. */
export function proposeBudget(files, { headroom = HEADROOM, measuredOn, commit = null } = {}) {
  const limits = {};
  for (const id of Object.keys(MEASURES)) {
    const { value } = measure(files, id);
    if (value === 0) continue; // nothing of that kind in this build: no line
    limits[id] = { limit_bytes: Math.ceil((value * (1 + headroom)) / 1000) * 1000, measured_bytes: value };
  }
  return {
    schema: 1,
    note: `Limits are the build measured on ${measuredOn}${commit ? ` at commit ${commit}` : ""} plus ${Math.round(headroom * 100)} percent, rounded up to the next 1,000 bytes. Raise a limit only in a reviewed commit that says why. How to: docs/sre/capacity.md.`,
    measured_on: measuredOn,
    commit,
    headroom,
    limits,
  };
}

/** Markdown for a job summary. */
export function markdownReport(result) {
  const lines = [
    `### Page-weight budget: ${result.ok ? "within budget" : "OVER BUDGET"}`,
    "",
    `Build folder \`${result.build}\`, ${result.files} files, checked ${result.checked_at}.`,
    "",
    "| Budget line | Now | Limit | Measured when set | Result |",
    "| --- | ---: | ---: | ---: | --- |",
    ...result.lines.map((line) => `| ${line.what}${line.file ? ` (\`${line.file}\`)` : ""} | ${kB(line.actual_bytes)} | ${kB(line.limit_bytes)} | ${kB(line.baseline_bytes)} | ${line.ok ? "ok" : "over"} |`),
    "",
    "Largest files:",
    "",
    "| File | Stored | Compressed |",
    "| --- | ---: | ---: |",
    ...result.largest.map((file) => `| \`${file.path}\` | ${kB(file.bytes)} | ${kB(file.gzip)} |`),
  ];
  if (!result.ok) lines.push("", ...result.messages.map((message) => `- ${message}`));
  return `${lines.join("\n")}\n`;
}

export function parseArgs(argv) {
  const options = { build: DEFAULT_BUILD, budget: DEFAULT_BUDGET, out: null, summary: null, propose: false, help: false };
  const values = { "--build": "build", "--budget": "budget", "--out": "out", "--summary": "summary" };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--propose") options.propose = true;
    else if (flag === "--help") options.help = true;
    else if (flag in values) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new UsageError(`${flag} needs a value.`);
      options[values[flag]] = value;
      index += 1;
    } else throw new UsageError(`Unknown option "${flag}". Run with --help for the list.`);
  }
  return options;
}

/** The wall clock, or SRE_NOW (an ISO time) when it is set. */
export function now(env = process.env) {
  if (env.SRE_NOW === undefined || env.SRE_NOW === "") return new Date();
  const at = new Date(env.SRE_NOW);
  if (Number.isNaN(at.getTime())) throw new UsageError(`SRE_NOW must be an ISO time, got "${env.SRE_NOW}".`);
  return at;
}

const HELP = `Page-weight budget for the public site (run after npm run build)

  node scripts/sre/perf-budget.mjs [--build DIR] [--budget FILE] [--out FILE] [--summary FILE]
  node scripts/sre/perf-budget.mjs --propose [--build DIR]

  --build DIR     the published folder. Default: build/
  --budget FILE   the limits. Default: scripts/sre/perf-budget.json
  --out FILE      also write the result as JSON
  --summary FILE  also append a Markdown report (for $GITHUB_STEP_SUMMARY)
  --propose       print a budget made from this build plus ${HEADROOM * 100} percent; changes nothing

Exit codes: 0 within budget, 1 over budget, 2 could not check.`;

export function main(argv, { log = console.log, error = console.error, env = process.env } = {}) {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      log(HELP);
      return 0;
    }
    const checkedAt = now(env);
    const files = scanBuild(resolve(options.build));
    if (options.propose) {
      const commit = [env.GITHUB_SHA, env.CF_PAGES_COMMIT_SHA].find((value) => /^[0-9a-f]{7,40}$/i.test(value ?? "")) ?? null;
      log(JSON.stringify(proposeBudget(files, { measuredOn: checkedAt.toISOString().slice(0, 10), commit }), null, 2));
      return 0;
    }
    const budget = loadBudget(resolve(options.budget));
    const evaluation = evaluate(files, budget);
    const result = {
      schema: 1,
      checked_at: checkedAt.toISOString(),
      build: relative(process.cwd(), resolve(options.build)) || ".",
      files: files.length,
      ok: evaluation.ok,
      lines: evaluation.lines,
      messages: failureMessages(evaluation),
      totals: totalsByKind(files),
      largest: files.slice(0, LARGEST_SHOWN),
    };
    for (const line of result.lines) {
      log(`${line.ok ? "ok  " : "OVER"} ${line.id.padEnd(20)} ${kB(line.actual_bytes).padStart(10)} of ${kB(line.limit_bytes).padStart(10)}${line.file ? `  ${line.file}` : ""}`);
    }
    log("\nLargest files:");
    for (const file of result.largest) log(`  ${kB(file.bytes).padStart(10)} stored ${kB(file.gzip).padStart(10)} compressed  ${file.path}`);
    if (options.out) writeFileSync(resolve(options.out), `${JSON.stringify(result, null, 2)}\n`);
    if (options.summary) appendFileSync(resolve(options.summary), markdownReport(result));
    if (!result.ok) {
      error("");
      for (const message of result.messages) error(message);
      return 1;
    }
    log("\nWithin budget.");
    return 0;
  } catch (problem) {
    if (problem instanceof UsageError) {
      error(problem.message);
      return 2;
    }
    error(`Page-weight check failed: ${problem.stack ?? problem}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
