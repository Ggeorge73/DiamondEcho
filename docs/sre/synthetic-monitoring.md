# Synthetic monitoring: how the site is watched from outside

A *synthetic check* is a scripted visitor: a small program that opens the
site's pages and asks the API the questions a browser would ask, then writes
down whether each answer was right and how long it took. It sees what a
visitor sees, so it notices a broken page even when every server reports
itself healthy.

This guide says what is checked, how often and from where, what is
deliberately not checked, and how to add a check. The code is
`scripts/sre/synthetic-checks.mjs` and the modules in `scripts/sre/checks/`;
the rules every check follows are in `scripts/sre/README.md`.

**No web page is loaded (decided 2026-11-14).** The monitor runs on GitHub's
servers, and Cloudflare's Bot Fight Mode refuses those servers on every page
of `diamondecho.com` and `staff.diamondecho.com`. Gbenga decided that Bot
Fight Mode stays on, that no outside monitoring service is added, and that
nothing checks the hosting address behind Cloudflare. So the monitor asks
only the API, the inquiry route, the staff sign-in route and the redirects,
plus the hourly certificate, DNS and domain checks. **No automatic check
loads a web page.** That is a known gap, decided by the owner, not a defect.
What it means is in "Bot Fight Mode refuses the monitor, so no page is
loaded" below.

## Two tiers

| | GitHub tier (on once switched on) | Cloud Monitoring tier (prepared, off) |
| --- | --- | --- |
| What | Every check below. None of them loads a web page | Six uptime checks: home, search, Deal Studio, contact page, API health, staff site. Five of the six load a page and may be refused by Bot Fight Mode (see below) |
| How often | Fast checks every 5 minutes, slow checks hourly, everything after a merge to `main` | Every 5 minutes |
| From where | One GitHub runner per run, in one Azure region (usually in the USA) | Six Google locations each time: three in the USA, one each in Europe, South America and Asia Pacific |
| Where results go | The `sre-status` branch, the status page, `sre-incident` issues | Cloud Monitoring; alerting on it is the observability role's alert policies |
| Switched on by | Gbenga setting the repository variable `SRE_MONITOR` = `enabled` ([needs-from-gbenga.md](needs-from-gbenga.md), item 1.1) | Gbenga running `deploy/monitoring/apply.sh` (see below). Not applied |

Be honest about the GitHub tier's limits:

- **It does not see the pages.** If Cloudflare Pages serves a broken or
  empty page, or Cloudflare itself has an outage, while the API keeps
  answering, no incident opens and the status page still says "Operational"
  (it carries a notice that pages are not loaded). A person learns of it
  from a visitor, or by opening the site.
- **GitHub's schedule is best effort.** A run "every 5 minutes" can start
  several minutes late or be skipped when GitHub is busy. A gap in the status
  history is GitHub, not the site. The Cloud Monitoring tier does not have
  this problem.
- **One place per run.** Each run comes from one Azure region (the run
  records it as `vantage.region`, read from Azure's own metadata service; it
  is `null` when Azure does not say). A fault that only affects visitors in
  one part of the world can be missed. Seeing the site from several
  continents at once is what the Cloud Monitoring tier is for.
- **Speed is measured from a data centre.** A latency figure is from a
  well-connected server, not from a phone on a home connection. It is good
  for noticing a change, not for saying what visitors feel. With no page
  loaded, the only speed measured is the API's.
- **The monitor keeps the API warm.** The API scales to zero when idle and
  the first visitor after that waits for it to start (a *cold start*).
  Checks every five minutes mean the monitor itself rarely meets a cold
  start, so it under-reports what the first visitor of the morning sees.

## What is checked

Every check has a fixed id (never reuse or rename one: the history is filed
under it), a name a visitor would understand, the part of the site it belongs
to (*component*), how bad it is if it keeps failing (*severity*, defined in
[severity-and-escalation.md](severity-and-escalation.md)), and the SLIs it
counts toward (an *SLI* is a measured share of good answers; see
[slo.md](slo.md)).

