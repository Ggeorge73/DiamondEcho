// deploy/monitoring/apply.sh with a fake gcloud and curl on PATH: the plan
// changes nothing, --apply creates or updates by name, placeholders are
// filled, and the refusals hold. No network, no Google Cloud.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile, mkdir, rm, chmod, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "apply.sh");
const CHANNEL = "projects/diamondecho-prod/notificationChannels/42";

// The fakes log each call (one line, arguments joined by a tab) and keep a
// copy of any file they were given, so the test can read what was sent.
const FAKE_GCLOUD = `#!/usr/bin/env bash
printf 'gcloud\\t%s\\n' "$*" >> "$FAKE_LOG"
for arg in "$@"; do case "$arg" in --*-from-file=*) f="\${arg#*=}"; cp "$f" "$FAKE_SENT/$(basename "$f")";; esac; done
case "$*" in
  "config get-value account") echo "$FAKE_ACCOUNT" ;;
  "auth print-access-token") echo "fake-access-token" ;;
  "logging metrics describe diamondecho_sre_api_server_errors"*) [ -n "$FAKE_EXISTING" ] && echo found || exit 1 ;;
  "logging metrics describe"*) exit 1 ;;
  "monitoring policies list"*'DiamondEcho SRE: API server errors above 5 percent'*) [ -n "$FAKE_EXISTING" ] && echo "projects/diamondecho-prod/alertPolicies/777" ;;
  "monitoring policies list"*) ;;
  "monitoring dashboards list"*) ;;
  *" create"*|*" update"*|"logging metrics create"*|"logging metrics update"*|"monitoring policies create"*|"monitoring policies update"*|"monitoring dashboards create"*|"monitoring dashboards update"*) echo "projects/diamondecho-prod/x/1" ;;
  *) echo "fake gcloud: unexpected $*" >&2; exit 9 ;;
esac
`;
const FAKE_CURL = `#!/usr/bin/env bash
method=GET; url=""; body=""
while [ $# -gt 0 ]; do
  case "$1" in -X) method="$2"; shift ;; --data-binary) body="\${2#@}"; shift ;; -H) shift ;; -*) ;; *) url="$1" ;; esac
  shift
done
headers="$(cat)"
case "$headers" in *"Bearer fake-access-token"*) ;; *) echo "fake curl: no token on stdin" >&2; exit 9 ;; esac
printf 'curl\\t%s\\t%s\\n' "$method" "$url" >> "$FAKE_LOG"
[ -n "$body" ] && cp "$body" "$FAKE_SENT/$(basename "$body")"
case "$method $url" in
  "GET "*uptimeCheckConfigs*) [ -n "$FAKE_EXISTING" ] && echo '{"uptimeCheckConfigs":[{"name":"projects/diamondecho-prod/uptimeCheckConfigs/home-1","displayName":"DiamondEcho SRE: Home page"}]}' || echo '{}' ;;
  "GET "*/serviceLevelObjectives*) echo '{"serviceLevelObjectives":[{"name":"projects/diamondecho-prod/services/s1/serviceLevelObjectives/o1","userLabels":{"sli":"api-availability"},"displayName":"old name"}]}' ;;
  "GET "*/services*) [ -n "$FAKE_EXISTING" ] && echo '{"services":[{"name":"projects/diamondecho-prod/services/s1","displayName":"DiamondEcho API (Cloud Run diamondecho-api, us-east1)"}]}' || echo '{}' ;;
  "POST "*/services) echo '{"name":"projects/diamondecho-prod/services/new1"}' ;;
  *) echo '{}' ;;
esac
`;

