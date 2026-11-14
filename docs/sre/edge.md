# The edge: certificates, DNS, the domain and Cloudflare

"The edge" is everything between a visitor's browser and our code: the domain
name, DNS (the internet's address book), the TLS certificates that put the
padlock in the address bar, and Cloudflare, which answers for the site. When
one of these breaks, everything breaks at once, and none of it shows up in our
own code or logs. This page says what we have, what watches it, and what we
recommend changing. Every change on this page needs Gbenga's yes; the
repository has no Cloudflare, GoDaddy or Google Cloud credential and changes
nothing by itself.

Owner: the edge security engineer role (an AI collaborator). Last reviewed
2026-11-13; the Bot Fight Mode decision of 2026-11-14 was added by the
synthetic monitoring role.

## What we have today

| Part | What it is | Who renews or runs it |
| --- | --- | --- |
| Domain `diamondecho.com` | Registered at GoDaddy. Registry expiry 2027-07-17 (read from the .com registry on 2026-11-13). Transfer, delete and update locks on. | Gbenga pays GoDaddy |
| DNS | Cloudflare, Free plan. Nameservers `georgia.ns.cloudflare.com` and `jasper.ns.cloudflare.com` since 2026-10-06. | Cloudflare |
| Mail | Microsoft 365 bought through GoDaddy, filtered by Proofpoint. Its records (MX, SPF, the Microsoft 365 TXT and `autodiscover`) live in the same Cloudflare zone as the site. | GoDaddy / Microsoft |
| Public site | Cloudflare Pages project `diamondecho`. `www` is a redirect rule to the bare name. | Cloudflare issues and renews the certificate |
| Staff site | Cloudflare Pages project `diamondecho-staff`. | Cloudflare |
| API | Cloud Run at `diamondecho-api-180189726732.us-east1.run.app`. **Not behind Cloudflare**: Cloudflare's settings do not touch it. | Google issues and renews the certificate |

Checked live on 2026-11-13 (DNS over HTTPS at Cloudflare and Google, and the
.com registry): every record in `deploy/dns/expected-records.json` matched at
both resolvers; plain http on the bare name answers 301 to https; `www`
answers 301 to the same path on the bare name; the home page sends
`Strict-Transport-Security: max-age=15552000`; no analytics script is in the
home page; DNSSEC is off; there is no CAA record.

### What Cloudflare Free gives, and what it does not

- **Gives:** a free certificate for every proxied name, renewed automatically;
  the SSL/TLS settings below; DNSSEC; a managed set of firewall (WAF) rules for
  common attacks; a handful of custom firewall rules; **one** rate-limiting
  rule; Bot Fight Mode; Browser Integrity Check; "I'm Under Attack" mode.
- **Does not give:** health checks or load balancing (there is no automatic
  failover to a second copy of the site: if Cloudflare is down, so is the site
  and so is our DNS, including the mail records); the advanced bot product
  (Super Bot Fight Mode); a support desk for technical incidents.
- **Does not reach the API.** The API is on Google's `run.app` address, so a
  Cloudflare firewall or rate-limiting rule does nothing for it today. Its
  protection is the limits in the code (`backend/inquiries/limits.py`) and
  Cloud Run's maximum of 3 instances.

## What watches it

Four check modules run hourly in the `slow` suite of
`scripts/sre/synthetic-checks.mjs` (contract: `scripts/sre/README.md`), and
the edge checks also run after each deploy (`post-deploy` suite). They only
read: DNS questions to two public resolvers, one registry lookup, two
redirect requests and four TLS connections an hour, plus the edge checks' two
redirect requests and two DNS questions after a deploy. Since 2026-11-14 the
edge checks no longer load the home page (see "When Cloudflare stops the
monitor itself" below).

| Check | What it proves | Fails at |
| --- | --- | --- |
| `tls-public`, `tls-www`, `tls-staff`, `tls-api` | The certificate is valid, is for the right name, has time left, and the connection is TLS 1.2 or newer. | under 21 days left sev3, under 7 sev2, under 2 or invalid sev1. Could not connect: sev3, never called a certificate problem. |
| `dns-apex-resolves`, `dns-staff-resolves` | The site's names resolve. | sev1 (bare name), sev2 (staff) |
| `dns-nameservers` | The zone is still served by the two Cloudflare nameservers on record. | sev2 |
| `dns-mail-mx`, `dns-mail-spf` | Mail delivery records and the single SPF record are exactly as recorded. | sev2 |
| `dns-mail-microsoft-365`, `dns-mail-dmarc` | Microsoft 365's ownership TXT, `autodiscover`, and the DMARC policy. | sev3 |
| `dns-other-records` | Teams, GoDaddy webmail and payment records carried over from GoDaddy. | sev4 |
| `domain-expiry` | Days until the registration expires; holds and deletion states. | under 60 days sev3, under 30 sev2, under 7 or expired sev1 |
| `domain-registrar-lock` | Transfer lock on; no transfer under way; registrar still GoDaddy. | lock off sev3; transfer or new registrar sev2 |
| `domain-delegation` | The .com registry points at our two nameservers. | sev2 |
| `edge-http-redirect`, `edge-www-redirect` | http goes to https; `www` keeps the page. | sev3 |
| `edge-hsts` | HSTS is sent. **Not made at present:** it reads the home page, which Bot Fight Mode refuses to the monitor. | sev3 |
| `edge-no-analytics-beacon` | Cloudflare's analytics beacon has not come back into the page (the Privacy page promises no analytics). **Not made at present**, for the same reason. | sev3 |
| `edge-dnssec`, `edge-caa` | Whether DNSSEC and CAA are on. | never fail (information) |

**Two resolvers must agree.** A DNS check fails only when Cloudflare's and
Google's resolvers both see the same fault. One resolver unreachable, or the
two disagreeing for a few minutes after a change, is reported in the check's
text but is not a failure. If neither can be asked, the check fails as an
early warning (sev3) so that "we could not look" never reads as "healthy".

**Mail is watched as closely as the site.** Mail breaks silently: nobody sees
an error, messages just stop arriving, including the inquiry alert email. So
every mail record is compared exactly, hourly, by the same two-resolver rule
as the site.

**When a DNS change is meant**, update `deploy/dns/expected-records.json` in
the same pull request (or the next), or the check will keep reporting it.

**When Cloudflare stops the monitor itself.** It does, on every page:
Bot Fight Mode is on by Gbenga's decision (2026-11-14) and answers 403 to
GitHub's runners. So the monitor no longer loads a page. An outside uptime
service, UptimeRobot, loads the pages and the monitor reads its verdicts
([synthetic-monitoring.md](synthetic-monitoring.md)). Of the edge checks
that leaves the two redirects, which Cloudflare answers before its bot
check. `edge-hsts` and `edge-no-analytics-beacon` need the home page and are
not made; nothing in the SRE monitor replaces them. That is a known gap.
They come back only in a run with `SRE_PAGE_SOURCE=direct`, from a network
Cloudflare lets through.

If a request the monitor still makes is refused, the check says so in words
written by `scripts/sre/lib/http.mjs` and by `edge.mjs`: "Cloudflare refused
the request (403, error 1010: the browser signature check, usually Browser
Integrity Check): a Cloudflare security setting is blocking the monitor, and
perhaps visitors too." Only Cloudflare's error number is kept from its page.
That points at a Cloudflare security setting, not at the site: see
[cloudflare-outage.md](runbooks/cloudflare-outage.md) and "Found on
2026-11-13" below.

Not repeated here: the strength of the security headers, which
`scripts/security-headers-check.mjs` checks daily for the security team.

## Found on 2026-11-13

1. **Cloudflare blocks the SRE monitor's name.** Requests to the bare name
   carrying the monitor's User-Agent
   (`DiamondEcho-SRE-Monitor/1 (+https://github.com/Ggeorge73/DiamondEcho)`)
   get Cloudflare's "Access denied" page, status 403, error 1010, which
   Cloudflare documents as a block on the browser's signature (Browser
   Integrity Check). The same request with a browser's User-Agent, with
   curl's, with Node's default, or with
   `Mozilla/5.0 (compatible; DiamondEcho-SRE-Monitor/1; +https://github.com/Ggeorge73/DiamondEcho)`
   gets the real page. `www` is not affected (its redirect rule answers
   first). This was seen from the agents' sandbox. **Measured from
   GitHub's runners on 2026-11-14** (monitor run 27, 02:36 UTC): every page
   on `diamondecho.com` and `staff.diamondecho.com` answered 403 to the
   monitor, error 1010 on most and a Cloudflare challenge page on the home
   page, the Deal Studio page and the staff home page. The API checks, the
   inquiry route checks and the `www` redirect (301) passed. **Gbenga's
   decision (2026-11-14): Bot Fight Mode stays on.** The plan of 2026-11-13,
   a Cloudflare custom rule for the monitor, is withdrawn: on the Free plan
   a custom rule cannot skip Bot Fight Mode. The pages are loaded by an
   outside uptime service instead; see item 9 below.
2. **Cloudflare adds a bot-detection script to the page.** The home page as
   served contains `/cdn-cgi/challenge-platform/scripts/jsd/main.js`,
   Cloudflare's "JavaScript detections", which Cloudflare adds while Bot Fight
   Mode or JavaScript detections is on. It is a security script, not
   analytics, but it runs on every page. Whether the Privacy page should
   mention it is Gbenga's decision. The check notes it and does not fail.
3. **`msoid.diamondecho.com` no longer exists**, although
   `docs/de13-production-setup.md` lists it as carried to Cloudflare. Mail does
   not depend on it. Left out of the checks until Gbenga says whether it
   should exist.
4. **A DMARC record exists** (`v=DMARC1; p=none`, reporting to Cloudflare's
   DMARC service), although de13 recorded none on 2026-10-06. Who added it is
   not recorded. It only asks for reports, so it changes no delivery.

## Recommended baseline

Each item is a proposal. None is switched on by this repository. Where a
setting's current value cannot be read from outside, the item says so; the
first step is for Gbenga to look and note what is there.

### 1. SSL/TLS mode: "Full (strict)"

- **Where:** Cloudflare > diamondecho.com > SSL/TLS > Overview.
- **Why:** this is how Cloudflare talks to the server behind it. "Flexible"
  sends that leg unencrypted; "Full (strict)" insists on a valid certificate.
  Pages is served by Cloudflare itself, so today it makes little difference,
  but "Flexible" becomes a trap the day any record points at a real server
  (for example an API name, see below).
- **Today:** not visible from outside.
- **Risk:** low for Pages. A proxied record pointing at a server without a
  valid certificate would start failing with error 526.
- **Undo:** set the mode back to what it was.
- **Needs Gbenga's yes.**

### 2. Always Use HTTPS: on

- **Where:** SSL/TLS > Edge Certificates > Always Use HTTPS.
- **Why:** sends anyone who types `http://` to `https://`.
- **Today:** plain http on the bare name already answers 301 to https
  (`edge-http-redirect` watches it). Which setting does it is not visible from
  outside; confirming the switch is on costs nothing.
- **Risk:** none known for this site.
- **Undo:** switch it off.
- **Needs Gbenga's yes** (only if it is off).

### 3. Minimum TLS version: 1.2

- **Where:** SSL/TLS > Edge Certificates > Minimum TLS Version.
- **Why:** TLS 1.0 and 1.1 are retired by every current browser and have known
  weaknesses. Refusing them stops downgrade tricks.
- **Today:** not visible from the repository; Gbenga can read it on that
  page. Cloudflare's default for a new zone accepts TLS 1.0. (A quick
  `curl --tls-max 1.1` test is misleading: most current computers refuse TLS
  1.1 on their own side, so it fails even when Cloudflare would accept it.)
  The `tls-*` checks prove the connection a modern client gets is 1.2 or
  newer; they do not prove old versions are refused.
