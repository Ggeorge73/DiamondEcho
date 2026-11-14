# Runbooks

A runbook is the step-by-step fix for one kind of problem, written to be
followed on a phone during an incident. Each has the same six parts: Symptoms,
Impact on visitors, Check first, Fix, When to escalate and to whom,
Afterwards. Start with [incident-response.md](../incident-response.md) if
you have not yet.

The incident issue the monitor opens already names the runbook to follow
(from `RUNBOOKS` in `scripts/sre/alert-policy.mjs`). Otherwise, find what you
see below.

## Find it by what you see

| What you see | Runbook |
| --- | --- |
| **The site does not load**: error page, blank page, or an old version | [site-down.md](site-down.md) |
| The staff site at staff.diamondecho.com does not load | [site-down.md](site-down.md) |
| "This site can't be reached", "server IP address could not be found" | [dns-problem.md](dns-problem.md) |
| **Mail to realtor@diamondecho.com bounces or stops** | [dns-problem.md](dns-problem.md), then [domain-expiry.md](domain-expiry.md) |
| A Cloudflare-branded error or "checking your browser" page, or the incident "Cloudflare is refusing the monitor" | [cloudflare-outage.md](cloudflare-outage.md) |
| "Your connection is not private", a certificate warning | [tls-certificate.md](tls-certificate.md) |
| The domain is expiring, has expired, a lock is off, or it is being moved | [domain-expiry.md](domain-expiry.md) |
| **Something broke right after a merge or an API deploy** | [bad-deploy.md](bad-deploy.md) |
| **The form fails to send**, or Deal Studio says "The analysis service could not be reached, so nothing was calculated" | [api-down.md](api-down.md) |
| The form or Deal Studio is slow, or says it is busy | [api-slow-or-saturated.md](api-slow-or-saturated.md) |
| The form errors and staff cannot open the queue, while the API's health page is fine | [database-unavailable.md](database-unavailable.md) |
| **A visitor says they sent a request, but it is not in the queue or no alert email came** | [inquiry-not-delivered.md](inquiry-not-delivered.md) |
| Property search shows nothing, or the Georgia MLS search is down | [search-provider-down.md](search-provider-down.md) |
| Address suggestions, property lookup or the market brief stopped; a usage email from RentCast, Mapbox or Google | [provider-quota.md](provider-quota.md) |
| A flood of traffic, junk requests, "too many requests", or bills climbing | [traffic-spike-or-abuse.md](traffic-spike-or-abuse.md) |
| The status page is stale, or "Monitoring cannot see the site" | [monitoring-is-blind.md](monitoring-is-blind.md) |

Several at once usually means one cause upstream. Try them in this order:
DNS, then Cloudflare, then a recent deploy, then the part itself.

## By monitor component

| Component (status page name) | Runbooks |
| --- | --- |
| `public-site` (Website) | [site-down.md](site-down.md), [cloudflare-outage.md](cloudflare-outage.md) |
| `staff-site` (Staff site) | [site-down.md](site-down.md) |
| `search` (Property search) | [search-provider-down.md](search-provider-down.md) |
| `calculators` (Intelligence calculators) | [api-down.md](api-down.md), [api-slow-or-saturated.md](api-slow-or-saturated.md), [provider-quota.md](provider-quota.md) |
| `inquiry` (Inquiry form) | [inquiry-not-delivered.md](inquiry-not-delivered.md), [api-down.md](api-down.md), [database-unavailable.md](database-unavailable.md) |
| `api` (API) | [api-down.md](api-down.md), [api-slow-or-saturated.md](api-slow-or-saturated.md), [traffic-spike-or-abuse.md](traffic-spike-or-abuse.md) |
| `dns` (DNS) | [dns-problem.md](dns-problem.md) |
| `tls` (TLS certificates) | [tls-certificate.md](tls-certificate.md) |
| `domain` (Domain registration) | [domain-expiry.md](domain-expiry.md) |
| Monitoring | [monitoring-is-blind.md](monitoring-is-blind.md); [cloudflare-outage.md](cloudflare-outage.md) first when the title is "Cloudflare is refusing the monitor" |
| Any part, within two hours of a deploy | [bad-deploy.md](bad-deploy.md) first |

## All runbooks

| Runbook | Covers | Owner (role agent) |
| --- | --- | --- |
| [site-down.md](site-down.md) | Website or staff site not loading | `sre-infrastructure-engineer` |
| [api-down.md](api-down.md) | API not answering; the form and calculators affected | `sre-infrastructure-engineer` |
| [api-slow-or-saturated.md](api-slow-or-saturated.md) | API slow, busy, refusing with 429, 503 or 504 | `sre-performance-engineer` |
| [database-unavailable.md](database-unavailable.md) | Firestore cannot store or read requests | `sre-infrastructure-engineer` |
| [dns-problem.md](dns-problem.md) | Name not found, mail records wrong | `sre-infrastructure-engineer` |
| [tls-certificate.md](tls-certificate.md) | Certificate expiring, expired or wrong | `sre-edge-security-engineer` |
| [domain-expiry.md](domain-expiry.md) | Registration expiring, locks, transfers | `sre-edge-security-engineer` |
| [cloudflare-outage.md](cloudflare-outage.md) | Cloudflare down or turning visitors away | `sre-edge-security-engineer` |
| [traffic-spike-or-abuse.md](traffic-spike-or-abuse.md) | Floods, junk requests, rising bills | `sre-edge-security-engineer`, with `security-lead` |
| [bad-deploy.md](bad-deploy.md) | Broken by a merge or an API deploy; rollback | `sre-release-engineer` |
| [search-provider-down.md](search-provider-down.md) | Georgia MLS search or the /search page | `sre-synthetic-monitoring-engineer` |
| [inquiry-not-delivered.md](inquiry-not-delivered.md) | A request accepted but not in the queue, or no alert email | `sre-observability-engineer` |
| [provider-quota.md](provider-quota.md) | RentCast, Mapbox or Google quota or bill | `sre-performance-engineer` |
| [monitoring-is-blind.md](monitoring-is-blind.md) | The monitor or the status page has stopped seeing the site | `sre-observability-engineer` |

Attacks and leaked secrets also follow the security playbook in
[security-operations.md](../../security-operations.md).

## Writing or changing a runbook

1. Copy [_template.md](_template.md) and keep its six headings.
2. Every step is a command or a click, says who does it, and marks any
   production change "needs Gbenga's yes" unless it is a documented rollback.
3. Add it to the three tables above, and to `RUNBOOKS` in
   `scripts/sre/alert-policy.mjs` (observability role) if the monitor should
   point at it.
4. A second SRE role reviews it. After each use, fix what was wrong and update
   "Last reviewed".
