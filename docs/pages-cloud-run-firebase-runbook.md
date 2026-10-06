# Pages + Cloud Run + Firebase release runbook

Status: implementation prepared, not deployed. All live actions below require
Gbenga's explicit approval and verified access. No actual cloud project, staff
UID, service account, API hostname or Cloudflare project is assumed.

## 1. Owner decisions before provisioning

Gbenga approves project/billing account, region and Firestore location (choose
near expected users and Cloud Run), retention/backup policy, staff identities,
domain/DNS plan and budget. Identity Platform is needed for Firebase TOTP.
Provision only Gbenga's initial staff user, verify email and configure recovery
and revocation procedures. Do not give every Firebase user staff access.
Do not enable public signup in this site's UI. Allow staff authentication only
on the chosen staff origin. Configure password policy and email-enumeration
protection privately. Account recovery must not bypass MFA authorization.

Inventory any existing MongoDB inquiry data before separately approving a
migration. Preserve it; this implementation performs no migration/deletion.

## 2. Firebase and runtime IAM

Create Firestore in native mode and deploy the default-deny rules/index config
only after selecting the approved project. Server Admin SDK bypasses rules.
Give Cloud Run a dedicated runtime service account, not Owner/Editor. Review
`roles/datastore.user` for the selected database and
`roles/firebaseauth.viewer` (includes `firebaseauth.users.get` for revocation
checks); prefer narrower custom permissions where feasible. Separate the
deployment identity from the runtime identity. Use attached identity/ADC, never
downloaded service-account keys in Git, Pages or chat. Secrets such as
RENTCAST_API_KEY belong in Secret Manager with narrowly scoped access.

Do not set emulator variables on Cloud Run. The application refuses them when
K_SERVICE is present. Production staff SDK configuration never uses emulators.

## 3. Cloud Run container and configuration

Build context is `backend`, Python 3.12, nonroot process, port PORT (8080 by
default). Use an image digest, not an unreviewed mutable tag. The template is
deliberately incomplete and keeps the inquiry queue disabled.

Start with one CPU, 1 GiB, concurrency 1, min instances 0, max instances 3 and
30-second request timeout. Concurrency 1 limits overlap with existing CPU-heavy
calculator calls; benchmark worst-case Monte Carlo before rollout. These are
initial settings, not a measured production sizing guarantee or spending cap.

Benchmark on staging at these settings, 2026-10-04 (DE-33), three rental cases
per run: 1,000 iterations per case 5.3 s; 2,500 14.1 s; 5,000 25.2 s; 10,000
cut off by the 30-second timeout with no result, after which the abandoned
calculation delayed the next requests. The API therefore stops a simulation at
`MONTE_CARLO_TIME_BUDGET_SECONDS` (default 20) and returns the iterations it
completed, the same number for every case, with the counts stated in the
result. Keep the budget at least 8 seconds below the request timeout to leave
room for a cold start (7.3 s measured). If the timeout is raised, raise the
budget with it.

With the 20-second budget, measured on staging on 2026-10-04: a 10,000 request
returned about 3,450 iterations per case for rental, 3,700 for fix and flip and
2,300 for land, each in about 20.3 s, and a 1,000 run straight afterwards took
its normal 5.8 s. Land is the slowest strategy: its default of 2,500 returned
2,250.

Since 2026-10-06 (DE-25) Deal Studio no longer sends its simulation to this
service. Gbenga's production test stopped at 3,400 of 5,000 rental iterations,
so the page now runs Monte Carlo in the visitor's browser, a block at a time
with progress shown: 10,000 iterations per case for three cases took about 2
seconds on a desktop-class machine, in a tab that is in view or (since DE-38)
out of view. The `/api/v1/deals/monte-carlo` address and
its time budget are unchanged and still protect the service from any other
caller. Base analysis still goes to the service. See
`docs/deal-studio-land-decision.md`.

Required backend environment:

| Variable | Value / meaning |
| --- | --- |
| FIREBASE_PROJECT_ID | Approved Firebase/GCP project ID |
| INQUIRY_STAFF_UIDS | Exact comma-separated approved staff UIDs, never emails |
| PUBLIC_ORIGIN | Exact HTTPS public origin, no trailing slash |
| STAFF_ORIGIN | Different exact HTTPS staff origin, no trailing slash |
| CORS_ORIGINS | Only those approved origins; add www only if actually used |
| INQUIRY_STAFF_QUEUE_ENABLED | false until operational acceptance; then true |
| INQUIRY_LIMIT_PER_ADDRESS | Optional. Submissions one connection may send in 10 minutes. Default 5. Must be 1 to 1000; anything else uses the default, so the limit cannot be switched off |
| INQUIRY_LIMIT_PER_HOUR | Optional. Submissions one running instance accepts in an hour from everyone together. Default 30. Same rule |
| MONTE_CARLO_TIME_BUDGET_SECONDS | Optional. Seconds a simulation may calculate before it returns what it has. Default 20. `0` removes the limit and is only safe where nothing cuts requests off |

The public inquiry/calculator API requires unauthenticated Cloud Run invocation,
while staff routes enforce Firebase tokens themselves. Gbenga must approve
that ingress/IAM choice. Cloud Run IAM alone is not staff authentication.
`/health` proves process liveness only, not delivery or Firebase readiness.
Do not check `/healthz` on a deployed service: Cloud Run answers that path
itself with a 404 and the request never reaches the API (DE-33).
With queue disabled/unconfigured, submissions and staff access return 503.
The legacy status endpoints are staff-protected, no longer publicly readable.

Before enabling the queue, test the abuse controls on the deployed service,
including direct API-hostname access. CORS does not stop bots.

