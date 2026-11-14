# What the SRE team needs from Gbenga

Every account, key, setting and decision the SRE work needs, in one list. Until
an item is done, the part that depends on it stays switched off; nothing here
has been changed in production by an AI role. Each line says what it unlocks
and where the exact steps are.

Status key: **Open** (waiting on you), **Done** (with the date you did it).

## 1. Do first (the pages are not watched without it)

| # | Item | Why | Where the steps are | Status |
| --- | --- | --- | --- | --- |
| 1.1 | **Set up the uptime service that loads the pages (UptimeRobot), and give the monitor its read-only key.** Your decision of 2026-11-14: Bot Fight Mode stays on. It answers `403` to GitHub's runners on every page of `diamondecho.com` and `staff.diamondecho.com` (measured in monitor run 27, 2026-11-14), and on the Free plan no rule can exempt them. UptimeRobot is on Cloudflare's verified-bot list, so it is let through. It loads each page every 5 minutes; the monitor only reads its verdicts and files them as its own checks. **The exact steps are below this table.** | Without it no page is watched: the monitor itself now asks only the API, the inquiry route and the redirects. | Steps below; `docs/sre/synthetic-monitoring.md`, `docs/sre/edge.md` | Open |
| 1.2 | **If you created the Cloudflare custom rule `Let the DiamondEcho monitor through`** (the earlier plan), delete it: Cloudflare, zone `diamondecho.com`, Security, Security rules, Custom rules. It is no longer used, and it let anyone who copied the monitor's name skip the browser check. If you never created it, there is nothing to do. | Removes an exemption nothing needs. | `docs/sre/edge.md` | Open |
| 1.3 | **Deploy the API once** with the build-identity change, setting the new `APP_COMMIT` setting (`--update-env-vars APP_COMMIT=$(git rev-parse HEAD)`; `deploy.sh` sets it for you, and every later deploy must set it too) (the redeploy in `docs/de13-production-setup.md`, or `scripts/sre/cloudrun/deploy.sh`). | Until `/api/` names its revision and commit, the monitor cannot notice a deploy, so the automatic rollback can never act and the post-merge check cannot tell old from new. | `docs/sre/release-safety.md` | Open |

### Steps for 1.1 (about 20 minutes, no cost on the Free plan)

Nothing here changes Cloudflare or the website. You create an account with an
outside service, tell it which pages to load, and give the monitor a key that
can only read the results.

1. **Create the account.** Go to `https://uptimerobot.com`, choose the Free
   plan and sign up with an address that is not on `diamondecho.com` (if the
   domain ever fails, its own mail fails with it). Before you finish, read the
   Free plan's terms for business use: reports from 2025 and 2026 disagree on
   whether a business website is allowed. If it is not, the paid Solo plan
   works the same way with these steps, or tell me and I will prepare another
   verified service.
2. **Create 12 monitors**, one per row of the table below. For each: **New
   monitor**, type as given in the table, paste the address, set the **name
   exactly as written** (the monitor finds each one by its name), leave the
   interval at **5 minutes**, and save. For the one keyword monitor, enter the
   keyword from the table and choose "alert when the keyword **does not
   exist**".

   | Monitor name (exact) | Type | Address |
   | --- | --- | --- |
   | `public-home` | HTTP(s) | `https://diamondecho.com/` |
   | `public-page-agents` | HTTP(s) | `https://diamondecho.com/agents` |
   | `public-page-about` | HTTP(s) | `https://diamondecho.com/about` |
   | `public-page-podcast` | HTTP(s) | `https://diamondecho.com/podcast` |
   | `public-page-privacy` | HTTP(s) | `https://diamondecho.com/privacy` |
   | `public-page-terms` | HTTP(s) | `https://diamondecho.com/terms` |
   | `search-page` | HTTP(s) | `https://diamondecho.com/search` |
   | `calculators-deal-page` | HTTP(s) | `https://diamondecho.com/investment-calculator` |
   | `calculators-mortgage-page` | HTTP(s) | `https://diamondecho.com/mortgage-calculator` |
   | `calculators-net-sheet-page` | HTTP(s) | `https://diamondecho.com/seller-net-sheet` |
   | `inquiry-page` | Keyword, keyword `de-inquiry-submit` | `https://diamondecho.com/inquire` |
   | `staff-home` | HTTP(s) | `https://staff.diamondecho.com/` |

3. **Wait 10 minutes and look.** Every monitor should show **Up**. If one
   shows Down while the page opens in your browser, stop and tell me which:
   Cloudflare may be turning UptimeRobot away too, and the monitor must not be
   switched on in that state.
4. **Keep UptimeRobot's own email alert on** (it is on by default, to the
   address you signed up with). That is a second, independent way of being
   told, which works even if GitHub is down.
5. **Create the read-only key.** In UptimeRobot: **Integrations & API**, then
   **API** (older screens: My Settings, API Settings). Under **Read-only API
   key** choose Create. Copy that key, and only that one: the "Main API key"
   can change and delete monitors and must never be given to GitHub.
6. **Give the key to the monitor.** GitHub, this repository: Settings, Secrets
   and variables, Actions, **Secrets**, New repository secret. Name
   `UPTIMEROBOT_API_KEY`, value the read-only key. Never paste the key in an
   issue, a pull request or a chat.
7. **Try it once by hand.** Actions, SRE monitor, Run workflow (suite `fast`).
   In the run's summary, "Uptime service reports every page" and the 12 page
   checks should pass. If it names a page as "no monitor with this name" or
   "watches another address", fix that monitor's name or address in
   UptimeRobot and run it again.
8. **Switch the monitor on.** Settings, Secrets and variables, Actions,
   **Variables**, New repository variable `SRE_MONITOR` = `enabled`. Until
   then the scheduled checks and the after-merge check do not run.

Undo: delete the secret and the variable, then delete the UptimeRobot account.
What it costs you in privacy: UptimeRobot learns the 12 public addresses and
when they are up. It never sees visitor data, and the staff monitor loads only
the sign-in page.

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
| 3.3 | **Multi-region uptime checks, alert policies, log metrics, dashboard and real-request SLOs**: run `deploy/monitoring/apply.sh` (prints the plan), then `apply.sh --apply`. Re-check Cloud Monitoring prices first. | A second, independent monitor from several continents, which also notices when the GitHub monitor itself stops. | `docs/sre/observability.md`, `docs/sre/synthetic-monitoring.md`, `docs/sre/slo.md` | Open |
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