- **Risk:** very old devices (phones and computers that stopped receiving
  updates years ago) can no longer open the site. How many visitors that is
  has not been measured; there is no visitor analytics, by design.
- **Undo:** set it back to the value noted before the change.
- **Needs Gbenga's yes.**

### 4. HSTS: keep it where it is

The site already sends `Strict-Transport-Security: max-age=15552000` from
`frontend/public/_headers`, so it is versioned and tested with the code. Do
not also switch on Cloudflare's own HSTS setting (two sources of the same
header drift apart). Do not add `includeSubDomains` or `preload` without a
separate review: the zone also holds mail and Microsoft records, and `preload`
is very hard to undo.

### 5. DNSSEC: on, with care

- **Where:** Cloudflare > DNS > Settings > DNSSEC, which then shows a "DS
  record" to paste at GoDaddy (Domain > DNS > DNSSEC).
- **Why:** signs our DNS answers so nobody can forge them on the way, for
  example to send mail for `realtor@` to someone else's server.
- **Today:** off (no DS record at the registry; `edge-dnssec` reports it).
- **Risk:** this is the one setting here that can take down the site **and
  mail** at once. A wrong DS record at GoDaddy, or moving nameservers away
  from Cloudflare later without removing the DS record first, makes every
  name in the zone fail to resolve for most of the internet. The DNS checks
  would then fail with SERVFAIL at both resolvers.
