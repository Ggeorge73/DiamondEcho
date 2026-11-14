# Release safety

How a change reaches diamondecho.com, the checks it must pass on the way, and
how to undo it. Most outages start with a change, so every change here is
checked before visitors see it, moved over gradually where that is possible,
and can be undone in a minute.

Words used below:

- A **revision** is one deployed version of the API on Cloud Run. Old
  revisions are kept, so going back to one takes seconds.
- **Traffic** is the share of visitors' requests a revision answers.
- A **candidate** is a new revision that has been started with no traffic,
  reachable only at its own temporary address (its **tag**, `candidate---…`).
- A **gate** is a check that must pass before the next step. A failed gate
  stops the change and undoes it.
- A **rollback** puts the previous version back. It never rebuilds anything.

Nothing in this document switches itself on. Each automatic part stays
dormant until Gbenga supplies the setting it needs; the list is in
[needs-from-gbenga.md](needs-from-gbenga.md) and at the end of this page.

## How a change reaches production

| Part | Today, before this work | With this work |
| --- | --- | --- |
| Public site | Merging to `main` makes Cloudflare Pages build and publish the site within minutes. Nothing checks it afterwards. | The same, then the **post-merge check** waits until Cloudflare Pages reports the new build as published and runs the monitor's own checks (API, inquiry route, redirects). A failed build or check opens an `sre-incident` issue with the rollback steps. Nothing checks that the pages of the new build load: no check loads a page (Gbenga's decisions of 2026-11-14). Site rollback is by hand: no page check is left to trigger the automatic one. |
| API | Gbenga deploys by hand from Cloud Shell: new revision with no traffic, a few checks at its temporary address, then all traffic at once (`docs/de13-production-setup.md`). | The same steps as one script, `deploy.sh`, with every check written down, traffic moved in steps with a gate after each, and an automatic return to the old revision on any failure. Run from Cloud Shell as today, or later from a GitHub workflow that asks Gbenga to approve each run. |
| Staff site | Cloudflare Pages, built from `main`. | Unchanged. The monitor checks that the staff API asks for sign-in; the staff page itself is not loaded. |

A merge never changes the API. The API changes only when someone deploys it.

## Which build is live

Two public addresses say what is running, so anyone can check without a
cloud sign-in:

```bash
curl -s https://diamondecho.com/version.json
# {"commit":"<the commit the site was built from>","built_at":"…"}
curl -s https://diamondecho-api-180189726732.us-east1.run.app/api/
# {"service":"DiamondEcho API","revision":"diamondecho-api-000NN-xxx","commit":"<commit>"}
```

- `version.json` is written by `scripts/copy-build.mjs` at the end of
  `npm run build`, into `build/`, the folder Cloudflare Pages publishes (the
  Pages project's build command is `npm run build` and its output folder is
  `build`, per `docs/pages-cloud-run-firebase-runbook.md`; the dashboard
  setting itself has not been read by an agent). The commit comes from
  Cloudflare's `CF_PAGES_COMMIT_SHA`, else GitHub's `GITHUB_SHA`, else
  `unknown`.
- The API's `revision` comes from Cloud Run; its `commit` is the setting
  `APP_COMMIT`, which `deploy.sh` sets. Both are `null` until the first
  API deploy that includes this change.
- **`APP_COMMIT` goes stale after a hand deploy.** A plain
  `gcloud run deploy --source backend` keeps the `APP_COMMIT` of the last
  scripted deploy, so `/api/` would name the wrong commit, and the monitor and
  the automatic rollback would reason from it. Deploy with the script, or add
  `--update-env-vars APP_COMMIT=$(git rev-parse HEAD)` to the hand command.
- Nothing else is published on either address.
- `version.json` answers a browser or a plain `curl` from a home or office
  connection. It answers 403 to GitHub's runners (Cloudflare's Bot Fight
  Mode), so the monitor and the post-merge check cannot read it; see the
  next section.

