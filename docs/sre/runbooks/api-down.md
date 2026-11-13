# Runbook: The form or the calculators say the service is unavailable

| | |
| --- | --- |
| Component | `api` (also `inquiry` and `calculators` when the API is the cause) |
| Usual severity | sev2, see [severity-and-escalation.md](../severity-and-escalation.md) |
| Alerts that lead here | `api-health`, `api-identity`, `api-cors-allowed`, `inquiry-route`, `inquiry-preflight`, `calculators-api-analyze` |
| Last reviewed | 2026-11-13, not yet tested |

## Symptoms

- A visitor who sends the form sees an error instead of "DiamondEcho received
  your request".
- Deal Studio's "Run base analysis" shows "The analysis service could not
  be reached, so nothing was calculated. Check your connection and try
  again." when the API does not answer, or "Request failed with status code
  …" when it answers with an error (it calculates on the device only when
  the API is out of date, not when it is down).
- Staff open the queue and get an error.
- The incident issue says "API is down" (or names the inquiry form) and may
  carry a line from the automatic rollback engine: read it first.
- This runbook is NOT for: the pages themselves not loading
  ([site-down.md](site-down.md)); the form saying "unavailable" because the
  queue was switched off on purpose; slow answers or 429s under load
  (`api-slow-or-saturated.md`); requests stored but no email
  (`inquiry-not-delivered.md`); the database ([database-unavailable.md](database-unavailable.md)).

## Impact on visitors

Visitors cannot send a request through the form; they are told to call or
email. A request that fails is not stored, so nothing is lost silently, but
the visitor may not try again. Deal Studio's base analysis fails with an
error; its risk simulation, the mortgage simulator and the seller net sheet
run in the browser and keep working. Staff cannot read the queue.

## Check first

1. **Anyone.** Paste:
   ```bash
   curl -sS -w ' %{http_code}\n' https://diamondecho-api-180189726732.us-east1.run.app/health
   curl -sS -w ' %{http_code}\n' https://diamondecho-api-180189726732.us-east1.run.app/api/
   ```
   Healthy: `{"status":"ok"} 200`, and `{"service":"DiamondEcho API",…} 200`
   (once the build identity is deployed, it also names the revision and
   commit). Use `/health`, never `/healthz`: Google answers `/healthz` itself
   with a 404. The first request after a quiet spell can take several seconds
   while an instance starts.
2. **Anyone.** Open https://status.cloud.google.com. If Cloud Run or Firestore
   in `us-east1` shows an incident, the cause is Google: post a status update
   and go to "When to escalate".
3. **Anyone.** Read the last lines of the automatic rollback log:
   ```bash
   git fetch origin sre-status && git show origin/sre-status:remediation-log.jsonl | tail -n 3
   ```
   It says whether a recent deploy is suspected, which revision served before
   (`to_revision`), and whether the engine already rolled back
   ([auto-remediation.md](../auto-remediation.md)).
4. **Gbenga.** In Cloud Shell, in a clone of the repository, see what serves
   and what exists (read-only):
   ```bash
   bash scripts/sre/cloudrun/status.sh
   gcloud run services describe diamondecho-api --project diamondecho-prod --region us-east1 \
     --format='value(spec.template.spec.containers[0].env[].name)'
   ```
   Healthy: one revision with 100 percent, the one you last deployed, and the
   six setting names you expect (the second command prints names only, never
   values). A revision you do not recognise, or one created minutes before the
   trouble began, is the likely cause.
5. **Gbenga.** The API's recent errors, times and status codes only:
   ```bash
   gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="diamondecho-api" AND httpRequest.status>=500' \
     --project diamondecho-prod --freshness 1h --limit 20 \
     --format 'table(timestamp,resource.labels.revision_name,httpRequest.requestMethod,httpRequest.status)'
   ```
   Do not paste log lines with addresses or messages into the issue; write
   what they show in your own words.

## Fix

1. **Gbenga. Documented rollback** ([auto-remediation.md](../auto-remediation.md),
   [release-safety.md](../release-safety.md)): if the trouble started after a
   new revision, give all traffic back to the one before it. First a dry run,
   which changes nothing and shows the exact command:
   ```bash
   bash scripts/sre/cloudrun/rollback.sh --to PREVIOUS_REVISION
   bash scripts/sre/cloudrun/rollback.sh --to PREVIOUS_REVISION --apply
   ```
   `PREVIOUS_REVISION` is the revision that was serving before: the
   `to_revision` in the remediation log (step 3), or the last serving
   revision recorded in `docs/de13-production-setup.md`. Not simply the next
   one in the list from step 4: that can be a candidate that never served
   anyone. **A rollback brings back all of that revision's settings too**
   (the inquiry queue switch, the origins): if they differ from today's, say
   so in the issue and check the form afterwards. Worked when: the script ends
   with "Rolled back: … answers /health" and the next monitor run passes the
   API checks.

   After this the service is **pinned**: `update-traffic --to-latest` would
   put the broken revision back on 100 percent, and a plain settings change
   would make a revision with the broken image and no traffic. Before any
   settings change, follow [auto-remediation.md](../auto-remediation.md),
   "After an automatic rollback", step 3 (and the release role's
   [release-safety.md](../release-safety.md), "After a rollback").
2. If the automatic engine already rolled back and it did not help
   (`verified: false`), do not roll back again to another older revision on a
   guess: go to step 4 of "Check first" and to "When to escalate".
3. If the answers are 429 or 503 "busy" rather than errors: this is capacity
   or the hourly cap, not a fault. Go to `api-slow-or-saturated.md` (or
   `traffic-spike-or-abuse.md` if the traffic is not real visitors).
4. If `/health` is fine but the form fails with "storage was not confirmed",
   or staff get "temporarily unavailable": go to
   [database-unavailable.md](database-unavailable.md).
5. **AI role agent.** Prepare a fix for the broken revision as a draft pull
   request, with a test. It changes nothing until Gbenga merges and deploys it
   (`--no-traffic --tag candidate`, candidate checks, then
   `update-traffic --to-latest` once `status.sh` shows the fixed revision is
   the newest; **needs Gbenga's yes**).

If none of these works within the time to mitigate for this severity, go to
"When to escalate".

## When to escalate and to whom

| When | Who | How |
| --- | --- | --- |
| The rollback did not work, or there was no recent deploy | Gbenga | The incident issue; see [severity-and-escalation.md](../severity-and-escalation.md) |
| Google reports a Cloud Run or Firestore incident in `us-east1` | Google Cloud | https://status.cloud.google.com; support through the Google Cloud console, at the level of the billing account's support plan (not recorded in `docs/de13-production-setup.md`) |
| The API answers things it should not, or settings changed that nobody changed | security-lead role agent | [security-operations.md](../../security-operations.md) |

## Afterwards

- [ ] Confirm the monitor shows the API, form and calculators as operational
      again and the incident issue has closed.
- [ ] Post the "resolved" update (wording in
      [incident-response.md](../incident-response.md)).
- [ ] If traffic was rolled back: the newer revision is still in Cloud Run
      with no traffic. Do not send traffic to it again without a fix: never
      run `update-traffic --to-latest` until `status.sh` shows that the newest
      revision is the fixed one.
- [ ] Record in `docs/de13-production-setup.md` which revision serves now.
- [ ] Open a postmortem if
      [postmortem-template.md](../postmortem-template.md) says one is
      required.
- [ ] Correct this runbook if any step was wrong, missing or slow, and update
      "Last reviewed".
