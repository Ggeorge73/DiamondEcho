# Runbook: A request from the contact form did not get through

| | |
| --- | --- |
| Component | `inquiry` |
| Usual severity | sev2 when the form cannot send; sev1 when a request a visitor was told we received is missing; sev3 when requests arrive but the arrival email does not. See [severity-and-escalation.md](../severity-and-escalation.md) |
| Alerts that lead here | `inquiry-page`, `inquiry-preflight`, `inquiry-route`, `inquiry-queue`; a report from a visitor or from Gbenga |
| Last reviewed | 2026-11-13, not yet tested |

## Symptoms

- A visitor says they sent the form and saw an error, or never heard back.
- The incident issue says "Inquiry form is not working properly" and lists
  one of the checks above.
- Gbenga sees requests in the staff queue that never produced an arrival
  email, or an email with nothing new in the queue.
- This runbook is NOT for: the whole API being down (the calculators fail
  too): use [api-down.md](api-down.md); the website not loading at all: use
  [site-down.md](site-down.md).

## Impact on visitors

A visitor whose request is refused sees an error, not "DiamondEcho received
your request", and nothing is stored: nothing is lost silently, but the
visitor may give up. The costly case is the other one: a visitor told their
request was received when it is not in the queue, or a request that sits
unseen because the arrival email did not come. Either can lose a client.

## Check first

Never test by sending the form or by posting to `/api/v1/inquiries`: every
attempt counts against real visitors' allowance (5 per 10 minutes per sender,
30 per hour per instance).

1. **Anyone.** Read the incident issue: which check fails tells you which
   case this is.
   - `inquiry-page`: the contact page itself does not load: go to
     [site-down.md](site-down.md).
   - `inquiry-preflight` or `inquiry-route`: the API is refusing the form or
     not answering: go to [api-down.md](api-down.md).
   - `inquiry-queue` with "switched off or not configured": continue at
     step 2.
   - No failing check, but a visitor or Gbenga reports a problem: continue at
     step 3.
2. **Anyone.** See whether the queue is switched on (no sign-in is sent; this
   is the same read-only question the monitor asks):
   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' https://diamondecho-api-180189726732.us-east1.run.app/api/v1/inquiries/staff
   ```
   Healthy: `401` (the queue is on and asks for sign-in). `503`: the queue is
   off or not configured, and the form answers every visitor "unavailable".
3. **Gbenga.** Open https://staff.diamondecho.com, sign in, and look at the
   queue. Every request with an **Acknowledge** button has not been taken.
   Compare with the arrival emails in realtor@diamondecho.com for the same
   hours.
4. **Gbenga.** In Google Cloud, Monitoring > Alerting: the policy
   "DiamondEcho production: new request received" and its email channel are
   both enabled. In the mailbox, look in junk and quarantine for mail from
   Google Cloud alerting.
5. **Gbenga.** Count stored requests the alert should have seen (read-only,
   from [DE-31](../../de31-inquiry-routing.md)), and compare with step 3:
   ```bash
   gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="diamondecho-api" AND logName="projects/diamondecho-prod/logs/run.googleapis.com%2Frequests" AND httpRequest.requestMethod="POST" AND httpRequest.status=201 AND httpRequest.requestUrl:"/api/v1/inquiries"' \
     --project diamondecho-prod --freshness=2d --limit 50 --format='value(timestamp)'
   ```
   These are times only. Do not widen the output format: the request log
   holds visitors' IP addresses.

## Fix

1. **Gbenga. Needs Gbenga's yes:** if step 2 showed `503` and nobody switched
   the queue off on purpose, switch it back on with the settings recorded in
   [DE-13](../../de13-production-setup.md) ("Undo" lists the switch). Worked
   when: step 2 answers `401` and the incident closes after three good runs.
2. **Gbenga.** If requests are in the queue but the email did not come:
   answer them from the queue now, oldest first. Then re-enable the policy or
   channel if it was off (**needs Gbenga's yes**), or release the email from
   quarantine and mark the sender as safe. Worked when: the next stored
   request produces an email (Google may not send one for a request soon
   after a policy change, see DE-31).
3. **Gbenga.** If a visitor was told their request was received but it is not
   in the queue: declare a sev1 with the **Incident (reported by a person)**
   issue template, refer to the request only by its reference (DE-…), and
   contact the visitor by the route they used to report it. Then follow
   [database-unavailable.md](database-unavailable.md).
4. **AI role agent.** Prepare a fix for any code cause as a draft pull
   request. It changes nothing until Gbenga merges and deploys it.

If none of these works within the time to mitigate for the severity, go to
"When to escalate".

## When to escalate and to whom

| When | Who | How |
| --- | --- | --- |
| The form still refuses after the fix steps | Gbenga | The incident issue; see [severity-and-escalation.md](../severity-and-escalation.md) |
| Cloud Run or Firestore in us-east1 shows an incident | Google Cloud support | https://status.cloud.google.com, then the support page in the console |
| Arrival emails are rejected or quarantined by the mail system | Microsoft 365 / GoDaddy support | Their admin centre; give the sender and the time, never a visitor's details |
| Requests appear that nobody sent, or the queue looks tampered with | security-lead role agent | [security-operations.md](../../security-operations.md) |

## Afterwards

- [ ] Confirm the monitor shows the inquiry form as operational and the
      incident issue has closed.
- [ ] Every request that waited during the incident has been answered.
- [ ] Post the "resolved" update (wording in
      [incident-response.md](../incident-response.md)).
- [ ] If the arrival email was the problem, note in DE-31's table "When the
      alert does not ring" what happened.
- [ ] Open a postmortem if
      [postmortem-template.md](../postmortem-template.md) says one is
      required (always for sev1; for sev2 when it touched inquiries).
- [ ] Correct this runbook if any step was wrong, missing or slow, and update
      "Last reviewed".