async function harness({ account = "gbenga@example.invalid", existing = false, dir = null } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "sre-apply-"));
  const bin = path.join(root, "bin");
  const sent = path.join(root, "sent");
  await mkdir(bin);
  await mkdir(sent);
  await writeFile(path.join(bin, "gcloud"), FAKE_GCLOUD);
  await writeFile(path.join(bin, "curl"), FAKE_CURL);
  await chmod(path.join(bin, "gcloud"), 0o755);
  await chmod(path.join(bin, "curl"), 0o755);
  const log = path.join(root, "calls.log");
  await writeFile(log, "");
  const env = {
    PATH: `${bin}:${process.env.PATH}`, HOME: root, FAKE_LOG: log, FAKE_SENT: sent, FAKE_ACCOUNT: account,
    FAKE_EXISTING: existing ? "1" : "", PROJECT_ID: "diamondecho-prod", NOTIFICATION_CHANNEL: CHANNEL,
    ...(dir ? { SRE_MONITORING_DIR: dir } : {}),
  };
  const run = (args = [], extra = {}) => exec("bash", [SCRIPT, ...args], { env: { ...env, ...extra } });
  const calls = async () => (await readFile(log, "utf8")).trim().split("\n").filter(Boolean);
  return { root, sent, run, calls, cleanup: () => rm(root, { recursive: true, force: true }) };
}

const MUTATING = /(\tlogging metrics (create|update)|\tmonitoring (policies|dashboards) (create|update)|^curl\t(POST|PATCH|PUT|DELETE))/;

test("the plan reads the project, changes nothing, and lists every definition", async () => {
  const h = await harness({ existing: true });
  try {
    const { stdout } = await h.run();
    const calls = await h.calls();
    assert.ok(calls.length > 0);
    assert.deepEqual(calls.filter((call) => MUTATING.test(call)), []);
    assert.match(stdout, /Mode: plan only/);
    assert.match(stdout, /log-metric\s+update\s+diamondecho_sre_api_server_errors/);
    assert.match(stdout, /log-metric\s+create\s+diamondecho_sre_api_slow_requests/);
    assert.match(stdout, /alert-policy\s+update\s+DiamondEcho SRE: API server errors above 5 percent/);
    assert.match(stdout, /alert-policy\s+create\s+DiamondEcho SRE: uptime check failing from 2 or more places/);
    assert.match(stdout, /dashboard\s+create\s+DiamondEcho SRE: API and uptime/);
    assert.match(stdout, /uptime-check\s+update\s+DiamondEcho SRE: Home page/);
    assert.match(stdout, /slo\s+update\s+API availability/, "an SLO is matched by its sli label, not its name");
    assert.match(stdout, /Nothing was changed/);
    assert.ok(!stdout.includes("fake-access-token"), "the token is never printed");
    const policies = (await readdir(path.join(HERE, "alert-policies"))).filter((name) => name.endsWith(".json")).length;
    assert.equal((stdout.match(/alert-policy\s/g) || []).length, policies);
  } finally {
    await h.cleanup();
  }
});

