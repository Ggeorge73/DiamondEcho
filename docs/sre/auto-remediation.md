# Automatic rollback of the API

Written 2026-11-13 by the SRE infrastructure role (an AI collaborator) and
revised the same day after review by the release and security roles.
**It is switched off.** Nothing here has been run against Google Cloud; the
engine has been tested only with simulated answers (54 tests in
`scripts/sre/remediation-policy.test.mjs` and `scripts/sre/remediate.test.mjs`).
Switching it on needs Gbenga's yes and the one-time setup at the end.

## In one paragraph

Every monitor run, after the incidents are updated, an engine
(`scripts/sre/remediate.mjs`, rules in `scripts/sre/remediation-policy.mjs`)
looks at each open incident and decides whether the one safe automatic fix
applies: moving all of the API's traffic back to the Cloud Run revision that
was serving before the newest one. A *revision* is one deployed version of the
API, its code and its settings together; the older ones stay in Cloud Run, so
going back takes seconds and builds nothing. For every other problem the
engine does nothing except write down which runbook a person should follow.
Every decision is written to a log, whether it acted or not.

## What it will do

- Run `bash scripts/sre/cloudrun/status.sh` (read-only) to see which revision
  serves, which exist, their container images and settings fingerprints, and
  which traffic tags exist.
- When every guardrail below passes, and only then, run
  `bash scripts/sre/cloudrun/rollback.sh --to <previous revision> --apply`,
  which runs exactly
  `gcloud run services update-traffic diamondecho-api --to-revisions=<previous revision>=100 --project diamondecho-prod --region us-east1`
  and then reads the traffic back and asks `/health`.
- Write the decision, and later whether it worked, to
  `remediation-log.jsonl` on the `sre-status` branch.

Those two commands are the whole allowlist. The engine refuses to start any
other process, and checks the command again just before it runs it.

**A rollback brings back ALL of the older revision's settings**, not only its
code: every environment variable, the inquiry queue switch
(`INQUIRY_STAFF_QUEUE_ENABLED`) and the allowed origins among them. That is
why the engine only goes back to a revision whose settings fingerprint is the
same as the serving revision's (code `settings-differ` otherwise). A person
rolling back by hand must check the same thing.

## What it will never do

- Change an environment variable, a secret, a permission, DNS, scaling, the
  database, or the inquiry queue switch, either directly or by going back to a
  revision whose settings differ.
- Deploy, build, or delete anything (revisions included).
- Act while a deploy is in progress (a `candidate` tag, or traffic split).
- Act on the website, the staff site, search, DNS, certificates or the domain.
- Act more than once in 24 hours, or go back to the same revision twice.
- Act on a fixed clock (`SRE_NOW` set): replays and drills are always dry runs.
- Retry. A second failure is a person's job.

## How it decides

An incident goes through these questions in order. The first "no" stops it
with a reason; that reason is logged and shown in the run summary.

| # | Question | If not: code in the log |
| --- | --- | --- |
| 1 | Is the incident on the API, the inquiry form or the calculators? | `no-automatic-fix` (with the runbook) |
| 2 | Is it sev1 or sev2? | `severity-too-low` |
| 3 | Can the engine read its own log? | `log-unreadable` |
| 4 | Did the incident open less than 60 minutes ago? After that a person may be on it | `incident-too-old` |
| 5 | Is the monitoring data fresh (less than 20 minutes old)? | `status-stale` |
| 6 | Is a sev1 or sev2 check of that part failing now, twice in a row or more? | `checks-pass-now`, `not-confirmed` |
| 7 | Are the website and DNS healthy (no open incident, no sev1/sev2 check failing, at least one passing recently)? If not, the cause is likely the network, a provider or the monitor | `site-or-dns-unhealthy` |
| 8 | Does the failure look like the API breaking? For the API's own checks: any answer except a refusal (401, 403, 429), or no answer. For the form and calculators: only checks that call the API count, and only a 500, 502 or 504 or no answer (for the calculators also 503; for the form a 503 is its own "queue off or hourly cap" answer and does not count). A page on Cloudflare Pages never counts | `not-api-fault` |
| 9 | Has there been no automatic attempt in the last 24 hours? | `rollback-limit` |
| 10 | Can Cloud Run be read, with all traffic on one revision and no `candidate` tag (and does status.sh say which tags exist)? | `cloud-run-unreadable`, `deploy-in-progress`, `serving-unknown` |
| 11 | Did the serving revision start serving no more than 60 minutes before the incident opened, and before it? | `no-recent-deploy`, `incident-before-deploy` |
| 12 | Does the monitor know which revision served before, and is it listed, ready and older? | `no-previous-revision`, `previous-invalid`, `previous-missing`, `previous-not-ready`, `previous-not-older` |
| 13 | Is the new revision new **code** (a different container image, or the published commit changed with it)? A setting-only change is a person's decision | `settings-only`, `cannot-tell-new-code` |
| 14 | Do both revisions report the same settings fingerprint? A missing fingerprint counts as different | `settings-differ` |
| 15 | Was the API quiet for 6 hours before the new revision? | `unstable-before-deploy` |
| 16 | Has the engine never gone back to that revision before? | `same-target` |
| 17 | Has the plan been seen on an earlier run, and have the checks failed again since? | `pending-confirmation` (the plan is written down; the next run decides) |

