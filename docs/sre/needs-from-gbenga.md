# What the SRE team needs from Gbenga

Every account, key, setting and decision the SRE work needs, in one list. Until
an item is done, the part that depends on it stays switched off; nothing here
has been changed in production by an AI role. Each line says what it unlocks
and where the exact steps are.

Status key: **Open** (waiting on you), **Done** (with the date you did it).

## 1. Do first

| # | Item | Why | Where the steps are | Status |
| --- | --- | --- | --- | --- |
| 1.1 | **Switch the monitor on.** Your decisions of 2026-11-14: Bot Fight Mode stays on, no outside monitoring service is added, and nothing checks the hosting address behind Cloudflare. So the monitor no longer asks for any page of `diamondecho.com` or `staff.diamondecho.com` (Bot Fight Mode answered `403` to GitHub's runners on every one, monitor run 27). It asks only the API, the inquiry route, the staff sign-in route and the redirects, plus the hourly certificate, DNS and domain checks; all of those passed from GitHub's runners on 2026-11-14. Nothing in Cloudflare needs changing. First run it once by hand (Actions, SRE monitor, Run workflow, suite `fast`) and check that every check passes. Then: Settings, Secrets and variables, Actions, Variables, New repository variable `SRE_MONITOR` = `enabled`. Undo: delete the variable. | Until then the scheduled checks and the after-merge check do not run. | `docs/sre/synthetic-monitoring.md` | Open |
| 1.2 | **If you created the Cloudflare custom rule `Let the DiamondEcho monitor through`** (the earlier plan), delete it: Cloudflare, zone `diamondecho.com`, Security, Security rules, Custom rules. It is no longer used, and it let anyone who copied the monitor's name skip the browser check. If you never created it, there is nothing to do. | Removes an exemption nothing needs. | `docs/sre/edge.md` | Open |
| 1.2a | **Know what is no longer watched, and accept it or tell me.** No automatic check now loads a web page. If Cloudflare Pages serves a broken or empty page, or Cloudflare itself has an outage, while the API keeps answering, no incident opens and the status page still says "Operational" (it carries a note saying pages are not loaded). The website's and the calculators' page targets (SLOs) get no data. What still tells you: a failed site build after a merge opens an incident (the after-merge check reads Cloudflare Pages' own result from GitHub); certificate, DNS, domain and redirect problems are still caught. Optional, inside Cloudflare and with no outside service: Cloudflare dashboard, Notifications, add the Pages notification for a failed deployment if your account lists it. | So that the gap is a decision, not a surprise. | `docs/sre/synthetic-monitoring.md`, `docs/sre/slo.md` | Open |
| 1.3 | **Deploy the API once** with the build-identity change, setting the new `APP_COMMIT` setting (`--update-env-vars APP_COMMIT=$(git rev-parse HEAD)`; `deploy.sh` sets it for you, and every later deploy must set it too) (the redeploy in `docs/de13-production-setup.md`, or `scripts/sre/cloudrun/deploy.sh`). | Until `/api/` names its revision and commit, the monitor cannot notice a deploy, so the automatic rollback can never act and the post-merge check cannot tell old from new. | `docs/sre/release-safety.md` | Open |

## 2. Switch on in GitHub (repository settings, no cost)

| # | Item | Why | Status |
| --- | --- | --- | --- |
| 2.1 | **Do first in GitHub: protect `main`** (Settings, Branches, add a rule for `main`: require a pull request and the CI checks). Leave Settings, Actions, General, "Workflow permissions" at its read-only default: every SRE workflow asks for exactly the permissions it needs on its own jobs (`contents: write` for the `sre-status` branch, `issues: write`). Do not protect `sre-status`. | Code review is the only limit on what the deploy and rollback automation can do, and a job that can write the status branch could otherwise also push to `main`. | Open |
| 2.2 | **Public status page**: Settings, Pages, Source: **GitHub Actions** (not "Deploy from a branch": branch builds are limited to about 10 an hour, and the monitor saves about 13 times an hour). Then add the repository variable `SRE_STATUS_PAGE` = `enabled`. The monitor then publishes the page itself after each run. | Publishes the status page at `https://ggeorge73.github.io/DiamondEcho/`. | Open |
| 2.3 | **Optional chat alert**: secret `SRE_ALERT_WEBHOOK_URL` (a Slack or Teams incoming-webhook address). | Incidents also post to chat, not only GitHub email. | Open |
| 2.4 | **Who to page**: variable `SRE_OWNER` = your GitHub user name. | A sev1 that is not acknowledged mentions you on the issue. | Open |
| 2.5 | **Protected environment** named `production` with you as the required reviewer, deployments limited to the `main` branch. | Each run of the manual API deploy workflow waits for your approval. | Open |
| 2.6a | **Get the alert emails**: on the repository page, Watch, Custom, tick Issues; and keep GitHub email notifications on. Incident issues reach you by email only this way. | Without it you are never told. | Open |
| 2.6b | **Two labels** for the issue forms: `incident` and `postmortem` (Issues, Labels, New label). | Issues opened from the incident and postmortem forms get their label. | Open |
| 2.7 | **Keep the schedule alive**: GitHub pauses scheduled workflows in a public repository after 60 days with no commits. If the monitor stops, re-enable it under Actions. | A paused monitor sees nothing. The weekly report flags monitoring gaps. | Note |

## 3. Google Cloud (`diamondecho-prod`), in Cloud Shell

| # | Item | Unlocks | Where | Status |
| --- | --- | --- | --- | --- |
| 3.1 | **Phase 1, read-only sign-in for GitHub**: Workload Identity Federation (no keys), service account `diamondecho-sre-monitor`, custom role with `run.services.get` and `run.revisions.list` on `diamondecho-api` only, then the repository variables `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SRE_SERVICE_ACCOUNT`, `GCP_PROJECT_ID`, `GCP_REGION`, `CLOUD_RUN_SERVICE`. | The rollback engine's dry runs read the real revisions; nothing can change. | `docs/sre/auto-remediation.md` | Open |
| 3.2 | **Phase 2, a separate yes**: add `run.services.update` to that role and set variable `SRE_AUTOREMEDIATE` = `enabled`. | Automatic rollback of a bad API deploy. Note: that permission cannot be limited to traffic only. | `docs/sre/auto-remediation.md` | Open |
| 3.3 | **Multi-region uptime checks, alert policies, log metrics, dashboard and real-request SLOs**: run `deploy/monitoring/apply.sh` (prints the plan), then `apply.sh --apply`. Re-check Cloud Monitoring prices first. | A second, independent monitor from several continents, which also notices when the GitHub monitor itself stops. Before applying: its page checks come from Google's network and may be refused by Bot Fight Mode like GitHub's were; tell me and I will cut the plan down to the API checks first. | `docs/sre/observability.md`, `docs/sre/synthetic-monitoring.md`, `docs/sre/slo.md` | Open |
| 3.3a | **Deploying the API from GitHub** (optional; until then deploy by hand from Cloud Shell with `scripts/sre/cloudrun/deploy.sh`): a separate sign-in from the monitor's (its own Workload Identity provider and service account, trusted only for the `production` environment and `sre-deploy-api.yml` on `main`), and the `production` environment limited to `main`. Do this only after the default compute account loses Editor and Cloud Build has its own account (security finding #1). | `docs/sre/release-safety.md` | Open |
| 3.4 | **Backup restore drill** into a scratch database (DE-28). | Proof that a restore works, and a measured recovery time. | `docs/sre/backup-and-restore.md` | Open |

## 4. Decisions

| # | Decision | Where | Status |
| --- | --- | --- | --- |
| 4.1 | **Accept or change the proposed SLO targets** after one full 28-day window of data. Until then the error-budget policy is advice only. | `docs/sre/slo.md`, `docs/sre/error-budget-policy.md` | Open |
| 4.1a | **Incident targets**: accept or change the proposed time to acknowledge and to fix for each severity, and whether sev2 chat messages may arrive at night. | `docs/sre/severity-and-escalation.md` | Open |
| 4.2 | **A backup contact** for when you cannot answer an incident. Today there is no second person. | `docs/sre/severity-and-escalation.md` | Open |
| 4.3 | **Edge hardening**, each with its risk and undo: DNSSEC, a CAA record, minimum TLS 1.2, WAF managed rules, a rate-limiting rule, putting the API behind Cloudflare. | `docs/sre/edge.md` | Open |
| 4.4 | **Privacy page**: Cloudflare's bot-detection script (`/cdn-cgi/challenge-platform/…`) is on the home page; does the Privacy page need to mention it? | `docs/sre/edge.md` | Open |
| 4.5 | **DNS records**: should `msoid.diamondecho.com` exist (listed in DE-13, gone today)? Who added the DMARC record? | `docs/sre/edge.md` | Open |
| 4.6 | **A backup GoDaddy contact email** that is not on `diamondecho.com` (if the domain lapses, its own mail stops). | `docs/sre/runbooks/domain-expiry.md` | Open |
| 4.7 | **Capacity options** (minimum instances 1 against cold starts, more instances, caching), each with a cost. | `docs/sre/architecture.md`, `docs/sre/capacity.md` | Open |
| 4.8 | **Automatic Pages rollback** after a failed post-merge check (optional): a Cloudflare token limited to "Pages: Edit" on this account, stored as `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets of a GitHub environment that only `main` may use (not repository secrets: that token controls what diamondecho.com serves), added to the security rotation list, and variable `SRE_PAGES_AUTOROLLBACK` = `enabled`. | `docs/sre/release-safety.md` | Open |
| 4.10 | **Deal Studio when the API is down** (product decision): today its base analysis shows "The analysis service could not be reached, so nothing was calculated" when the API does not answer. The page already has the same formulas and uses them when the API is out of date, so it could calculate on the device in this case too, and say so. That would keep Deal Studio working through an API outage. A small frontend change with tests, if you want it. | `docs/sre/capacity.md` | Open |
| 4.11 | **A staging load test**, to measure capacity, cold starts and a full API (costs staging run time). | `docs/sre/load-testing.md` | Open |
| 4.12 | **Two read-only facts from Cloud Shell**: whether production holds the RentCast and Mapbox keys as plain values or as secrets (if plain, move them to Secret Manager before phase 1 lets the monitor read the service), and whether the market brief is switched on. | `docs/sre/runbooks/provider-quota.md` | Open |
| 4.13 | **An alert on the monitor account's own actions** in Cloud Run (admin-activity log), once phase 2 is on; and delete old Cloud Run revisions nobody needs (a rollback can only go to a kept revision). | `docs/sre/auto-remediation.md` | Open |
| 4.9 | **Game days**: a rehearsed Cloud Run rollback, a rehearsed Pages rollback and an end-to-end alert test, each at a quiet hour with you present. | `docs/sre/chaos-and-game-days.md` | Open |
