# Runbook: address lookup, address suggestions or the spoken market brief stopped working

| | |
| --- | --- |
| Component | `calculators` (address suggestions and public-record lookup in Deal Studio); `public-site` (the market brief) |
| Usual severity | sev3: a minor feature is down and the rest of the site works. See [severity-and-escalation.md](../severity-and-escalation.md) |
| Alerts that lead here | No automatic check: the monitor never calls the paid routes. Arrives as a usage or billing email from RentCast, Mapbox or Google Cloud, the $25 budget alert, a visitor's report, or the log lines below |
| Last reviewed | 2026-11-13, not yet tested |

## Symptoms

Four outside providers sit behind four features:

| Provider | Feature | What a visitor sees when it fails |
| --- | --- | --- |
| RentCast (paid per call) | Deal Studio public-record lookup after choosing an address | "Public-record details are not available for that address. Enter the property's figures yourself." |
| Mapbox (paid per search session) | Address suggestions under Deal Studio's address box | No suggestions appear while typing. Nothing else changes. |
| Google Cloud Text-to-Speech (paid per character) | The spoken welcome, tour and market brief | The figures and the written brief still show; there is no audio to play. |
| FRED and Freddie Mac (free public data) | The figures in the market brief | A figure card is missing; the brief lists that source as unavailable. |

- The API's own log has "Market brief voice failed" (text-to-speech) or
  "FRED mortgage series not used" (a data source).
- Requests to `/api/v1/properties/lookup` or `/suggest` answer 502 in the
  Cloud Run request log.
- This runbook is NOT for: the whole API slow or refusing
  ([api-slow-or-saturated.md](api-slow-or-saturated.md)); someone draining
  the paid lookup on purpose
  ([traffic-spike-or-abuse.md](traffic-spike-or-abuse.md)); a leaked key (the
  security team: [security-operations.md](../../security-operations.md));
  the Georgia MLS search ([search-provider-down.md](search-provider-down.md)).

## Impact on visitors

Small. Deal Studio still analyses any deal from figures the visitor types;
it loses the shortcut of filling them in from a public record. The market
brief keeps the day's last complete version when a source or the voice fails
for a moment, and tries again after 15 minutes. No inquiry is affected, and
nothing is lost.

## Check first

Never call `/api/v1/properties/lookup` or `/suggest` to test: each call costs
money. Read the dashboards and logs instead.