## The post-merge check (public site)

`.github/workflows/sre-post-merge-check.yml` runs after every merge to `main`:

1. It waits, looking every 30 seconds for up to 15 minutes, until the new
   build is published. It asks `https://diamondecho.com/version.json`
   first. Cloudflare's Bot Fight Mode (on by Gbenga's decision of
   2026-11-14) answers 403 to GitHub's runners there, so on a 403 it asks
   GitHub instead for the check run named "Cloudflare Pages: diamondecho",
   which Cloudflare Pages itself reports for the merged commit
   (`pagesBuildState` in `scripts/sre/post-deploy.mjs`; the job has the
   read-only permission `checks: read` for this). "Success" there means the
   build was published. "Failure" opens the incident at once, without
   waiting out the 15 minutes: the previous build is still serving.
2. It runs `node scripts/sre/synthetic-checks.mjs --suite post-deploy`. All
   checks are read-only; no inquiry is sent. This suite now holds only what
   the monitor asks itself: the API, the reference calculation, the inquiry
   route, the staff API, the redirects, and two DNS questions. **It contains
   no page check.** So "published" is proven here, and **nothing verifies
   that the pages of the new build load**: not this check, and not the
   5-minute monitor, which loads no page either
   ([synthetic-monitoring.md](synthetic-monitoring.md)). After a merge that
   changes the site, open it yourself.
3. It notes whether the live API is behind `main` for backend changes. That
   is expected after a backend merge (the API is deployed by hand) and does
   not fail the run.
4. If the build never appears, or a check fails, the run fails and opens one
   issue titled "Post-merge check failed for …" (or adds to the open one),
   naming the merge, what failed and the rollback steps. When a later merge
   passes, it closes that issue.