### Fast suite: every 5 minutes

| Id | Name | Component | Severity | What passes |
| --- | --- | --- | --- | --- |
| `outside-dns-probe` | Monitor can reach the internet | dns | sev4 | Run first. One DNS-over-HTTPS lookup of `example.com` (a name that is not ours) at Google's resolver, or Cloudflare's if Google's does not answer properly, comes back with an address. See "Telling a blind monitor from a down site" below |
| `public-www-redirect` | www address redirects to the site | public-site | sev2 | `www.diamondecho.com/about` answers 301 to `https://diamondecho.com/about` (Cloudflare answers a redirect before its bot check). The page it points at is not loaded |
| `api-health` | API is up | api | sev2 | `/health` says ok |
| `api-identity` | API identity | api | sev2 | `/api/` names the DiamondEcho API; reports the revision and commit when the API publishes them |
| `api-cors-allowed` | API accepts calls from the website | api | sev2 | the identity answer lets `https://diamondecho.com` read it |
| `api-cors-refused` | API refuses calls from other sites | api | sev3 | the same question from an unknown site gets no permission |
| `calculators-api-analyze` | Deal analysis service returns the reference figures | calculators | sev2 | One fixed fix-and-flip sent to `POST /api/v1/deals/analyze`; the answer carries a formula version and a profit of exactly 44,800.00 |
| `inquiry-preflight` | Inquiry form is allowed to send from the website | inquiry | sev2 | The browser's permission question (`OPTIONS`, the *CORS preflight*) for the form is answered yes for `https://diamondecho.com`, POST and the form's headers |
| `inquiry-route` | Inquiry route exists | inquiry | sev2 | `GET /api/v1/inquiries` answers 405 "POST only": the route is there |
| `inquiry-queue` | Inquiry queue is switched on | inquiry | sev2 | `GET /api/v1/inquiries/staff` without sign-in answers 401 (a 503 "not configured" means the queue is off; the body is read only for a 503) |
| `staff-api-auth` | Staff API asks for sign-in | staff-site | sev2 | 401 without sign-in, `no-store`, readable by the staff site only; a 200 is reported as a security incident. The answer's body is never read |

These eleven are the whole fast suite (`synthetic-checks.test.mjs` holds it
to exactly this list, and to sending nothing to a page on Cloudflare).

SLIs: `api-health` and `api-identity` count toward `api-availability` and
`api-latency`, and the deal analysis call toward `api-availability` (an API
failure is counted once, as an API outage, not again as a calculator
outage); the three inquiry checks toward `inquiry-availability`;
`staff-api-auth` toward `staff-availability`. The CORS and redirect checks
feed no SLO. **`public-availability`, `public-latency` and
`calculators-availability` were fed only by page checks, so they get no
data at present** ([slo.md](slo.md)). `inquiry-availability` and
`staff-availability` are now fed by their API-side checks only.

A fast run makes 10 requests, one at a time with a pause between them: 1 to
an outside DNS resolver, 1 to the www address and 8 to the API. Only one is
a POST (the reference calculation). Over a day that is about 2,300 API
requests, if GitHub runs every scheduled time.

#### Checks that are not made at present

These were made while the monitor loaded the pages itself. They are kept in
the code and are **not made at present (pages are not loaded, 2026-11-14)**.
Nothing on a schedule replaces them. This is a known gap, not a pass:

| Id | Name | Component | Severity | What it proved |
| --- | --- | --- | --- | --- |
| `public-home` | Home page | public-site | sev1 | 200, HTML, the page's own canonical address and a heading (the empty app shell has neither); the commit the site was built from, read from `/version.json` |
| `public-page-agents`, `-about` | Advisory, About pages | public-site | sev2 | as above |
| `public-page-podcast`, `-privacy`, `-terms` | Podcast, Privacy, Terms pages | public-site | sev3 | as above |
| `public-not-found` | Unknown address answers Page not found | public-site | sev3 | `/sre-monitor-no-such-page` answers 404 (launch audit finding F6) |
| `public-asset-js`, `public-asset-css` | Site script / stylesheet loads | public-site | sev1 / sev2 | The files the home page names answer 200 with a script / stylesheet type |
| `search-page` | Property search page | search | sev2 | `/search` passes the page test and contains the Georgia MLS search frame |
| `calculators-deal-page`, `-mortgage-page`, `-net-sheet-page` | Calculator pages | calculators | sev2 | page test |
| `inquiry-page` | Contact page | inquiry | sev2 | page test, the request form is there and the "call or email us" card is not |
| `staff-home` | Staff site loads with its protections | staff-site | sev2 | 200, HTML, `no-store`, `default-src 'none'`, `X-Frame-Options: DENY`. `scripts/staging-smoke.mjs` still checks those three headers, on staging |
| `edge-hsts`, `edge-no-analytics-beacon` (hourly and after a merge) | HSTS is sent / no analytics beacon in the page | public-site | sev3 | They read the home page ([edge.md](edge.md)) |

They come back when the monitor loads the pages itself: set
`SRE_PAGE_SOURCE=direct` (see `PAGE_SOURCES` in
`scripts/sre/synthetic-checks.mjs`; the default is `none`). That is only
useful for a run from a network Cloudflare lets through. GitHub's runners
are not one.

### Telling a blind monitor from a down site

Every other fast check looks at our own hosts. When the GitHub runner's own
network fails, they all fail together, and without something to compare
with, that run would look like a site outage and page as a sev1.
`outside-dns-probe` is that comparison: one question to the wider internet,
asked before our own hosts so a dead network cannot use up the module's time
first. It asks about `example.com`, a name reserved for examples, through
DNS-over-HTTPS (a DNS lookup sent as an ordinary HTTPS request), with a
3-second limit and one more try only when nothing answered, then the same at
the second resolver. It never sends anything to our hosts.

It is sev4 and feeds no SLO: on its own it is a notice. Its use is to the
alert engine, which treats it as an outside check: when it fails in the same
run as our own checks, the run is read as "monitor blind", not as an outage
(see [alerting.md](alerting.md)). Its detail starts with that conclusion.
It runs in the fast and post-deploy suites; the slow suite's own DNS checks
(`checks/dns.mjs`) ask the same resolvers about our domain.

### Slow suite: hourly

If the hourly run is missed (GitHub drops a waiting run when a newer one
arrives), a five-minute run does the slow checks instead once the last slow
run is more than 90 minutes old. Only every other run may do that, so the
fast checks keep running.

| Id | Name | Component | Severity | What passes |
| --- | --- | --- | --- | --- |
| `api-docs-off` | API route list is not published | api | sev3 | `/docs`, `/redoc` and `/openapi.json` answer 404 (launch audit finding F4) |
| `search-idx-provider` | Georgia MLS search (outside provider) | search | sev3 | One GET of `https://georgeolugbe.georgiamls.com/idxsearch/` (at most two attempts, see below) answers 200 HTML and does not forbid being shown inside our page |

The slow suite also runs the edge security role's certificate, DNS, domain
and edge checks (`checks/tls.mjs`, `dns.mjs`, `domain.mjs`, `edge.mjs`); see
[edge.md](edge.md).

### Post-deploy suite

The fast checks above and the edge checks (the two redirects, DNSSEC and
CAA), once, after a merge to `main`. It contains no page check, so nothing
verifies that the pages of a new build load. What the post-merge check does
prove is that Cloudflare Pages reported the build as published
([release-safety.md](release-safety.md)).

### Retries, time limits and what a failure means

- **Only "no answer" is tried again.** A request that got no answer at all
  (the connection failed or nothing came back within 10 seconds) is tried
  again after 0.5 s and then 1.5 s: at most three attempts. A wrong answer,
  a server error (5xx) included, is reported at once, after one attempt:
  retrying it would hide from the SLOs errors that visitors meet. Two
  exceptions try fewer times: the reference calculation (at most two
  attempts) and, once a host has failed to answer at all, every later
  request to that host in the same run (one 5-second attempt). The Georgia
  MLS check, which feeds no SLO, is the only one that also tries a server
  error once more (at most two attempts).