test("not signed in: the plan still lists everything and reads nothing", async () => {
  const h = await harness({ account: "" });
  try {
    const { stdout } = await h.run();
    assert.deepEqual(await h.calls(), ["gcloud\tconfig get-value account"]);
    assert.match(stdout, /create or update\s+DiamondEcho SRE: API and uptime \(not signed in/);
    const refused = await h.run(["--apply"]).catch((error) => error);
    assert.equal(refused.code, 2);
    assert.match(refused.stderr, /not signed in/);
  } finally {
    await h.cleanup();
  }
});

test("--apply creates what is missing, updates what exists, and fills every placeholder", async () => {
  const h = await harness({ existing: true });
  try {
    const { stdout } = await h.run(["--apply"]);
    assert.match(stdout, /Mode: APPLY/);
    assert.match(stdout, /Nothing was deleted/);
    const calls = await h.calls();
    assert.ok(calls.includes("gcloud\tlogging metrics update diamondecho_sre_api_server_errors --project diamondecho-prod --config-from-file=" + calls.find((c) => c.includes("metrics update")).split("--config-from-file=")[1]));
    assert.ok(calls.some((call) => /^gcloud\tmonitoring policies update projects\/diamondecho-prod\/alertPolicies\/777 --project diamondecho-prod --policy-from-file=/.test(call)));
    assert.ok(calls.some((call) => /^gcloud\tmonitoring policies create --project diamondecho-prod --policy-from-file=.*uptime-check-failing\.json/.test(call)));
    assert.ok(calls.some((call) => /^curl\tPATCH\thttps:\/\/monitoring\.googleapis\.com\/v3\/projects\/diamondecho-prod\/uptimeCheckConfigs\/home-1$/.test(call)));
    assert.ok(calls.some((call) => /^curl\tPATCH\thttps:\/\/monitoring\.googleapis\.com\/v3\/projects\/diamondecho-prod\/services\/s1\/serviceLevelObjectives\/o1$/.test(call)));
    assert.ok(!calls.some((call) => /DELETE|\tdelete /.test(call)), "never deletes");
    for (const name of await readdir(h.sent)) {
      const text = await readFile(path.join(h.sent, name), "utf8");
      assert.ok(!/\$\{[A-Z_]+\}/.test(text), `${name} still has a placeholder`);
      JSON.parse(text);
    }
    const policy = JSON.parse(await readFile(path.join(h.sent, "alert-policies-api-5xx-ratio.json"), "utf8"));
    assert.deepEqual(policy.notificationChannels, [CHANNEL]);
    const metric = JSON.parse(await readFile(path.join(h.sent, "log-metrics-api-server-errors.json"), "utf8"));
    assert.match(metric.filter, /projects\/diamondecho-prod\/logs\/run\.googleapis\.com%2Fstdout/);
  } finally {
    await h.cleanup();
  }
});

test("refusals: no project, a bad channel, --apply in GitHub Actions, a missing channel, an unknown placeholder", async () => {
  const h = await harness();
  try {
    const cases = [
      [[], { PROJECT_ID: "" }, /set PROJECT_ID/],
      [[], { NOTIFICATION_CHANNEL: "realtor@example.com" }, /must look like/],
      [["--apply"], { GITHUB_ACTIONS: "true" }, /refused inside GitHub Actions/],
      [[], { NOTIFICATION_CHANNEL: "" }, /needs NOTIFICATION_CHANNEL/],
      [["--force"], {}, /unknown option/],
    ];
    for (const [args, extra, message] of cases) {
      const error = await h.run(args, extra).catch((caught) => caught);
      assert.equal(error.code, 2, String(message));
      assert.match(error.stderr, message);
    }
    assert.deepEqual((await h.calls()).filter((call) => MUTATING.test(call)), []);

    const odd = path.join(h.root, "defs");
    await mkdir(path.join(odd, "dashboards"), { recursive: true });
    await writeFile(path.join(odd, "dashboards", "x.json"), '{"displayName":"DiamondEcho SRE: x","note":"${SECRET_THING}"}');
    const error = await h.run([], { SRE_MONITORING_DIR: odd }).catch((caught) => caught);
    assert.equal(error.code, 2);
    assert.match(error.stderr, /placeholders this script does not fill: \$\{SECRET_THING\}/);
  } finally {
    await h.cleanup();
  }
});

test("every definition here is JSON, prefixed, and alerts only through the placeholder channel", async () => {
  for (const folder of ["alert-policies", "dashboards"]) {
    for (const name of (await readdir(path.join(HERE, folder))).filter((file) => file.endsWith(".json"))) {
      const doc = JSON.parse(await readFile(path.join(HERE, folder, name), "utf8"));
      assert.match(doc.displayName, /^DiamondEcho SRE: /, name);
      if (folder === "alert-policies") {
        assert.deepEqual(doc.notificationChannels, ["${NOTIFICATION_CHANNEL}"], name);
        assert.equal(doc.conditions.length, 1, `${name}: one condition each (alerting is priced per condition)`);
        assert.ok(doc.documentation?.content?.includes("docs/sre/runbooks/"), `${name}: says which runbook to follow`);
        assert.ok(doc.alertStrategy?.notificationRateLimit, `${name}: rate-limited`);
      }
    }
  }
  for (const name of (await readdir(path.join(HERE, "log-metrics"))).filter((file) => file.endsWith(".json"))) {
    const doc = JSON.parse(await readFile(path.join(HERE, "log-metrics", name), "utf8"));
    assert.match(doc.name, /^diamondecho_sre_/, name);
    assert.match(doc.metricDescriptor.displayName, /^DiamondEcho SRE: /, name);
    // Only the fields the middleware writes, never anything a visitor sent.
    for (const extractor of Object.values(doc.labelExtractors)) assert.match(extractor, /^EXTRACT\(jsonPayload\.(route|status)\)$/, name);
  }
});
