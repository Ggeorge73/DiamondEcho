# DE-33 staging setup: first stage

Status: prepared by Claude acting as the Engineering agent on 2026-10-03. Steps 1 to 4 were run on 2026-10-04 and are recorded under "What has been run" and "What has been checked on staging" below.

This first stage stands up the API and two staging sites with the inquiry queue **disabled**. It is enough to repeat the Deal Studio and assistant checks on a deployed build. Staff sign-in, Firestore and real inquiry delivery are the second stage and need Firebase decisions that this document does not make.

## Who does what

Gbenga creates the accounts, the project, billing and the Pages projects, and runs the commands below himself in Google Cloud Shell. No password, key or token is given to an agent, pasted into chat, or written to GitHub or Jira. The agents need only names and web addresses, which are not secret.

## What has been run

| Step | Result |
| --- | --- |
| 1 | Project `diamondecho-staging`, billing attached, budget of 25 US dollars a month. Done by Gbenga |
| 2 | Public staging `https://diamondecho-staging.pages.dev` and staff staging `https://diamondecho-staff-staging.pages.dev`, both built from `main`. Done by Gbenga |
| 3 | API `diamondecho-api-staging` in `us-east1`, revision `diamondecho-api-staging-00001-xtt`, built from commit `15500c16549b94b70c0b71ac3380cf4b7e44e653`, at `https://diamondecho-api-staging-299705773978.us-east1.run.app`. Inquiry queue off. Run on 2026-10-04 by Claude in Gbenga's Cloud Shell, at his request, as a one-off exception to the rule that agents do not provision cloud resources. No password, key or token was typed or seen. Checks are recorded on DE-33 |
| 3, repeated | Redeployed from `1d69bf53894c65d82c8911d8da390308f93481f4` after PR #42, revision `diamondecho-api-staging-00002-zxs`, same address and settings. Run by Claude at Gbenga's request |
| 3, repeated again | Redeployed from `0eb78b8f4499e53bd1e4332d116e04ec445cf323` after PR #43, revision `diamondecho-api-staging-00003-gdl`, same address and settings. Run by Claude at Gbenga's request |
| 4 | `REACT_APP_BACKEND_URL` added to the `diamondecho-staging` Pages project (Production) and the latest deployment retried. Run by Claude in Gbenga's Cloudflare dashboard, with his permission. The existing DiamondEcho Pages project was not touched |

Cloud Run gives one service two addresses. The second, `https://diamondecho-api-staging-2ku27sqe6q-ue.a.run.app`, reaches the same service. Use the first everywhere so the records agree.

## Choices made, for Gbenga to confirm

| Choice | Value | Why |
| --- | --- | --- |
| Region | `us-east1` (South Carolina) | Closest Google region to Atlanta. Firestore's location, chosen in the second stage, should match and cannot be changed later |
| API service name | `diamondecho-api-staging` | Keeps staging and production apart by name |
| Cost limits | 1 CPU, 1 GiB, at most 3 instances, none kept running when idle | The values in `docs/pages-cloud-run-firebase-runbook.md`. An idle service costs nothing for compute. This is not a spending cap, so the budget alert in step 1 matters |

## Step 1. Google Cloud project (Gbenga, about 10 minutes)

1. In the Google Cloud console create a new project. Suggested name: `diamondecho-staging`. Note the **project ID** the console shows; it may differ from the name.
2. Attach a billing account to it.
3. Under Billing, Budgets and alerts, create a budget for this project with email alerts. Suggested amount: 25 US dollars a month.

## Step 2. Two Cloudflare Pages projects (Gbenga, about 10 minutes)

Create both from the same GitHub repository, production branch `main`. Copy the Node and npm settings from the existing DiamondEcho Pages project.

| Project | Build command | Output directory | Settings to add now |
| --- | --- | --- | --- |
| Public staging, suggested name `diamondecho-staging` | `npm run build` | `build` | None yet |
| Staff staging, suggested name `diamondecho-staff-staging` | `npm run build:staff` | `staff-queue/dist` | None. With no settings it builds a page that says the staff queue is disabled, which is correct for this stage |

Note the two addresses Cloudflare gives them, for example `https://diamondecho-staging.pages.dev`. Cloudflare adds letters to a name that is already taken, so use the addresses it actually shows.

## Step 3. Deploy the API (Gbenga, in Google Cloud Shell, about 10 minutes)

Open Cloud Shell from the console with the staging project selected. Put the two addresses from step 2 into the first two lines, with no trailing slash, then paste the block.

