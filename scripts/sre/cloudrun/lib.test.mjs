// The parts of lib.mjs that judge what Cloud Run answered.
import test from "node:test";
import assert from "node:assert/strict";
import {
  analysisSummary, appCommitOf, identityOf, settingsFingerprint, tagsOf, rollbackTarget, rolloutSteps, servingOf, settingsDiff, statusDocument, taggedRevision,
} from "./lib.mjs";

const service = (traffic) => ({ status: { traffic } });
const revision = (name, created, ready = true, image) => ({
  metadata: { name, creationTimestamp: created },
  ...(image ? { spec: { containers: [{ image }] } } : {}),
  status: { conditions: [{ type: "Ready", status: ready ? "True" : "False" }] },
});

test("servingOf adds shares per revision and leaves out a 0 percent tag", () => {
  assert.deepEqual(servingOf(service([
    { revisionName: "a", percent: 40 }, { revisionName: "b", percent: 60 }, { revisionName: "a", percent: 0, tag: "candidate" },
  ])), [{ revision: "b", percent: 60 }, { revision: "a", percent: 40 }]);
  assert.deepEqual(servingOf({}), []);
});

test("statusDocument lists revisions newest first with their readiness", () => {
  const doc = statusDocument(service([{ revisionName: "r2", percent: 100, latestRevision: true }]),
    [revision("r1", "2026-10-01T00:00:00Z", true, "img@sha256:1"), revision("r3", "2026-10-03T00:00:00Z", false), revision("r2", "2026-10-02T00:00:00Z", true, "img@sha256:2")]);
  const fingerprint = settingsFingerprint(revision("r1", "x", true, "img@sha256:1"));
  assert.match(fingerprint, /^[0-9a-f]{16}$/);
  assert.deepEqual(doc, {
    serving: [{ revision: "r2", percent: 100 }],
    tags: [],
    revisions: [
      { name: "r3", created: "2026-10-03T00:00:00Z", ready: false, image: "", settings: settingsFingerprint(revision("r3", "x", false)) },
      { name: "r2", created: "2026-10-02T00:00:00Z", ready: true, image: "img@sha256:2", settings: fingerprint },
      { name: "r1", created: "2026-10-01T00:00:00Z", ready: true, image: "img@sha256:1", settings: fingerprint },
    ],
  });
});

test("rollbackTarget accepts only a known, ready revision that is not already serving everything", () => {
  const svc = service([{ revisionName: "r2", percent: 100 }]);
  const revisions = [revision("r1", "1"), revision("r2", "2"), revision("r3", "3", false)];
  assert.equal(rollbackTarget(svc, revisions, "r1"), "ok");
  assert.equal(rollbackTarget(svc, revisions, "r2"), "already");
  assert.equal(rollbackTarget(svc, revisions, "r3"), "not-ready");
  assert.equal(rollbackTarget(svc, revisions, "r9"), "unknown");
  assert.equal(rollbackTarget(service([{ revisionName: "r2", percent: 50 }, { revisionName: "r1", percent: 50 }]), revisions, "r2"), "ok");
});

test("taggedRevision finds the candidate and its address", () => {
  const svc = service([{ revisionName: "r1", percent: 100 }, { revisionName: "r2", percent: 0, tag: "candidate", url: "https://candidate---x.run.app" }]);
  assert.deepEqual(taggedRevision(svc, "candidate"), { revision: "r2", url: "https://candidate---x.run.app" });
  assert.equal(taggedRevision(svc, "other"), null);
});

const withTemplate = (container, annotations = {}) => ({
  spec: { template: { metadata: { annotations }, spec: { containerConcurrency: 1, timeoutSeconds: 30, containers: [container] } } },
});
const container = (overrides = {}) => ({
  image: "img@sha256:1", env: [{ name: "A", value: "1" }, { name: "APP_COMMIT", value: "aaaaaaa" }],
  resources: { limits: { cpu: "1", memory: "1Gi" } }, ...overrides,
});

test("settingsDiff ignores the image, APP_COMMIT and who made the change", () => {
  const before = withTemplate(container(), { "autoscaling.knative.dev/maxScale": "3", "run.googleapis.com/client-version": "1" });
  const after = withTemplate(container({ image: "img@sha256:2", env: [{ name: "APP_COMMIT", value: "bbbbbbb" }, { name: "A", value: "1" }] }),
    { "autoscaling.knative.dev/maxScale": "3", "run.googleapis.com/client-version": "2", "client.knative.dev/user-image": "img" });
  assert.deepEqual(settingsDiff(before, after), []);
});

