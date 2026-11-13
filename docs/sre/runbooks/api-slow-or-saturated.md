# Runbook: Deal Studio or the form is slow, or says it could not finish

| | |
| --- | --- |
| Component | `api` (also `calculators` and `inquiry` when the API is the cause) |
| Usual severity | sev3 while answers are slow but arrive; sev2 when visitors are refused (429, 503, 504). See [severity-and-escalation.md](../severity-and-escalation.md) |
| Alerts that lead here | `api-latency` SLO burn alert; `api-health` or `calculators-api-analyze` slow or failing with a 429, 503 or 504 |
| Last reviewed | 2026-11-13, not yet tested |

## Symptoms

- Deal Studio takes many seconds after "Analyze", then may show "The
  analysis could not be completed. Review the assumptions and try again."
  The visitor's figures are fine: the service was busy. (Deal Studio does not
  calculate on the device when the service is busy or down; see
  [capacity.md](../capacity.md).)
- The form says "Online requests are busy right now" or fails to send.
- The assistant gives an error, or the market brief section stays empty.
- The incident issue names `api-latency`, or an API check failed with
  HTTP 429, 503 or 504.
- This runbook is NOT for: the API not answering at all
  ([api-down.md](api-down.md)); a flood of junk or one sender running up the
  bill ([traffic-spike-or-abuse.md](traffic-spike-or-abuse.md)); a provider
  out of quota ([provider-quota.md](provider-quota.md)); slowness that began
  with a deploy ([bad-deploy.md](bad-deploy.md)).

## Impact on visitors

The API works on at most three requests at once (three instances, one
request each). When all three are busy, other requests wait, and after a
while Google refuses them. Deal Studio, the assistant, the inquiry form and
the market brief all share those three places. A refused inquiry is not
stored and the visitor is asked to call or email, so it is not lost silently,
but the visitor may not try again. The pages themselves, search, the mortgage
simulator and the seller net sheet keep working.

## Check first

Never load-test production to "see if it is slow". A handful of requests
at a human pace is enough.

1. **Anyone.** Paste, three times a few seconds apart:
   ```bash
   curl -sS -o /dev/null -w '%{http_code} %{time_total}s\n' https://diamondecho-api-180189726732.us-east1.run.app/health
   ```
   Healthy: `200` in well under a second (0.12 to 0.26 s from our sandbox on
   2026-11-13). A first answer of several seconds followed by fast ones is a
   cold start (an instance starting after a quiet spell, 7.3 s measured on
   staging): go to Fix step 4 only if it keeps happening.
2. **Anyone.** Open https://diamondecho.com/investment-calculator in a private
   window and press "Analyze" once with the example figures. Healthy: results
   in about a second.
3. **Gbenga.** Google Cloud > Cloud Run > `diamondecho-api` > Revisions.
   Healthy: the revision serving 100% has not changed since before the
   slowness began. If it changed just before, go to
   [bad-deploy.md](bad-deploy.md).
4. **Gbenga.** Same service > Metrics, last 6 hours. Read: *Container
   instance count*, *Request latencies* (95th and 99th percentile) and
   *Request count* split by response code. Healthy: instance count mostly 0
   or 1, not pinned at 3; latency 95th percentile under 1 second; almost no
   4xx and 5xx.
5. **Gbenga.** Google Cloud > Logging, query:
   ```
   resource.type="cloud_run_revision"
   resource.labels.service_name="diamondecho-api"
   (httpRequest.status=429 OR httpRequest.status=503 OR httpRequest.status=504 OR httpRequest.latency>="5s")
   ```
   Read only the path and status of each line; do not copy full URLs (some
   carry what a visitor typed). How to read it:
   - 429 on `/api/v1/deals/scenarios`, `/sensitivity`, `/monte-carlo`,
     `/api/v1/inquiries` or `/api/v1/properties/lookup`: our own per-sender
     limit doing its job.
   - 429 on any other path, often with "no available instance" in the
     message: **all three instances were busy** and Google refused the
     request.
   - 503 on `/api/v1/inquiries`: the inquiry hourly limit.
   - 504, or many requests near 20 to 30 s on `/api/v1/deals/monte-carlo`:
     someone is sending heavy simulations. Go to
     [traffic-spike-or-abuse.md](traffic-spike-or-abuse.md).
6. **Gbenga.** Google Cloud status page, https://status.cloud.google.com,
   Cloud Run in `us-east1`. Healthy: no incident.

## Fix

1. **Gbenga. Documented rollback** ([release-safety.md](../release-safety.md)):
   if the slowness began with a new revision, send traffic back to the
   previous one, as [bad-deploy.md](bad-deploy.md) describes. Worked when:
   step 1 of "Check first" is fast again within a few minutes.
2. **Gbenga.** If heavy simulations from a script are filling the instances,
   follow [traffic-spike-or-abuse.md](traffic-spike-or-abuse.md). It has the
   steps for a flood.
3. **Gbenga. Needs Gbenga's yes:** if real visitors are filling all three
   instances (instance count pinned at 3, requests ordinary), allow five for
   now:
   ```bash
   gcloud run services update diamondecho-api --region us-east1 --project diamondecho-prod --max-instances 5
   ```
   Cost: more instances bill while busy. Risk: the in-memory inquiry and
   heavy-route limits are per instance, so their ceilings rise too. Worked
   when: 429s on ordinary paths stop and latency falls within 10 minutes.
   Undo afterwards: the same command with `--max-instances 3`.
4. **Gbenga. Needs Gbenga's yes:** if the slowness is cold starts (slow first
   answers after quiet spells, fast afterwards), keep one instance running:
   ```bash
   gcloud run services update diamondecho-api --region us-east1 --project diamondecho-prod --min-instances 1
   ```
   Cost: one idle instance all month; see the formula in
   [capacity.md](../capacity.md). Worked when: the first answer after 20
   quiet minutes is under a second. Undo: `--min-instances 0`.
5. **AI role agent.** Run Actions > **SRE load test** on the commit that is
   live and compare with [capacity.md](../capacity.md). If a route has become
   several times slower, prepare a fix as a draft pull request. It changes
   nothing until Gbenga merges it.

If none of these works within the time to mitigate for the severity, go to
"When to escalate".

## When to escalate and to whom

| When | Who | How |
| --- | --- | --- |
| Visitors are still refused 30 minutes after the fixes above | Gbenga | The incident issue; see [severity-and-escalation.md](../severity-and-escalation.md) |
| The Google Cloud status page shows a Cloud Run incident, or instances will not start | Google Cloud support | Google Cloud console > Support. Say: Cloud Run service `diamondecho-api`, project `diamondecho-prod`, region `us-east1`, the time it began and the status codes seen |
| The traffic looks like an attack | security-lead role agent | [security-operations.md](../../security-operations.md) |

## Afterwards

- [ ] Confirm the monitor shows the API as operational again and the
      incident issue has closed.
- [ ] Post the "resolved" update (wording in
      [incident-response.md](../incident-response.md)).
- [ ] Undo any temporary instance change (`--max-instances 3`,
      `--min-instances 0`) unless Gbenga decided to keep it, and record the
      decision in [capacity.md](../capacity.md).
- [ ] Add what was learned (peak instance count, latency, which paths) to
      [capacity.md](../capacity.md), labelled with the date and "production,
      read from Cloud Run metrics".
- [ ] Open a postmortem if
      [postmortem-template.md](../postmortem-template.md) says one is
      required.
- [ ] Correct this runbook if any step was wrong, missing or slow, and update
      "Last reviewed".
