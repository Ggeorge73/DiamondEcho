# Automatic rollback of the API

Written 2026-11-13 by the SRE infrastructure role (an AI collaborator).
**It is switched off.** Nothing here has been run against Google Cloud; the
engine has been tested only with simulated answers (49 tests in
`scripts/sre/remediation-policy.test.mjs` and `scripts/sre/remediate.test.mjs`).
Switching it on needs Gbenga's yes and the one-time setup at the end.

## In one paragraph

Every monitor run, after the incidents are updated, an engine
(`scripts/sre/remediate.mjs`, rules in `scripts/sre/remediation-policy.mjs`)
looks at each open incident and decides whether the one safe automatic fix
applies: moving all of the API's traffic back to the Cloud Run revision that
was serving before the newest one. A *revision* is one deployed version of the
API; the older ones stay in Cloud Run, so going back takes seconds and builds
nothing. For every other problem the engine does nothing except write down
which runbook a person should follow. Every decision is written to a log,
whether it acted or not.

## What it will do

- Run `bash scripts/sre/cloudrun/status.sh` (read-only) to see which revision
  serves and which exist.
- When every guardrail below passes, and only then, run
  `bash scripts/sre/cloudrun/rollback.sh --to <previous revision> --apply`,
  which runs exactly
  `gcloud run services update-traffic diamondecho-api --to-revisions=<previous revision>=100 --project diamondecho-prod --region us-east1`
  and then reads the traffic back and asks `/health`.
- Write the decision, and later whether it worked, to
  `remediation-log.jsonl` on the `sre-status` branch.

Those two commands are the whole allowlist. The engine refuses to start any
other process, and checks the command again just before it runs it.

## What it will never do

- Change an environment variable, a secret, a permission, DNS, scaling, the
  database, or the inquiry queue switch.
- Deploy, build, or delete anything (revisions included).
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
| 8 | Does the failure look like the API breaking: an error (5xx) or no answer, on a check that calls the API? A refusal (401, 403, 429), the form's own 503 (queue off or hourly cap), or a page on Cloudflare Pages does not count | `not-api-fault` |
| 9 | Has there been no automatic attempt in the last 24 hours? | `rollback-limit` |
| 10 | Can Cloud Run be read, with all traffic on one revision? | `cloud-run-unreadable`, `traffic-split`, `serving-unknown` |
| 11 | Did the serving revision start serving no more than 60 minutes before the incident opened, and before it? | `no-recent-deploy`, `incident-before-deploy` |
| 12 | Does the monitor know which revision served before, and is it listed, ready and older? | `no-previous-revision`, `previous-invalid`, `previous-missing`, `previous-not-ready`, `previous-not-older` |
| 13 | Is the new revision new **code**, not only a changed setting? A setting change is a person's decision and is never undone automatically | `settings-only`, `cannot-tell-new-code` |
| 14 | Was the API quiet for 6 hours before the new revision? | `unstable-before-deploy` |
| 15 | Has the engine never gone back to that revision before? | `same-target` |
| 16 | Has the plan been seen on an earlier run, and have the checks failed again since? | `pending-confirmation` (the plan is written down; the next run decides) |

Then:

| Switch | Result | Code |
| --- | --- | --- |
| Off (the normal state) | Logs exactly what it would run; changes nothing | decision `dry-run`, code `would-roll-back` |
| On | Runs the rollback | decision `acted`, code `roll-back`; or `failed` / `rollback-failed`; or `skipped` / `already-serving` if someone else moved the traffic first |
| Two incidents at once (API and form) | One rollback covers both | the second is `covered-by-other` |

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
2. **Proof of new code.** Either `status.sh` reports each revision's container
   image (requested from the release role), or the API publishes `APP_COMMIT`
   (set by the release role's `deploy.sh`, not by a plain
   `gcloud run deploy --source`). Without one of them every case ends in
   `cannot-tell-new-code`.
3. **A Google sign-in for the monitor**, below.

## Switching it on and off

