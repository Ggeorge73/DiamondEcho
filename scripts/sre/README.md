# SRE automation: how the pieces fit

This folder holds the automation that watches diamondecho.com and keeps it
stable. The plain-language guide is `docs/sre/README.md`. This file is the
contract between the scripts: who owns what, what each command reads and
writes, and the rules none of them may break.

## The pipeline

Every few minutes a GitHub Actions run does this, in order:

```
synthetic-checks.mjs  ->  run.json          look at the live site (read-only)
state.mjs record      ->  state dir         file the result, update status.json
alert.mjs             ->  actions.json      open, update or resolve incidents
remediate.mjs         ->  decision.json     decide on a safe automatic fix
state-git.sh commit   ->  sre-status branch save state; the status page reads it
```

Each step is a command that reads files and writes files, so each can be
tested alone. `.github/workflows/sre-monitor.yml` runs them in that order.

## The run document

`synthetic-checks.mjs` writes one JSON document per run. Its shape is defined
and checked in `lib/schema.mjs` (`makeCheck`, `makeRun`, `runProblems`); build
results with those functions, never by hand.

```json
{
  "schema": 1,
  "suite": "fast",
  "started_at": "2026-11-13T00:00:00.000Z",
  "finished_at": "2026-11-13T00:00:04.210Z",
  "vantage": { "provider": "github-actions", "region": "eastus" },
  "commit": "59f8d46…",
  "checks": [
    {
      "id": "public-home",
      "name": "Home page",
      "component": "public-site",
      "severity": "sev1",
      "ok": true,
      "status": 200,
      "latency_ms": 212,
      "detail": "",
      "attempts": 1,
      "slis": ["public-availability", "public-latency"]
    }
  ]
}
```

- `suite`: `fast` (every 5 minutes: pages, API, calculators, inquiry route),
  `slow` (hourly: TLS, DNS, domain registration, third parties), `post-deploy`
  (after a merge to `main`: everything).
- `component`: one of the keys of `COMPONENTS` in `lib/schema.mjs`. Incidents
  and the status page are per component.
- `severity`: how bad it is if this check keeps failing (`sev1` to `sev4`,
  defined in `docs/sre/severity-and-escalation.md`).
- `slis`: names from `slo.config.mjs`. A check that feeds no SLO passes `[]`.
- `detail`: one short sentence for a human. Never a secret, a token, visitor
  data, a request body or a full URL with a query string.

## Check modules

A check module lives in `checks/` and exports:

```js
export const suites = ["fast", "post-deploy"];      // which suites run it
export async function run(ctx) { return [makeCheck({...}), ...]; }
```

`ctx` is `{ fetch, now, targets, env }`: `fetch` is the standard function,
`now()` returns milliseconds, `targets` is `TARGETS.production` from
`targets.mjs`, `env` is the process environment. A module that needs another
transport (a TLS socket, a DNS-over-HTTPS query, an RDAP lookup) brings its
own default and reads an override from `ctx` (for example `ctx.tlsConnect`),
so tests replace everything that touches the network or the clock. A module
never throws for a failed check: it returns the check with `ok: false`. It
throws only for a bug. `synthetic-checks.mjs` imports the modules from a fixed
list: `pages`, `api`, `calculators`, `inquiry`, `search`, `staff`, `tls`,
`dns`, `domain`, `edge`.

A check may report short facts it read from the live service in `observed`,
for example `{ "revision": "diamondecho-api-00028-zin", "commit": "59f8d46" }`
on the API identity check and `{ "commit": "…" }` on the home page check.
`state.mjs` notices when one changes and records a deploy.

## The state directory

A checkout of the `sre-status` branch (an orphan branch that only the
workflows write; nothing on it is ever merged into `main`):

```
status.json              current state of every check and component
history/YYYY-MM-DD.jsonl one compact line per run (UTC day)
incidents.json           alert engine memory: failure streaks, open incidents
remediation-log.jsonl    every automatic-fix decision, acted on or not
reports/YYYY-Www.md      weekly reliability reports
index.html, …            the public status page (copied from status-page/)
```

`status.json`, `history/`, `uptime/daily.json` and `deploys.jsonl` are written
only by `state.mjs`; `incidents.json` only by `alert.mjs`;
`remediation-log.jsonl` only by `remediate.mjs`; `slo.json` only by
`slo-calc.mjs`; `reports/` only by `weekly-report.mjs`. Everyone may read.