5. **Automatic site rollback can no longer be triggered.** It needs a
   failing page check, and the post-deploy suite no longer contains one. The
   code and its switch are kept, and rolling back by hand is unchanged
   ("Rolling back the website" below). For the record, it would act only
   when all of these hold:
   - the merged build itself is the live one (not a later merge that
     includes it: that merge's own check decides);
   - a website check of severity 1 or 2 failed that a rollback could fix: not
     a refusal by Cloudflare itself (a security setting, the same for every
     build) and not the www redirect (a Cloudflare zone rule);
   - the same check failed again on a second look about a minute later;
   - the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` exist in
     the GitHub environment `pages-rollback`, and the repository variable
     `SRE_PAGES_AUTOROLLBACK` is `enabled`.

   Otherwise the issue says why nothing was rolled back, or what it would
   have put back. Today that is always "no failed website check that a
   rollback could fix". The conditions could be met again only if the
   post-merge check ran with `SRE_PAGE_SOURCE=direct` from a network
   Cloudflare lets through, which GitHub's runners are not.

If the build never appears it never rolls back: the old build is still
serving, and rolling back would go one build further back than wanted.

The Cloudflare secrets are **environment** secrets, not repository secrets:
GitHub, the repository, Settings, Environments, New environment
`pages-rollback`; under "Deployment branches and tags" choose "Selected
branches" and add `main` only; no required reviewer (the check must not wait
for a person); then add the two secrets there. A workflow run from any other
branch cannot read them.

Why it works this way: Cloudflare answers `403` to GitHub's runners on every
page of diamondecho.com, `/version.json` included (measured in monitor run
27, 2026-11-14). Gbenga decided the same day that Bot Fight Mode stays on
(on the Free plan no rule can exempt the runners), that no outside
monitoring service is added, and that nothing checks the hosting address
behind Cloudflare. So the post-merge check does not depend on reading the
site. The build result it reads comes from GitHub, where Cloudflare Pages
reports it; that is not an outside service. It runs only once the repository
variable `SRE_MONITOR` is `enabled` (item 1.1 of
[needs-from-gbenga.md](needs-from-gbenga.md)); a run started by hand always
runs.

Known limits of this:

- The check run's name, "Cloudflare Pages: diamondecho", is the one seen on
  this repository's pull requests and merges. If Cloudflare renames it, or
  the Pages project is renamed, the check finds no result, waits its 15
  minutes and reports that the build did not appear. The name is in one
  place, `PAGES_CHECK_NAME`.
- A build that publishes but serves a broken or empty page passes the
  post-merge check, and nothing else catches it: no automatic check loads a
  page. No incident opens, and nothing rolls it back automatically. A known
  gap, decided by the owner (item 1.2a of
  [needs-from-gbenga.md](needs-from-gbenga.md)). A failed build is
  different: that still opens the incident.

## Deploying the API

`scripts/sre/cloudrun/deploy.sh` is the hand procedure of
`docs/de13-production-setup.md` as one command. In Cloud Shell, signed in as
today:

```bash
git clone https://github.com/Ggeorge73/DiamondEcho && cd DiamondEcho   # or: git checkout main && git pull
git log --oneline -1                                   # the commit you mean to deploy
bash scripts/sre/cloudrun/deploy.sh --commit <commit>  # dry run: reads, prints every command
bash scripts/sre/cloudrun/deploy.sh --commit <commit> --apply
```

What `--apply` does, in order. Any failure stops it.

| # | Step or gate | Passes when | If it fails |
| --- | --- | --- | --- |
| 1 | Checkout | Nothing uncommitted, no ignored files in `backend/` (they would be uploaded), at `--commit`, and on `origin/main` | Stops. Nothing changed. |
| 2 | What serves now | One revision has 100 percent; it is remembered as the fallback | Stops. Settle split traffic first. |
| 3 | Build the candidate | `gcloud run deploy … --no-traffic --tag candidate --update-env-vars APP_COMMIT=<commit>` makes a new, ready revision. No other setting is passed | Stops. No traffic moved. |
| 4 | Settings | The service before and after the deploy, and the serving revision against the new one, differ only in the image and `APP_COMMIT`. Differences are named by setting, never by value | Refused. The candidate keeps 0 percent. |
| 5 | Candidate checks, at the tagged address | `/health` 200; `/api/` names the new revision and this commit; the staff list with no sign-in 401 (or 503); `/docs` and `/openapi.json` 404; the reference land request (`backend/tests/deal_intelligence/candidate_land_equity_first.json`) answers 200 with this commit's `FORMULA_VERSION`; no answer of 500 or more in the new revision's logs | Refused. The candidate keeps 0 percent. |
| 6 | 10 percent, watched 2 minutes | Four probes of the candidate's `/health` and `/api/` pass, and the new revision logged no 500-or-more answer | All traffic back to the fallback. |
| 7 | 50 percent, watched 2 minutes | The same | All traffic back to the fallback. |
| 8 | 100 percent (`--to-latest`), watched 2 minutes | The same, and the service's own address is answered by the new revision | All traffic back to the fallback. |
| 9 | Tidy | The `candidate` tag is removed | A warning only. |

At the end it prints a record block (standard output). Paste it into
`docs/de13-production-setup.md` and add the row to the revision table there.
The build took about a minute in the recorded redeploys; with the default
steps the whole run takes about ten minutes.

Exit codes: `0` deployed (or dry run); `1` refused or rolled back, the old
revision serves; `2` could not start, nothing moved; `3` a rollback was needed
and did not complete: follow [runbooks/bad-deploy.md](runbooks/bad-deploy.md)
at once. Stopping the script part-way (Ctrl-C) also rolls back, and a second
Ctrl-C does not interrupt that rollback (it runs in a session of its own).

A refused or rolled-back run leaves the service **pinned** to the old
revision, with the refused image still in the service's template: read
"After a rollback" before changing any setting. The script prints the exact
safe command.

Settings, all optional: `GCP_PROJECT_ID` (default `diamondecho-prod`),
`GCP_REGION` (`us-east1`), `CLOUD_RUN_SERVICE` (`diamondecho-api`),
`DEPLOY_STEPS` (`10 50 100`), `DEPLOY_GATE_SECONDS` (`120`),
`DEPLOY_GATE_PROBES` (`4`), `DEPLOY_LOG_GATE` (`on`; `off` skips the log
reads if the signed-in account cannot read logs), and
`DEPLOY_IGNORE_SETTINGS` (setting names the comparison may ignore, for a
settings change Gbenga has agreed to make in the same deploy).

### Deploying from GitHub

`.github/workflows/sre-deploy-api.yml` runs the same script. Start it by hand
from `main`, give the full 40-character commit, and type
`deploy diamondecho-api`. GitHub then asks Gbenga to approve the run (the
`production` environment), and the record appears on the run's summary page.
Only commits that contain `deploy.sh` can be deployed this way.

**Do not cancel a running deploy.** If a run is cancelled or times out, its
last step (`scripts/sre/cloudrun/cleanup.sh`) gives the traffic back to the
revision that served before and removes the candidate tag, but a rollout left
to finish, or to roll itself back, is cleaner.

It stops with a message until all of this exists. **Do not switch it on
before Cloud Build runs as a service account of its own:** today builds may
run as the default compute account, which holds Editor on the project
(`docs/security-operations.md`, finding on the default compute account), and
a deploy identity that can start builds could then act as Editor.

1. A **deploy identity of its own**, never the monitor's
   (`auto-remediation.md`): a Workload Identity pool provider for GitHub and a
   service account, for example `sre-deploy@diamondecho-prod.iam.gserviceaccount.com`.
   The provider maps `attribute.repository_id`, and its condition admits only
   this workflow, from main, in the protected environment:
   ```
   assertion.repository_id == '<the repository's numeric ID>' &&
   assertion.sub == 'repo:Ggeorge73/DiamondEcho:environment:production' &&
   assertion.workflow_ref == 'Ggeorge73/DiamondEcho/.github/workflows/sre-deploy-api.yml@refs/heads/main'
   ```
2. **Roles for the deploy account, and nothing else** (a first list from
   what `gcloud run deploy --source` and `deploy.sh` call; confirm it on
   staging before production):
   - `roles/run.developer` on the service `diamondecho-api` (deploy, move
     traffic, read revisions);
   - `roles/iam.serviceAccountUser` on the runtime account
     `diamondecho-api-runtime@` only (a revision runs as it);
   - `roles/cloudbuild.builds.editor` on the project (`--source` starts a build);
   - `roles/storage.objectAdmin` on the bucket the source uploads already go
     to (read its name from the last build:
     `gcloud builds list --limit 1 --format 'value(source.storageSource.bucket)' --project diamondecho-prod`);
   - `roles/artifactregistry.reader` on the repository `cloud-run-source-deploy`;
   - `roles/logging.viewer` on the project (the log gate);
   - `roles/serviceusage.serviceUsageConsumer` on the project.
3. A GitHub environment `production`: required reviewer Gbenga; "Deployment
   branches and tags" set to `main` only. This limit, and Google's condition
   above, are the real guards: the workflow's own preflight checks run from
   whatever branch is being run, so they are a convenience, not a control.
4. Repository variables `GCP_DEPLOY_WORKLOAD_IDENTITY_PROVIDER` (the
   provider's full name), `GCP_DEPLOY_SERVICE_ACCOUNT`, `GCP_PROJECT_ID`,
   `GCP_REGION`, `CLOUD_RUN_SERVICE`.

The two Google actions are pinned by commit, and gcloud by version.

**When the page and the API both change**, deploy the API first and make the
API accept both the old and the new page; then merge the page. The page
already falls back to calculating on the device when the API is older than it
needs, so this order never leaves a visitor without an answer.

## What automatic rollback covers, and what it does not

Covered:

- An API deploy made with `deploy.sh` that fails a check or a gate within its
  steps: the traffic goes back to the revision that served before.
- A bad API revision noticed later by the monitor, once Gbenga switches on
  [auto-remediation.md](auto-remediation.md). That is a separate switch.

Not covered:

- **A website build whose pages fail.** The post-merge check no longer loads
  a page (Cloudflare refuses GitHub's runners), so it has nothing to trigger
  the website rollback with, switched on or not. Nothing automatic reports a
  broken page either; a person has to see it
  ([site-down.md](runbooks/site-down.md)). The rollback is by hand
  ("Rolling back the website" below).
- **Low traffic.** At this site's traffic a 10 percent step may see no
  visitor at all in two minutes. The gates mostly prove that the new revision
  keeps answering while it is in the rotation; they are not a statistical
  comparison of error rates. A fault on a rarely used path can pass them.
- **Faults that show later** than the gate time, or only under load. The
  five-minute monitor and the alert engine catch those, and a person decides.
- **Data.** A rollback swaps code. Anything the new code wrote to Firestore
  stays written. Restoring data is [backup-and-restore.md](backup-and-restore.md).
- **Settings changed by hand** (`gcloud run services update`, console edits).
  Those are not deploys, and nothing here undoes them.
- **The other half.** Rolling back the site does not touch the API, and the
  reverse. Neither undoes the merge in git: revert it, or the next build
  brings it back.
- **Things that are not ours**: the Georgia MLS search, Cloudflare, Google,
  DNS. Rolling back does not help; see the matching runbook.

## When not to deploy

- The error budget of the part you are changing is spent
  ([error-budget-policy.md](error-budget-policy.md)): only fixes, security
  patches and reliability work ship. At "Restricted", ship small changes
  only, each watched until its checks pass.
- An incident is open for the part you are changing, unless the deploy is the
  fix.
- Nobody can watch the next 15 minutes, read the post-merge check or the
  deploy's record, and roll back if needed.
- The traffic is already split, or a rollback is still pinned and its cause is
  not understood (`status.sh` shows both).
- The page needs a newer API that is not deployed yet (see above).

## Rolling back the API by hand (Cloud Run)

Read first, then move the traffic. Both need a Cloud Shell signed in as
today; nothing here needs a new permission.

```bash
bash scripts/sre/cloudrun/status.sh                          # what serves, which revisions exist and are ready
bash scripts/sre/cloudrun/rollback.sh --to <revision>        # dry run: prints the exact command
bash scripts/sre/cloudrun/rollback.sh --to <revision> --apply
```

`rollback.sh` refuses a revision that is unknown or not ready, reads the
traffic back afterwards and asks `/health`. Without the repository, the same
move is one command (the "Undo" section of
`docs/de13-production-setup.md` names the kept revisions):

```bash
gcloud run services update-traffic diamondecho-api --to-revisions=<revision>=100 --project diamondecho-prod --region us-east1
```

## Rolling back the website (Cloudflare Pages)

1. Cloudflare dashboard, Workers & Pages, `diamondecho`, Deployments. Find the
   production deployment before the bad one, open its menu (three dots) and
   choose **Rollback to this deployment**. This follows Cloudflare's
   documentation; it has not been rehearsed on this project.
2. Or, where the Cloudflare secrets are set:
   `bash scripts/sre/cloudflare/pages-rollback.sh` (dry run: names the build
   it would put back), then the same with `--apply`. It refuses unless the
   build it replaces is the live one, reads the result back, and never prints
   the token.
3. Check `https://diamondecho.com/version.json` names the commit you expect
   (in a browser, or `curl` from your own computer; it answers 403 from a
   cloud server).
4. Revert the merge on GitHub (the **Revert** button on the pull request);
   the next merge to `main` would otherwise publish the bad change again.
   Merging the revert is Gbenga's.

## After a rollback

An API rollback names a revision (`--to-revisions=<revision>=100`), so the
service is **pinned** to it. A refused `deploy.sh` run leaves the same pin
even when no traffic moved, because `--no-traffic` pins the serving revision.
Two things are then true at once:

- A later settings change, including the inquiry switch in the "Undo"
  section of `docs/de13-production-setup.md`, makes a new revision that gets
  **no** traffic.
- The service's template, which every new revision is built from, still holds
  the **refused** image and its `APP_COMMIT`. So
  `update-traffic --to-latest` puts the refused code back on 100 percent, and
  a plain `gcloud run services update --update-env-vars …` builds a new
  revision from the refused image.

While pinned, change a setting only like this:

1. `bash scripts/sre/cloudrun/status.sh`: note the serving revision's
   `image`. Its commit is what `/api/` names.
2. Name that image, and its `APP_COMMIT`, in the same command as the setting:
   ```bash
   gcloud run services update diamondecho-api --image <the serving revision's image> \
     --update-env-vars NAME=VALUE,APP_COMMIT=<its commit> --project diamondecho-prod --region us-east1
   ```
   (If the serving revision has no `APP_COMMIT`, use
   `--update-env-vars NAME=VALUE --remove-env-vars APP_COMMIT`.) `deploy.sh`
   prints this command with the real image filled in.
3. `status.sh` again: the newest revision must show that same image, and a
   `settings` fingerprint that differs only by the setting you meant.
4. Only then: `gcloud run services update-traffic diamondecho-api --to-latest --project diamondecho-prod --region us-east1`.

Also:

- The next successful `deploy.sh` run ends the pin: its last step is
  `--to-latest`, after its own checks.
- The bad revision stays, with no traffic, for diagnosis. Its tagged address
  is removed.

A website rollback leaves nothing pinned: the next build from `main` is
published as usual.

## Switched off until Gbenga turns it on

| Part | Needs | Without it |
| --- | --- | --- |
| Automatic website rollback | Secrets `CLOUDFLARE_API_TOKEN` (Cloudflare Pages: Edit, this account only) and `CLOUDFLARE_ACCOUNT_ID` in the environment `pages-rollback` (main only); variable `SRE_PAGES_AUTOROLLBACK` = `enabled`. **Even with these it cannot act at present:** no page check is left in the post-merge check to trigger it. There is no reason to set it up now | The post-merge check still runs and opens issues; rollback is by hand |
| `pages-rollback.sh` | The same two secrets (or the same values in a shell) | Dashboard rollback |
| API deploy from GitHub | Cloud Build on its own service account first; then a deploy identity of its own (Workload Identity Federation, condition and roles in "Deploying from GitHub"); variables `GCP_DEPLOY_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT`, `GCP_PROJECT_ID`, `GCP_REGION`, `CLOUD_RUN_SERVICE`; a `production` environment, main only, with Gbenga as required reviewer | `deploy.sh` from Cloud Shell, as today |
| The log gate in `deploy.sh` | The signed-in account can read logs (Gbenga's owner account can) | `DEPLOY_LOG_GATE=off`; the probes still gate |

## How this was tested

Every script was run by `node --test` against a fake `gcloud` and a fake
`curl` that model Cloud Run and the Cloudflare Pages API
(`scripts/sre/cloudrun/fakes/`, `scripts/sre/cloudflare/fakes/`): a full
deploy, a failed candidate check, a gate failing at 50 percent and the
rollback, a 500 logged at 10 percent, a settings change, interrupted runs
(including a second Ctrl-C during the rollback), the clean-up after a killed
run, dirty checkouts, and the dry runs changing nothing. None of it has run
against real Cloud Run or Cloudflare. Before the first real use: a dry run in
Cloud Shell, then, if staging (DE-33) exists, an `--apply` there with
`GCP_PROJECT_ID` set to the staging project.