- **Latency is the whole request.** `latency_ms` runs from sending the
  first attempt to the last byte of the answer, with the failed attempts and
  the waits between them included. A page that needed a retry shows the
  time the visitor would have waited.
- **Time limits.** Each module has 90 seconds and the whole run 7 minutes,
  so a run always files a result before the workflow's 10-minute limit.
  Each request is shortened to the module's time left. When the time is
  gone, nothing more is sent: each remaining check is filed as failed under
  its own id and severity with the detail "Not tried: the module's time ran
  out." A check that was never sent measured nothing, so it counts toward no
  SLO; the same goes, when the monitor loads the pages itself
  (`SRE_PAGE_SOURCE=direct`), for the script and stylesheet checks when the
  home page gave nothing to read them from. The checks that ran keep their
  result, so a host that swallows every connection still shows as failed
  checks of that part, not as a monitor fault.
- **When a check module itself breaks.** The runner loads the ten modules
  from a fixed list. If one is missing, throws, returns something outside
  the contract, or does not hand in its checks within 5 seconds after its
  time, its checks are replaced by one failed sev3 check named
  `monitor-<module>` ("Monitor fault, not the site: …"), and every other
  module still runs. A blind spot is reported, never skipped in silence.

## What is deliberately not checked, and why

| Not checked | Why | What covers it instead |
| --- | --- | --- |
| Submitting an inquiry | Every well-formed `POST /api/v1/inquiries` counts against 5 per 10 minutes per sender and 30 per hour per instance. A monitor that posted would lock visitors out and fill the staff queue | The route, preflight and queue checks above, which `backend/tests/test_monitor_probe.py` proves never reach a limiter or the store. Delivery is covered by the arrival alert ([inquiry-not-delivered.md](runbooks/inquiry-not-delivered.md)) |
| Property lookup and address suggestions (`/api/v1/properties/lookup`, `/suggest`) | Each call costs money (RentCast, Mapbox) | Nothing on a schedule. Checked by hand when changed |
| Scenarios, sensitivity, Monte Carlo (`/api/v1/deals/...`) | Limited to 10 per 10 minutes per sender and heavy on the API | The analysis check uses the same service; the website runs these in the browser |
| The assistant (`/api/assistant/chat`) | It is a conversation, not a page; a scripted conversation every five minutes is noise in its use | Its own tests |
| Signing in to the staff site | It needs a real staff account and second factor; the monitor holds no secret | `staff-api-auth` proves the staff API is there and locked. The sign-in page itself is not loaded |
| Searching inside the Georgia MLS frame | It is Georgia MLS's service and data; scripted searches against it are not ours to make | One hourly GET of its search page (`search-idx-provider`). Our own `/search` page is not loaded |
| Any web page of `diamondecho.com` or `staff.diamondecho.com`, and what is in it (heading, search frame, request form, script and stylesheet, the 404 page, HSTS, the analytics beacon, the staff page's headers) | Bot Fight Mode refuses GitHub's runners on every page and stays on; no outside monitoring service is used; nothing checks the hosting address behind Cloudflare (Gbenga, 2026-11-14) | Nothing on a schedule. A failed site build after a merge still opens an incident. Otherwise a person opening the site, or a visitor's report ([site-down.md](runbooks/site-down.md)) |
| The certificate, DNS and domain from GitHub | They belong to the edge role | Slow suite, edge modules |

## The Cloud Monitoring tier (prepared, off)

`deploy/monitoring/uptime-checks/` holds six request bodies for Cloud
Monitoring's uptime checks (the `UptimeCheckConfig` resource): home page,
`/search`, `/investment-calculator`, `/inquire`, API `/health` and the staff
site. Each is an HTTPS GET every 5 minutes from the USA, Europe, South America
and Asia Pacific, with a 10-second limit, and passes only on a 200 that
contains the page's own canonical address (`"status":"ok"` for the API, the
page title for the staff site). `${PROJECT_ID}` is filled in when applied.