`status.json` (read by the status page, the alert engine and remediation):

```json
{
  "schema": 1,
  "updated_at": "2026-11-13T00:00:04.210Z",
  "overall": "operational",
  "components": {
    "public-site": { "name": "Website", "state": "operational", "since": "2026-11-01T10:00:00.000Z", "checks": ["public-home"] }
  },
  "checks": {
    "public-home": {
      "name": "Home page", "component": "public-site", "severity": "sev1", "suite": "fast",
      "ok": true, "status": 200, "latency_ms": 212, "detail": "", "checked_at": "2026-11-13T00:00:01.000Z",
      "consecutive_failures": 0, "last_ok_at": "2026-11-13T00:00:01.000Z", "last_failure_at": null,
      "observed": { "commit": "59f8d46" }
    }
  },
  "last_runs": { "fast": { "at": "2026-11-13T00:00:00.000Z", "region": "eastus" } }
}
```

`overall` and each component `state` are `operational`, `degraded`, `outage`
or `unknown` (no data yet, or the data is stale).

`uptime/daily.json` (the status page's day-by-day bars): component key, then
UTC day, then `{ "runs": 288, "failed": 0 }`, where a run counts as failed for
a component when one of its sev1 or sev2 checks failed in it.

`deploys.jsonl`: one line each time an `observed` revision or commit changes:
`{"at":"…","what":"api","check":"api-identity","fact":"revision","from":"…","to":"…"}`.

`incidents.json` (written by `alert.mjs`; read by the status page, remediation
and the weekly report):

```json
{
  "schema": 1,
  "engine": {},
  "open": [
    {
      "key": "public-site", "component": "public-site", "severity": "sev1",
      "title": "Website is down", "opened_at": "2026-11-13T00:10:00.000Z",
      "failing_checks": ["public-home"], "issue_number": 12, "issue_url": "https://github.com/…/issues/12",
      "updates": [{ "at": "2026-11-13T00:10:00.000Z", "text": "Opened: Home page has failed 2 checks in a row." }]
    }
  ],
  "recent": []
}
```

`engine` is the alert engine's own memory (failure streaks and so on) in any
shape. `recent` holds resolved incidents of the last 90 days, newest first,
each with `resolved_at` and `duration_minutes` added. Texts are public: they
appear on the status page.

`remediation-log.jsonl`: one line per decision:
`{"at":"…","trigger":"api","action":"cloud-run-rollback","decision":"dry-run","reason":"…","from_revision":"…","to_revision":"…","verified":null}`.
`decision` is `acted`, `dry-run`, `skipped` or `failed`. A line may also carry
`code` (the machine reason, for example `no-recent-deploy`), `incident_key`,
`incident_opened_at`, `issue_number`, `runbook`, `summary`, `command`,
`gcloud_command`, `verify`, `verified_at` and `verify_result`. Verification
rewrites the acted line in place (it sets `verified`); it does not append.

`decision.json` (one per run of `remediate.mjs`):
`{ "schema": 1, "at": "…", "mode": "dry-run|apply", "switch": "…", "inputs": {…}, "decisions": [], "verifications": [], "logged": 0, "summary": "…" }`.

`slo.json` (written by `slo-calc.mjs`; read by the alert engine through
`--slo`, by the status page and by the weekly report):

```json
{
  "schema": 1, "generated_at": "…", "window_days": 28,
  "slos": [
    { "id": "public-availability", "name": "Website availability", "component": "public-site",
      "target": 0.999, "accepted": false, "good": 8002, "total": 8010, "attainment": 0.999,
      "budget_remaining": 0.0012, "burn": { "1h": 0, "6h": 1.2, "3d": 0.8 }, "enough_data": true }
  ],
  "burn_alerts": [
    { "slo": "public-availability", "component": "public-site", "severity": "sev2", "window": "1h", "burn_rate": 16.2, "text": "…" }
  ]
}
```

`slo.json` may carry more fields than shown (coverage, budget level, the burn
rule that fired); a `burn` value is `null` when its window holds no data.
`budget_remaining` is the share of the window's error budget still unspent
(1 is untouched, 0 is spent, negative is overspent). `accepted` is false until
Gbenga accepts the target.

One history line (written by `state.mjs`, read by `slo-calc.mjs`):

```json
{"t":"2026-11-13T00:00:00.000Z","suite":"fast","region":"eastus","c":{"public-home":[1,212,["public-availability","public-latency"]]}}
```

`c` maps check id to `[ok as 1 or 0, latency_ms or null, slis]`.

## Commands

| Command | Owner | Reads | Writes |
| --- | --- | --- | --- |
| `node scripts/sre/synthetic-checks.mjs --suite fast\|slow\|post-deploy --out run.json [--fail-on-failure]` | synthetic monitoring | the live site | `run.json` |
| `node scripts/sre/state.mjs record --run run.json --state-dir DIR` | observability | `run.json` | `status.json`, `history/` |
| `bash scripts/sre/state-git.sh checkout DIR` / `commit DIR "message"` | observability | the `sre-status` branch | the `sre-status` branch |
| `node scripts/sre/alert.mjs --run run.json --state-dir DIR --out actions.json [--slo slo.json] [--apply]` | observability | `run.json`, `incidents.json` | `incidents.json`, `actions.json`; with `--apply`, GitHub issues and the optional webhook |
| `node scripts/sre/remediate.mjs --state-dir DIR --out decision.json [--apply]` | infrastructure | state dir | `remediation-log.jsonl`, `decision.json`; with `--apply`, calls `cloudrun/rollback.sh` |
| `bash scripts/sre/cloudrun/status.sh` | release and change safety | Cloud Run | prints `{"serving":[{"revision":"…","percent":100}],"revisions":[{"name":"…","created":"…","ready":true,"image":"…"}]}` |
| `bash scripts/sre/cloudrun/rollback.sh --to REVISION [--apply]` | release and change safety | Cloud Run | with `--apply`, Cloud Run traffic |
| `bash scripts/sre/cloudrun/deploy.sh [--apply]` | release and change safety | the repository | with `--apply`, a new Cloud Run revision |
| `node scripts/sre/slo-calc.mjs --state-dir DIR --window-days 28 --out slo.json` | SLO | `history/` | `slo.json` |
| `node scripts/sre/weekly-report.mjs --state-dir DIR --out report.md [--apply]` | SLO | state dir | `report.md`; with `--apply`, opens (or comments on) that week's `sre-report` issue |

`lib/github.mjs` (observability) is the one way scripts talk to GitHub:
`githubClient({ token, repository, fetch })` returns
`{ ensureLabel(name, color, description), createIssue({ title, body, labels }) -> { number, html_url }, comment(number, body), closeIssue(number), listOpenIssues(label) -> [{ number, title, html_url, labels }] }`.
`token` defaults to `GITHUB_TOKEN` and `repository` to `GITHUB_REPOSITORY`.

Exit codes: 0 means the command did its job (a failed check is data, not an
error); 2 means the command itself broke. `--fail-on-failure` makes
`synthetic-checks.mjs` exit 1 when any check failed (for pull requests and the
post-merge check).

Anything that changes something outside the repository is off unless
`--apply` is given. Without it the command prints what it would do.

Every command that reads the clock honours `SRE_NOW` (an ISO time) when it is
set, so the offline fire drill (`fire-drill.mjs`) and tests can replay hours of
history in seconds. Production runs never set it.

## Rules for every script and workflow

1. **Read-only against production.** GET, HEAD and OPTIONS at a human pace.
   Never load-test production.
2. **Never submit an inquiry and never use up a visitor's allowance.**
   `POST /api/v1/inquiries` counts every well-formed JSON attempt, valid or
   not, against 5 per 10 minutes per sender and 30 per hour per instance
   (`backend/inquiries/limits.py`). A monitor that posts there would lock real
   visitors out. Probe the route without a counted attempt.
3. **Never call the paid routes.** `/api/v1/properties/lookup` (RentCast) and
   `/api/v1/properties/suggest` (Mapbox) cost money per call. The heavy
   calculation routes (`/deals/scenarios`, `/sensitivity`, `/monte-carlo`) are
   limited to 10 per 10 minutes per sender; do not probe them on a schedule.
4. **No visitor data, secrets or tokens** in results, logs, issues, the status
   branch or the status page. No invented numbers anywhere: the status page
   and reports show what was measured, or say there is no data yet.
5. **No new npm or Python packages.** Node built-ins only (`fetch`,
   `node:test`, `node:tls`, `node:dns`), working on Node 20 and 22.
6. **Production changes are off by default.** Anything that touches Google
   Cloud, Cloudflare, DNS or repository settings stays dormant until Gbenga
   supplies the setting and switches it on. Every such need goes in
   `docs/sre/needs-from-gbenga.md`.
7. **Workflows:** top-level `permissions: contents: read`; wider permissions
   per job and only what the job needs; no `pull_request_target`; scheduled
   jobs start with `if: github.repository == 'Ggeorge73/DiamondEcho'`; only
   GitHub's own actions (`actions/*`, `github/*`) plus
   `google-github-actions/auth` and `setup-gcloud` where Google sign-in is
   needed; tools are downloaded at a pinned version with a checksum.
8. **Tests sit next to the code** as `*.test.mjs` and run with
   `node --test`. A test never touches the network.

## Who owns which files

| Role | Files |
| --- | --- |
| SRE lead | this file, `lib/schema.mjs`, `targets.mjs`, `.github/workflows/sre-monitor.yml`, `docs/sre/README.md`, `docs/sre/needs-from-gbenga.md`, `AGENTS.md`, `.claude/agents/sre-*.md`, `.github/workflows/ci.yml` |
| Incident commander | `docs/sre/incident-response.md`, `severity-and-escalation.md`, `postmortem-template.md`, `runbooks/README.md`, `runbooks/_template.md`, `.github/ISSUE_TEMPLATE/`, `status-page/` |
| Observability | `state.mjs`, `state-git.sh`, `alert.mjs`, `alert-policy.mjs`, `lib/github.mjs`, `backend/observability/`, `deploy/monitoring/alert-policies/`, `dashboards/`, `log-metrics/`, `deploy/monitoring/apply.sh`, `docs/sre/observability.md`, `docs/sre/alerting.md`, `runbooks/monitoring-is-blind.md`, `runbooks/inquiry-not-delivered.md` |
| Synthetic monitoring | `synthetic-checks.mjs`, `lib/http.mjs`, `checks/pages.mjs`, `checks/api.mjs`, `checks/calculators.mjs`, `checks/inquiry.mjs`, `checks/search.mjs`, `checks/staff.mjs`, `deploy/monitoring/uptime-checks/`, `docs/sre/synthetic-monitoring.md`, `runbooks/search-provider-down.md` |
| SLO and error budget | `slo.config.mjs`, `slo-calc.mjs`, `weekly-report.mjs`, `.github/workflows/sre-weekly-report.yml`, `deploy/monitoring/slos/`, `docs/sre/slo.md`, `docs/sre/error-budget-policy.md` |
| Infrastructure | `remediate.mjs`, `remediation-policy.mjs`, `deploy/cloud-run.service.yaml`, `docs/sre/architecture.md`, `docs/sre/auto-remediation.md`, `docs/sre/backup-and-restore.md`, `runbooks/site-down.md`, `api-down.md`, `database-unavailable.md`, `dns-problem.md` |
| Release and change safety | `cloudrun/`, `.github/workflows/sre-post-merge-check.yml`, `.github/workflows/sre-deploy-api.yml`, `post-deploy.mjs`, the build identity in `backend/server.py` and the frontend build, `docs/sre/release-safety.md`, `runbooks/bad-deploy.md` |
| Edge security | `checks/tls.mjs`, `checks/dns.mjs`, `checks/domain.mjs`, `checks/edge.mjs`, `deploy/dns/expected-records.json`, `docs/sre/edge.md`, `runbooks/tls-certificate.md`, `domain-expiry.md`, `cloudflare-outage.md`, `traffic-spike-or-abuse.md` |
| Performance and capacity | `tests/load/`, `.github/workflows/sre-load-test.yml`, `perf-budget.mjs`, `docs/sre/capacity.md`, `docs/sre/load-testing.md`, `runbooks/api-slow-or-saturated.md`, `runbooks/provider-quota.md` |
| Chaos and resilience | `tests/chaos/`, `fire-drill.mjs`, `.github/workflows/sre-chaos.yml`, `backend/tests/test_resilience.py`, `docs/sre/chaos-and-game-days.md` |

Paths without a folder are in `scripts/sre/`; runbooks are in
`docs/sre/runbooks/`. An owner edits only their own files. A change needed in
someone else's file goes to that owner or to the SRE lead.
