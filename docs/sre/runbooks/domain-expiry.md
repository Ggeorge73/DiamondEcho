# Runbook: the domain is about to expire, has expired, or is being moved away

| | |
| --- | --- |
| Component | `domain` |
| Usual severity | sev3 at under 60 days or a lock off; sev2 at under 30 days, a transfer under way, a new registrar or new nameservers at the registry; sev1 at under 7 days, expired, on hold, or unknown to the registry. See [severity-and-escalation.md](../severity-and-escalation.md) |
| Alerts that lead here | `domain-expiry`, `domain-registrar-lock`, `domain-delegation` |
| Last reviewed | 2026-11-13, not yet tested |

## Symptoms

- Before expiry: nothing visible. The incident issue says "The registration
  expires on YYYY-MM-DD, in N days. Renew it at GoDaddy."
- After expiry: the site, the staff site **and email** stop working, often a
  few hours or days apart as caches empty. The address may show a GoDaddy
  parking or "renew this domain" page. Mail to `realtor@diamondecho.com`
  bounces or vanishes.
- "The transfer lock is off", "a transfer to another registrar under way",
  "the registrar as …, not GoDaddy.com, LLC" or "The registry points the
  domain at …" mean someone may be moving the domain. Treat as an attack
  until Gbenga confirms he did it.
- "Could not read the registry's record … so this was not checked" is the
  monitor failing to look, not a domain problem; it clears by itself. If it
  lasts a day, tell the edge security engineer role.

## Impact on visitors

A lapsed domain takes down everything at once: the website, the staff queue,
the API's browser calls from the site, and all email, including the inquiry
alert email. Nothing is lost from the database, but inquiries cannot be sent
and replies to clients do not arrive. The API's own `run.app` address keeps
working, but no visitor knows it.

## Check first

1. **Anyone.** Ask the registry whether it holds the name at all
   (read-only, no account):
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' https://rdap.verisign.com/com/v1/domain/diamondecho.com
   ```
   `200`: go on to step 2. `404`: the registry has no record of the domain;
   it has lapsed past every grace period or been deleted: go straight to Fix
   step 2 and escalate. Anything else: the registry did not answer; try again
   in a few minutes.
2. **Anyone.** Read the registry's record:
   ```bash
   curl -s https://rdap.verisign.com/com/v1/domain/diamondecho.com | python3 -c 'import json,sys; d=json.load(sys.stdin); print([e for e in d["events"] if e["eventAction"]=="expiration"], d["status"], [n["ldhName"] for n in d["nameservers"]])'
   ```
   Healthy: an expiration date more than 60 days away; statuses include
   `client transfer prohibited`; nameservers `GEORGIA.NS.CLOUDFLARE.COM` and
   `JASPER.NS.CLOUDFLARE.COM`. A status of `client hold`, `redemption period`
   or `pending delete` means the domain has stopped working.
3. **Gbenga.** GoDaddy > My Products > Domains > `diamondecho.com`. Note the
   expiry date, whether **Auto-renew** is on, and that the payment method on
   file is current.
4. **Gbenga.** Same page, Domain settings: **Domain lock** should be on. Under
   transfers, note any pending outbound transfer.
5. **Gbenga.** Same page, DNS > Nameservers: should be the two Cloudflare
   names above.

## Fix

1. **Gbenga. Needs Gbenga's yes** (a payment): renew `diamondecho.com` at
   GoDaddy for at least one year, and switch Auto-renew on. Worked when: the
   registry's expiration date in step 2 above moves forward (it can take a
   few minutes) and `domain-expiry` passes on the next hourly run.
2. **Gbenga. Needs Gbenga's yes:** if it had already expired, renew the same
   way. The .com registry keeps an expired name for its owner for a while
   (a renewal grace period, then a 30-day redemption period at a higher
   price, then deletion); GoDaddy's own terms and fees for each stage are on
   its renewal page. Once renewed, the site and mail come back as caches
   refresh, typically within hours.
3. **Gbenga. Needs Gbenga's yes:** a transfer you did not start: decline it
   in GoDaddy's pending transfers, switch Domain lock on, change the GoDaddy
   password and confirm two-step sign-in is on. Then go to "When to escalate"
   (security).
4. **Gbenga. Needs Gbenga's yes:** nameservers at the registry not the two
   Cloudflare names, and you did not change them: set them back at GoDaddy >
   DNS > Nameservers to `georgia.ns.cloudflare.com` and
   `jasper.ns.cloudflare.com`. Then go to "When to escalate" (security).
   Resolvers may keep the wrong answer for up to two days.
5. **Gbenga. Needs Gbenga's yes:** lock off with no transfer under way:
   switch Domain lock on at GoDaddy. Worked when: `domain-registrar-lock`
   passes on the next run.
6. **AI role agent.** If a nameserver or registrar change was meant, update
   `deploy/dns/expected-records.json` in a draft pull request.

## When to escalate and to whom

| When | Who | How |
| --- | --- | --- |
| Under 30 days and not renewed, or any sev1 | Gbenga | the incident issue, and by phone or text: the renewal reminders may go to the mailbox that stops working |
| The renewal does not go through, or the name is in redemption | GoDaddy support | the help link in the GoDaddy account; have the domain name and the account to hand |
| A transfer, registrar change or nameserver change nobody made | security-lead role agent, then GoDaddy support | [security-operations.md](../../security-operations.md); GoDaddy can freeze a disputed domain |

## Afterwards

- [ ] Confirm the three `domain-*` checks pass and the `domain` component is
      operational; the incident issue has closed.
- [ ] Post the "resolved" update (wording in
      [incident-response.md](../incident-response.md)).
- [ ] Confirm Auto-renew is on and the card on file does not expire before
      the next renewal date.
- [ ] Decision for Gbenga: add a second contact email at GoDaddy that is
      **not** on `diamondecho.com`, so expiry reminders still arrive when the
      domain itself has stopped.
- [ ] Open a postmortem if
      [postmortem-template.md](../postmortem-template.md) says one is
      required. Always for a lapse or an unwanted transfer.
- [ ] Correct this runbook if any step was wrong, missing or slow, and update
      "Last reviewed".