What exists (DE-33, `backend/inquiries/limits.py`): the API refuses a sixth
submission from one connection inside 10 minutes with 429, and refuses further
submissions with 503 once one instance has accepted 30 in an hour. Both answers
carry `Retry-After` and a sentence the form shows the visitor. Replays and
submissions that fail the field checks count as attempts. On Cloud Run the
connection is the last `X-Forwarded-For` entry, the one Google's front end
appends; entries a sender types in front of it are ignored. IPv6 addresses
are counted per /64.

What it is not: counts are held in each instance's memory, so the real ceiling
is the per-hour figure times `--max-instances` (90 an hour at the settings
above), and an instance that has just started begins from zero. A sender who
rotates addresses is held only by the hourly cap, and can use it up so that
real visitors are told to call or email instead. There is no CAPTCHA or
challenge at the form. If the hourly cap is ever reached in production, add a
challenge (for example Cloudflare Turnstile) before raising the cap. This
remains a public-launch gate until it has been exercised on staging.
Review existing public analytics/recording scripts separately under DE-18.
The production dependency audit reports 41 findings (21 high, 11 moderate,
9 low; no critical), including the existing React/CRA dependency tree.
Review runtime exposure and remediate or explicitly accept risks before launch;
do not use an automatic breaking audit fix as release evidence.

## 4. Two Cloudflare Pages projects

Use repository root for both builds, pinned npm 10.9.3 and a tested Node
version (CI uses Node 20 for public and Node 22 for staff). Never publish source
directories directly.

Public project: command `npm run build`, output `build`.
Set REACT_APP_BACKEND_URL to the approved Cloud Run/API HTTPS origin WITHOUT
`/api` or trailing slash. React configuration is baked into each build.
The copied `_redirects` supports SPA deep links; test routes and true not-found
UI on Pages. Initial unconfigured builds do not prove live intake.

Staff project: command `npm run build:staff`, output `staff-queue/dist`.
Deployment environment:
- STAFF_QUEUE_ENABLED=true
- STAFF_API_ORIGIN=<approved API HTTPS origin>
- STAFF_ORIGIN=<approved isolated staff HTTPS origin>
- PUBLIC_ORIGIN=<approved public HTTPS origin>
- FIREBASE_PROJECT_ID=<approved project>
- FIREBASE_AUTH_DOMAIN=<project>.firebaseapp.com
- FIREBASE_WEB_API_KEY=<Firebase public web API key>
- FIREBASE_WEB_APP_ID=<Firebase public app ID>

Unset staff configuration builds an intentionally disabled page. Only public
web config is included; never provide Admin credentials. Configure Firebase
authorized domains/API-key restrictions consistently with the approved staff
host and test sign-in. Do not put staff settings into the public React bundle.
Staff output includes restrictive CSP and no-store security headers. Confirm
those headers on the deployed host rather than relying on file existence.

Do not provide production identity config to untrusted PR previews. Use
separate staging credentials/projects. Disable automatic production promotion
until Gbenga approves the tested release commit.

## 5. Domain and release

GoDaddy remains the registrar. Connecting apex diamondecho.com to Pages may
require the Cloudflare DNS/nameserver setup; inspect current DNS and preserve
MX/TXT/email records before any change. Approve www redirects and staff/API
subdomains explicitly. Do not cancel GoDaddy hosting until the replacement is
verified and rollback is agreed.

This was done on 2026-10-06: DNS hosting moved to Cloudflare, `diamondecho.com`
serves the public site, `www` redirects to it and `staff.diamondecho.com`
serves the staff site. The record of every production step, the DNS records
that were carried over, the checks and what is still unproven is
`docs/de13-production-setup.md`.

Tiara runs the Type 7 matrix on the exact release-candidate build and URLs,
including real email/password + TOTP enrollment/sign-in, negative identity
cases and all three inquiry types. Lara confirms who checks the queue, response
SLA, alerting, backup responder, retention and recovery. Gbenga set the routing
terms on 2026-10-05. An arrival alert email exists on staging and, since
2026-10-05, in production; see `docs/de31-inquiry-routing.md` and
`docs/de13-production-setup.md`. No automated retention job is implemented.
Gbenga alone authorizes merge and production release.

## 6. Costs, monitoring and rollback

Configure billing budgets/alerts, log retention, API/provider quotas and Cloud
Run max instances before release. Alerts and max instances are not hard total
spend caps; storage, egress, builds and third-party APIs can incur charges.
Watch storage failures, staff verification failures, 5xx/429, latency and oldest
unacknowledged inquiry. Never log request bodies, tokens or visitor details.
Container access logs are disabled; review Cloud Run platform logging separately.

Rollback public/staff Pages deployments to the last approved build and Cloud
Run to the last compatible revision. Do NOT roll the old MongoDB/shared-key
prototype into an enabled queue. Disable inquiry acceptance when staff delivery
is unverified; retain Firestore records. Any customer-data deletion needs exact
targets and separate approval.

## Commands for development/CI only

```text
npm ci
npm run test --workspace frontend -- --watchAll=false --runInBand
npm run test:staff
npm run build
npm run build:staff
python -m pip install -r backend/requirements.txt
python -m pytest backend/tests
npx --yes firebase-tools@15.31.0 emulators:exec --project demo-diamondecho --only firestore "node --test staff-queue/firestore-rules.test.mjs && python -m pytest backend/tests/test_firestore_emulator.py -q"
docker build -t diamondecho-api:local backend
```

Emulator requires Java 21; CI supplies it. Local workstation has Java 16 and
no Docker, so container/emulator results must come from CI or a suitable test
machine. Never substitute a real Firebase project for the demo emulator.

References:
[Auth IAM](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaseauth),
[TOTP](https://firebase.google.com/docs/auth/web/totp-mfa),
[Emulator](https://firebase.google.com/docs/emulator-suite/connect_firestore).
