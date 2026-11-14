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

## Two tiers

| | GitHub tier (on now, once merged) | Cloud Monitoring tier (prepared, off) |
| --- | --- | --- |
| What | Every check below | Six uptime checks: home, search, Deal Studio, contact page, API health, staff site |
| How often | Fast checks every 5 minutes, slow checks hourly, everything after a merge to `main` | Every 5 minutes |
| From where | One GitHub runner per run, in one Azure region (usually in the USA) | Six Google locations each time: three in the USA, one each in Europe, South America and Asia Pacific |
| Where results go | The `sre-status` branch, the status page, `sre-incident` issues | Cloud Monitoring; alerting on it is the observability role's alert policies |
| Switched on by | Merging the pull request | Gbenga running `deploy/monitoring/apply.sh` (see below) |

Be honest about the GitHub tier's limits:

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
  for noticing a change, not for saying what visitors feel.
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
| `public-home` | Home page | public-site | sev1 | 200, HTML, the page's own canonical address and a heading (the empty app shell has neither). Reports the commit the site was built from when `/version.json` says |
| `public-page-agents`, `-about` | Advisory, About pages | public-site | sev2 | as above |
| `public-page-podcast`, `-privacy`, `-terms` | Podcast, Privacy, Terms pages | public-site | sev3 | as above |
| `public-not-found` | Unknown address answers Page not found | public-site | sev3 | `/sre-monitor-no-such-page` answers 404 (launch audit finding F6) |
| `public-www-redirect` | www address redirects to the site | public-site | sev2 | `www.diamondecho.com/about` answers 301 to `https://diamondecho.com/about` |
| `public-asset-js`, `public-asset-css` | Site script / stylesheet loads | public-site | sev1 / sev2 | The files the home page names answer 200 with a script / stylesheet type (headers only; the file is not downloaded) |
| `search-page` | Property search page | search | sev2 | `/search` passes the page test and contains the Georgia MLS search frame |
| `calculators-deal-page`, `-mortgage-page`, `-net-sheet-page` | Calculator pages | calculators | sev2 | page test |
| `calculators-api-analyze` | Deal analysis service returns the reference figures | calculators | sev2 | One fixed fix-and-flip sent to `POST /api/v1/deals/analyze`; the answer carries a formula version and a profit of exactly 44,800.00 |
| `inquiry-page` | Contact page | inquiry | sev2 | page test, the request form is there and the "call or email us" card is not |
| `inquiry-preflight` | Inquiry form is allowed to send from the website | inquiry | sev2 | The browser's permission question (`OPTIONS`, the *CORS preflight*) for the form is answered yes for `https://diamondecho.com`, POST and the form's headers |
| `inquiry-route` | Inquiry route exists | inquiry | sev2 | `GET /api/v1/inquiries` answers 405 "POST only": the route is there |
| `inquiry-queue` | Inquiry queue is switched on | inquiry | sev2 | `GET /api/v1/inquiries/staff` without sign-in answers 401 (a 503 "not configured" means the queue is off; the body is read only for a 503) |
| `api-health` | API is up | api | sev2 | `/health` says ok |
| `api-identity` | API identity | api | sev2 | `/api/` names the DiamondEcho API; reports the revision and commit when the API publishes them |
| `api-cors-allowed` | API accepts calls from the website | api | sev2 | the identity answer lets `https://diamondecho.com` read it |
| `api-cors-refused` | API refuses calls from other sites | api | sev3 | the same question from an unknown site gets no permission |
| `staff-home` | Staff site loads with its protections | staff-site | sev2 | 200, HTML, `no-store`, `default-src 'none'`, `X-Frame-Options: DENY` |
| `staff-api-auth` | Staff API asks for sign-in | staff-site | sev2 | 401 without sign-in, `no-store`, readable by the staff site only; a 200 is reported as a security incident. The answer's body is never read |

