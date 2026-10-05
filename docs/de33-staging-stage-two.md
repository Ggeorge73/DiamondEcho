# DE-33 staging setup: second stage

Status: prepared by Claude acting as the Engineering agent on 2026-10-05. **Steps 1, 2, 3, 4a and 5 were run that day, and six of the eight settings in step 7 were saved. Steps 4b, 4c, 6, 8 and 9 have not been run.** The commands were first written from the product documentation and the repository. Each step that has been run is recorded under "What has been run", and its commands below have been corrected to match what was run (the same commands, entered one at a time rather than as one block). The commands for steps not yet run are still unproven and will be corrected here as each is run, as was done for the first stage in [de33-staging-setup.md](de33-staging-setup.md).

The first stage stood up the API and two staging sites with the inquiry queue disabled. This stage adds the database, staff sign-in with an authenticator app, and real test requests end to end. It is staging only: project `diamondecho-staging`, region `us-east1`, the two `*-staging.pages.dev` sites. No production resource, domain, DNS record or billing setting is touched.

## What has been run

Gbenga gave his yes in chat on 2026-10-05 to the database location, the staff email, the listed changes, and separately to the Blaze pricing plan when Firebase asked for it. Claude ran these in his browser and Cloud Shell, signed in as him. No password, key or token was typed or seen.

| Step | Result |
| --- | --- |
| 1 | Firebase added to `diamondecho-staging`. Google Analytics off. Firebase required a pricing-plan confirmation, "Blaze, pay as you go", because the project already has billing; Gbenga approved it. No monthly fee; the free allowances still apply |
| 2 | Before: Firestore service off, no database, the API's identity holding no roles. `firebase`, `firebaserules` and `identitytoolkit` had been switched on by step 1. After: all four services on; database `(default)` created, `us-east1`, Native mode, free tier; the API's identity holds exactly `roles/datastore.user` and `roles/firebaseauth.viewer` |
| 3 | Rules and index settings published from commit `ef1bb51` with `firebase-tools@15.31.0`, which used Cloud Shell's sign-in without asking. Anonymous list and anonymous write both answer 403. The anonymous list already answered 403 before the rules were published: a new database is closed to browsers by default |
| 4a | Email/Password provider on (email-link sign-in off). Upgraded to Identity Platform; the console warns that this cannot be reversed and that sign-in is charged only above 50,000 monthly users. The three settings calls each answered 200. Read back: authenticator provider `ENABLED` with `adjacentIntervals` 1; `disabledUserSignup` and `disabledUserDeletion` true; improved email privacy true; phone and anonymous sign-in not configured |
| 4b, 4c | Not run. Waiting for Gbenga to create the staff user |
| 5 | Web app `DiamondEcho staff staging` registered, Hosting not set up. App ID `1:299705773978:web:7e51d904b59b1582a6d423`, auth domain `diamondecho-staging.firebaseapp.com` |
| 6 | Not run. Waits for the submission limits to be on `main` |
| 7 | Six settings saved on the `diamondecho-staff-staging` Pages project (Production): the three addresses, the project ID, the auth domain and the app ID. **Not** yet set: `FIREBASE_WEB_API_KEY` (Gbenga) and `STAFF_QUEUE_ENABLED`. No deployment was retried, so the staff site still serves the disabled page |
| 8, 9 | Not run |

## Decisions

| Decision | Chosen | Note |
| --- | --- | --- |
| Database location | `us-east1`. Approved by Gbenga 2026-10-05 | Same region as the API. **Cannot be changed now that the database exists** |
| Staff sign-in email | The DiamondEcho realtor inbox. Approved by Gbenga 2026-10-05 | One named account. The API lists the account's user ID, never the email |
| Pricing plan | Blaze, pay as you go. Approved by Gbenga 2026-10-05 | Required for a project with billing. No monthly fee |
| Authenticator window | 1 interval either side | A code is accepted for about 90 seconds in total. Google's default is 5 either side. Claude's choice; say if it should be wider |
| Turning the queue on, on staging | Approved, after the submission limits are merged | The staging API is reachable from the internet. See "Why the limits come first" |

