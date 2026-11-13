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
| `public-home` | Home page | public-site | sev1 | 200, HTML, the page's own canonical address and a heading (the empty app shell has neither). Reports the commit the site was built from when `/version.json` says |
| `public-page-agents`, `-about` | Advisory, About pages | public-site | sev2 | as above |
| `public-page-podcast`, `-privacy`, `-terms` | Podcast, Privacy, Terms pages | public-site | sev3 | as above |
| `public-not-found` | Unknown address answers Page not found | public-site | sev3 | `/sre-monitor-no-such-page` answers 404 (launch audit finding F6) |
| `public-www-redirect` | www address redirects to the site | public-site | sev2 | `www.diamondecho.com/about` answers 301 to `https://diamondecho.com/about` |
| `public-asset-js`, `public-asset-css` | Site script / stylesheet loads | public-site | sev1 / sev2 | The files the home page names answer 200 with a script / stylesheet type (headers only; the file is not downloaded) |
| `search-page` | Property search page | search | sev2 | `/search` passes the page test and contains the Georgia MLS search frame |
| `calculators-deal-page`, `-mortgage-page`, `-net-sheet-page` | Calculator pages | calculators | sev2 | page test |
| `calculators-api-analyze` | Deal analysis service returns the reference figures | calculators | sev3 | One fixed fix-and-flip sent to `POST /api/v1/deals/analyze`; the answer carries a formula version and a profit of exactly 44,800.00 |
| `inquiry-page` | Contact page | inquiry | sev2 | page test, the request form is there and the "call or email us" card is not |
| `inquiry-preflight` | Inquiry form is allowed to send from the website | inquiry | sev2 | The browser's permission question (`OPTIONS`, the *CORS preflight*) for the form is answered yes for `https://diamondecho.com`, POST and the form's headers |
| `inquiry-route` | Inquiry route exists | inquiry | sev2 | `GET /api/v1/inquiries` answers 405 "POST only": the route is there |
| `inquiry-queue` | Inquiry queue is switched on | inquiry | sev2 | `GET /api/v1/inquiries/staff` without sign-in answers 401 (a 503 "not configured" means the queue is off) |
| `api-health` | API is up | api | sev2 | `/health` says ok |
| `api-identity` | API identity | api | sev2 | `/api/` names the DiamondEcho API; reports the revision and commit when the API publishes them |
| `api-cors-allowed` | API accepts calls from the website | api | sev2 | the identity answer lets `https://diamondecho.com` read it |
| `api-cors-refused` | API refuses calls from other sites | api | sev3 | the same question from an unknown site gets no permission |
| `staff-home` | Staff site loads with its protections | staff-site | sev2 | 200, HTML, `no-store`, `default-src 'none'`, `X-Frame-Options: DENY` |
| `staff-api-auth` | Staff API asks for sign-in | staff-site | sev2 | 401 without sign-in, `no-store`, readable by the staff site only; a 200 is reported as a security incident |

SLIs: page checks count toward `public-availability` and `public-latency`
(the search page too); calculator page checks toward `calculators-availability`;
inquiry checks toward `inquiry-availability`; `api-health` and `api-identity`
toward `api-availability` and `api-latency`, and the deal analysis call toward
`api-availability` (the calculators still work in the browser when the API is
down, so an API failure is not counted as a calculator outage); staff checks toward
`staff-availability`. The CORS, not-found and redirect checks feed no SLO.

A fast run makes about 25 requests, one at a time with a pause between them:
16 to the public site, 1 to the staff site and 8 to the API. Only one is a
POST (the reference calculation). Over a day that is about 2,300 API
requests, if GitHub runs every scheduled time.

### Slow suite: hourly

| Id | Name | Component | Severity | What passes |
| --- | --- | --- | --- | --- |
| `api-docs-off` | API route list is not published | api | sev3 | `/docs`, `/redoc` and `/openapi.json` answer 404 (launch audit finding F4) |
| `search-idx-provider` | Georgia MLS search (outside provider) | search | sev3 | One GET of `https://georgeolugbe.georgiamls.com/idxsearch/` (at most one retry) answers 200 HTML and does not forbid being shown inside our page |

The slow suite also runs the edge security role's certificate, DNS, domain
and edge checks (`checks/tls.mjs`, `dns.mjs`, `domain.mjs`, `edge.mjs`); see
[edge.md](edge.md).

### Post-deploy suite

Everything above, once, after a merge to `main`.

### When a check module itself breaks

The runner loads the ten modules from a fixed list. If one is missing,
throws, returns something outside the contract or runs past 90 seconds, its
checks are replaced by one failed sev3 check named `monitor-<module>`
("Monitor could run the … checks"), and every other module still runs. A
blind spot is reported, never skipped in silence. A whole run stops starting
new modules after 7 minutes, so it always files a result before the
workflow's 10-minute limit.

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
(Monitoring > Uptime checks) and confirm all six pass: see the Cloudflare note
below, because a Cloudflare rule could refuse Google's checkers too.

## A Cloudflare rule refuses the monitor's plain User-Agent (found 2026-11-13)

On 2026-11-13, from this sandbox, `https://diamondecho.com/` answered
403 "Access denied … used Cloudflare to restrict access" to the monitor's
User-Agent `DiamondEcho-SRE-Monitor/1 (+https://github.com/Ggeorge73/DiamondEcho)`,
and also to `DiamondEcho-SRE-Monitor/1` alone, while it answered 200 to
`curl/8.5.0`, to `node` and to
`Mozilla/5.0 (compatible; DiamondEcho-SRE-Monitor/1; +https://github.com/Ggeorge73/DiamondEcho)`.
The refusal page names Cloudflare error 1010: the visitor's "browser
signature" was refused, which is usually Cloudflare's Browser Integrity Check
(a zone setting that turns away requests whose headers look unlike a
browser's). Only the Cloudflare dashboard (Security > Events) can confirm
which setting it was. The www redirect and the API are not affected: the
redirect is answered before that check, and the API is not behind Cloudflare.

Until it is resolved, a check that meets Cloudflare's refusal says
"Cloudflare refused the request (403, error 1010: …)" rather than a bare
status, so nobody mistakes it for the site being down. The proposed fix is
the browser-style form above (the usual shape for an honest automated
client, as search engines' crawlers use). It goes in `USER_AGENT` in
`scripts/sre/targets.mjs`. Google's uptime checkers may meet the same check
once the Cloud Monitoring tier is applied.

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
   `request()` from `lib/http.mjs` (time limit, retries, the monitor's
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
