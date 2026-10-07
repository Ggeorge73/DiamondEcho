# DE-13: production set-up as run

This is the record of how production was built on 2026-10-05 and 2026-10-06, what was checked, and what is still unproven. It follows the staging records `docs/de33-staging-setup.md` and `docs/de33-staging-stage-two.md`; where a step was identical it points there instead of repeating the commands.

Every change below was listed to Gbenga first and made after his yes in chat. Claude ran the steps in Gbenga's browser and Cloud Shell. Gbenga created the staff user and pasted the web key himself. The Jira record is DE-13, comments 10246 to 10274.

No password, key, token, authenticator code or staff user ID is in this file.

## What production is

| Part | Value |
| --- | --- |
| Public site | `https://diamondecho.com` (Cloudflare Pages project `diamondecho`) |
| `www` | `https://www.diamondecho.com` redirects (301) to the public site |
| Staff site | `https://staff.diamondecho.com` (Cloudflare Pages project `diamondecho-staff`) |
| API | `https://diamondecho-api-180189726732.us-east1.run.app` (Cloud Run service `diamondecho-api`, `us-east1`) |
| Google Cloud project | `diamondecho-prod` ("DiamondEcho Production"), number `180189726732` |
| Database | Firestore `(default)`, Native mode, `us-east1` |
| Staff sign-in | Identity Platform: email and password plus authenticator app |
| Domain registration | GoDaddy. DNS is hosted at Cloudflare (Free plan) |
| Mailbox | `realtor@diamondecho.com`: Microsoft 365 bought through GoDaddy, with Proofpoint filtering |

The older addresses `https://diamondecho.pages.dev` and `https://diamondecho-staff.pages.dev` still load, but the API no longer accepts them: the form and the staff queue work only at the addresses above.

## Order of work

| # | Date (UTC) | What | Approval, as given |
| --- | --- | --- | --- |
| 1 | 10-05 | Project, billing link, 25 dollar budget alert, Cloud Run + Cloud Build + Artifact Registry, runtime identity with no roles | "Yes, all five" |
| 2 | 10-05 | Staff Pages project; API deployed with the queue off; health check | "Yes to all 3." |
| 3 | 10-05 | Firebase on the Blaze plan, database, two roles, staff sign-in, web app | "Yes to all 5 steps" |
| 4 | 10-05 | Staff user moved to `realtor@` and verified; queue on; staff site settings; public site pointed at the API | "yes please use realtor@diamondecho.com. You have my YES for all 4 steps." |
| 5 | 10-05 | Arrival alert; daily backup | "You have my YES for both items." |
| 6 | 10-06 | Read-only look at GoDaddy's DNS records | "Yes go ahead with opening GoDaddy in my browser" |
| 7 | 10-06 | Domain move: Cloudflare zone, nameservers, addresses, settings, tests | "YOu have my Yes for all 5" |

## 1. Project and limits

As staging stage one, with the production names. Billing account "My Billing Account". Budget "diamondecho-prod monthly $25" with alerts at 50, 90 and 100 percent of actual spend and 100 percent of forecast. A budget alert is a notice, not a spending cap.

Runtime identity: `diamondecho-api-runtime@diamondecho-prod.iam.gserviceaccount.com`. After batch 3 it holds exactly `roles/datastore.user` and `roles/firebaseauth.viewer`.

Cloud Run: 1 CPU, 1 GiB, concurrency 1, timeout 30 s, minimum 0 and maximum 3 instances, open to the internet (the API does its own checks). First deployed from `main` at `f84c9ea`; revisions 2 and 3 changed settings only and kept that container image. Revision 4 is a new image built from `main` at `50705a5`, with the settings unchanged.

| Revision | Change |
| --- | --- |
| `diamondecho-api-00001-lj9` | First deploy, queue off |
| `diamondecho-api-00002-9zg` | Queue on, one staff user ID listed |
| `diamondecho-api-00003-prh` | `PUBLIC_ORIGIN`, `STAFF_ORIGIN`, `CORS_ORIGINS` moved to the `diamondecho.com` addresses |
| `diamondecho-api-00004-kiq` | New image from `main` at `50705a5` (formula `diamond-underwriting-1.1.0`). Served all requests from 2026-10-06, shortly before 21:00 UTC, to 2026-10-07 01:05 UTC. Kept as the fallback |
| `diamondecho-api-00007-deh` | New image from `main` at `f8853da` (assistant topics, continued conversations and fair-housing check; route list switched off). Served all requests from 2026-10-07 01:05 UTC to 01:45 UTC. Kept as the fallback |
| `diamondecho-api-00010-car` | New image from `main` at `d151b51` (a plain tour request gets the tour request form). Serving all requests since 2026-10-07 01:45 UTC. Numbers 5, 6, 8 and 9 name no revision: the list shows 1, 2, 3, 4, 7 and 10. Each redeploy was followed by two traffic-only changes, and the next revision's number was three higher each time |