Expected cost: none at this volume. Firestore's free allowance and Identity Platform's free tier (email sign-in up to 50,000 monthly users) cover it, and no text messages are sent because the second factor is an authenticator app. The 25 US dollar budget alert from the first stage stays. An alert is not a spending cap.

## Who does what

Each Google Cloud, Firebase and Cloudflare change below needs Gbenga's explicit yes in chat. With that yes Claude runs the steps in his Cloud Shell and dashboards, as in the first stage. Three things only Gbenga does, because they involve a secret:

1. Create the staff user and choose its password (step 4).
2. Enrol his phone's authenticator app and sign in (step 8).
3. Paste the Firebase web key into Cloudflare (step 7).

No password, authenticator code, enrolment secret or token is typed by an agent, pasted into chat, or written to GitHub or Jira.

## Why the limits come first

`--allow-unauthenticated` is required: visitors' browsers call the API directly. So once the queue is on, anyone who finds the API address can post to it. `backend/inquiries/limits.py` bounds that: 5 submissions per connection per 10 minutes, and 30 accepted per running instance per hour. The queue is switched on (step 6) only on a commit that contains those limits. `docs/pages-cloud-run-firebase-runbook.md` says what they do and do not stop.

## Step 1. Add Firebase to the staging project

In the Firebase console choose "Create a new Firebase project", then "Add Firebase to Google Cloud project", and pick `diamondecho-staging`. The console lists what adding Firebase means, then asks to confirm the **Blaze, pay as you go** pricing plan (the only plan offered to a project that already has billing), then offers Google Analytics: turn it **off**. This cannot be undone short of deleting the project.

## Step 2. Services, database, roles (Cloud Shell)

```bash
(
set -euo pipefail
PROJECT_ID="$(gcloud config get-value project)"
[ "${PROJECT_ID}" = "diamondecho-staging" ] || { echo "Wrong project: ${PROJECT_ID}"; exit 1; }
REGION="us-east1"
RUNTIME="diamondecho-api-runtime@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud services enable firestore.googleapis.com identitytoolkit.googleapis.com \
  firebaserules.googleapis.com firebase.googleapis.com --quiet

# The database. Native mode. The location is permanent.
gcloud firestore databases describe --database="(default)" >/dev/null 2>&1 \
  || gcloud firestore databases create --database="(default)" --location="${REGION}" --type=firestore-native --quiet

# The API's own identity held no roles after the first stage. It gets two:
# read and write the database, and look up a staff account so a disabled or
# signed-out-everywhere account is refused.
for ROLE in roles/datastore.user roles/firebaseauth.viewer; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${RUNTIME}" --role="${ROLE}" --condition=None --quiet >/dev/null
done
gcloud projects get-iam-policy "${PROJECT_ID}" --flatten="bindings[].members" \
  --filter="bindings.members:${RUNTIME}" --format="value(bindings.role)"
)
```

The last command must print exactly those two roles.

Keep `--quiet` on these commands. Without it, a `gcloud firestore` command run while the Firestore service is off stops and asks whether to enable the service; if its output is being trimmed the question is hidden and the command appears to hang.

## Step 3. Database rules: deny every browser (Cloud Shell)

The repository's `firestore.rules` refuses all reads and writes from browsers. Only the API, through its own identity, reaches the data.

```bash
(
set -euo pipefail
D="$(mktemp -d)" && git clone -q --depth 1 https://github.com/Ggeorge73/DiamondEcho.git "${D}/repo" && cd "${D}/repo"
echo "Rules from commit: $(git rev-parse HEAD)"
npx --yes firebase-tools@15.31.0 deploy --only firestore:rules,firestore:indexes \
  --project diamondecho-staging --non-interactive
)
```

Check, from anywhere, with no sign-in. Both must answer 403:

```bash
B="https://firestore.googleapis.com/v1/projects/diamondecho-staging/databases/(default)/documents"
curl -s -o /dev/null -w "list  %{http_code}\n" "${B}/inquiries"
curl -s -o /dev/null -w "write %{http_code}\n" -X POST -H "Content-Type: application/json" \
  "${B}/rules_probe" -d '{"fields":{"probe":{"stringValue":"x"}}}'
```

