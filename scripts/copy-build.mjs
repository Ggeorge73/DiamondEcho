import { cpSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const source = resolve("frontend/build");
const target = resolve("build");

if (!existsSync(source)) {
  throw new Error(`Missing frontend build output: ${source}`);
}

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });

// Build identity: /version.json says which commit the published site was
// built from, so a monitor with no Cloudflare sign-in can tell when a merge
// has gone live and which build a problem belongs to (scripts/sre). Cloudflare
// Pages sets CF_PAGES_COMMIT_SHA during its build and GitHub Actions sets
// GITHUB_SHA; a build on someone's own machine says "unknown". Only a value
// that looks like a commit is written. The file is written here, into the
// folder that is published, and not into the script bundle: the pages and
// scripts of two builds of the same source stay byte for byte the same.
const commit = [process.env.CF_PAGES_COMMIT_SHA, process.env.GITHUB_SHA]
  .map((value) => (value || "").trim().toLowerCase())
  .find((value) => /^[0-9a-f]{7,40}$/.test(value)) || "unknown";
// SRE_NOW (an ISO time) stands in for the clock in tests and drills
// (scripts/sre/README.md); a real build never sets it.
const fixed = Date.parse(process.env.SRE_NOW || "");
const builtAt = new Date(Number.isNaN(fixed) ? Date.now() : fixed).toISOString();
writeFileSync(join(target, "version.json"), `${JSON.stringify({ commit, built_at: builtAt })}\n`);
