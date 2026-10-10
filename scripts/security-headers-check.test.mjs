import { test } from "node:test";
import assert from "node:assert/strict";
import { checkTarget, TARGETS } from "./security-headers-check.mjs";

const good = {
  "strict-transport-security": "max-age=15552000",
  "x-frame-options": "DENY",
  "content-security-policy": "frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
};
const fakeFetch = (headers, status = 200) => async () => new Response("<html></html>", { status, headers });

test("passes when every required header is strong", async () => {
  const result = await checkTarget(TARGETS[0], fakeFetch(good));
  assert.equal(result.pass, true, result.problems.join("; "));
});

test("flags a missing header", async () => {
  const { "x-frame-options": _, ...rest } = good;
  const result = await checkTarget(TARGETS[0], fakeFetch(rest));
  assert.equal(result.pass, false);
  assert.ok(result.problems.includes("missing x-frame-options"));
});

test("flags a short HSTS max-age", async () => {
  const result = await checkTarget(TARGETS[0], fakeFetch({ ...good, "strict-transport-security": "max-age=60" }));
  assert.equal(result.pass, false);
});

test("flags a leaked server banner", async () => {
  const result = await checkTarget(TARGETS[0], fakeFetch({ ...good, "x-powered-by": "Express" }));
  assert.ok(result.problems.includes("leaks x-powered-by"));
});

test("flags a redirect or error status", async () => {
  const result = await checkTarget(TARGETS[0], fakeFetch(good, 503));
  assert.equal(result.pass, false);
});

test("reports a network failure instead of throwing", async () => {
  const result = await checkTarget(TARGETS[0], async () => { throw new Error("offline"); });
  assert.equal(result.pass, false);
});