The write check aims at a collection of its own, not `inquiries`, so that a mistake in the rules could never put a malformed record in front of the staff queue.

## Step 4. Sign-in

**4a. Turn on sign-in (Claude, with Gbenga's yes).** In the Firebase console under Authentication choose "Get started", enable the Email/Password provider (leave "Email link" off) and save. Then under "SMS Multi-factor Authentication" choose "Upgrade to enable" and complete the four-step upgrade to Identity Platform, which authenticator codes require. Leave SMS multi-factor itself off. Then in Cloud Shell:

```bash
(
set -euo pipefail
PROJECT_ID="diamondecho-staging"
patch() {  # $1 = updateMask, $2 = JSON body. Prints only the HTTP status.
  curl -sS -o /dev/null -w "$1 %{http_code}\n" -X PATCH \
    -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    -H "Content-Type: application/json" -H "X-Goog-User-Project: ${PROJECT_ID}" \
    "https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT_ID}/config?updateMask=$1" -d "$2"
}
# Authenticator-app codes as the second factor. One 30-second interval either side.
patch mfa '{"mfa":{"providerConfigs":[{"state":"ENABLED","totpProviderConfig":{"adjacentIntervals":1}}]}}'
# Nobody can create or delete an account from a browser. Staff are added by the owner only.
patch client.permissions '{"client":{"permissions":{"disabledUserSignup":true,"disabledUserDeletion":true}}}'
# Sign-in errors do not reveal whether an email has an account.
patch emailPrivacyConfig '{"emailPrivacyConfig":{"enableImprovedEmailPrivacy":true}}'
)
```

Each line must print 200.

Reading the configuration back shows `"mfa": {"state": "DISABLED", "providerConfigs": [{"totpProviderConfig": {"adjacentIntervals": 1}, "state": "ENABLED"}]}`. The outer `state` is the text-message second factor, which is off on purpose. The authenticator provider inside it is the one that matters. Whether enrolment then works is proven only by step 8.

**4b. Create the staff user (Gbenga only).** Firebase console, Authentication, Users, "Add user". Enter the staff email and a password he chooses and keeps in his password manager. Copy the **User UID** shown in the list and give it to Claude. The UID is an identifier, not a secret.

**4c. Mark that email as verified (Claude, with Gbenga's yes).** The staff page refuses an unverified email, and it has no "send me a verification email" step. For staging the owner's own address is marked verified by an administrator call. Before this is run, test T6 below is done. Put the UID in the first line:

```bash
STAFF_UID="PASTE_UID_HERE"
curl -sS -o /dev/null -w "verify %{http_code}\n" -X POST \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" -H "X-Goog-User-Project: diamondecho-staging" \
  "https://identitytoolkit.googleapis.com/v1/projects/diamondecho-staging/accounts:update" \
  -d "{\"localId\":\"${STAFF_UID}\",\"emailVerified\":true}"
```

This is a gap for production: a real staff member should prove the inbox is theirs. It is listed under "Findings to carry forward".

## Step 5. Register the staff web app

Firebase console, Project settings, "Your apps", add a **Web** app named `DiamondEcho staff staging`. Leave "Also set up Firebase Hosting" unticked. The console then shows the public configuration: `apiKey`, `authDomain`, `projectId`, `appId`. These identify the project to Google and are shipped inside the staff page; they are not passwords. Access is decided by the API's user-ID list and the second factor, not by this key.

## Step 6. Redeploy the API with the queue on (Cloud Shell)

Run from a `main` that contains `backend/inquiries/limits.py`. This is the first-stage block with three more settings. It is run twice: first with `STAFF_UIDS="not-a-listed-user"`, so that tests T8 and T9 can show a correctly signed-in person who is not on the list being refused; then with the real UID.

```bash
PUBLIC_ORIGIN="https://diamondecho-staging.pages.dev"
STAFF_ORIGIN="https://diamondecho-staff-staging.pages.dev"
STAFF_UIDS="not-a-listed-user"

(
set -euo pipefail
PROJECT_ID="$(gcloud config get-value project)"
[ "${PROJECT_ID}" = "diamondecho-staging" ] || { echo "Wrong project: ${PROJECT_ID}"; exit 1; }
REGION="us-east1"
SERVICE="diamondecho-api-staging"
RUNTIME_ACCOUNT="diamondecho-api-runtime"

rm -rf DiamondEcho
git clone --depth 1 https://github.com/Ggeorge73/DiamondEcho.git
cd DiamondEcho
echo "Commit being deployed: $(git rev-parse HEAD)"
test -f backend/inquiries/limits.py || { echo "This commit has no submission limits. Stopping."; exit 1; }

gcloud run deploy "${SERVICE}" \
  --source backend \
  --region "${REGION}" \
  --service-account "${RUNTIME_ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --allow-unauthenticated \
  --cpu 1 --memory 1Gi --concurrency 1 \
  --min-instances 0 --max-instances 3 --timeout 30 \
  --set-env-vars "^@^INQUIRY_STAFF_QUEUE_ENABLED=true@FIREBASE_PROJECT_ID=${PROJECT_ID}@INQUIRY_STAFF_UIDS=${STAFF_UIDS}@PUBLIC_ORIGIN=${PUBLIC_ORIGIN}@STAFF_ORIGIN=${STAFF_ORIGIN}@CORS_ORIGINS=${PUBLIC_ORIGIN},${STAFF_ORIGIN}"

gcloud run services describe "${SERVICE}" --region "${REGION}" --format='value(status.latestReadyRevisionName)'
)
```

To weld the slot shut again at once, without a rebuild:

```bash
gcloud run services update diamondecho-api-staging --region us-east1 \
  --update-env-vars INQUIRY_STAFF_QUEUE_ENABLED=false
```

## Step 7. Configure the staff staging site (Cloudflare)

In the `diamondecho-staff-staging` Pages project only, Production environment, add these. The existing DiamondEcho Pages project and the public staging project are not changed.

Order matters. The build ignores every other setting until `STAFF_QUEUE_ENABLED` is `true`, and then fails on purpose if any is missing. So the six plain values go in first (done), then Gbenga pastes the key, and `STAFF_QUEUE_ENABLED` goes in **last**, followed by a retry of the latest deployment. Set in any other order, the next push to `main` would produce a failed staff build. The dashboard's "Add" panel accepts several `NAME=value` lines pasted into the name field at once.

| Setting | Value | Entered by |
| --- | --- | --- |
| `STAFF_API_ORIGIN` | `https://diamondecho-api-staging-299705773978.us-east1.run.app` | Claude |
| `STAFF_ORIGIN` | `https://diamondecho-staff-staging.pages.dev` | Claude |
| `PUBLIC_ORIGIN` | `https://diamondecho-staging.pages.dev` | Claude |
| `FIREBASE_PROJECT_ID` | `diamondecho-staging` | Claude |
| `FIREBASE_AUTH_DOMAIN` | `diamondecho-staging.firebaseapp.com` | Claude |
| `FIREBASE_WEB_APP_ID` | The `appId` from step 5 | Claude |
| `FIREBASE_WEB_API_KEY` | The `apiKey` from step 5 | **Gbenga** |
| `STAFF_QUEUE_ENABLED` | `true`, last | Claude |

The build fails on purpose if any value is missing or the three addresses are not distinct.

## Step 8. Enrol and sign in (Gbenga only)

Open `https://diamondecho-staff-staging.pages.dev`, sign in with the staff email and password, scan or type the enrolment secret into an authenticator app, and enter the six-digit code. The page signs out after enrolment by design. Sign in again with the password and a fresh code.

## Step 9. Tests, in this order

All test requests use plainly synthetic details: the name `Staging Test`, addresses at `example.com`, a made-up property address. No real person's details are entered. References are recorded with the middle characters removed.

| # | When | Test | Expected |
| --- | --- | --- | --- |
| T1 | After step 6, first run | `node scripts/staging-smoke.mjs` | 9 of 9. The staff line now answers 401, not 503 |
| T2 | Same | Buyer request through the staging form | "DiamondEcho received your request." and a reference. One document in the database |
| T3 | Same | Same request replayed with the same key; then the same key with a changed message | 200 with the same reference; then 409 |
| T4 | Same | Seller and tour requests through the forms; a tour time in the past; a missing consent tick | Two more references; the two bad ones refused with the field named |
| T5 | Same | Submission limit on the deployed API, from Cloud Shell: seven posts from one connection, the last three with a different typed `X-Forwarded-For` first entry | Five stored at most in total for that connection in 10 minutes; the rest 429 with `Retry-After`. The typed header changes nothing |
| T6 | After 4b, before 4c | Sign in on the staff page with the unverified account | Refused: "Sign-in failed…" and no enrolment secret |
| T7 | After 4c | Staff API with no token; with a made-up token; with any token from the public site's address | 401; 401; 403 "Staff origin denied." All `no-store` |
| T8 | After step 8, API still listing `not-a-listed-user` | Gbenga signs in with password and code | The page refuses to show the queue (the API answers 403). This is the "signed in correctly, not on the list" case |
| T9 | After step 6, second run with the real UID | Gbenga signs in | The three test requests appear with type, contact, address, time and consent |
| T10 | Same | Acknowledge one; reload and sign in again; a wrong authenticator code | Acknowledged state survives; wrong code refused |
| T11 | Same | Sign out; press Back | No visitor details on screen or in browser storage |
| T12 | Same | Staff page and the three forms by keyboard only, and at phone width | Reachable, labelled, nothing cut off |
| T13 | Same | Step 3's two anonymous database calls again | 403 and 403 |

Not reachable through the page, so covered by the automated tests only: a signed-in session with no second factor (the page signs out straight after enrolment), and an expired token.

Optional, and only if Gbenga wants it: disable the staff user in the console, confirm the open staff page is refused on its next call, and enable it again.

## Cleanup of test data (Gbenga)

Deleting data is the owner's action. Staging holds only the synthetic requests above. To remove them:

```bash
gcloud firestore bulk-delete --database="(default)" --collection-ids=inquiries
```

## Rollback (staging only)

| To undo | Do |
| --- | --- |
| Queue on | The one-line update under step 6. Takes effect in seconds |
| Staff page | Remove `STAFF_QUEUE_ENABLED` in the staff Pages project and retry the deployment. It rebuilds as the disabled page |
| The two roles | `gcloud projects remove-iam-policy-binding` for each |
| Staff user | Disable or delete it in the Firebase console |
| Database | `gcloud firestore databases delete --database="(default)"` |
| Adding Firebase, and the Identity Platform upgrade | Cannot be undone without deleting the project |

## Findings to carry forward

1. **No email verification step for staff.** Step 4c marks the address verified by hand. Production needs either a verification email sent to the staff member or a recorded owner procedure.
2. **The browser key is unrestricted.** Restricting the key from step 5 to the staff site's address and to the sign-in services is a hardening step. It is left until sign-in is proven, because the staff page sends no referrer and a wrong restriction would block sign-in. Test it on staging before production.
3. **Request logs.** Cloud Run's request log records each caller's IP address and web address for 30 days by default. The Privacy page says so for builds that use the request service. Log retention is an operations decision under DE-26.
4. **Address lookup** still has no Mapbox or RentCast keys on staging. It needs Secret Manager and is not part of this stage.
5. **`localhost` is an authorised sign-in domain.** Firebase adds it by default beside the two `diamondecho-staging` addresses. The staff page uses email and password only, which this list does not govern, so it is harmless here. Remove it for production.
6. **The Privacy page date.** `POLICIES_UPDATED` must be set to the day online requests open in production, because that is the day the page a visitor sees changes.

## What this stage does not cover

Production, the live domain, DNS, email notification of new requests (none exists; staff must open the queue), retention or deletion schedules, monitoring and alerts (DE-26, DE-31), and Safari, Firefox and iPhone.
