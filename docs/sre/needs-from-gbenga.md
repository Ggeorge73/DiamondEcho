# What the SRE team needs from Gbenga

Every account, key, setting and decision the SRE work needs, in one list. Until
an item is done, the part that depends on it stays switched off; nothing here
has been changed in production by an AI role. Each line says what it unlocks
and where the exact steps are.

Status key: **Open** (waiting on you), **Done** (with the date you did it).

## 1. Do first (the monitor cannot see the site without it)

| # | Item | Why | Where the steps are | Status |
| --- | --- | --- | --- | --- |
| 1.1 | **Let the monitor past Cloudflare's browser check** (your choice, 2026-11-13: a Cloudflare rule, so the monitor keeps its plain name). Cloudflare answers `403` (error 1010) to the monitor on `diamondecho.com` and `staff.diamondecho.com`, measured 2026-11-13. In the Cloudflare dashboard, zone `diamondecho.com`: **Security, Security rules (older dashboards: WAF), Custom rules, Create rule**. Name: `Let the DiamondEcho monitor through`. Field `User Agent`, operator `contains`, value `DiamondEcho-SRE-Monitor`. Action: **Skip**; under "More components to skip" tick **Browser Integrity Check** only. Place it first; Deploy. Then run the "SRE monitor" workflow by hand (Actions, SRE monitor, Run workflow) and check that the website checks pass. Undo: delete the rule. Trade-off: anyone who copies that name also skips the browser check (and only that check: the WAF, rate limits and Bot Fight Mode still apply). | Without it every website check reports a false outage. | `docs/sre/edge.md`, `docs/sre/synthetic-monitoring.md` | Open |
| 1.2 | **Look at Cloudflare, Security, Events** and note which setting gives error 1010 (likely Browser Integrity Check) and whether Bot Fight Mode is on. Read-only. | GitHub's runners may also be challenged by Bot Fight Mode, which a rule cannot exempt on the Free plan. | `docs/sre/edge.md` | Open |
| 1.3 | **Deploy the API once** with the build-identity change (the redeploy in `docs/de13-production-setup.md`, or `scripts/sre/cloudrun/deploy.sh`). | Until `/api/` names its revision and commit, the monitor cannot notice a deploy, so the automatic rollback can never act and the post-merge check cannot tell old from new. | `docs/sre/release-safety.md` | Open |

## 2. Switch on in GitHub (repository settings, no cost)

| # | Item | Why | Status |
| --- | --- | --- | --- |
| 2.1 | **Actions may write**: Settings, Actions, General, Workflow permissions: allow the `sre-monitor` and `sre-weekly-report` workflows to push to the `sre-status` branch and open issues (the workflows ask only for `contents: write` and `issues: write` on their own jobs). Do not protect `sre-status`. | The monitor saves its results and opens incident issues. | Open |
| 2.2 | **Public status page**: Settings, Pages, deploy from branch `sre-status`, folder `/`. | Publishes the status page at `https://ggeorge73.github.io/DiamondEcho/`. | Open |
| 2.3 | **Optional chat alert**: secret `SRE_ALERT_WEBHOOK_URL` (a Slack or Teams incoming-webhook address). | Incidents also post to chat, not only GitHub email. | Open |
| 2.4 | **Who to page**: variable `SRE_OWNER` = your GitHub user name. | A sev1 that is not acknowledged mentions you on the issue. | Open |
| 2.5 | **Protected environment** named `production` with you as the required reviewer. | Each run of the manual API deploy workflow waits for your approval. | Open |
| 2.6 | **Branch protection on `main`**: require a pull request and the CI checks. | Code review is the only limit on what the deploy and rollback automation can do. | Open |
| 2.7 | **Keep the schedule alive**: GitHub pauses scheduled workflows in a public repository after 60 days with no commits. If the monitor stops, re-enable it under Actions. | A paused monitor sees nothing. The weekly report flags monitoring gaps. | Note |

## 3. Google Cloud (`diamondecho-prod`), in Cloud Shell

| # | Item | Unlocks | Where | Status |
| --- | --- | --- | --- | --- |
| 3.1 | **Phase 1, read-only sign-in for GitHub**: Workload Identity Federation (no keys), service account `diamondecho-sre-monitor`, custom role with `run.services.get` and `run.revisions.list` on `diamondecho-api` only, then the repository variables `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SRE_SERVICE_ACCOUNT`, `GCP_PROJECT_ID`, `GCP_REGION`, `CLOUD_RUN_SERVICE`. | The rollback engine's dry runs read the real revisions; nothing can change. | `docs/sre/auto-remediation.md` | Open |
| 3.2 | **Phase 2, a separate yes**: add `run.services.update` to that role and set variable `SRE_AUTOREMEDIATE` = `enabled`. | Automatic rollback of a bad API deploy. Note: that permission cannot be limited to traffic only. | `docs/sre/auto-remediation.md` | Open |
| 3.3 | **Multi-region uptime checks, alert policies, log metrics, dashboard and real-request SLOs**: run `deploy/monitoring/apply.sh` (prints the plan), then `apply.sh --apply`. Re-check Cloud Monitoring prices first. | A second, independent monitor from several continents, which also notices when the GitHub monitor itself stops. | `docs/sre/observability.md`, `docs/sre/synthetic-monitoring.md`, `docs/sre/slo.md` | Open |
| 3.4 | **Backup restore drill** into a scratch database (DE-28). | Proof that a restore works, and a measured recovery time. | `docs/sre/backup-and-restore.md` | Open |

## 4. Decisions

| # | Decision | Where | Status |
| --- | --- | --- | --- |
| 4.1 | **Accept or change the proposed SLO targets** after one full 28-day window of data. Until then the error-budget policy is advice only. | `docs/sre/slo.md`, `docs/sre/error-budget-policy.md` | Open |
| 4.2 | **A backup contact** for when you cannot answer an incident. Today there is no second person. | `docs/sre/severity-and-escalation.md` | Open |
| 4.3 | **Edge hardening**, each with its risk and undo: DNSSEC, a CAA record, minimum TLS 1.2, WAF managed rules, a rate-limiting rule, putting the API behind Cloudflare. | `docs/sre/edge.md` | Open |
| 4.4 | **Privacy page**: Cloudflare's bot-detection script (`/cdn-cgi/challenge-platform/…`) is on the home page; does the Privacy page need to mention it? | `docs/sre/edge.md` | Open |
| 4.5 | **DNS records**: should `msoid.diamondecho.com` exist (listed in DE-13, gone today)? Who added the DMARC record? | `docs/sre/edge.md` | Open |
| 4.6 | **A backup GoDaddy contact email** that is not on `diamondecho.com` (if the domain lapses, its own mail stops). | `docs/sre/runbooks/domain-expiry.md` | Open |
| 4.7 | **Capacity options** (minimum instances 1 against cold starts, more instances, caching), each with a cost. | `docs/sre/architecture.md`, `docs/sre/capacity.md` | Open |
| 4.8 | **Automatic Pages rollback** after a failed post-merge check: secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (a token limited to Pages), and variable `SRE_PAGES_AUTOROLLBACK` = `enabled`. Optional. | `docs/sre/release-safety.md` | Open |
| 4.9 | **Game days**: a rehearsed Cloud Run rollback, a rehearsed Pages rollback and an end-to-end alert test, each at a quiet hour with you present. | `docs/sre/chaos-and-game-days.md` | Open |
