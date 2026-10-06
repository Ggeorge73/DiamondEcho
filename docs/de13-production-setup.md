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

Cloud Run: 1 CPU, 1 GiB, concurrency 1, timeout 30 s, minimum 0 and maximum 3 instances, open to the internet (the API does its own checks). Deployed from `main` at `f84c9ea`; later revisions changed settings only and kept the same container image.

| Revision | Change |
| --- | --- |
| `diamondecho-api-00001-lj9` | First deploy, queue off |
| `diamondecho-api-00002-9zg` | Queue on, one staff user ID listed |
| `diamondecho-api-00003-prh` | `PUBLIC_ORIGIN`, `STAFF_ORIGIN`, `CORS_ORIGINS` moved to the `diamondecho.com` addresses |

Always pass `--project diamondecho-prod`. Cloud Shell's default project can be either staging or production, depending on how the session was opened.

## 2. Database and sign-in

The same steps as `docs/de33-staging-stage-two.md` steps 1 to 5, with these differences:

- **Role grant collision.** The first `add-iam-policy-binding` failed with "concurrent policy changes", because Google was writing its own service entries just after the services were enabled. Nothing was half-applied. Waiting a minute and running the two grants again succeeded.
- **Web app by command line.** `npx firebase-tools@15.31.0 apps:create WEB "DiamondEcho staff" --project diamondecho-prod`, so that the web key was not displayed to the agent. The console screen that shows the key was not read.
- **Staff user.** Gbenga created the user. At his instruction it was moved to `realtor@diamondecho.com` and marked verified by the administrator call in stage-two step 4c, in one request.
- **Two staging tests not repeated.** T6 (an unverified account is refused) and T8 (a signed-in person not on the list is refused) passed on staging. In production the email was verified and the real user listed in one pass, so neither was exercised.

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

## Proven by the owner

| Date | What Gbenga did | Result |
| --- | --- | --- |
| 10-06 | Scanned the QR code with his authenticator app on the production staff page | Enrolled and signed in. A first attempt failed because the code came from the staging entry |
| 10-06 | Opened the production queue | The one synthetic request was shown, with its time in Eastern time |
| 10-06 | Pressed Acknowledge | "Request acknowledged." |
| 10-06 | Checked the mailbox | The production alert email had arrived |

These were done at the `pages.dev` staff address, before the domain move.

## Not proven, and open

1. Mail to and from `realtor@` after the nameserver change. The records are identical; only the mailbox owner can send and receive.
2. Staff sign-in at `staff.diamondecho.com`.
3. A request sent through the form at `diamondecho.com`, its alert and its appearance in the queue. The one stored request was sent from Cloud Shell.
4. A restore from backup.
5. The staff page on a real phone browser, Safari and Firefox.
6. Rollback of a Pages deployment or a Cloud Run revision has not been exercised in production.
7. Production holds one synthetic record, "Production Alert Test". Removing it is the owner's action.

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
- **Silence the alert:** disable the policy; do not remove it.
- **Move DNS back:** at GoDaddy choose "GoDaddy Nameservers". If GoDaddy does not restore its record list, re-enter the nineteen records in the table above. Then set `PUBLIC_ORIGIN`, `STAFF_ORIGIN` and `CORS_ORIGINS` on the API, and `STAFF_ORIGIN` and `PUBLIC_ORIGIN` on the staff Pages project, back to the `pages.dev` addresses and rebuild the staff site.
- Removing a record, a policy, a schedule, a project or stored requests is a deletion and is the owner's to run.