Then:

| Switch | Result | Code |
| --- | --- | --- |
| Off (the normal state) | Logs exactly what it would run; changes nothing | decision `dry-run`, code `would-roll-back` |
| On | Runs the rollback | decision `acted`, code `roll-back`; or `failed` / `rollback-failed`; or `skipped` / `already-serving` if someone else moved the traffic first |
| Two incidents at once (API and form) | One rollback covers both | the second is `covered-by-other` |

If `rollback.sh` does not finish within 4 minutes, the engine stops it and
every process it started (the whole process group, gcloud included) and logs
`failed`, saying that the traffic change may already have been sent and a
person must run `status.sh`.

After acting, each later run checks the result. It is `verified: true` when
the checks that were failing pass again and the API reports the old revision;
`false` when they still fail 30 minutes later, when the API reports a third
revision, or when there is no evidence after 24 hours.

### Why these numbers

They are policy choices, written in one place (`LIMITS` in
`remediation-policy.mjs`), not measurements:

- **Two failed runs**: one failure can be a blip.
- **60 minutes from serving**: a broken build fails on its first requests. In
  the two production redeploys with exact clock times in
  `docs/de13-production-setup.md`, the new revision took the traffic about 12
  and about 2 minutes after it was created. When the monitor did not see the
  moment of the switch, the creation time is used, which is stricter.
- **6 quiet hours**: if the API was already failing, the new revision may be
  someone's fix.
- **24 hours, never the same target twice**: an automatic fix that did not
  work once will not be tried again without a person.

## What it needs before it can ever act

Today it could not act even if switched on, and that is safe:

1. **The API must publish its revision.** The monitor learns which revision
   served before from `GET /api/`. Production (revision 28, `90739bd`)
   answered only `{"service":"DiamondEcho API"}` on 2026-11-13; the revision
   and commit fields are in `backend/server.py` on this branch and arrive with
   the next API deploy.
2. **`status.sh` must report each revision's `image`, its `settings`
   fingerprint, and the service's traffic `tags`.** It reports `image` now;
   `settings` is being added by the release role; until `tags` is reported
   every case ends in `deploy-in-progress`, and until `settings` is reported,
   in `settings-differ`.
3. **A Google sign-in for the monitor**, below.

## Switching it on and off

