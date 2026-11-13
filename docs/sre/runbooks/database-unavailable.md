# Runbook: Requests cannot be stored or read (the database)

| | |
| --- | --- |
| Component | `inquiry` (the database is not a component of its own; the form and the staff queue are where it shows) |
| Usual severity | sev2, see [severity-and-escalation.md](../severity-and-escalation.md) |
| Alerts that lead here | None from the monitor: it never submits a request, so it cannot see the database. A visitor, the missing arrival email, or staff seeing an error lead here |
| Last reviewed | 2026-11-13, not yet tested |

## Symptoms

- A visitor sends the form and sees an error; the API answers 503 with
  "Inquiry storage was not confirmed. Retry with the same submission key."
- Staff open the queue, sign in, and get "Inquiry queue is temporarily
  unavailable."
- No arrival email although someone says they sent a request.
- `/health` still answers `{"status":"ok"}` (it does not touch the database),
  and the pages and calculators work.
- This runbook is NOT for: the whole API down
  ([api-down.md](api-down.md)); the form saying "Online requests are busy"
  (the hourly cap, `traffic-spike-or-abuse.md`); requests stored but no email
  (`inquiry-not-delivered.md`).

## Impact on visitors

Visitors cannot send a request; each attempt fails and is not stored. The
visitor is shown an error, so a request is not lost silently, but the visitor
may give up. Staff cannot read the queue. If the data itself was lost or
damaged, requests already received may be gone: the database is the only copy.

## Check first

1. **Anyone.** Open https://status.cloud.google.com and
   https://status.firebase.google.com. Healthy: no Firestore incident in
   `us-east1`. If there is one, go to Fix step 1.
2. **Gbenga.** Is the database there, and in which state (read-only):
   ```bash
   gcloud firestore databases describe --database="(default)" --project diamondecho-prod \
     --format="value(name,locationId,deleteProtectionState)"
   ```
   Healthy: `projects/diamondecho-prod/databases/(default)  us-east1  DELETE_PROTECTION_ENABLED`.
3. **Gbenga.** Does the API's identity still hold its two roles (read-only):
   ```bash
   gcloud projects get-iam-policy diamondecho-prod --flatten=bindings \
     --filter="bindings.members:serviceAccount:diamondecho-api-runtime@diamondecho-prod.iam.gserviceaccount.com" \
     --format="value(bindings.role)"
   ```
   Healthy: exactly `roles/datastore.user` and `roles/firebaseauth.viewer`.
4. **Gbenga.** Is billing still linked (Firestore stops without it):
   ```bash
   gcloud billing projects describe diamondecho-prod --format="value(billingEnabled)"
   ```
   Healthy: `True`.
5. **Gbenga.** How many submissions failed, and since when (times and codes
   only, no addresses):
   ```bash
   gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="diamondecho-api" AND httpRequest.requestMethod="POST" AND httpRequest.requestUrl:"/api/v1/inquiries" AND httpRequest.status>=500' \
     --project diamondecho-prod --freshness 1d --limit 50 --format 'table(timestamp,httpRequest.status)'
   ```
6. **Gbenga.** If the database answers but requests seem missing: open the
   staff queue and compare with what you expect. If data is gone, go to
   [backup-and-restore.md](../backup-and-restore.md), "A real recovery".

## Fix

1. **Google incident.** Nothing to change on our side. Post a status update.
   If it lasts, **Gbenga, needs Gbenga's yes:** close the form so visitors are
   told plainly to call or email instead of seeing a failure
   (`docs/de13-production-setup.md`, "Undo", made safe for a pinned service):
   ```bash
   bash scripts/sre/cloudrun/status.sh            # note the image of the revision at 100 percent
   curl -sS https://diamondecho-api-180189726732.us-east1.run.app/api/   # note its commit, if it names one
   gcloud run services update diamondecho-api --region us-east1 --project diamondecho-prod \
     --image SERVING_IMAGE --update-env-vars INQUIRY_STAFF_QUEUE_ENABLED=VALUE,APP_COMMIT=SERVING_COMMIT
   bash scripts/sre/cloudrun/status.sh            # the newest revision: SERVING_IMAGE, ready
   ```
   `VALUE` is `false` to close, `true` to reopen. If `/api/` names no commit,
   drop `,APP_COMMIT=SERVING_COMMIT` and add `--remove-env-vars APP_COMMIT`
   (leaving it out would keep the refused revision's commit from the template). Passing the serving revision's image matters: after
   a rollback the service is pinned and its template names the broken image.
   If the newest revision is not at 100 percent (the service was pinned), and
   only then, move the traffic to it:
   ```bash
   gcloud run services update-traffic diamondecho-api --to-latest --project diamondecho-prod --region us-east1
   ```
   Worked when: `status.sh` shows the new revision at 100 percent, and the
   monitor's `inquiry-queue` check fails (closed) or passes (open) on its next
   run.
   Reopen the same way with `true` when Firestore is back. Each makes a new
   revision (a settings change; the automatic rollback never undoes it).
2. **A role is missing** (step 3). **Gbenga, needs Gbenga's yes:**
   ```bash
   gcloud projects add-iam-policy-binding diamondecho-prod \
     --member=serviceAccount:diamondecho-api-runtime@diamondecho-prod.iam.gserviceaccount.com --role=roles/datastore.user
   ```
   Worked when: a staff sign-in shows the queue. Then tell the security-lead
   role: a role that disappears is a security question.
3. **Billing is off** (step 4). **Gbenga, needs Gbenga's yes:** relink the
   billing account in the Google Cloud console, Billing, "Link a billing
   account". Worked when: step 4 says `True` and the queue opens.
4. **Data lost or damaged.** **Gbenga, needs Gbenga's yes:** follow
   [backup-and-restore.md](../backup-and-restore.md), "A real recovery". Close
   the form first (step 1's commands) so no new request is lost meanwhile.
5. **It started right after an API deploy.** The new code may be what fails to
   store: [api-down.md](api-down.md), Fix step 1 (documented rollback).

If none of these works within the time to mitigate for this severity, go to
"When to escalate".

## When to escalate and to whom

| When | Who | How |
| --- | --- | --- |
| Not fixed within the time to mitigate | Gbenga | The incident issue; see [severity-and-escalation.md](../severity-and-escalation.md) |
| Google reports a Firestore incident | Google Cloud | https://status.cloud.google.com; support through the console at the billing account's support level |
| A role or the database changed and nobody changed it | security-lead role agent | [security-operations.md](../../security-operations.md) |

## Afterwards

- [ ] Confirm a staff sign-in shows the queue, and the monitor's inquiry
      checks pass.
- [ ] If the form was closed, confirm it is open again: the monitor's
      `inquiry-queue` check passes.
- [ ] Count the failed submissions from Check step 5 and note the number (not
      the senders) in the issue: those visitors were told to call or email.
- [ ] Post the "resolved" update (wording in
      [incident-response.md](../incident-response.md)).
- [ ] Open a postmortem if
      [postmortem-template.md](../postmortem-template.md) says one is
      required.
- [ ] Correct this runbook if any step was wrong, missing or slow, and update
      "Last reviewed".