**On** (needs Gbenga's yes): do phases 1 and 2 of the setup below.

**Off, normal way:** GitHub, the repository, Settings, Secrets and variables,
Actions, Variables: change `SRE_AUTOREMEDIATE` to `disabled` (or delete it).
The next monitor run, within about five minutes, is a dry run.

**Off, at once and for certain** (Cloud Shell, needs Gbenga's yes):

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

gcloud's own error messages go only to the workflow log, never to these
files, which are public.

## After an automatic rollback

1. Read the incident issue and the `summary`. The newer revision is still
   there, still broken, with no traffic.
2. The service is now pinned to the older revision: a later settings change
   (`gcloud run services update …`) makes a revision that gets **no**
   traffic. See the release role's `docs/sre/release-safety.md`, "After a
   rollback".
3. Fix the code, deploy as usual (`--no-traffic --tag candidate`, candidate
   checks), then `update-traffic --to-latest`, which also ends the pin.
4. If the rollback did not fix it (`verified: false`), follow
   [api-down.md](runbooks/api-down.md).

## One-time setup (for Gbenga; written, not run)

The monitor signs in to Google Cloud with **Workload Identity Federation**:
GitHub gives each workflow run a short-lived signed statement of which
repository, branch and workflow it is, and Google swaps it for a short-lived
sign-in as one service account. No key is created or stored anywhere.

Run in Cloud Shell, signed in as the project owner. Every command changes
Google Cloud and **needs Gbenga's yes**.

### Phase 1: read-only (the engine still only dry-runs)

```bash
# Turn on the two Google services the sign-in uses.
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com --project diamondecho-prod

# A pool for GitHub, and a provider that accepts ONLY the SRE monitor
# workflow of this repository, running on main.
gcloud iam workload-identity-pools create github-actions \
  --project diamondecho-prod --location global --display-name "GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc diamondecho-sre-monitor \
  --project diamondecho-prod --location global --workload-identity-pool github-actions \
  --display-name "DiamondEcho SRE monitor (main)" \
  --issuer-uri "https://token.actions.githubusercontent.com" \
  --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref,attribute.workflow_ref=assertion.workflow_ref" \
  --attribute-condition "assertion.repository == 'Ggeorge73/DiamondEcho' && assertion.ref == 'refs/heads/main' && assertion.workflow_ref == 'Ggeorge73/DiamondEcho/.github/workflows/sre-monitor.yml@refs/heads/main'"

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

# Let the monitor workflow (and only it, by the provider's condition) sign in as that identity.
gcloud iam service-accounts add-iam-policy-binding \
  diamondecho-sre-monitor@diamondecho-prod.iam.gserviceaccount.com --project diamondecho-prod \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/180189726732/locations/global/workloadIdentityPools/github-actions/attribute.repository/Ggeorge73/DiamondEcho"
```

Then, in GitHub (Settings, Secrets and variables, Actions, **Variables**;
these are names, not secrets):

| Variable | Value |
| --- | --- |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/180189726732/locations/global/workloadIdentityPools/github-actions/providers/diamondecho-sre-monitor` |
| `GCP_SRE_SERVICE_ACCOUNT` | `diamondecho-sre-monitor@diamondecho-prod.iam.gserviceaccount.com` |
| `GCP_PROJECT_ID` | `diamondecho-prod` |
| `GCP_REGION` | `us-east1` |
| `CLOUD_RUN_SERVICE` | `diamondecho-api` |

Check: run the SRE monitor once by hand (Actions, SRE monitor, Run workflow,
on `main`). With no open API incident the summary says "Nothing to decide";
the sign-in step should succeed. Leave phase 1 running for a while: each dry
run shows what the engine would have done with real Cloud Run data.

### Phase 2: allow the rollback (needs a separate yes)

```bash
gcloud iam roles update sreCloudRunRollback --project diamondecho-prod --add-permissions run.services.update
```

Then add the variable `SRE_AUTOREMEDIATE` = `enabled`.

### The permissions, and why each

| Permission | Used by | Why |
| --- | --- | --- |
| `run.services.get` | `status.sh`, `rollback.sh` (`gcloud run services describe`) | Which revision has the traffic; read the traffic back after the change |
| `run.revisions.list` | `status.sh`, `rollback.sh` (`gcloud run revisions list`) | Which revisions exist, when each was created, whether it is ready |
| `run.services.update` | `rollback.sh` (`gcloud run services update-traffic`), phase 2 only | Move the traffic |

Uncertain, to settle on the first try rather than by granting more up front:

- **`run.services.update` is wider than "move traffic".** Google has no
  traffic-only permission; this one would also allow changing the service's
  settings. What keeps the monitor to traffic only is the code (the
  two-command allowlist), the provider's condition (only
  `sre-monitor.yml` on `main`), and that `main` changes only through a pull
  request Gbenga merges. Branch protection on `main` (a repository setting)
  makes that last part enforced rather than habitual.
- **Listing revisions may need a project-level grant.** If `status.sh` fails
  with a permission error on `run.revisions.list`, grant a second custom role
  holding only `run.revisions.list` at the project level
  (`gcloud projects add-iam-policy-binding diamondecho-prod --member … --role …`).
  There is only one Cloud Run service in the project.
- **The traffic change may also ask for `iam.serviceAccounts.actAs`** on the
  API's runtime identity, if Google treats the change as a deploy. If
  `rollback.sh` is refused with a message naming `actAs`, the narrowest fix is
  `roles/iam.serviceAccountUser` on
  `diamondecho-api-runtime@diamondecho-prod.iam.gserviceaccount.com` only, never
  on the project. That is a further widening and a separate yes.
- **`run.operations.get`** may be needed for gcloud to wait for the change.
  Add it only if refused.
- **Reading the service shows its environment variable values** (the staff
  user list among them). `status.sh` keeps them in a temporary folder that it
  deletes, and prints only names, times and readiness; GitHub's runner is
  discarded after each run.

### Today's workflow

`.github/workflows/sre-monitor.yml` (the SRE lead's file) signs in to Google
only when `SRE_AUTOREMEDIATE` is `enabled`. So phase 1 gives the engine no
Cloud Run data until the lead changes the sign-in condition to "the provider
variable is set and the branch is `main`". Without that change, every dry run
of an API incident that passes the file checks ends in `cloud-run-unreadable`.

### Undo the setup

```bash
gcloud iam workload-identity-pools providers disable diamondecho-sre-monitor \
  --workload-identity-pool github-actions --location global --project diamondecho-prod
```

Then remove the variables. Deleting the role, the identity or the pool is a
deletion and is Gbenga's to run.
