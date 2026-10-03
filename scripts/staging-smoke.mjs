#!/usr/bin/env node
// Read-only checks for an isolated staging deployment. Never submits visitor data.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const required = ["STAGING_PUBLIC_ORIGIN", "STAGING_STAFF_ORIGIN", "STAGING_API_ORIGIN"];

export function parseOrigins(env = process.env) {
  const origins = Object.fromEntries(required.map((name) => {
    const value = env[name];
    if (!value) throw new Error(`${name} is required`);
    const url = new URL(value);
    if (url.protocol !== "https:" || url.origin !== value || url.username || url.password || url.search || url.hash) {
      throw new Error(`${name} must be an exact HTTPS origin without credentials or a path`);
    }
    if (url.hostname === "diamondecho.com" || url.hostname.endsWith(".diamondecho.com")) {
      throw new Error(`${name} must not target a production DiamondEcho domain`);
    }
    return [name, value];
  }));
  if (new Set(Object.values(origins)).size !== required.length) throw new Error("Staging public, staff and API origins must be distinct");
  return origins;
}

export async function checkStaging(origins, fetcher = fetch) {
  const publicOrigin = origins.STAGING_PUBLIC_ORIGIN;
  const staffOrigin = origins.STAGING_STAFF_ORIGIN;
  const apiOrigin = origins.STAGING_API_ORIGIN;
  const checks = [
    { name: "public home", url: `${publicOrigin}/`, status: 200, html: true },
    { name: "public inquiry deep link", url: `${publicOrigin}/inquire`, status: 200, html: true },
    { name: "staff home", url: `${staffOrigin}/`, status: 200, html: true, staff: true },
    { name: "API liveness", url: `${apiOrigin}/healthz`, status: 200, json: { status: "ok" } },
    { name: "API identity", url: `${apiOrigin}/api/`, status: 200, json: { service: "DiamondEcho API" } },
  ];
  const results = [];
  for (const check of checks) {
    try {
      const response = await fetcher(check.url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(10000) });
      let pass = response.status === check.status;
      if (check.html) pass &&= (await response.text()).toLowerCase().includes("<html");
      if (check.json) {
        const body = await response.json();
        pass &&= Object.entries(check.json).every(([key, value]) => body[key] === value);
      }
      if (check.staff) {
        const headers = response.headers;
        pass &&= (headers.get("cache-control") || "").includes("no-store");
        pass &&= (headers.get("content-security-policy") || "").includes("default-src 'none'");
        pass &&= headers.get("x-frame-options") === "DENY";
      }
      results.push({ name: check.name, pass, status: response.status });
    } catch (error) {
      results.push({ name: check.name, pass: false, error: error.message });
    }
  }
  for (const [name, origin, expected] of [
    ["allowed public CORS", publicOrigin, publicOrigin],
    ["allowed staff CORS", staffOrigin, staffOrigin],
    ["unapproved CORS", "https://unapproved.example", null],
  ]) {
    try {
      const response = await fetcher(`${apiOrigin}/api/`, {
        method: "GET", headers: { Origin: origin }, redirect: "error", signal: AbortSignal.timeout(10000),
      });
      const actual = response.headers.get("access-control-allow-origin");
      results.push({ name, pass: response.status === 200 && actual === expected, status: response.status });
    } catch (error) {
      results.push({ name, pass: false, error: error.message });
    }
  }
  try {
    const response = await fetcher(`${apiOrigin}/api/v1/inquiries/staff`, {
      method: "GET", headers: { Origin: staffOrigin }, redirect: "error", signal: AbortSignal.timeout(10000),
    });
    results.push({ name: "staff API denies unauthenticated access",
      pass: [401, 503].includes(response.status) && (response.headers.get("cache-control") || "").includes("no-store"),
      status: response.status });
  } catch (error) {
    results.push({ name: "staff API denies unauthenticated access", pass: false, error: error.message });
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const results = await checkStaging(parseOrigins());
    for (const result of results) console.log(`${result.pass ? "PASS" : "FAIL"} ${result.name}${result.status ? ` (${result.status})` : ""}${result.error ? `: ${result.error}` : ""}`);
    if (results.some((result) => !result.pass)) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
