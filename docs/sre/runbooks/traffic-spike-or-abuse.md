# Runbook: a sudden flood of traffic, junk inquiries, or someone running up our bills

| | |
| --- | --- |
| Component | `api` and `inquiry` (sometimes `public-site`) |
| Usual severity | sev2 when real visitors are refused or slowed; sev3 when the limits are holding and visitors are fine. See [severity-and-escalation.md](../severity-and-escalation.md) |
| Alerts that lead here | API and inquiry checks slow or failing; the $25 budget alert; a run of inquiry alert emails; a provider (RentCast, Mapbox) usage warning |
| Last reviewed | 2026-11-13, not yet tested |

## Symptoms

- The form tells visitors "Too many requests were sent from this
  connection" (429, one sender's limit) or "Online requests are busy right
  now" (503, the hourly limit), both with "call or email us".
- Deal Studio's analysis fails with "The analysis could not be completed",
  or pages that use the API are slow.
- Many inquiry alert emails in a short time, or junk in the staff queue.
- The Google Cloud budget alert email, or a usage email from RentCast or
  Mapbox.
- Not for an API that is down with no unusual traffic: use
  [api-down.md](api-down.md) or [api-slow-or-saturated.md](api-slow-or-saturated.md).
  Not for a leaked key: that is the security team's playbook,
  [security-operations.md](../../security-operations.md).

## Impact on visitors

The limits in the code are a seatbelt, not a bouncer
(`backend/inquiries/limits.py`). The inquiry route accepts 5 attempts per 10
minutes from one sender and 30 per hour per Cloud Run instance; with the
maximum of 3 instances, about 90 an hour in all (code defaults; the
`INQUIRY_LIMIT_PER_ADDRESS` and `INQUIRY_LIMIT_PER_HOUR` settings can change
them). A sender who rotates addresses can use up the hourly allowance, and
then **real visitors are refused** and asked to call. Nothing they typed is
stored when they are refused. The paid property lookup (20 per 10 minutes per
sender, 300 per hour per instance) costs money per call. The site's pages are
static and served by Cloudflare; a flood of page requests costs nothing.

## Check first

Never test this by sending requests to production yourself.

1. **Anyone.** Open https://diamondecho.com and https://diamondecho.com/investment-calculator
   in a private window. Healthy: both load; the calculator runs.
2. **Gbenga.** Google Cloud > Cloud Run > `diamondecho-api` > Metrics, last 6
   hours. Note: request count, how many are 4xx (429 is a sender's limit
   working) and 5xx (a 503 from the inquiry route can be its hourly limit),
   and instance count. Healthy: instance count usually 0 or 1, not
   pinned at 3.
3. **Gbenga.** Google Cloud > Logging, query `resource.labels.service_name="diamondecho-api"
   httpRequest.status=(429 OR 503)`. Note which paths are refused. The logs hold no
   visitor addresses for the limits (they are hashed and never logged), so
   do not try to find "who".
4. **Gbenga.** If the pages are the target: Cloudflare > diamondecho.com >
   Analytics & Logs > Traffic, last 24 hours. Note whether requests jumped and
   which countries or paths stand out.
5. **Gbenga.** The staff queue: count junk entries since the spike began.
   Do not copy their contents anywhere; refer to them by reference.
6. **Gbenga.** RentCast and Mapbox dashboards: today's usage compared with a
   normal day.

## Fix

1. **Gbenga. Needs Gbenga's yes:** junk is filling the queue or real visitors
   are refused: close the request slot, from Cloud Shell:
   ```bash
   gcloud run services update diamondecho-api --region us-east1 --project diamondecho-prod --update-env-vars INQUIRY_STAFF_QUEUE_ENABLED=false
   ```
   The form then answers 503 and stores nothing; the visitor sees an error
   and that the request was not confirmed. Worked when: no new queue entries
   appear. Undo: the same command
   with `=true`. This is the "Undo" step in
   [de13-production-setup.md](../../de13-production-setup.md).
2. **Gbenga. Needs Gbenga's yes:** the paid lookup is being drained: in the
   RentCast and Mapbox dashboards, lower the account's usage cap if it has
   one, or rotate the key (then set the new one as the API's secret). The
   page then cannot look up an address but everything else works.
3. **Gbenga. Needs Gbenga's yes:** the bill is climbing with instances pinned
   at 3: lower the maximum to 1 (`gcloud run services update diamondecho-api
   --max-instances 1 --region us-east1 --project diamondecho-prod`). This
   also lowers the inquiry ceiling to one instance's 30 an hour. Undo: set it
   back to 3.
4. **Gbenga. Needs Gbenga's yes:** the pages themselves are flooded and slow
   for visitors: Cloudflare > Security > Settings > Security Level "I'm Under
   Attack". It stops the monitor too, so the status page will show the site
   as down while it is on. Undo: set the level back; see
   [edge.md](../edge.md), item 10.
5. **Gbenga. Needs Gbenga's yes:** one clear source (a country, network or
   path seen in step 4): a Cloudflare custom rule that blocks or challenges
   just that. Undo: delete the rule. This protects the pages only: the API is
   not behind Cloudflare ([edge.md](../edge.md), "Option: put the API behind
   Cloudflare").
6. **AI role agent.** Prepare any lasting change (a lower limit, a challenge
   on the form) as a draft pull request with tests, for Gbenga to review.

## When to escalate and to whom

| When | Who | How |
| --- | --- | --- |
| Real visitors refused for longer than the time in [severity-and-escalation.md](../severity-and-escalation.md) | Gbenga | the incident issue |
| It looks deliberate (one pattern, rotating addresses, probing routes), or a key may be leaked | security-lead role agent | [security-operations.md](../../security-operations.md), "Abuse in progress" |
| A provider bill keeps rising after the key is rotated | RentCast or Mapbox support; Google Cloud billing | their support pages; Google Cloud > Billing > Support |

## Afterwards

- [ ] Re-open the request slot (Fix step 1 undo) once the source has stopped,
      and confirm a visitor can reach the form page. Do not send a test
      inquiry.
- [ ] Put the maximum instances and the security level back if they were
      changed.
- [ ] Confirm the API and inquiry checks pass and the incident issue has
      closed; post the "resolved" update (wording in
      [incident-response.md](../incident-response.md)).
- [ ] Gbenga removes junk queue entries; record how many, by reference only.
- [ ] Open a postmortem if
      [postmortem-template.md](../postmortem-template.md) says one is
      required.
- [ ] Correct this runbook if any step was wrong, missing or slow, and update
      "Last reviewed".