```bash
PUBLIC_ORIGIN="https://diamondecho-staging.pages.dev"
STAFF_ORIGIN="https://diamondecho-staff-staging.pages.dev"

(
set -euo pipefail
PROJECT_ID="$(gcloud config get-value project)"
REGION="us-east1"
SERVICE="diamondecho-api-staging"
RUNTIME_ACCOUNT="diamondecho-api-runtime"
echo "Deploying to project: ${PROJECT_ID}"

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

# A dedicated identity for the running API with no roles granted. Stage two adds
# only what Firestore and staff sign-in need.
gcloud iam service-accounts describe "${RUNTIME_ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com" >/dev/null 2>&1 \
  || gcloud iam service-accounts create "${RUNTIME_ACCOUNT}" --display-name="DiamondEcho staging API runtime"

rm -rf DiamondEcho
git clone --depth 1 https://github.com/Ggeorge73/DiamondEcho.git
cd DiamondEcho
echo "Commit being deployed: $(git rev-parse HEAD)"

gcloud run deploy "${SERVICE}" \
  --source backend \
  --region "${REGION}" \
  --service-account "${RUNTIME_ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --allow-unauthenticated \
  --cpu 1 --memory 1Gi --concurrency 1 \
  --min-instances 0 --max-instances 3 --timeout 30 \
  --set-env-vars "^@^INQUIRY_STAFF_QUEUE_ENABLED=false@PUBLIC_ORIGIN=${PUBLIC_ORIGIN}@STAFF_ORIGIN=${STAFF_ORIGIN}@CORS_ORIGINS=${PUBLIC_ORIGIN},${STAFF_ORIGIN}"

gcloud run services describe "${SERVICE}" --region "${REGION}" --format='value(status.url)'
)
```

The block runs inside brackets so that an error stops the block without closing the Cloud Shell window.

What to expect:

- The first deploy asks to create a storage place for the built image. Answer yes.
- `--allow-unauthenticated` makes the API reachable from the internet. That is required: the public site's calculator calls it from visitors' browsers. Staff routes check sign-in themselves and, with the queue disabled, answer 503.
- The last line prints the API address, ending in `.run.app`.
- To confirm the API is up, open `<API address>/health`. It should show `{"status":"ok"}`. Do not use `/healthz`: Cloud Run answers that path itself with a "404 Not Found" page and the request never reaches the API.
- Running the block again later redeploys the current `main` to the same service and address. That is how a merged change reaches staging.
- If a command stops with an error, copy the error text to the Engineering agent. These outputs contain no secrets.

## Step 4. Point the public staging site at the API (Gbenga, about 5 minutes)

In the **public staging** Pages project only, add the setting `REACT_APP_BACKEND_URL` with the API address from step 3, with no `/api` and no trailing slash. Then retry the latest deployment so the build picks it up.

Do not add this setting to the existing DiamondEcho Pages project. That one stays as it is.

## Step 5. Tell the Engineering agent (not secret)

1. The Google Cloud project ID.
2. The three addresses: public staging, staff staging and API.
3. The commit printed in step 3.

## What the agents do next

- Run the read-only smoke check (`scripts/staging-smoke.mjs`) against the three addresses and record the output on DE-33.
- Repeat the checks carried over to DE-33 on the deployed build: Deal Studio through the API for rental, flip and land, Monte Carlo with 10,000 iterations, a rejected request, and the assistant.
- Record the commit, addresses, region and rollback path on DE-33.

## What has been checked on staging

Recorded on DE-33 on 2026-10-04. Step 4 is set: `REACT_APP_BACKEND_URL` on the `diamondecho-staging` Pages project points at the API address above.

- Smoke check (`scripts/staging-smoke.mjs`): 9 of 9 pass.
- Deal Studio base analysis for rental, flip and land, a rejected request, and the assistant: pass through the staging site.
- Risk simulation before the time budget: 1,000, 2,500 and 5,000 iterations per case finished (5.3 s, 14.1 s, 25.2 s). 10,000 did not finish inside the 30-second request limit, and the abandoned run delayed the requests behind it.

Risk simulation with the 20-second time budget (API revision `diamondecho-api-staging-00003-gdl`): every run returns. Three cases per run:

| Strategy | Requested per case | Time | Completed per case |
| --- | --- | --- | --- |
| Rental | 2,500 | 14.5 s | 2,500 |
| Rental | 5,000 | 20.2 s | 3,500 |
| Rental | 10,000 | 20.4 s | 3,450 |
| Rental | 1,000, straight after the 10,000 run | 5.8 s | 1,000 |
| Fix and flip | 10,000 | 20.3 s | 3,700 |
| Land | 2,500 | 20.4 s | 2,250 |
| Land | 10,000 | 20.2 s | 2,300 |

When a run stops early the results panel states "Only X of the Y requested iterations were run."

## What this stage does not cover

- Staff sign-in, Firestore, and sending or reading real inquiries. The queue stays disabled, so the inquiry forms on the staging site will show "We could not send your request just now."
- Address lookup in Deal Studio. It needs Mapbox and RentCast keys stored in Secret Manager, which is a separate step.
- Any production resource, domain or DNS record.

## Known behaviour to decide before stage two

Address lookups are sent as part of the web address (`/api/v1/properties/lookup?address=...`), and Cloud Run's request log records web addresses. A looked-up address would therefore appear in the request log. The Privacy page says so. Whether to shorten log retention or change the lookup to keep the address out of the log is an open decision.

## Rollback

Staging only. To stop the API: `gcloud run services delete diamondecho-api-staging --region us-east1`. To remove a staging site, delete its Pages project. Neither touches production.
