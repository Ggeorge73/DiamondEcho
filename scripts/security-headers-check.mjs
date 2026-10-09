#!/usr/bin/env node
// Read-only check of the live sites' security headers. Sends plain GET requests
// and never submits forms or visitor data. Used by the scheduled security scan.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// What each origin must send. The public site deliberately has no script/style
// CSP yet (see frontend/public/_headers): one untested against the Georgia MLS
// frame could break the search, so only framing protection is required there.
export const TARGETS = [
  {
    name: "public site",
    url: "https://diamondecho.com/",
    headers: {
      "strict-transport-security": (v) => /max-age=(\d+)/.test(v) && Number(v.match(/max-age=(\d+)/)[1]) >= 15552000,
      "x-frame-options": (v) => v.toUpperCase() === "DENY",
      "content-security-policy": (v) => v.includes("frame-ancestors 'none'"),
      "x-content-type-options": (v) => v.toLowerCase() === "nosniff",
    },
  },
];

const FORBIDDEN = ["x-powered-by"];

export async function checkTarget(target, fetcher = fetch) {
  const problems = [];
  let response;
  try {
    response = await fetcher(target.url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(15000) });
  } catch (error) {
    return { name: target.name, url: target.url, pass: false, problems: [`request failed: ${error.message}`] };
  }
  if (response.status !== 200) problems.push(`expected status 200, got ${response.status}`);
  for (const [header, valid] of Object.entries(target.headers)) {
    const value = response.headers.get(header);
    if (value === null) problems.push(`missing ${header}`);
    else if (!valid(value)) problems.push(`weak ${header}: ${value}`);
  }
  for (const header of FORBIDDEN) {
    if (response.headers.get(header) !== null) problems.push(`leaks ${header}`);
  }
  return { name: target.name, url: target.url, pass: problems.length === 0, problems };
}

export async function checkAll(targets = TARGETS, fetcher = fetch) {
  const results = [];
  for (const target of targets) results.push(await checkTarget(target, fetcher));
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const results = await checkAll();
  for (const result of results) {
    console.log(`${result.pass ? "PASS" : "FAIL"} ${result.name} ${result.url}`);
    for (const problem of result.problems) console.log(`  - ${problem}`);
  }
  if (results.some((result) => !result.pass)) process.exit(1);
}