- **Undo:** remove the DS record at GoDaddy first; wait until both resolvers
  no longer return it (`edge-dnssec` shows "absent"); only then switch DNSSEC
  off at Cloudflare. Never in the other order.
- **Needs Gbenga's yes.** Recommended, but not in the same week as any other
  DNS change.

### 6. CAA record: not now

- **What it is:** a DNS record that names which certificate authorities may
  issue certificates for the domain.
- **Why not now:** Cloudflare renews our certificates through more than one
  authority and chooses which. A CAA record that leaves one out can stop a
  renewal, and a failed renewal is a full outage weeks later. The protection
  it adds (against a wrongly issued certificate) is small for this site.
- **If ever added:** add it at Cloudflare, check the authorities Cloudflare
  lists for the zone (SSL/TLS > Edge Certificates), and watch the `tls-*`
  checks through the next renewal.
- **Undo:** delete the record.

### 7. WAF managed rules: confirm they are on

- **Where:** Security > WAF > Managed rules.
- **Why:** Cloudflare's free managed rules block well-known attack requests
  to the site.
- **Risk:** small. The site is static pages and the API is not behind
  Cloudflare, so there is little for a rule to block wrongly.
- **Undo:** switch the ruleset off.
- **Needs Gbenga's yes** (only if it is off).

