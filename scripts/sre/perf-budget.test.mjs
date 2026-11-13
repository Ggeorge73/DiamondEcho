import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  DEFAULT_BUDGET,
  MEASURES,
  evaluate,
  failureMessages,
  kindOf,
  loadBudget,
  main,
  markdownReport,
  measure,
  proposeBudget,
  scanBuild,
  totalsByKind,
} from "./perf-budget.mjs";

const quiet = () => {
  const out = [];
  const err = [];
  return { out, err, log: (line) => out.push(String(line)), error: (line) => err.push(String(line)) };
};

// A small build folder: two scripts, one style file, two pages, one image.
function makeBuild() {
  const dir = mkdtempSync(join(tmpdir(), "perf-budget-test-"));
  mkdirSync(join(dir, "assets"));
  const files = {
    "assets/index-aaaa.js": "x".repeat(5000),
    "assets/chunk-bbbb.js": "let a = 1;\n".repeat(300),
    "assets/index-cccc.css": "body{color:red}\n".repeat(100),
    "index.html": "<!doctype html><p>home</p>",
    "about.html": "<p>about</p>".repeat(50),
    "og-image.png": Buffer.alloc(2000, 7),
  };
  for (const [path, content] of Object.entries(files)) writeFileSync(join(dir, path), content);
  return { dir, files };
}

const withBuild = (fn) => {
  const build = makeBuild();
  try {
    return fn(build);
  } finally {
    rmSync(build.dir, { recursive: true, force: true });
  }
};

const writeBudget = (dir, limits) => {
  const path = join(dir, "budget.json");
  writeFileSync(path, JSON.stringify({ schema: 1, limits }));
  return path;
};

test("files are sorted by kind from their extension", () => {
  assert.equal(kindOf("assets/a.JS"), "js");
  assert.equal(kindOf("a.mjs"), "js");
  assert.equal(kindOf("a.css"), "css");
  assert.equal(kindOf("a.html"), "html");
  assert.equal(kindOf("og-image.png"), "image");
  assert.equal(kindOf("favicon.svg"), "image");
  assert.equal(kindOf("font.woff2"), "font");
  assert.equal(kindOf("_headers"), "other");
  assert.equal(kindOf("sitemap.xml"), "other");
});

test("scanBuild measures every file, stored and compressed, largest first", () => withBuild(({ dir, files }) => {
  const scanned = scanBuild(dir);
  assert.equal(scanned.length, Object.keys(files).length);
  const script = scanned.find((file) => file.path === "assets/index-aaaa.js");
  assert.equal(script.bytes, 5000);
  assert.equal(script.gzip, gzipSync(Buffer.from(files["assets/index-aaaa.js"])).length);
  assert.equal(script.kind, "js");
  assert.equal(scanned[0].path, "assets/index-aaaa.js"); // the largest
  for (let index = 1; index < scanned.length; index += 1) assert.ok(scanned[index - 1].bytes >= scanned[index].bytes);
}));