Always pass `--project diamondecho-prod`. Cloud Shell's default project can be either staging or production, depending on how the session was opened.

## 2. Database and sign-in

The same steps as `docs/de33-staging-stage-two.md` steps 1 to 5, with these differences:

- **Role grant collision.** The first `add-iam-policy-binding` failed with "concurrent policy changes", because Google was writing its own service entries just after the services were enabled. Nothing was half-applied. Waiting a minute and running the two grants again succeeded.
- **Web app by command line.** `npx firebase-tools@15.31.0 apps:create WEB "DiamondEcho staff" --project diamondecho-prod`, so that the web key was not displayed to the agent. The console screen that shows the key was not read.
- **Staff user.** Gbenga created the user. At his instruction it was moved to `realtor@diamondecho.com` and marked verified by the administrator call in stage-two step 4c, in one request.
- **Two staging tests not repeated.** T6 (an unverified account is refused) and T8 (a signed-in person not on the list is refused) passed on staging. In production the email was verified and the real user listed in one pass, so neither was exercised.

**Delete protection is on** for the `(default)` database since 2026-10-07 02:25 UTC, on the owner's yes ("Yes, turn it on"): `gcloud firestore databases update --database="(default)" --delete-protection --project diamondecho-prod`; state read back `DELETE_PROTECTION_ENABLED`. It costs nothing. Point-in-time recovery is off; it has a cost and was not asked for. Backups read the same day: one daily schedule kept 7 days, two backups `READY` (2026-10-05T23:57:56Z and 2026-10-07T00:07:16Z).

Rules: `firestore.rules` from commit `f84c9ea`, deny-all. With no sign-in, a list of `inquiries` and a write to `rules_probe` both answer 403.

Sign-in settings read back: email and password on, email link off, authenticator provider on with `adjacentIntervals: 1`, text-message factor off, sign-up off, deletion off, improved email privacy on. Allowed sign-in domains: `localhost`, the two Firebase defaults, and `staff.diamondecho.com`.

## 3. Sites

`diamondecho-staff` (new Pages project): build command `npm install --global npm@10.9.3 && npm ci && npm run build:staff`, output `staff-queue/dist`, production branch `main`. Variables, Production environment:

| Setting | Value | Entered by |
| --- | --- | --- |
| `NODE_VERSION` | `20` | Claude |
| `STAFF_API_ORIGIN` | the API address above | Claude |
| `STAFF_ORIGIN` | `https://staff.diamondecho.com` | Claude |
| `PUBLIC_ORIGIN` | `https://diamondecho.com` | Claude |
| `FIREBASE_PROJECT_ID` | `diamondecho-prod` | Claude |
| `FIREBASE_AUTH_DOMAIN` | `diamondecho-prod.firebaseapp.com` | Claude |
| `FIREBASE_WEB_APP_ID` | the production web app's ID | Claude |
| `FIREBASE_WEB_API_KEY` | the production web key | **Gbenga** |
| `STAFF_QUEUE_ENABLED` | `true`, entered last | Claude |

`diamondecho` (existing Pages project): one variable added, Production only: `REACT_APP_BACKEND_URL` = the API address. Pull-request previews do not have it.

Two things learned in the dashboard:

- The "Add" panel accepts several `NAME=value` lines pasted into the name field, but refuses a name that already exists. To change a value, edit it in the list and press Save in the bar that appears.
- A value change takes effect only on the next build. Use "Retry deployment" on the latest production deployment.

## 4. Arrival alert and backup

Alert: as `docs/de31-inquiry-routing.md`, with the production names. Channel "DiamondEcho request alerts" to `realtor@diamondecho.com`; policy "DiamondEcho production: new request received"; filter on service `diamondecho-api`, log `projects/diamondecho-prod/logs/run.googleapis.com%2Frequests`, `POST`, status 201, address containing `/api/v1/inquiries`. The email links to `https://staff.diamondecho.com`.