### 8. The one rate-limiting rule: keep it for the API

The site's pages are static files, which Cloudflare serves without a
per-request charge, so a flood of page requests costs us nothing and slows
nobody. The costly routes are on the API, which Cloudflare does not front.
Spending the Free plan's only rate-limiting rule on the pages buys little.
Recommendation: leave it unused until the API is behind Cloudflare (below);
then put it on `POST` to `/api/v1/inquiries`, in addition to the limits in the
code.

### 9. Bot Fight Mode and Browser Integrity Check

- **What they are:** Bot Fight Mode challenges or blocks traffic Cloudflare
  thinks is automated. Browser Integrity Check blocks requests whose headers
  look like a known abusive tool; it produced the error 1010 in "Found on
  2026-11-13".
- **Risk to monitors:** the monitor is automated by definition, and runs from
  cloud addresses (GitHub, Google). On the Free plan, Bot Fight Mode cannot be
  exempted for one client by a firewall rule. It does stop the monitor: on
  2026-11-14 every page answered 403 to GitHub's runners (see "Found on
  2026-11-13", item 1). It lets through the services on Cloudflare's list of
  verified bots.
- **Risk to the Georgia MLS search:** the search frame loads from
  `georgiamls.com`, which our zone's settings do not reach; the `/search` page
  around it is ours. Not tested with either setting changed: re-check the
  search (DE-32's real-browser check) after any bot setting change.
- **Today:** Bot Fight Mode is on, and stays on (Gbenga, 2026-11-14).
  Cloudflare's JavaScript detections script is in the page (see "Found on
  2026-11-13"). The exact switches are under Security > Bots.
- **The options, and the one chosen:**
  1. **Chosen (Gbenga, 2026-11-14): keep Bot Fight Mode on, and let an
     outside uptime service load the pages.** UptimeRobot is on Cloudflare's
     list of verified bots, which Bot Fight Mode lets through. It loads each
     of the 12 pages every 5 minutes; the monitor reads its verdicts with a
     read-only key and files them as its own page checks. Nothing in
     Cloudflare changes. The steps are item 1.1 of
     [needs-from-gbenga.md](needs-from-gbenga.md); how it works is in
     [synthetic-monitoring.md](synthetic-monitoring.md).
     - **Risk:** the page checks depend on a second outside company. If
       UptimeRobot is down or its key fails, the pages are not watched (the
       check `uptime-service` says so). The monitor no longer checks HSTS,
       the analytics beacon or the staff page's headers. Whether the Free
       plan's terms allow a business website is for Gbenga to confirm when
       signing up; reports from 2025 and 2026 conflict.
     - **Undo:** delete the secret `UPTIMEROBOT_API_KEY` and the UptimeRobot
       account. The pages are then not watched until another option is
       chosen.
     - **Worked when:** after a hand-run of the "SRE monitor" workflow,
       "Uptime service reports every page" and the 12 page checks pass.
       Nobody has seen this yet.
  2. **Withdrawn: a custom rule for the monitor** (the decision of
     2026-11-13: `Let the DiamondEcho monitor through`, skipping Browser
     Integrity Check for the monitor's User-Agent). It could never have been
     enough: a custom rule cannot skip Bot Fight Mode on the Free plan. It
     also let anyone who copied the monitor's name skip the browser check.
     If the rule was created, deleting it is item 1.2 of
     [needs-from-gbenga.md](needs-from-gbenga.md).
  3. **Not chosen: switch Bot Fight Mode off.** The monitor could then load
     the pages itself again (with `SRE_PAGE_SOURCE=direct`), if Browser
     Integrity Check also let it through, which has not been tested. It
     gives up the bot protection for every visitor. Undo: switch it on.
     **Needs Gbenga's yes.**
  4. **Not chosen: a paid Cloudflare plan**, where Cloudflare's bot settings
     can be skipped by a rule. A cost; see Cloudflare's plans page. **Needs
     Gbenga's yes.**
- **Google's uptime checks may meet the same block.** The Cloud Monitoring
  uptime checks in `deploy/monitoring/uptime-checks/` (item 3.3 of
  [needs-from-gbenga.md](needs-from-gbenga.md)) set no User-Agent, so they
  send Google's own checker name. Google documents it as starting
  `GoogleStackdriverMonitoring-UptimeChecks`. They run from Google's cloud
  addresses, so Bot Fight Mode may refuse them with a 403 as it did the
  monitor. Nobody has tested this; they do not exist yet. How Gbenga checks,
  read-only, within an hour of applying them:
  1. Google Cloud > Monitoring > Uptime checks. Open each `DiamondEcho SRE: …`
     check. Healthy: every region passes. A 403 failure in every region
     means a block.
  2. Cloudflare > diamondecho.com > Security > Events, filtered to the last
     hour and the action "Block" or "Challenge". Healthy: no events from
     Google's checker. A block names the service (for example "Bot Fight
     Mode" or "Browser Integrity Check") and shows the exact User-Agent.
  3. If they are blocked by Bot Fight Mode, no rule on the Free plan can let
     them through. Leave those checks unapplied (or remove them) and rely on
     UptimeRobot for the pages; the API uptime check is not behind
     Cloudflare and is not affected. Anything else is one of the options
     above and **needs Gbenga's yes**.

### 10. "I'm Under Attack" mode: only during an attack

- **Where:** Security > Settings > Security Level.
- **What:** shows every visitor a short browser check before the site.
- **Use:** only during a real flood of the site, as a step in
  [traffic-spike-or-abuse.md](runbooks/traffic-spike-or-abuse.md). Whether
  it stops UptimeRobot too has not been tested; if it does, the status page
  will show the pages as down while it is on. **Needs Gbenga's yes**; undo: set the level back.

## Option: put the API behind Cloudflare (`api.diamondecho.com`)

Not recommended before the site has run steadily for a while; written down so
the trade-offs are known when it comes up.

**What it would give:** the WAF and the one rate-limiting rule in front of the
inquiry and calculation routes, so a flood is turned away before Cloud Run
starts instances (and bills for them); one address family for visitors
(`diamondecho.com`, `staff.`, `api.`); Cloudflare's view of API traffic.

**What it would cost or risk:**

- **The per-sender limits would break.** `backend/inquiries/limits.py` takes
  the sender's address from the last `X-Forwarded-For` entry, which Google's
  front end adds. Behind Cloudflare that address becomes a Cloudflare server,
  so many visitors would share one allowance (5 inquiries per 10 minutes) and
  lock each other out. The code must first learn to read Cloudflare's
  `CF-Connecting-IP`, and only from requests that really came from
  Cloudflare. This needs its own change and tests, before the switch.
- **The `run.app` address stays open.** Anyone can keep calling it directly
  and skip Cloudflare. Closing it needs Google's load balancer (a monthly
  charge; see Google's pricing page) or an equivalent, so Cloudflare alone
  does not make the API private.
- **How to connect it:** a Cloud Run domain mapping, Google's load balancer,
  or a Cloudflare rule that rewrites the address. Each has its own limits and
  cost; none has been tried for this project.
- **Everything that names the API must change together:** the frontend's
  `REACT_APP_BACKEND_URL` and rebuild, the staff site's `config.js` and its
  strict Content-Security-Policy, the API's `CORS_ORIGINS`, and the SRE
  targets in `scripts/sre/targets.mjs`.
- **Bot settings would then apply to the API**, including to the browser
  calls from the calculators and the form. Needs a test pass on phones.
- **Undo:** point the frontend and staff site back at the `run.app` address
  and redeploy; remove the DNS record.

**Needs Gbenga's yes**, and a written plan reviewed by the security lead.

## Changing DNS safely

1. Write the change as a proposal: the record, the old and new value, why,
   what could break (always ask "does mail use this name?"), and the undo.
2. Gbenga makes the change in Cloudflare. Mail records (`MX`, the SPF `TXT`,
   the Microsoft 365 `TXT`, `autodiscover`, `sip`, `lyncdiscover`) stay
   "DNS only" (grey cloud): proxied, they break Outlook and Teams.
3. In the same pull request, or the next, update
   `deploy/dns/expected-records.json`.
4. Watch the next hourly `slow` run: the DNS checks should pass at both
   resolvers.
5. Undo: put the old value back; it takes effect as caches expire (the
   record's TTL: 3600 s (one hour) for the MX, TXT and SRV records, 300 s
   (five minutes) for the six CNAMEs, as answered on 2026-11-13).

## Runbooks

- [tls-certificate.md](runbooks/tls-certificate.md): a certificate is
  expiring, expired or wrong.
- [domain-expiry.md](runbooks/domain-expiry.md): the registration is close to
  expiry, has lapsed, or is being moved away.
- [cloudflare-outage.md](runbooks/cloudflare-outage.md): Cloudflare is down,
  or is blocking real visitors or the monitor.
- [traffic-spike-or-abuse.md](runbooks/traffic-spike-or-abuse.md): a flood of
  requests or scripted abuse.
- DNS records wrong or missing: `runbooks/dns-problem.md` (infrastructure
  role).