**Not applied, and five of the six may be refused.** These checks run from
Google's network. Bot Fight Mode answered 403 to GitHub's runners on every
page, and may do the same to Google's checkers; nobody has tested it,
because the checks do not exist yet. Only the API check is outside
Cloudflare. Gbenga also decided on 2026-11-14 against any outside monitoring
service, so whether these page checks are wanted at all is his to say
before anything is applied (item 3.3 of
[needs-from-gbenga.md](needs-from-gbenga.md): the plan can be cut down to
the API check first).

They cost executions, so the count is worked out in advance (the test beside
the files repeats this sum):

- 6 Google locations per check (USA counts three) and 8,928 runs a location
  in a 31-day month at one every 5 minutes;
- 6 checks x 6 locations x 8,928 = 321,408 executions a month.

When this was written Google's published allowance was 1 million free uptime
check executions a month, with a charge per thousand after that. **Re-check
the price and the allowance on Google's Cloud Monitoring pricing page before
applying**: both can change, and the allowance may be shared with anything
else on the billing account. The API check also adds about 1,700 requests a
day to the API.

To apply (Gbenga, once the observability role's `apply.sh` is merged): sign
in to Cloud Shell on project `diamondecho-prod` and run
`bash deploy/monitoring/apply.sh` as that script describes. Nothing is
created until then. After applying, look at each check in the console
(Monitoring > Uptime checks) and see which pass: a 403 in every region on a
page check is Bot Fight Mode ([edge.md](edge.md), item 9).

## Bot Fight Mode refuses the monitor, so no page is loaded

**What was measured.** On 2026-11-13, from the sandbox the checks were built
in, `https://diamondecho.com/` and `https://staff.diamondecho.com/` answered
403 "Access denied … used Cloudflare to restrict access" (Cloudflare error
1010) to the monitor. In monitor run 27, from GitHub's runners (2026-11-14
02:36 UTC), every page on `diamondecho.com` and `staff.diamondecho.com`
answered 403 to the monitor: error 1010 on most, and a Cloudflare challenge
page on the home page, the Deal Studio page and the staff home page. In the
same run the API checks, the inquiry route checks and the www redirect (301)
passed. The redirect is answered before the bot check, and the API is not
behind Cloudflare.

**The decisions (Gbenga, 2026-11-14).**