| Time (UTC), 10-05 | Event | Result |
| --- | --- | --- |
| 23:10:34 | Policy created | Listed as enabled |
| 23:18:22 | One synthetic request from Cloud Shell | 201, `queued` |
| 23:19:19 | Alert opened | 57 seconds later |
| next day | Email | Gbenga sent a picture of it. No visitor detail in the part shown |

Backup: `gcloud firestore backups schedules create --database="(default)" --recurrence=daily --retention=7d --project diamondecho-prod`. The first backup was taken at 2026-10-05T23:57:56Z, state READY, expiring seven days later. Backups are billed by stored size with no free allowance; a restore is charged per GiB restored. A restore has not been tested.

## 5. Domain move

### What GoDaddy held

Nineteen records, read from GoDaddy's DNS page in the account that holds the domain. A public lookup beforehand had found eighteen of them and missed `pay`; a public lookup only finds names that are asked for.

| Type | Name | Data | Carried to Cloudflare |
| --- | --- | --- | --- |
| A | `@` | GoDaddy parking | no, replaced by the site |
| NS (2) | `@` | `ns55.domaincontrol.com`, `ns56.domaincontrol.com` | no, replaced |
| SOA | `@` | GoDaddy's | no, replaced |
| CNAME | `www` | `diamondecho.com` | no, replaced by the redirect |
| CNAME | `autodiscover` | `autodiscover.outlook.com` | yes |
| CNAME | `email` | `emaildot.godaddy.com` | yes |
| CNAME | `lyncdiscover` | `webdir.online.lync.com` | yes |
| CNAME | `msoid` | `clientconfig.microsoftonline-p.net` | yes |
| CNAME | `pay` | `paylinks.commerce.godaddy.com` | yes |
| CNAME | `sip` | `sipdir.online.lync.com` | yes |
| CNAME | `_domainconnect` | `_domainconnect.gd.domaincontrol.com` | yes |
| MX (3) | `@` | `mx1-usg2.ppe-hosted.com`, `mx2-usg2.ppe-hosted.com`, `mx3-usg2.ppe-hosted.com`, priority 0 | yes |
| TXT | `@` | `NETORGFT9628004.onmicrosoft.com` | yes |
| TXT | `@` | `v=spf1 include:_spf-usg2.ppe-hosted.com include:secureserver.net ~all` | yes |
| SRV | `_sip._tls` | `100 1 443 sipdir.online.lync.com` | yes |
| SRV | `_sipfederationtls._tcp` | `100 1 5061 sipfed.online.lync.com` | yes |

There was no DMARC record and no DKIM record. Forwarding was not set up. Before the move the address showed GoDaddy's parking page.

### How it was done

1. **Cloudflare, "Connect a domain"**, Free plan. Import method "Upload a DNS zone file" with the fourteen records above, so that Cloudflare's automatic scan did not bring in the parking records. "Bot Preference Sync" was switched off so that Cloudflare does not write into `robots.txt`; the AI crawler policies were left at the default, "Allow".
2. **Proxy status.** The import marked the seven CNAMEs "Proxied". Each was switched to "DNS only". A proxied `autodiscover` or `sip` record breaks Outlook and Teams.
3. **Compare before switching.** Cloudflare's two assigned nameservers answer for the zone before it is live. Each record was asked of GoDaddy's nameserver and of Cloudflare's and the answers compared: 11 of 11 lookups identical.
   ```bash
   dig +short MX diamondecho.com @ns55.domaincontrol.com | sort
   dig +short MX diamondecho.com @georgia.ns.cloudflare.com | sort
   ```
4. **GoDaddy, DNS, Nameservers, "Change Nameservers", "I'll use my own nameservers"**: `georgia.ns.cloudflare.com` and `jasper.ns.cloudflare.com`. When first checked, at 14:46:30 UTC, the `.com` registry already listed the new pair; Cloudflare showed the zone as active by about 14:49 UTC.
5. **Pages custom domains.** `diamondecho.com` on `diamondecho` and `staff.diamondecho.com` on `diamondecho-staff`. Pages refuses the bare name until the zone is active, so this cannot be done ahead of step 4.
6. **`www`.** A proxied placeholder record, A `192.0.2.1`, and a redirect rule from the "Redirect from WWW to root" template, changed to match both schemes: `http*://www.*` to `https://${2}`, 301, query string kept.
7. **Settings.** The three API values, the two staff-site values and a rebuild, the allowed sign-in domain, and the link in the alert email.

