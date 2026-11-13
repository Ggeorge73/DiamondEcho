# Runbook: the browser says the site is "not secure" or the connection is not private

| | |
| --- | --- |
| Component | `tls` |
| Usual severity | sev3 when a certificate is close to expiry; sev1 when it has expired, is for the wrong name, or is refused. See [severity-and-escalation.md](../severity-and-escalation.md) |
| Alerts that lead here | `tls-public`, `tls-www`, `tls-staff`, `tls-api` |
| Last reviewed | 2026-11-13, not yet tested |

## Symptoms

- A visitor sees a full-page warning such as "Your connection is not private"
  or "Warning: Potential Security Risk Ahead", and cannot reach the page
  without clicking through.
- The incident issue says one of:
  - "the certificate expires on YYYY-MM-DD, in N days, and has not been
    renewed" (early warning: the site still works);
  - "the certificate expired on …" or "is not valid (CERT_…)" (outage);
  - "the certificate is for …, not diamondecho.com" (wrong certificate);
  - "refused the TLS handshake" (no secure connection possible).
- "Could not open a TLS connection … This is not proof of a certificate
  problem" means the monitor could not reach the host at all. That is
  [site-down.md](site-down.md) or [api-down.md](api-down.md), not this one.

## Impact on visitors

On an expired or wrong certificate, almost every visitor stops at the
browser's warning. For `tls-public` or `tls-www` that is the whole website; for
`tls-staff` staff cannot open the queue; for `tls-api` Deal Studio's base
analysis and the inquiry form cannot reach the API (a visitor can still phone;
the mortgage simulator and seller net sheet run in the browser and keep
working). Days-left warnings
have no visitor impact yet.

## Check first

1. **Anyone.** Open the host named in the alert in a private window, for
   example https://diamondecho.com. Healthy: the page loads with a padlock and
   no warning. Click the padlock, then the certificate: note "Expires on" and
   "Issued to".
2. **Anyone.** Paste (replace the name with the host in the alert):
   ```bash
   echo | openssl s_client -connect diamondecho.com:443 -servername diamondecho.com 2>/dev/null | openssl x509 -noout -subject -issuer -enddate -ext subjectAltName
   ```
   Healthy: `notAfter` more than 21 days away, and the host appears under
   "Subject Alternative Name". If your own network inspects traffic (an
   office or antivirus proxy), the issuer will be that product; run it from a
   phone hotspot instead.
3. **Anyone.** Is it the provider? Cloudflare: https://www.cloudflarestatus.com
   (look for "SSL" or "Pages"). Google Cloud, for `tls-api`:
   https://status.cloud.google.com (Cloud Run). If they report an incident,
   go to "When to escalate".
4. **Gbenga.** For `tls-public`, `tls-www` or `tls-staff`: Cloudflare >
   diamondecho.com > SSL/TLS > Edge Certificates. Healthy: a Universal
   certificate covering `diamondecho.com` and `*.diamondecho.com`, status
   Active, with an expiry date in the future.
5. **Gbenga.** For `tls-public` or `tls-staff`: Cloudflare > Workers & Pages >
   `diamondecho` (or `diamondecho-staff`) > Custom domains. Healthy: the
   domain shows Active. Anything else: the page states what it is waiting for
   (usually a DNS record); note it.
6. **Anyone.** Was DNS changed recently? A CAA record added, or the record for
   the name changed, can stop renewal. Paste:
   ```bash
   curl -s -H 'accept: application/dns-json' 'https://cloudflare-dns.com/dns-query?name=diamondecho.com&type=CAA'
   ```
   Healthy today: no `Answer` (no CAA record, see [edge.md](../edge.md)).

## Fix

1. **Gbenga. Needs Gbenga's yes:** if a DNS change in the last weeks
   (a new CAA record, a changed or removed record for the name) explains it,
   put the old value back in Cloudflare > DNS > Records. Worked when: the
   Pages custom domain shows Active again and, within a few hours, a new
   expiry date appears under Edge Certificates.
   Mail guard: never change the `MX` records, the `TXT` records,
   `autodiscover`, `sip` or `lyncdiscover` as part of this fix, and keep
   every `CNAME` "DNS only" (grey cloud); see [edge.md](../edge.md),
   "Changing DNS safely".
2. **Gbenga. Needs Gbenga's yes:** if a Pages custom domain is not Active and
   names a missing DNS record, add exactly the record it names. Worked when:
   it shows Active and the `tls-*` check passes on the next hourly run.
   Mail guard: never change the `MX` records, the `TXT` records,
   `autodiscover`, `sip` or `lyncdiscover` as part of this fix, and keep
   every `CNAME` "DNS only" (grey cloud); see [edge.md](../edge.md),
   "Changing DNS safely".
3. **Gbenga.** If Edge Certificates shows the certificate as Active with a
   future date but the check still fails, the monitor may have seen an old
   connection: wait for the next hourly run before doing anything else.
4. **Gbenga.** `tls-api`: Google issues this certificate and we cannot renew
   it. Open a case with Google Cloud support (see "When to escalate"). The
   site keeps working; the calculators fall back to the browser.
5. **AI role agent.** Update this runbook and, if a DNS value changed on
   purpose, `deploy/dns/expected-records.json` in a draft pull request.

Do not switch Universal SSL off and on, or delete and re-add a Pages custom
domain, to "force" a renewal: both can leave the name without any
certificate for a while. If none of the steps works within the time to
mitigate for this severity, go to "When to escalate".

## When to escalate and to whom

| When | Who | How |
| --- | --- | --- |
| Expired or wrong certificate (sev1), or a warning not fixed within the time in [severity-and-escalation.md](../severity-and-escalation.md) | Gbenga | the incident issue |
| Cloudflare does not renew, and the dashboard shows no reason | Cloudflare | https://community.cloudflare.com and the support page in the dashboard; the Free plan has limited support. Give the zone name, the host, and the expiry date |
| `tls-api` certificate wrong or expired | Google Cloud support | Cloud console > Support; service `diamondecho-api`, project `diamondecho-prod`, region us-east1 |
| A certificate for our name that we did not ask for, or an unknown issuer | security-lead role agent | [security-operations.md](../../security-operations.md) |

## Afterwards

- [ ] Confirm the `tls-*` checks pass and the `tls` component is operational
      on the status page; the incident issue has closed.
- [ ] Post the "resolved" update (wording in
      [incident-response.md](../incident-response.md)).
- [ ] If a DNS record was put back or added, update
      `deploy/dns/expected-records.json`.
- [ ] Open a postmortem if
      [postmortem-template.md](../postmortem-template.md) says one is
      required. An expired certificate always deserves one: renewal is
      automatic, so something stopped it.
- [ ] Correct this runbook if any step was wrong, missing or slow, and update
      "Last reviewed".