test("settingsDiff names every other change by setting, never by value", () => {
  const before = withTemplate(container(), { "autoscaling.knative.dev/maxScale": "3" });
  const after = withTemplate(container({ env: [{ name: "A", value: "secret-looking-2" }, { name: "B", value: "x" }], resources: { limits: { cpu: "1", memory: "2Gi" } } }),
    { "autoscaling.knative.dev/maxScale": "10" });
  const diff = settingsDiff(before, after);
  assert.deepEqual(diff, [
    "annotations[autoscaling.knative.dev/maxScale] changed",
    "spec.containers[0].env.A changed",
    "spec.containers[0].env.B was added",
    "spec.containers[0].resources.limits.memory changed",
  ]);
  assert.ok(!diff.join(" ").includes("secret-looking"));
  assert.deepEqual(settingsDiff(before, after, ["spec.containers[0].env.B", "spec.containers[0].env.A",
    "spec.containers[0].resources.limits.memory", "annotations[autoscaling.knative.dev/maxScale]"]), []);
});

test("settingsDiff compares two revisions as well as two services", () => {
  const rev = (memory) => ({ metadata: { annotations: { "serving.knative.dev/routes": "x" } }, spec: { containers: [container({ resources: { limits: { memory } } })] } });
  assert.deepEqual(settingsDiff(rev("1Gi"), { ...rev("1Gi"), metadata: { annotations: {} } }), []);
  assert.deepEqual(settingsDiff(rev("1Gi"), rev("512Mi")), ["spec.containers[0].resources.limits.memory changed"]);
});

test("identityOf passes on only a revision name and a commit", () => {
  assert.deepEqual(identityOf('{"service":"DiamondEcho API","revision":"api-00031-abc","commit":"abcdef1"}'),
    { service: "DiamondEcho API", revision: "api-00031-abc", commit: "abcdef1" });
  assert.deepEqual(identityOf('{"service":"DiamondEcho API","revision":"<b>","commit":null}'),
    { service: "DiamondEcho API", revision: "", commit: "" });
  assert.deepEqual(identityOf("not json"), { service: "", revision: "", commit: "" });
});

test("analysisSummary reads the formula and the four headline figures", () => {
  assert.deepEqual(analysisSummary(JSON.stringify({
    formula_version: "diamond-underwriting-1.8.0",
    metrics: { residual_land_value: { value: 1.5 }, development_profit: { value: -2 }, development_margin: { value: 0.1 }, irr: { value: null } },
  })), { formula: "diamond-underwriting-1.8.0", residual: "1.5", profit: "-2", margin: "0.1", irr: "" });
  assert.equal(analysisSummary("{}").formula, "");
});

test("rolloutSteps accepts rising whole percentages that end at 100", () => {
  assert.deepEqual(rolloutSteps("10 50 100"), [10, 50, 100]);
  assert.deepEqual(rolloutSteps("25,100"), [25, 100]);
  assert.deepEqual(rolloutSteps("100"), [100]);
  for (const bad of ["", "10 50", "50 10 100", "0 100", "10 100 100", "10.5 100", "x 100", "101"]) assert.equal(rolloutSteps(bad), null, bad);
});

test("the settings fingerprint ignores the image, APP_COMMIT and volatile notes, and changes with any setting", () => {
  const rev = ({ image = "img@sha256:1", commit = "aaaaaaa", memory = "1Gi", maxScale = "3", routes = "x" } = {}) => ({
    metadata: { name: "r", annotations: { "autoscaling.knative.dev/maxScale": maxScale, "serving.knative.dev/routes": routes } },
    spec: { containerConcurrency: 1, containers: [{ image, env: [{ name: "A", value: "1" }, { name: "APP_COMMIT", value: commit }], resources: { limits: { memory } } }] },
  });
  const base = settingsFingerprint(rev());
  assert.equal(settingsFingerprint(rev({ image: "img@sha256:2", commit: "bbbbbbb", routes: "y" })), base);
  assert.notEqual(settingsFingerprint(rev({ memory: "2Gi" })), base);
  assert.notEqual(settingsFingerprint(rev({ maxScale: "10" })), base);
  assert.ok(!settingsFingerprint(rev()).includes("1Gi"));
});

test("appCommitOf reads a revision's APP_COMMIT, or nothing", () => {
  assert.equal(appCommitOf({ spec: { containers: [{ env: [{ name: "APP_COMMIT", value: "abcdef1" }] }] } }), "abcdef1");
  assert.equal(appCommitOf({ spec: { containers: [{ env: [{ name: "APP_COMMIT", value: "not a commit" }] }] } }), "");
  assert.equal(appCommitOf({}), "");
});

test("tagsOf lists every traffic tag with its revision", () => {
  assert.deepEqual(tagsOf(service([
    { revisionName: "r1", percent: 100, latestRevision: true },
    { revisionName: "r2", percent: 0, tag: "candidate", url: "https://candidate---x.run.app" },
    { revisionName: "r1", percent: 0, tag: "stable" },
  ])), [{ tag: "candidate", revision: "r2" }, { tag: "stable", revision: "r1" }]);
  assert.deepEqual(tagsOf({}), []);
});