### Checks after the move (2026-10-06, 15:05 UTC)

- The nine checks of `scripts/staging-smoke.mjs`, at commit `e27cd5e`, against the three production addresses: 9 of 9 pass. The script's command line refuses `diamondecho.com` names on purpose, so its exported `checkStaging` function was called directly. All nine are read-only.
- The API gives no CORS permission to `https://diamondecho.pages.dev` and answers 403 to the staff API from `https://diamondecho-staff.pages.dev`.
- `diamondecho.com` serves `main.9c677b1c.js` (sha256 `1648874372e58b7a96084cae05dd5a42974c01635270f9c7e6770d3eca558685`), byte-identical to a local build of the same frontend source (unchanged since `f84c9ea`) with `REACT_APP_BACKEND_URL` set to the API address. The stylesheet and `index.html` also match.
- `staff.diamondecho.com` serves the same `app.js`, `index.html` and `staff.css` as before the move; its `config.js` names the new addresses; its headers include `default-src 'none'`, `no-store` and `X-Frame-Options: DENY`.
- From the page at `diamondecho.com`, an empty request to the API answers 422 with the missing fields named.
- Mail records from a public resolver after the move: the same 11 answers.

### API redeploy and visitor monitoring (2026-10-06, 20:42 to 21:05 UTC)

Both changes had the owner's yes in chat ("yes to both").

**API moved from `f84c9ea` to `50705a5`.** The only backend files that differ between the two commits are `backend/deal_intelligence/engine.py`, its README and its test. The new revision was started with no visitors on it, tested at a temporary address, and only then given the traffic:

1. `gcloud run deploy diamondecho-api --source backend --project diamondecho-prod --region us-east1 --no-traffic --tag candidate --quiet`, from a fresh clone whose commit read `50705a5`. Result: `diamondecho-api-00004-kiq`, serving 0 percent.
2. Settings compared from the saved service description before and after: runtime identity, 1 CPU, 1 GiB, concurrency 1, timeout 30 s, maximum 3 instances, and the six environment variables are identical.
3. Candidate checks: `/health` 200; the staff list with no sign-in 401; an empty request 422; the reference land request of `backend/tests` answers formula `diamond-underwriting-1.1.0` with residual land value 2,315.27, development profit -2,756,112.30, margin -0.6125 and IRR -0.3737, the same figures a local run of the engine at `50705a5` gives. The same request to the old revision, minutes earlier, answered formula `1.0.0` with residual -565,679.80.
4. `gcloud run services update-traffic diamondecho-api --to-latest --project diamondecho-prod --region us-east1`, then `--remove-tags candidate`. The service is back to one entry: latest revision, 100 percent. The temporary address answers 404.
5. On production afterwards: `/health` 200 and the staff list 401, three times each; the reference request answers formula `1.1.0` and 2,315.27; on `diamondecho.com/investment-calculator`, "Land development" then "Run base analysis" called the API (200) and the page showed formula version 1.1 and "Residual land value $2,315".

Not done: no request was sent through the form, and a return to revision 3 was not rehearsed (see "Undo").

**Cloudflare Real User Monitoring switched off** for the `diamondecho.com` zone (Speed, then Real User Monitoring, then "Disable completely"). Cloudflare had been adding its `beacon.min.js` script to every page, which the Privacy page's "no analytics" sentence did not allow for. The script was still in the pages one minute after the switch. It was absent from the HTML of `diamondecho.com` at 20:46 UTC, and at 21:02 to 21:05 UTC neither `diamondecho.com` nor `staff.diamondecho.com` had it in the HTML or the loaded page, and neither page made a request to it.

### API redeploy from `f8853da` (2026-10-07, 00:52 to 01:10 UTC)

The owner's yes in chat: "Yes, redeploy the production API from main."

**API moved from `50705a5` to `f8853da`.** The backend files that differ between the two commits are the assistant (`backend/ai/`), one knowledge source (`backend/services/knowledge/catalog.py`), the switch for the route list in `backend/server.py`, and tests. `backend/requirements-runtime.txt` and the Dockerfile are unchanged. Same routine as the day before:

1. Before anything changed, the old revision was asked 18 assistant questions and gave the old answers; `/docs`, `/redoc` and `/openapi.json` answered 200.
2. `gcloud run deploy diamondecho-api --source backend --project diamondecho-prod --region us-east1 --no-traffic --tag candidate --quiet`, from the Cloud Shell clone at `f8853da` with nothing uncommitted. 00:52:46 to 00:53:46 UTC. Result: `diamondecho-api-00007-deh`, serving 0 percent.
3. Settings compared from the service description saved before and read after: runtime identity, 1 CPU, 1 GiB, concurrency 1, timeout 30 s, maximum 3 instances, the six environment variable names and their values, the port and the startup probe are identical, and no annotation differs. Only the image changed.
4. Candidate checks at its temporary address (01:04 UTC): `/health` 200; the staff list with no sign-in 401; an empty request 422; `/docs`, `/redoc` and `/openapi.json` 404; the reference land request answers formula `diamond-underwriting-1.1.0` with residual land value 2,315.27, the same as before; 18 assistant messages in 15 conversations, sent the way the page sends them, each answer byte-identical to a local copy of the service at `f8853da`.
5. `gcloud run services update-traffic diamondecho-api --to-latest`, then `--remove-tags candidate`, 01:05:29 to 01:05:37 UTC. The service is back to one entry: latest revision, 100 percent. The temporary address answers 404.
6. On production afterwards: `/health` 200, staff list 401, the three route-list addresses 404 (01:05 UTC); the same 18 assistant answers and the land figures again identical (01:07 UTC); and on `diamondecho.com` the six assistant criteria of DE-20 were seen in the panel itself (`docs/de20-assistant.md`).

Not done: no request was sent through a form, and a return to revision 4 was not rehearsed (see "Undo").

Left in the owner's Cloud Shell home, his to remove: `api-before2.json` and `api-after2.json` (service descriptions, which include the environment variable values), `cmp2.py`, `cmp2.out`, `deploy2.log`, `traffic2.log`, beside the three items from the day before.

### API redeploy from `d151b51` (2026-10-07, 01:41 to 01:48 UTC)

The owner's yes in chat, after merging the tour fix (PR #70): "Yes to another redeploy."

**API moved from `f8853da` to `d151b51`.** The only backend files that differ are `backend/ai/assistant.py`, `backend/ai/intent.py` and one test file. Same routine:

1. Before: production (revision 7) answered the 18 assistant messages exactly as a local copy of `f8853da` does; "I would like to tour a property" got the opening menu.
2. `gcloud run deploy diamondecho-api --source backend --project diamondecho-prod --region us-east1 --no-traffic --tag candidate --quiet`, from the Cloud Shell clone at `d151b51` with nothing uncommitted. 01:41:57 to 01:42:55 UTC. Result: `diamondecho-api-00010-car`, serving 0 percent.
3. Settings compared from the description saved before and read after: identical apart from the image (runtime identity, 1 CPU, 1 GiB, concurrency 1, timeout 30 s, maximum 3 instances, the six environment variable names and values, the port, the startup probe; no annotation differs).
4. Candidate checks at its temporary address (01:43:54 UTC): `/health` 200; the staff list with no sign-in 401; `/docs`, `/redoc` and `/openapi.json` 404. Then an empty request 422, the reference land request unchanged (formula `1.1.0`, residual 2,315.27), and the 18 assistant answers byte-identical to a local copy of the service at `d151b51`.
5. `update-traffic --to-latest`, then `--remove-tags candidate`, 01:45:04 to 01:45:11 UTC. One entry: latest revision, 100 percent. The temporary address answers 404.
6. On production afterwards: `/health` 200, staff list 401, route list 404; the 18 answers and the land figures identical again; and in the panel on `diamondecho.com`, "I would like to tour a property" shows "Request a property tour", which opens the tour form (`docs/de20-assistant.md`).

The site's own files did not change: `diamondecho.com` still serves the build of `f8853da`, which is byte-identical to a build of `d151b51`.

Not done: no request was sent through a form, and a return to revision 7 was not rehearsed.

Left in the owner's Cloud Shell home, his to remove: `api-before3.json` and `api-after3.json` (they include the environment variable values), `cmp3.py`, `cmp3.out`, `deploy3.log`, `traffic3.log`, beside the items from the two earlier redeploys. Also `delprot.log` from switching delete protection on.

## Proven by the owner

| Date | What Gbenga did | Result |
| --- | --- | --- |
| 10-06 | Scanned the QR code with his authenticator app on the production staff page | Enrolled and signed in. A first attempt failed because the code came from the staging entry |
| 10-06 | Opened the production queue | The one synthetic request was shown, with its time in Eastern time |
| 10-06 | Pressed Acknowledge | "Request acknowledged." |
| 10-06 | Checked the mailbox | The production alert email had arrived |

