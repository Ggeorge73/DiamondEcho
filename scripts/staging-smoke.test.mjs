import test from "node:test";
import assert from "node:assert/strict";
import { checkStaging, parseOrigins } from "./staging-smoke.mjs";

const env = {
  STAGING_PUBLIC_ORIGIN: "https://public-stage.example.com",
  STAGING_STAFF_ORIGIN: "https://staff-stage.example.com",
  STAGING_API_ORIGIN: "https://api-stage.example.com",
};

test("requires three distinct non-production HTTPS origins", () => {
  assert.deepEqual(parseOrigins(env), env);
  assert.throws(() => parseOrigins({ ...env, STAGING_API_ORIGIN: "https://diamondecho.com" }), /production/);
  assert.throws(() => parseOrigins({ ...env, STAGING_API_ORIGIN: env.STAGING_PUBLIC_ORIGIN }), /distinct/);
  assert.throws(() => parseOrigins({ ...env, STAGING_API_ORIGIN: "http://api-stage.example.com" }), /HTTPS/);
  assert.throws(() => parseOrigins({ ...env, STAGING_API_ORIGIN: "https://api-stage.example.com/path" }), /HTTPS/);
});

function response(status, body, headers = {}) {
  return { status, headers: new Headers(headers), text: async () => body,
    json: async () => JSON.parse(body) };
}

function fixture(url, options) {
  const parsed = new URL(url);
  if (parsed.hostname === "public-stage.example.com") return response(200, "<html>public</html>");
  if (parsed.hostname === "staff-stage.example.com") return response(200, "<html>staff</html>", {
    "cache-control": "no-store", "content-security-policy": "default-src 'none'", "x-frame-options": "DENY",
  });
  if (parsed.pathname === "/health") return response(200, '{"status":"ok"}');
  // Cloud Run's front end intercepts this path; the smoke check must not rely on it.
  if (parsed.pathname === "/healthz") return response(404, "<html>Error 404</html>");
  if (parsed.pathname === "/api/v1/inquiries/staff") return response(503, '{}', { "cache-control": "no-store" });
  const origin = options.headers?.Origin;
  return response(200, '{"service":"DiamondEcho API"}', origin === "https://unapproved.example" ? {} : { "access-control-allow-origin": origin });
}

test("checks liveness on a path Cloud Run does not intercept", async () => {
  const requested = [];
  const results = await checkStaging(parseOrigins(env), (url, options) => { requested.push(new URL(url).pathname); return fixture(url, options); });
  assert.ok(requested.includes("/health"));
  assert.ok(!requested.includes("/healthz"));
  assert.equal(results.find((result) => result.name === "API liveness").pass, true);
});

test("passes a safe, read-only staging fixture", async () => {
  const results = await checkStaging(parseOrigins(env), fixture);
  assert.equal(results.length, 9);
  assert.ok(results.every((result) => result.pass), JSON.stringify(results));
});

test("fails if staff security headers or CORS isolation are missing", async () => {
  const results = await checkStaging(parseOrigins(env), (url, options) => {
    const result = fixture(url, options);
    if (url === `${env.STAGING_STAFF_ORIGIN}/`) result.headers.delete("content-security-policy");
    if (options.headers?.Origin === "https://unapproved.example") result.headers.set("access-control-allow-origin", "*");
    return result;
  });
  assert.deepEqual(results.filter((result) => !result.pass).map((result) => result.name), ["staff home", "unapproved CORS"]);
});