**On** (needs Gbenga's yes): do phases 1 and 2 of the setup below.

**Off** (needs no yes; do both):

1. GitHub, the repository, Settings, Secrets and variables, Actions,
   Variables: change `SRE_AUTOREMEDIATE` to `disabled` (or delete it). The
   next monitor run, within about five minutes, is a dry run.
2. In Cloud Shell, take away the permission to move traffic. It takes effect
   within a few minutes:
   ```bash
   gcloud iam roles update sreCloudRunRollback --project diamondecho-prod --remove-permissions run.services.update
   ```
   The monitor can then still read Cloud Run but cannot move traffic.

## Reading the log

The log is `remediation-log.jsonl` on the `sre-status` branch, one line per
decision; a decision the same as the last one for its incident is not
repeated every five minutes. To read the last five:

```bash
git fetch origin sre-status && git show origin/sre-status:remediation-log.jsonl | tail -n 5
```

Each line has `at`, `trigger` (the part), `action`, `decision` (`acted`,
`dry-run`, `skipped`, `failed`), `reason`, `from_revision`, `to_revision`,
`verified`, and also `code` (the table above), `incident_key`,
`issue_number`, `runbook` and `summary`, a sentence the incident issue can
quote. An acted line also has `command`, `gcloud_command`, `verify` (the
checks to watch) and, once known, `verified_at` and `verify_result`.

Each run also writes `decision.json` (in the workflow's temporary folder; its
`summary` is shown on the run's summary page): the switch state, what could
be read, this run's decisions and any rollback being verified.

**Everything here is public.** The repository is public, so the `sre-status`
branch, the workflow logs and the run summaries can be read by anyone. The
log and `decision.json` hold revision names, check names and reasons, never
settings or values. gcloud's own error output goes only to the workflow log;
it can name accounts (such as the monitor's service account) but holds no
secret.

## After an automatic rollback

1. Read the incident issue and the `summary`. The newer revision is still
   there, still broken, with no traffic.
2. **The service is now pinned** to the older revision, and its template
   still names the broken revision's image. Two traps follow:
   - **`update-traffic --to-latest` puts the broken revision back on 100
     percent.** Do not run it until `status.sh` shows that the newest
     revision is one you want serving (a fixed deploy, or the settings change
     below).
   - **A plain settings change** (`gcloud run services update … --update-env-vars …`)
     makes a revision that runs the **broken** image and gets **no** traffic,
     so the setting does not actually change for visitors.
   The release role's [release-safety.md](release-safety.md), "After a
   rollback", is the full procedure; the short form is next.
3. **To change a setting while pinned**, give the new revision the serving
   revision's image and commit, check, and only then move the traffic:
   ```bash
   bash scripts/sre/cloudrun/status.sh            # note the image of the revision at 100 percent
   curl -sS https://diamondecho-api-180189726732.us-east1.run.app/api/   # note its commit, if it names one
   gcloud run services update diamondecho-api --project diamondecho-prod --region us-east1 \
     --image SERVING_IMAGE --update-env-vars NAME=VALUE,APP_COMMIT=SERVING_COMMIT
   bash scripts/sre/cloudrun/status.sh            # the newest revision: SERVING_IMAGE, ready
   gcloud run services update-traffic diamondecho-api --to-latest --project diamondecho-prod --region us-east1
   ```
   Leave out `APP_COMMIT=…` if `/api/` names no commit. **Needs Gbenga's
   yes.** Worked when: `status.sh` shows the new revision at 100 percent.
4. Fix the code and deploy as usual (`--no-traffic --tag candidate`,
   candidate checks); `update-traffic --to-latest` then sends traffic to the
   fixed revision and ends the pin.
5. If the rollback did not fix it (`verified: false`), follow
   [api-down.md](runbooks/api-down.md).

## One-time setup (for Gbenga; written, not run)

The monitor signs in to Google Cloud with **Workload Identity Federation**:
GitHub gives each workflow run a short-lived signed statement of which
repository, branch, workflow and event it is, and Google swaps it for a
short-lived sign-in as one service account. No key is created or stored
anywhere.

Run in Cloud Shell, signed in as the project owner. Every command that
changes Google Cloud **needs Gbenga's yes**.

### Phase 0: read the repository's numbers (read-only)

Google checks the repository by its numeric IDs as well as its name, because
a name can be reused after a rename or deletion; an ID cannot.

```bash
curl -sS https://api.github.com/repos/Ggeorge73/DiamondEcho \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("repository_id", d["id"]); print("repository_owner_id", d["owner"]["id"])'
```

On 2026-11-13 this read `repository_id 1093987105` and
`repository_owner_id 214499884`. Use the numbers it prints if they differ.

### Phase 1: read-only (the engine still only dry-runs)

```bash
# Turn on the two Google services the sign-in uses.
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com --project diamondecho-prod

# A pool used for nothing but the SRE monitor, and a provider that accepts
# ONLY the SRE monitor workflow of this repository, on main, run on its
# schedule or by hand.
gcloud iam workload-identity-pools create diamondecho-sre-monitor \
  --project diamondecho-prod --location global --display-name "DiamondEcho SRE monitor"
gcloud iam workload-identity-pools providers create-oidc github \
  --project diamondecho-prod --location global --workload-identity-pool diamondecho-sre-monitor \
  --display-name "GitHub: sre-monitor.yml on main" \
  --issuer-uri "https://token.actions.githubusercontent.com" \
  --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref,attribute.workflow_ref=assertion.workflow_ref,attribute.event_name=assertion.event_name" \
  --attribute-condition "assertion.repository_id == '1093987105' && assertion.repository_owner_id == '214499884' && assertion.repository == 'Ggeorge73/DiamondEcho' && assertion.ref == 'refs/heads/main' && assertion.workflow_ref == 'Ggeorge73/DiamondEcho/.github/workflows/sre-monitor.yml@refs/heads/main' && assertion.event_name in ['schedule', 'workflow_dispatch']"

# The monitor's own identity. It is not the API's runtime identity.
gcloud iam service-accounts create diamondecho-sre-monitor \
  --project diamondecho-prod --display-name "SRE monitor: read and roll back diamondecho-api"

# A custom role with only what status.sh needs, granted on the one service.
gcloud iam roles create sreCloudRunRollback --project diamondecho-prod \
  --title "SRE: read and roll back diamondecho-api" \
  --description "Read the service and its revisions; in phase 2 also move its traffic. Granted on diamondecho-api only." \
  --permissions run.services.get,run.revisions.list --stage GA
gcloud run services add-iam-policy-binding diamondecho-api \
  --project diamondecho-prod --region us-east1 \
  --member "serviceAccount:diamondecho-sre-monitor@diamondecho-prod.iam.gserviceaccount.com" \
  --role "projects/diamondecho-prod/roles/sreCloudRunRollback"

# Let exactly that workflow sign in as that identity.
gcloud iam service-accounts add-iam-policy-binding \
  diamondecho-sre-monitor@diamondecho-prod.iam.gserviceaccount.com --project diamondecho-prod \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/180189726732/locations/global/workloadIdentityPools/diamondecho-sre-monitor/attribute.workflow_ref/Ggeorge73/DiamondEcho/.github/workflows/sre-monitor.yml@refs/heads/main"
```

If Google refuses the last member's form (the workflow name holds `/` and
`@`), bind the whole pool instead, which is equally narrow because the pool
has only this one provider and its condition already names the workflow:
`--member "principalSet://iam.googleapis.com/projects/180189726732/locations/global/workloadIdentityPools/diamondecho-sre-monitor/*"`.

Then, in GitHub (Settings, Secrets and variables, Actions, **Variables**;
these are names, not secrets):

| Variable | Value |
| --- | --- |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/180189726732/locations/global/workloadIdentityPools/diamondecho-sre-monitor/providers/github` |
| `GCP_SRE_SERVICE_ACCOUNT` | `diamondecho-sre-monitor@diamondecho-prod.iam.gserviceaccount.com` |
| `GCP_PROJECT_ID` | `diamondecho-prod` |
| `GCP_REGION` | `us-east1` |
| `CLOUD_RUN_SERVICE` | `diamondecho-api` |

From then on the monitor signs in on every run from `main`, read-only.
`SRE_AUTOREMEDIATE` decides only whether `--apply` is passed.

### Check the sign-in (read-only)

The engine only asks Cloud Run during an API incident, so a missing
permission would otherwise show up for the first time in an incident. Check
it the day the setup is done: GitHub, Actions, SRE monitor, Run workflow, on
`main`. The access check (`node scripts/sre/remediate.mjs --check-access --out access.json`,
which calls `status.sh` once and changes nothing) prints one line in the
run's summary:

- Good: `Cloud Run read: N revisions of diamondecho-api; serving diamondecho-api-… 100%.`
- Also good, but the engine stays inert until the release role finishes
  `status.sh`: the same line ending `status.sh did not report …`.
- Bad: `The monitor could not read Cloud Run (…)`. The workflow log's gcloud
  message says which permission is missing.

If the message names `run.revisions.list`, listing revisions needs a
project-level grant. Grant a second role holding only that one read
permission (it covers every Cloud Run service in the project; there is one):

```bash
gcloud iam roles create sreCloudRunRevisionsList --project diamondecho-prod \
  --title "SRE: list Cloud Run revisions" --permissions run.revisions.list --stage GA
gcloud projects add-iam-policy-binding diamondecho-prod \
  --member "serviceAccount:diamondecho-sre-monitor@diamondecho-prod.iam.gserviceaccount.com" \
  --role "projects/diamondecho-prod/roles/sreCloudRunRevisionsList" --condition None
```

Then run the workflow again. Leave phase 1 running for a while: each dry run
shows what the engine would have done with real Cloud Run data.

### Phase 2: allow the rollback (needs a separate yes)

```bash
gcloud iam roles update sreCloudRunRollback --project diamondecho-prod --add-permissions run.services.update
```

Then add the variable `SRE_AUTOREMEDIATE` = `enabled`.

### The permissions, and why each

| Permission | Where | Used by | Why |
| --- | --- | --- | --- |
| `run.services.get` | the service | `status.sh`, `rollback.sh` (`gcloud run services describe`) | Which revision has the traffic; read the traffic back after the change |
| `run.revisions.list` | the service (project only if refused) | `status.sh`, `rollback.sh` (`gcloud run revisions list`) | Which revisions exist, when each was created, whether it is ready |
| `run.services.update` | the service, phase 2 only | `rollback.sh` (`gcloud run services update-traffic`) | Move the traffic |

What `run.services.update` really allows, said plainly: Google has no
traffic-only permission. Held by the monitor, it would also allow sending
traffic to **any** kept revision (for example `diamondecho-api-00001-lj9`,
which has the inquiry queue switched off and old origins), and changing the
service's settings. What keeps the monitor to "the previous revision, traffic
only" is the code (the two-command allowlist and the guardrails), the
provider's condition (only `sre-monitor.yml` on `main`), and that `main`
changes only through a pull request Gbenga merges. To make that safer:

- **Branch protection on `main`** (a repository setting), so the last part
  is enforced rather than a habit.
- **An alert on every change the monitor's account makes.** A log-based alert
  in Cloud Monitoring on admin-activity audit entries by that account; the
  filter is
  `logName="projects/diamondecho-prod/logs/cloudaudit.googleapis.com%2Factivity" AND protoPayload.authenticationInfo.principalEmail="diamondecho-sre-monitor@diamondecho-prod.iam.gserviceaccount.com"`.
  The observability role keeps the alert policies (`deploy/monitoring/`).
- **Delete old revisions nobody needs**, so there are fewer to send traffic
  to by mistake. Keep the serving one and the fallbacks named in
  `docs/de13-production-setup.md`. Each deletion is Gbenga's
  (`gcloud run revisions delete REVISION --project diamondecho-prod --region us-east1`).

Never granted:

- **`iam.serviceAccounts.actAs` on the API's runtime identity.** If the
  traffic change turns out to require it (the refusal would name `actAs`),
  automatic rollback stays off. Holding it would let the monitor act as the
  identity that reads the visitors' requests.
- Anything at project level beyond the one revision-list fallback above.

Uncertain until tried: whether gcloud also needs `run.operations.get` to wait
for the change. Add it only if refused.

Reading the service also returns its environment variable values (the staff
user list among them). `status.sh` keeps them in a temporary folder that it
deletes, and prints only names, times, images, readiness and a fingerprint;
GitHub's runner is discarded after each run.

### Undo the setup

```bash
gcloud iam workload-identity-pools providers update-oidc github \
  --workload-identity-pool diamondecho-sre-monitor --location global --project diamondecho-prod --disabled
```

Then remove the variables. Deleting the role, the identity or the pool is a
deletion and is Gbenga's to run.
