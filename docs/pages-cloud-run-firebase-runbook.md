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

Required backend environment:

| Variable | Value / meaning |
| --- | --- |
| FIREBASE_PROJECT_ID | Approved Firebase/GCP project ID |
| INQUIRY_STAFF_UIDS | Exact comma-separated approved staff UIDs, never emails |
| PUBLIC_ORIGIN | Exact HTTPS public origin, no trailing slash |
| STAFF_ORIGIN | Different exact HTTPS staff origin, no trailing slash |
| CORS_ORIGINS | Only those approved origins; add www only if actually used |
| INQUIRY_STAFF_QUEUE_ENABLED | false until operational acceptance; then true |

The public inquiry/calculator API requires unauthenticated Cloud Run invocation,
while staff routes enforce Firebase tokens themselves. Gbenga must approve
that ingress/IAM choice. Cloud Run IAM alone is not staff authentication.
`/healthz` proves process liveness only, not delivery or Firebase readiness.
With queue disabled/unconfigured, submissions and staff access return 503.
The legacy status endpoints are staff-protected, no longer publicly readable.

Before enabling the queue, implement and test provider/edge abuse controls,
rate limits and request quotas that also cover direct API-hostname access.
CORS does not stop bots. No distributed rate limiter or CAPTCHA is claimed by
this PR. This is an explicit public-launch gate, not resolved by max instances.
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

Tiara runs the Type 7 matrix on the exact release-candidate build and URLs,
including real email/password + TOTP enrollment/sign-in, negative identity
cases and all three inquiry types. Lara confirms who checks the queue, response
SLA, alerting, backup responder, retention and recovery. No email notification
or automated retention job is implemented. Gbenga alone authorizes merge and
production release.

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
