#!/usr/bin/env node
// A stand-in for `gcloud`, for the tests of status.sh, rollback.sh and
// deploy.sh. It keeps a small model of one Cloud Run service in the JSON file
// named by FAKE_STATE, answers the few commands the scripts use, and writes
// every call to FAKE_LOG so a test can see exactly what was run. Any other
// command fails loudly, so a script cannot call something untested.
//
// FAKE_SCENARIO (comma-separated) bends the model:
//   drift         the deploy also changes the memory limit
//   deploy-fails  the deploy command fails
//   no-logs       logging read is refused (no permission)
//   logs-5xx      the new revision has logged a 500
//   logs-5xx-live the new revision logs a 500 once it has visitors
//   traffic-fails update-traffic fails
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const statePath = process.env.FAKE_STATE;
const scenario = new Set((process.env.FAKE_SCENARIO || "").split(",").filter(Boolean));
if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, `gcloud ${args.join(" ")}\n`);

const state = JSON.parse(readFileSync(statePath, "utf8"));
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
const fail = (message, code = 1) => { process.stderr.write(`ERROR: (gcloud) ${message}\n`); process.exit(code); };
const flag = (name) => {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  const joined = args.find((arg) => arg.startsWith(`${name}=`));
  return joined ? joined.slice(name.length + 1) : undefined;
};
const words = args.filter((arg) => !arg.startsWith("-"));
const out = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

function requireTarget() {
  if (flag("--project") !== state.project || flag("--region") !== state.region) fail("wrong project or region", 1);
}
const service = () => state.service;
const revision = (name) => state.revisions.find((item) => item.metadata.name === name);
const tagUrl = (tag) => service().status.url.replace("https://", `https://${tag}---`);

function setTraffic(entries) {
  // Keep tagged entries at 0 percent unless they were given a share.
  const named = new Set(entries.map((entry) => entry.revisionName));
  const tags = service().status.traffic.filter((entry) => entry.tag && !named.has(entry.revisionName))
    .map((entry) => ({ ...entry, percent: 0, latestRevision: undefined }));
  const withTags = entries.map((entry) => {
    const tagged = service().status.traffic.find((item) => item.tag && item.revisionName === entry.revisionName);
    return tagged ? [entry, { revisionName: entry.revisionName, percent: 0, tag: tagged.tag, url: tagged.url }] : [entry];
  }).flat();
  service().status.traffic = [...withTags, ...tags];
}

const [group, resource, verb] = words;
if (group === "run" && resource === "services" && verb === "describe") {
  requireTarget();
  if (words[3] !== state.service.metadata.name) fail("service not found");
  out(service());
} else if (group === "run" && resource === "revisions" && verb === "list") {
  requireTarget();
  out(state.revisions);
} else if (group === "run" && resource === "revisions" && verb === "describe") {
  requireTarget();
  const found = revision(words[3]);
  if (!found) fail(`revision ${words[3]} not found`);
  out(found);
} else if (group === "run" && resource === "deploy") {
  requireTarget();
  if (scenario.has("deploy-fails")) fail("Build failed.");
  if (!args.includes("--no-traffic") || flag("--tag") !== "candidate") fail("the fake only deploys with --no-traffic --tag candidate", 3);
  const commit = (flag("--update-env-vars") || "").replace(/^APP_COMMIT=/, "");
  const template = JSON.parse(JSON.stringify(service().spec.template));
  template.spec.containers[0].image = `us-east1-docker.pkg.dev/p/cloud-run-source-deploy/api@sha256:${commit.padEnd(64, "0").slice(0, 64)}`;
  template.spec.containers[0].env = [...template.spec.containers[0].env.filter((item) => item.name !== "APP_COMMIT"), { name: "APP_COMMIT", value: commit }];
  if (scenario.has("drift")) template.spec.containers[0].resources.limits.memory = "2Gi";
  state.counter += 3;
  const name = `${state.service.metadata.name}-${String(state.counter).padStart(5, "0")}-new`;
  service().spec.template = template;
  state.revisions.unshift({
    metadata: { name, creationTimestamp: "2026-11-13T10:00:00Z", annotations: { ...template.metadata.annotations, "serving.knative.dev/creator": "someone" } },
    spec: template.spec,
    status: { conditions: [{ type: "Ready", status: "True" }] },
  });
  // --no-traffic pins what the latest revision served.
  const serving = service().status.traffic.filter((entry) => entry.percent > 0).map(({ revisionName, percent }) => ({ revisionName, percent }));
  service().status.traffic = [...serving, { revisionName: name, percent: 0, tag: "candidate", url: tagUrl("candidate") }];
  service().status.latestCreatedRevisionName = name;
  service().status.latestReadyRevisionName = name;
  save();
  process.stderr.write(`Service [api] revision [${name}] has been deployed and is serving 0 percent of traffic.\n`);
} else if (group === "run" && resource === "services" && verb === "update-traffic") {
  requireTarget();
  if (scenario.has("traffic-fails")) fail("traffic update failed");
  const toRevisions = flag("--to-revisions");
  if (args.includes("--to-latest")) {
    setTraffic([{ revisionName: service().status.latestReadyRevisionName, percent: 100, latestRevision: true }]);
  } else if (toRevisions) {
    const entries = toRevisions.split(",").map((pair) => {
      const [revisionName, percent] = pair.split("=");
      if (!revision(revisionName)) fail(`revision ${revisionName} not found`);
      return { revisionName, percent: Number(percent) };
    });
    setTraffic(entries);
  } else if (flag("--remove-tags")) {
    const tag = flag("--remove-tags");
    service().status.traffic = service().status.traffic
      .map((entry) => (entry.tag === tag ? { ...entry, tag: undefined, url: undefined } : entry))
      .filter((entry) => entry.percent > 0 || entry.tag);
  } else {
    fail("update-traffic without a change", 3);
  }
  save();
} else if (group === "logging" && resource === "read") {
  if (flag("--project") !== state.project) fail("wrong project");
  if (scenario.has("no-logs")) fail("PERMISSION_DENIED: logging.logEntries.list", 1);
  const filter = words[2] || "";
  const latest = service().status.latestCreatedRevisionName;
  const live = service().status.traffic.some((entry) => entry.revisionName === latest && entry.percent > 0);
  if (filter.includes(`revision_name="${latest}"`) && (scenario.has("logs-5xx") || (scenario.has("logs-5xx-live") && live))) {
    process.stdout.write("500\n");
  }
} else {
  fail(`the fake does not know: ${args.join(" ")}`, 3);
}
