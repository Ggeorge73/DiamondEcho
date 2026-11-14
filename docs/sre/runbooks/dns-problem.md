# Runbook: diamondecho.com cannot be found, or mail stops arriving

| | |
| --- | --- |
| Component | `dns` |
| Usual severity | sev1 when the site's address does not resolve; sev2 for nameservers, the staff address or mail records; see [severity-and-escalation.md](../severity-and-escalation.md) |
| Alerts that lead here | `dns-apex-resolves`, `dns-staff-resolves`, `dns-nameservers`, `dns-mail-mx`, `dns-mail-spf`, `dns-mail-microsoft-365`, `edge-www-redirect` |
| Last reviewed | 2026-11-13, not yet tested |

## Symptoms

- A browser says "This site can't be reached" or "server IP address could not
  be found" for `diamondecho.com` or `staff.diamondecho.com`.
- Mail to `realtor@diamondecho.com` bounces or stops arriving; Outlook or
  Teams cannot find the account.
- `www.diamondecho.com` stops redirecting.
- The incident issue names a DNS check, for example "Website address
  resolves" or "Nameservers are the two on record".
- This runbook is NOT for: the address resolving but the page failing
  ([site-down.md](site-down.md)); the domain's registration expiring
  (`domain-expiry.md`); a Cloudflare-wide outage (`cloudflare-outage.md`).

## Impact on visitors

When the address does not resolve, nobody can reach the site, the staff site
or the form, and **mail to `realtor@` can be lost or bounced** because the
mail records live in the same zone. The API keeps running at its `run.app`
address, but visitors only reach it through the site's pages.

## Check first

1. **Anyone.** Ask two public resolvers (DNS over HTTPS, an ordinary web
   request):
   ```bash
   curl -sS -H 'accept: application/dns-json' 'https://cloudflare-dns.com/dns-query?name=diamondecho.com&type=NS'
   curl -sS 'https://dns.google/resolve?name=diamondecho.com&type=A'
   curl -sS 'https://dns.google/resolve?name=diamondecho.com&type=MX'
   ```
   Healthy: NS `georgia.ns.cloudflare.com` and `jasper.ns.cloudflare.com`;
   at least one A answer; MX `mx1-usg2.ppe-hosted.com`, `mx2-…`, `mx3-…`. The
   full list is `deploy/dns/expected-records.json`.
2. **Anyone.** Ask the `.com` registry what it holds:
   ```bash
   curl -sS https://rdap.verisign.com/com/v1/domain/diamondecho.com
   ```
   Healthy: nameservers `GEORGIA.NS.CLOUDFLARE.COM` and
   `JASPER.NS.CLOUDFLARE.COM`, an expiration date in the future, and no status
   containing `hold`. If the expiry has passed or there is a hold, go to
   `domain-expiry.md`.
3. **Anyone.** Open https://www.cloudflarestatus.com. If "DNS" shows an
   incident, go to `cloudflare-outage.md`.
4. **Gbenga.** Cloudflare dashboard, `diamondecho.com`, DNS, Records. Compare
   with `deploy/dns/expected-records.json` and the table "What GoDaddy held"
   in `docs/de13-production-setup.md`. Then Manage account, Audit log: any
   DNS change in the last day, and by whom.
5. **Gbenga.** GoDaddy, My Products, `diamondecho.com`, DNS, Nameservers.
   Healthy: "I'll use my own nameservers" with the two Cloudflare names.

## Fix

Nothing here is a rollback; every step changes production.

1. **A record was changed or removed** (step 4). **Gbenga, needs Gbenga's
   yes:** put it back exactly as in `deploy/dns/expected-records.json`. Mail
   records and the Microsoft CNAMEs (`autodiscover`, `sip`, `lyncdiscover`,
   `msoid`, `email`, `pay`, `_domainconnect`) must be **"DNS only"** (grey
   cloud): proxied, they break Outlook and Teams. Worked when: Check step 1
   answers as expected from both resolvers (allow a few minutes).
2. **The nameservers at GoDaddy changed** (step 5). **Gbenga, needs Gbenga's
   yes:** set them back to `georgia.ns.cloudflare.com` and
   `jasper.ns.cloudflare.com`. The registry usually updates within minutes,
   but resolvers may keep the old answer for up to the record's lifetime
   (often a day or two for `.com` nameservers; not measured here). Then ask
   the security-lead role: an unplanned nameserver change can be a hijack.
3. **The `www` redirect stopped.** **Gbenga, needs Gbenga's yes:** re-create
   the redirect rule as in `docs/de13-production-setup.md`, "How it was done",
   step 6 (proxied placeholder A `192.0.2.1` for `www`, rule `http*://www.*`
   to `https://${2}`, 301, query string kept).
4. **Cloudflare DNS outage.** Do **not** move the nameservers back to GoDaddy
   during an outage: it takes hours to take effect, outlasts most outages,
   and risks mail if GoDaddy does not restore all nineteen records. Post a
   status update and follow `cloudflare-outage.md`.

Never change records "to see if it helps", and never touch the mail records
unless they are the fault.

## When to escalate and to whom

| When | Who | How |
| --- | --- | --- |
| Not fixed within the time to mitigate | Gbenga | The incident issue; see [severity-and-escalation.md](../severity-and-escalation.md) |
| Cloudflare reports a DNS incident, or the zone is not active | Cloudflare support | https://dash.cloudflare.com, Support; https://community.cloudflare.com (Free plan) |
| The registry shows a hold, a different registrar, or nameservers nobody set | GoDaddy, then security-lead role agent | GoDaddy support from the account that holds the domain; [security-operations.md](../../security-operations.md) |
| Mail is affected | Gbenga, as the mailbox owner | Check that mail arrives in both directions once the records are back |

## Afterwards

- [ ] Confirm the monitor's DNS checks pass on the next hourly run and the
      incident issue has closed.
- [ ] Confirm with Gbenga that mail to and from `realtor@` works again.
- [ ] If a record was meant to change, update
      `deploy/dns/expected-records.json` (edge security role) so the monitor
      stops reporting it.
- [ ] Post the "resolved" update (wording in
      [incident-response.md](../incident-response.md)).
- [ ] Open a postmortem if
      [postmortem-template.md](../postmortem-template.md) says one is
      required.
- [ ] Correct this runbook if any step was wrong, missing or slow, and update
      "Last reviewed".