test("scanBuild explains a missing or empty build folder", () => {
  assert.throws(() => scanBuild(join(tmpdir(), "no-such-build-folder-xyz")), /npm run build/);
  const empty = mkdtempSync(join(tmpdir(), "perf-budget-empty-"));
  try {
    assert.throws(() => scanBuild(empty), /empty/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("totals and largest-file figures", () => withBuild(({ dir }) => {
  const scanned = scanBuild(dir);
  const jsTotal = measure(scanned, "js-total-bytes");
  assert.equal(jsTotal.value, 5000 + "let a = 1;\n".length * 300);
  assert.equal(jsTotal.count, 2);
  assert.equal(jsTotal.file, null);
  const largest = measure(scanned, "js-largest-bytes");
  assert.equal(largest.value, 5000);
  assert.equal(largest.file, "assets/index-aaaa.js");
  assert.equal(measure(scanned, "image-largest-bytes").value, 2000);
  assert.equal(measure(scanned, "all-total-bytes").value, scanned.reduce((sum, file) => sum + file.bytes, 0));
  const totals = totalsByKind(scanned);
  assert.equal(totals.js.files, 2);
  assert.equal(totals.html.files, 2);
  assert.throws(() => measure(scanned, "fonts-total"), /Unknown budget line/);
}));

test("within budget passes; one byte over fails with a clear message", () => withBuild(({ dir }) => {
  const scanned = scanBuild(dir);
  const exact = measure(scanned, "js-largest-bytes").value;
  const pass = evaluate(scanned, { limits: { "js-largest-bytes": { limit_bytes: exact } } });
  assert.equal(pass.ok, true);
  const fail = evaluate(scanned, { limits: { "js-largest-bytes": { limit_bytes: exact - 1, measured_bytes: 4000 } } });
  assert.equal(fail.ok, false);
  assert.equal(fail.lines[0].file, "assets/index-aaaa.js");
  assert.equal(fail.lines[0].baseline_bytes, 4000);
  const [message] = failureMessages(fail);
  assert.match(message, /^Over budget: the largest script file \(stored\) is 5\.0 kB in assets\/index-aaaa\.js, 1 byte over its limit of 5\.0 kB\./);
  assert.match(message, /raise "js-largest-bytes" in scripts\/sre\/perf-budget\.json in a reviewed commit/);
}));

test("a proposed budget is the measured size plus 10 percent, rounded up to 1 kB", () => withBuild(({ dir }) => {
  const scanned = scanBuild(dir);
  const budget = proposeBudget(scanned, { measuredOn: "2026-11-13", commit: "abc1234" });
  assert.equal(budget.schema, 1);
  assert.equal(budget.limits["js-largest-bytes"].measured_bytes, 5000);
  assert.equal(budget.limits["js-largest-bytes"].limit_bytes, 6000); // 5,500 rounded up
  assert.equal(budget.limits["image-largest-bytes"].limit_bytes, 3000); // 2,200 rounded up
  assert.match(budget.note, /2026-11-13 at commit abc1234 plus 10 percent/);
  assert.equal(evaluate(scanned, budget).ok, true);
  for (const id of Object.keys(budget.limits)) assert.ok(MEASURES[id], id);
}));

test("a proposal leaves out kinds the build does not have", () => {
  const budget = proposeBudget([{ path: "a.js", kind: "js", bytes: 10, gzip: 5 }], { measuredOn: "2026-11-13" });
  assert.ok(budget.limits["js-total-bytes"]);
  assert.equal(budget.limits["css-total-gzip"], undefined);
});

test("loadBudget refuses a malformed budget", () => withBuild(({ dir }) => {
  for (const [content, pattern] of [
    ["not json", /Could not read/],
    [JSON.stringify({ schema: 2, limits: {} }), /schema/],
    [JSON.stringify({ schema: 1, limits: { "js-everything": { limit_bytes: 1 } } }), /unknown line/],
    [JSON.stringify({ schema: 1, limits: { "js-total-bytes": { limit_bytes: 0 } } }), /positive/],
    [JSON.stringify({ schema: 1, limits: { "js-total-bytes": { limit_bytes: 1.5 } } }), /whole/],
  ]) {
    const path = join(dir, "bad.json");
    writeFileSync(path, content);
    assert.throws(() => loadBudget(path), pattern, content);
  }
}));

test("the repository's budget file is well formed and every line carries its measured size", () => {
  const budget = loadBudget(DEFAULT_BUDGET);
  assert.ok(Object.keys(budget.limits).length >= 5);
  for (const [id, line] of Object.entries(budget.limits)) {
    assert.ok(Number.isInteger(line.measured_bytes) && line.measured_bytes > 0, id);
    assert.ok(line.limit_bytes >= line.measured_bytes, id);
    // Headroom stays modest: a budget far above the measured size checks nothing.
    assert.ok(line.limit_bytes <= Math.ceil(line.measured_bytes * 1.25), id);
  }
});

test("main: exit 0 within budget, with JSON and Markdown written", () => withBuild(({ dir }) => {
  const budgetPath = writeBudget(dir, { "js-total-gzip": { limit_bytes: 100000 }, "html-largest-bytes": { limit_bytes: 100000 } });
  const out = join(dir, "result.json");
  const summary = join(dir, "summary.md");
  const printed = quiet();
  const code = main(["--build", dir, "--budget", budgetPath, "--out", out, "--summary", summary], { ...printed, env: { SRE_NOW: "2026-11-13T12:00:00.000Z" } });
  assert.equal(code, 0);
  const result = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(result.ok, true);
  assert.equal(result.checked_at, "2026-11-13T12:00:00.000Z");
  assert.equal(result.lines.length, 2);
  assert.ok(result.largest.length > 0);
  const markdown = readFileSync(summary, "utf8");
  assert.match(markdown, /### Page-weight budget: within budget/);
  assert.match(markdown, /Largest files/);
  assert.ok(printed.out.some((line) => /Within budget/.test(line)));
}));

test("main: exit 1 over budget, and the message says what to do", () => withBuild(({ dir }) => {
  const budgetPath = writeBudget(dir, { "js-largest-bytes": { limit_bytes: 1000 } });
  const summary = join(dir, "summary.md");
  const printed = quiet();
  const code = main(["--build", dir, "--budget", budgetPath, "--summary", summary], { ...printed, env: {} });
  assert.equal(code, 1);
  assert.ok(printed.err.some((line) => /Over budget: the largest script file/.test(line)));
  assert.match(readFileSync(summary, "utf8"), /OVER BUDGET/);
}));

test("main: exit 2 when the check cannot run", () => withBuild(({ dir }) => {
  const printed = quiet();
  assert.equal(main(["--build", join(dir, "missing")], { ...printed, env: {} }), 2);
  assert.ok(printed.err.some((line) => /npm run build/.test(line)));
  assert.equal(main(["--build", dir, "--budget", join(dir, "missing.json")], { ...quiet(), env: {} }), 2);
  assert.equal(main(["--frobnicate"], { ...quiet(), env: {} }), 2);
  assert.equal(main(["--build"], { ...quiet(), env: {} }), 2);
  assert.equal(main(["--build", dir, "--budget", writeBudget(dir, {})], { ...quiet(), env: { SRE_NOW: "not a time" } }), 2);
}));

test("main --propose prints a budget and changes nothing", () => withBuild(({ dir }) => {
  const printed = quiet();
  const code = main(["--build", dir, "--propose"], { ...printed, env: { SRE_NOW: "2026-11-13T08:00:00Z", GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567" } });
  assert.equal(code, 0);
  const proposal = JSON.parse(printed.out.join("\n"));
  assert.equal(proposal.measured_on, "2026-11-13");
  assert.equal(proposal.commit, "0123456789abcdef0123456789abcdef01234567");
}));

test("markdownReport shows each line and says 'no data' for a missing baseline", () => {
  const text = markdownReport({
    ok: false,
    build: "build",
    files: 3,
    checked_at: "2026-11-13T00:00:00.000Z",
    lines: [{ id: "js-total-gzip", what: "all script files together (compressed)", file: null, actual_bytes: 230000, limit_bytes: 227000, baseline_bytes: null, ok: false }],
    largest: [{ path: "assets/a.js", bytes: 700000, gzip: 230000 }],
    messages: ["Over budget: …"],
  });
  assert.match(text, /\| all script files together \(compressed\) \| 230\.0 kB \| 227\.0 kB \| no data \| over \|/);
  assert.match(text, /- Over budget: …/);
});