1. **Gbenga.** Which providers production has keys for, and how each is
   held. In Cloud Shell (prints each setting's name and whether it is a
   plain value or a Secret Manager secret; never a value):
   ```bash
   gcloud run services describe diamondecho-api --region us-east1 --project diamondecho-prod --format=json \
     | python3 -c 'import json, sys
   for e in json.load(sys.stdin)["spec"]["template"]["spec"]["containers"][0].get("env", []):
       ref = e.get("valueFrom", {}).get("secretKeyRef")
       print(e["name"], "->", "secret " + ref["name"] + " version " + ref.get("key", "latest") if ref else "plain value (not shown)")'
   ```
   `RENTCAST_API_KEY` and `MAPBOX_ACCESS_TOKEN` mean those providers are on;
   `MARKET_BRIEF_ENABLED` means the brief is on. A provider that is not
   listed is off by design: the page says so, and nothing is broken. Note
   for each key whether it is a secret (and its secret's name) or a plain
   value: Fix step 3 depends on it.
2. **Gbenga.** Google Cloud > Logging, query:
   ```
   resource.labels.service_name="diamondecho-api"
   ("Market brief voice failed" OR "FRED mortgage series not used" OR "missing audio parts")
   ```
   The voice line names the error type and status: 429 or
   `RESOURCE_EXHAUSTED` is a quota; 403 is a permission, billing or
   "API not enabled" problem.
3. **Gbenga.** Logging, query:
   ```
   resource.labels.service_name="diamondecho-api"
   httpRequest.requestUrl:"/api/v1/properties/"
   httpRequest.status>=400
   ```
   Read the status and time only. Do not copy the URLs: they hold the
   address a visitor typed. 502 is the provider failing; 429 is our own
   per-sender limit; 404 is "no record" or a missing key.
4. **Gbenga.** The RentCast dashboard (API usage) and Mapbox account
   (Statistics): this month's use against the plan's allowance, and whether
   the key is still active.
5. **Gbenga.** Google Cloud > APIs and services > Cloud Text-to-Speech API >
   Quotas and Metrics. Healthy: no errors, use well under quota. Then
   Billing: the account is active.
6. **Anyone.** Open https://diamondecho.com in a private window and look at
   the "Today's Georgia market" section. Healthy: figure cards with dates,
   and a play control.

## Fix

1. **Gbenga. Needs Gbenga's yes:** RentCast or Mapbox allowance used up by
   real visitors: either wait for the plan's reset date, or move to a larger
   plan (a monthly cost, the provider's price list). Deal Studio works by
   typing in the meantime. Worked when: the dashboard shows calls succeeding
   again.
2. **Gbenga. Needs Gbenga's yes:** used up by one sender or a script: follow
   [traffic-spike-or-abuse.md](traffic-spike-or-abuse.md) (usage caps, key
   rotation).
3. **Gbenga. Needs Gbenga's yes:** a key was revoked, expired or must be
   replaced. Never put a key on a command line, in an issue or in a chat.
   1. Create the new key in the provider's dashboard. Leave the page open.
   2. Before changing the service, see whether it is pinned to a revision:
      step 3 of "Fix" in [api-slow-or-saturated.md](api-slow-or-saturated.md).
      Pinned: make the change in step 3.4 through "After a rollback" in
      [release-safety.md](../release-safety.md) (same flag, plus the serving
      image).
   3. If "Check first" step 1 showed the key as a **secret** (name `NAME`),
      add the new key as its next version. `read -rs` asks for it without
      showing it or saving it in the shell history; paste and press Enter:
      ```bash
      read -rs KEY && printf '%s' "$KEY" | gcloud secrets versions add NAME --data-file=- --project diamondecho-prod; unset KEY
      ```
      If it showed a **plain value**, first make a secret for it (for
      example `rentcast-api-key`) with
      `gcloud secrets create rentcast-api-key --replication-policy automatic --project diamondecho-prod`,
      add the key with the `read -rs` command above, and give the API's
      runtime service account read access to that one secret
      (`roles/secretmanager.secretAccessor` on the secret: an IAM change).
   4. Point the service at the new version. This makes a new revision.
      For a key that was a plain value, add
      `--remove-env-vars RENTCAST_API_KEY` to the same command:
      ```bash
      gcloud run services update diamondecho-api --region us-east1 --project diamondecho-prod --update-secrets RENTCAST_API_KEY=NAME:latest
      ```
      (`MAPBOX_ACCESS_TOKEN` the same way.)
   5. Worked when: `bash scripts/sre/cloudrun/status.sh` shows the **new**
      revision at 100%, and the provider's dashboard shows successful calls
      from real visitors. Then revoke the old key in the provider's dashboard
      and disable the old version:
      `gcloud secrets versions disable OLD_VERSION --secret NAME --project diamondecho-prod`.
4. **Gbenga. Needs Gbenga's yes:** to stop a provider costing anything while
   it is sorted out, remove its key. Lookup then fails closed (visitors type
   the figures) and suggestions fall back to nothing. This makes a new
   revision, so check for a pin first (step 3.2 above):
   ```bash
   gcloud run services update diamondecho-api --region us-east1 --project diamondecho-prod --remove-env-vars RENTCAST_API_KEY
   ```
   Use `--remove-secrets RENTCAST_API_KEY` instead if step 1 showed a
   secret. Worked when: `status.sh` shows the new revision at 100%. Undo: set
   the key again as in step 3.4.
5. **Gbenga. Needs Gbenga's yes:** text-to-speech over quota: in Quotas and
   Metrics, ask Google for a higher quota, or wait for it to reset. Not
   enabled or billing stopped: enable the API or settle billing. The brief
   records itself again on the next request after 15 minutes. Expected cost
   is small (about $1.50 a month at the list price, docs/market-brief.md).
6. **AI role agent.** A free data source refuses or has moved for more than
   a day: prepare a draft pull request that reads the figure from another
   publisher, or leaves it out, in `backend/market_brief/sources.py`. Never
   fill in a figure by hand.

If none of these works within the time to mitigate for the severity, go to
"When to escalate".

## When to escalate and to whom

| When | Who | How |
| --- | --- | --- |
| The fix needs money or a plan change | Gbenga | The incident issue |
| RentCast refuses a valid key or the plan looks wrong | RentCast support | Their dashboard's support link. Say: API key ending (last 4 characters only), the time it began, the status code |
| Mapbox refuses a valid token | Mapbox support | Their account page's support link, same details |
| Text-to-speech fails with quota available | Google Cloud support | Console > Support. Say: project `diamondecho-prod`, Text-to-Speech API, the error status and time |
| Usage jumped with no visitor growth | security-lead role agent | [security-operations.md](../../security-operations.md) |

## Afterwards

- [ ] Confirm the feature works again (step 6 for the brief; a test lookup
      is not made, the dashboard showing successful calls is enough).
- [ ] Post the "resolved" update (wording in
      [incident-response.md](../incident-response.md)).
- [ ] Put back any key removed in Fix step 4, or record that Gbenga decided
      to leave the provider off.
- [ ] If a plan's allowance ran out from normal use, record the month's usage
      in [capacity.md](../capacity.md) so the next plan choice rests on it.
- [ ] Open a postmortem if
      [postmortem-template.md](../postmortem-template.md) says one is
      required.
- [ ] Correct this runbook if any step was wrong, missing or slow, and update
      "Last reviewed".