These were done at the `pages.dev` staff address, before the domain move.

## Not proven, and open

State on 2026-10-07, after the owner's decisions of that night (Jira DE-26, DE-15, DE-9).

1. Mail to and from `realtor@` after the nameserver change. The records are identical; only the mailbox owner can send and receive. He has not said separately that an alert email arrived since the move.
2. Staff sign-in at `staff.diamondecho.com`: done by the owner on 2026-10-06 (DE-31).
3. Requests through the form at `diamondecho.com`: a buyer request by the owner on 2026-10-06, received, viewed and acknowledged; a seller and a tour request by Claude on 2026-10-07 at the owner's instruction, with made-up details, both answered 201 with the right receipt (references `5b107f29-3e9d-57cc-9f49-01c3cf74f2b6` and `0a2b76dc-70da-59db-bbab-63bbf00aea30`). **Their appearance and acknowledgement in the staff queue is the owner's to confirm.**
4. A restore from backup: **not done. The owner decided on 2026-10-07 to launch without it** ("Skip for launch"); it moves to the weeks after launch (DE-28). The alert email carries no visitor detail, so the database is the only copy of a request.
5. Phones, Safari and Firefox: the owner's report of 2026-10-06, "it looks perfect on all phones, safari and firefox". He did not name the pages or the phones; no agent has tested the staff page on a phone.
6. Rollback of a Pages deployment or a Cloud Run revision: **not rehearsed. Waived for launch by the owner on 2026-10-07.** The three redeploys of 10-06 and 10-07 moved forward only; the commands are under "Undo".
7. Production holds four test records: "Production Alert Test" (10-05), the owner's own request (10-06) and the two "TEST … (sent by Claude)" requests (10-07). Removing them is the owner's action.

## Findings to carry forward

- **Same issuer name in the authenticator app.** Staging and production both enrol as "DiamondEcho staff"; only the project name in brackets differs. One real mix-up happened. Either rename the staging entry in the app, or change the code so that a staging project enrols under a different issuer.
- **No DMARC or DKIM** for the mail domain. None existed before the move. Adding them changes how mail is treated and needs the owner's yes.
- **Default compute service account** holds the Editor role in both projects. It is not the API's identity. Narrowing it needs the owner's yes.
- **Node 20** is past end of life; all Pages projects that were read pin it. Moving is a separate, tested change.
- **The smoke script refuses production names.** A production mode, still read-only, would remove the need to call the function directly.
- **The `pages.dev` addresses still load.** A redirect from them to the new addresses would avoid confusion.
- **GoDaddy's Microsoft 365 and payment panels** may report that DNS is managed elsewhere. Future mail DNS changes are made at Cloudflare.
- **Email verification by administrator call.** As on staging, the staff page has no "prove this inbox is yours" step.

## Undo

- **Close the request slot at once:** `gcloud run services update diamondecho-api --region us-east1 --project diamondecho-prod --update-env-vars INQUIRY_STAFF_QUEUE_ENABLED=false`. The form then answers 503 and stores nothing.
- **Return the API to the earlier code:** `gcloud run services update-traffic diamondecho-api --to-revisions=diamondecho-api-00007-deh=100 --project diamondecho-prod --region us-east1`. Revision 7 (`f8853da`) is kept for this; the only difference is that a plain tour request gets the assistant's opening menu again. Revision 4 (`50705a5`: the assistant's earlier answers, a public route list, formula `1.1.0`) and revision 3 (`f84c9ea`, formula `1.0.0`) are also still there. Either command pins traffic to the named revision, so a later deploy serves nothing until `--to-latest` is run. Not rehearsed.
- **Allow the database to be deleted again:** `gcloud firestore databases update --database="(default)" --no-delete-protection --project diamondecho-prod`. Only needed before a deliberate removal, which is the owner's to run.
- **Silence the alert:** disable the policy; do not remove it.
- **Move DNS back:** at GoDaddy choose "GoDaddy Nameservers". If GoDaddy does not restore its record list, re-enter the nineteen records in the table above. Then set `PUBLIC_ORIGIN`, `STAFF_ORIGIN` and `CORS_ORIGINS` on the API, and `STAFF_ORIGIN` and `PUBLIC_ORIGIN` on the staff Pages project, back to the `pages.dev` addresses and rebuild the staff site.
- Removing a record, a policy, a schedule, a project or stored requests is a deletion and is the owner's to run.