SLIs: page checks count toward `public-availability` and `public-latency`
(the search page too); calculator page checks toward `calculators-availability`;
inquiry checks toward `inquiry-availability`; `api-health` and `api-identity`
toward `api-availability` and `api-latency`, and the deal analysis call toward
`api-availability` (an API failure is counted once, as an API outage, not
again as a calculator outage; the calculator pages themselves still load);
staff checks toward
`staff-availability`. The CORS, not-found and redirect checks feed no SLO.

A fast run makes about 26 requests, one at a time with a pause between them:
1 to an outside DNS resolver, 16 to the public site, 1 to the staff site and
8 to the API. Only one is a POST (the reference calculation). Over a day that
is about 2,300 API requests, if GitHub runs every scheduled time.

### Telling a blind monitor from a down site

Every other fast check looks at our own hosts. When the GitHub runner's own
network fails, they all fail together, and without something to compare
with, that run would look like a site outage and page as a sev1.
`outside-dns-probe` is that comparison: one question to the wider internet,
asked before our pages so a dead network cannot use up the module's time
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

Everything above, once, after a merge to `main`.

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
  SLO; the same goes for the script and stylesheet checks when the home page
  gave nothing to read them from. The checks that ran keep their result, so
  a site that swallows every connection still shows as a failed sev1 home
  page, not as a monitor fault.
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
| Signing in to the staff site | It needs a real staff account and second factor; the monitor holds no secret | `staff-home` and `staff-api-auth` prove the door is there and locked |
| Searching inside the Georgia MLS frame | It is Georgia MLS's service and data; scripted searches against it are not ours to make | One hourly GET of its search page (`search-idx-provider`) and our page's frame (`search-page`) |
| The certificate, DNS and domain from GitHub | They belong to the edge role | Slow suite, edge modules |

## The Cloud Monitoring tier (prepared, off)

`deploy/monitoring/uptime-checks/` holds six request bodies for Cloud
Monitoring's uptime checks (the `UptimeCheckConfig` resource): home page,
`/search`, `/investment-calculator`, `/inquire`, API `/health` and the staff
site. Each is an HTTPS GET every 5 minutes from the USA, Europe, South America
and Asia Pacific, with a 10-second limit, and passes only on a 200 that
contains the page's own canonical address (`"status":"ok"` for the API, the
page title for the staff site). `${PROJECT_ID}` is filled in when applied.

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
(Monitoring > Uptime checks) and confirm all six pass: see the Cloudflare
section below, because Cloudflare's browser check could refuse Google's
checkers too.

## Cloudflare's browser check refuses the monitor (found 2026-11-13)

On 2026-11-13, from the sandbox the checks were built in,
`https://diamondecho.com/` and `https://staff.diamondecho.com/` answered
403 "Access denied … used Cloudflare to restrict access" (Cloudflare error
1010, the browser signature check, usually Browser Integrity Check) to the
monitor's User-Agent `DiamondEcho-SRE-Monitor/1
(+https://github.com/Ggeorge73/DiamondEcho)`, while ordinary clients got
200. The www redirect and the API were not affected: the redirect is answered
before that check, and the API is not behind Cloudflare.

Gbenga chose to let the monitor through with a Cloudflare rule and keep its
plain name ([needs-from-gbenga.md](needs-from-gbenga.md), item 1.1: a custom
rule that skips Browser Integrity Check only, for GET and HEAD from that
User-Agent to our three hosts). **The rule must be in place before this
monitoring is merged.** Without it every website, search, calculator,
contact and staff page check fails from the first run, and the alert engine
opens incidents for an outage visitors are not having. After adding the
rule, run the "SRE monitor" workflow by hand and check that the website
checks pass.

When a check meets Cloudflare's own refusal page, its detail starts
"Cloudflare refused the request" and points to
[cloudflare-outage.md](runbooks/cloudflare-outage.md), and the script and
stylesheet checks say the home page was refused by Cloudflare. A 403 that
the site itself serves (Cloudflare Pages adds Cloudflare's headers to every
answer) is reported as a plain status. Google's uptime checkers may meet the
same browser check once the Cloud Monitoring tier is applied; the rule above
does not cover their User-Agent, so check them after applying.

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
   `frontend/src/lib/pageMeta.js` is listed.