- Bot Fight Mode stays on for the zone. On the Free plan a custom rule
  cannot skip it, so the earlier plan (a Cloudflare custom rule that let the
  monitor's User-Agent past the browser check) is withdrawn.
- No outside monitoring service is added to load the pages in the monitor's
  place, for security reasons.
- Nothing checks the hosting address behind Cloudflare either.

So the monitor does not ask for any page. Nothing in Cloudflare is changed
for it. The switch is unchanged: the scheduled runs start once Gbenga sets
`SRE_MONITOR` = `enabled` (item 1.1 of
[needs-from-gbenga.md](needs-from-gbenga.md)).

**What follows from that. These are known gaps, decided by the owner, not
defects** (item 1.2a of [needs-from-gbenga.md](needs-from-gbenga.md)):

- **No automatic check loads any web page.** A broken or empty page, or a
  Cloudflare outage, while the API keeps answering, opens no incident. The
  status page rows stay "Operational", with its notice that pages are not
  loaded.
- **What each status page row now means:**

  | Row | What it rests on |
  | --- | --- |
  | Website | The www redirect only (`public-www-redirect`), plus the hourly redirect checks |
  | Property search | The hourly Georgia MLS provider check only (`search-idx-provider`) |
  | Intelligence calculators | The deal analysis API call only (`calculators-api-analyze`) |
  | Inquiry form | The three API route checks (`inquiry-preflight`, `inquiry-route`, `inquiry-queue`) |
  | Staff site | The staff API's sign-in check (`staff-api-auth`) |
  | API, DNS, TLS, Domain | Unchanged |

- **Three targets get no data:** `public-availability`, `public-latency`
  and `calculators-availability` ([slo.md](slo.md)).
- **The rollback engine's "website must be healthy" guard** now rests on
  `public-www-redirect` (and DNS), not on a page
  ([auto-remediation.md](auto-remediation.md)).
- **The automatic website rollback cannot be triggered** by a failing page.
  A failed Pages build after a merge still opens an incident
  ([release-safety.md](release-safety.md)).
- **"Cloudflare is refusing the monitor"** can now only come from the
  redirect checks ([alerting.md](alerting.md)).

**What still tells Gbenga about the site:** a failed site build after a
merge; certificate, DNS, domain and redirect problems; and the API, inquiry
route and staff sign-in checks. For the pages themselves: a person opening
the site, or a visitor's report ([site-down.md](runbooks/site-down.md)).

**If Cloudflare refuses a redirect check.** The monitor's only requests to
Cloudflare are the redirects (`public-www-redirect`, and
`edge-http-redirect` and `edge-www-redirect` in the hourly and post-deploy
suites). If one meets Cloudflare's own refusal page, its detail starts
"Cloudflare refused the request" and points to
[cloudflare-outage.md](runbooks/cloudflare-outage.md). A 403 that the site
itself serves (Cloudflare Pages adds Cloudflare's headers to every answer)
is reported as a plain status.

## Running the checks yourself

```bash
node scripts/sre/synthetic-checks.mjs --suite fast --out /tmp/run.json
node scripts/sre/synthetic-checks.mjs --suite slow --out /tmp/run.json
node scripts/sre/synthetic-checks.mjs --suite post-deploy --out /tmp/run.json --fail-on-failure
```

It prints one line per check and a total, and writes the run document.
Exit code 0 means it ran (failed checks are data); 1 only with
`--fail-on-failure` when a check failed; 2 when the command itself broke.
Behind a proxy that Node does not pick up by itself, set
`NODE_USE_ENV_PROXY=1` (Node 22.21 or later). Keep it to a handful of runs:
it is the live site.

Tests (no network): `node --test scripts/sre/synthetic-checks.test.mjs
scripts/sre/lib/http.test.mjs scripts/sre/checks/*.test.mjs
deploy/monitoring/uptime-checks/uptime-checks.test.mjs`, and
`python -m pytest backend/tests/test_monitor_probe.py`.

## How to add a check

1. Decide what a visitor would notice, and whether it can be seen with GET,
   HEAD or OPTIONS. If it needs a POST, stop and ask: only the reference
   calculation is allowed (rules 1 to 3 of `scripts/sre/README.md`).
2. Put it in the module of its component in `scripts/sre/checks/`. Use
   `request()` from `lib/http.mjs` (time limit, the module's deadline,
   retries only when nothing answered, the monitor's
   User-Agent, no redirects followed, nothing logged) and `toCheck()`.
3. Give it a new kebab-case id, a name a visitor would understand, a
   component from `COMPONENTS` in `lib/schema.mjs`, a severity and its SLIs
   (or `[]`). The `detail` text is public: statuses and header names, never a
   body, a query string or anything a visitor typed.
4. Add a test beside the module with a fake `fetch`: the healthy answer, and
   each way it can fail. Never let a test touch the network.
5. If it touches the API, run `backend/tests/test_monitor_probe.py`: it
   replays every request the modules make and fails if one reaches a rate
   limiter or the inquiry store.
6. Try it once against the live site, then add it to the tables above.
7. A new public page needs nothing here except a line in `PAGES` in
   `checks/pages.mjs`: its test fails until the page in
   `frontend/src/lib/pageMeta.js` is listed. The page is not loaded at
   present (see above); the line keeps the list ready for when it is.
