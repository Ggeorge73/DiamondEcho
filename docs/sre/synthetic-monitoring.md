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

**Who loads the pages (changed 2026-11-14).** The monitor runs on GitHub's
servers, and Cloudflare's Bot Fight Mode refuses those servers on every page.
Gbenga decided Bot Fight Mode stays on. So the pages are loaded by an outside
uptime service, UptimeRobot, which Cloudflare lets through, and the monitor
reads UptimeRobot's verdict on each page. The monitor itself still asks the
API, the inquiry route and the redirects. The full story is in "Bot Fight
Mode refuses the monitor, so an uptime service loads the pages" below.

## Two tiers

| | GitHub tier (on now, once merged) | Cloud Monitoring tier (prepared, off) |
| --- | --- | --- |
| What | Every check below. The 12 page loads are made by UptimeRobot and read by the monitor; the monitor makes the rest itself | Six uptime checks: home, search, Deal Studio, contact page, API health, staff site |
| How often | Fast checks every 5 minutes, slow checks hourly, everything after a merge to `main` | Every 5 minutes |
| From where | The monitor's own checks: one GitHub runner per run, in one Azure region (usually in the USA). The page loads: UptimeRobot's own locations | Six Google locations each time: three in the USA, one each in Europe, South America and Asia Pacific |
| Where results go | The `sre-status` branch, the status page, `sre-incident` issues | Cloud Monitoring; alerting on it is the observability role's alert policies |
| Switched on by | Gbenga setting up UptimeRobot and its read-only key, then the variable `SRE_MONITOR` = `enabled` ([needs-from-gbenga.md](needs-from-gbenga.md), item 1.1) | Gbenga running `deploy/monitoring/apply.sh` (see below) |

Be honest about the GitHub tier's limits:

- **GitHub's schedule is best effort.** A run "every 5 minutes" can start
  several minutes late or be skipped when GitHub is busy. A gap in the status
  history is GitHub, not the site. The Cloud Monitoring tier does not have
  this problem.
- **One place per run.** Each run comes from one Azure region (the run
  records it as `vantage.region`, read from Azure's own metadata service; it
  is `null` when Azure does not say). A fault that only affects visitors in
  one part of the world can be missed. Seeing the site from several
  continents at once is what the Cloud Monitoring tier is for. The page
  loads come from wherever UptimeRobot runs them; the run does not record
  that place.
- **Speed is measured from a data centre.** A latency figure is from a
  well-connected server, not from a phone on a home connection. It is good
  for noticing a change, not for saying what visitors feel. For a page, the
  figure is UptimeRobot's last response time, measured from its servers, not
  the monitor's own.
- **A page outage is seen later than an API outage.** UptimeRobot loads each
  page every 5 minutes on its Free plan, and the monitor reads its verdict
  every 5 minutes. So a page that stops loading can take up to about 5
  minutes to be seen by UptimeRobot, and up to 5 more to be read by the
  monitor. An incident still needs two failing reads in a row (three for
  the sev3 pages). These are the two services' intervals, not a measured
  delay.
- **A page check is only as good as UptimeRobot.** If UptimeRobot is down,
  its key is missing, or a monitor there is paused or renamed, the pages are
  not watched. The check `uptime-service` says so. What the status page
  shows meanwhile is weaker than it looks: see "When the uptime service
  cannot be read" below.
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

"Asked by" says who makes the request. **Monitor** means the GitHub monitor
asks our site or API itself. **UptimeRobot** means UptimeRobot loads the page
and the monitor reads its verdict: "up" passes, "seems down" or "down" fails.
Those checks have no HTTP status (UptimeRobot does not give one), and their
latency is UptimeRobot's last response time.

| Id | Name | Component | Severity | Asked by | What passes |
| --- | --- | --- | --- | --- | --- |
| `outside-dns-probe` | Monitor can reach the internet | dns | sev4 | Monitor | Run first. One DNS-over-HTTPS lookup of `example.com` (a name that is not ours) at Google's resolver, or Cloudflare's if Google's does not answer properly, comes back with an address. See "Telling a blind monitor from a down site" below |
| `uptime-service` | Uptime service reports every page | public-site | sev3 | Monitor | One read of UptimeRobot's results (`api.uptimerobot.com`, with a read-only key) is answered, and every one of the 12 page monitors is there under its exact name, watches the right address, and is "up", "seems down" or "down". Fails, naming the pages, when the key is missing, UptimeRobot cannot be read, or a monitor is missing, paused, not checked yet or watching another address. Such a page files no check of its own in that run |
| `public-home` | Home page | public-site | sev1 | UptimeRobot | UptimeRobot's monitor `public-home` (`https://diamondecho.com/`) is "up" |
| `public-page-agents`, `-about` | Advisory, About pages | public-site | sev2 | UptimeRobot | The monitor of the same name is "up" |
| `public-page-podcast`, `-privacy`, `-terms` | Podcast, Privacy, Terms pages | public-site | sev3 | UptimeRobot | as above |
| `public-www-redirect` | www address redirects to the site | public-site | sev2 | Monitor | `www.diamondecho.com/about` answers 301 to `https://diamondecho.com/about` (Cloudflare answers a redirect before its bot check) |
| `search-page` | Property search page | search | sev2 | UptimeRobot | The monitor `search-page` (`/search`) is "up" |
| `calculators-deal-page`, `-mortgage-page`, `-net-sheet-page` | Calculator pages | calculators | sev2 | UptimeRobot | The monitor of the same name is "up" |
| `calculators-api-analyze` | Deal analysis service returns the reference figures | calculators | sev2 | Monitor | One fixed fix-and-flip sent to `POST /api/v1/deals/analyze`; the answer carries a formula version and a profit of exactly 44,800.00 |
| `inquiry-page` | Contact page | inquiry | sev2 | UptimeRobot | The keyword monitor `inquiry-page` (`/inquire`) is "up": the page loaded and contains the text `de-inquiry-submit`, the request form's send button |
| `inquiry-preflight` | Inquiry form is allowed to send from the website | inquiry | sev2 | Monitor | The browser's permission question (`OPTIONS`, the *CORS preflight*) for the form is answered yes for `https://diamondecho.com`, POST and the form's headers |
| `inquiry-route` | Inquiry route exists | inquiry | sev2 | Monitor | `GET /api/v1/inquiries` answers 405 "POST only": the route is there |
| `inquiry-queue` | Inquiry queue is switched on | inquiry | sev2 | Monitor | `GET /api/v1/inquiries/staff` without sign-in answers 401 (a 503 "not configured" means the queue is off; the body is read only for a 503) |
| `api-health` | API is up | api | sev2 | Monitor | `/health` says ok |
| `api-identity` | API identity | api | sev2 | Monitor | `/api/` names the DiamondEcho API; reports the revision and commit when the API publishes them |
| `api-cors-allowed` | API accepts calls from the website | api | sev2 | Monitor | the identity answer lets `https://diamondecho.com` read it |
| `api-cors-refused` | API refuses calls from other sites | api | sev3 | Monitor | the same question from an unknown site gets no permission |
| `staff-home` | Staff site loads | staff-site | sev2 | UptimeRobot | The monitor `staff-home` (`https://staff.diamondecho.com/`) is "up". Its protection headers are no longer checked here (see below) |
| `staff-api-auth` | Staff API asks for sign-in | staff-site | sev2 | Monitor | 401 without sign-in, `no-store`, readable by the staff site only; a 200 is reported as a security incident. The answer's body is never read |

SLIs: page checks count toward `public-availability` and `public-latency`
(the search page too); calculator page checks toward `calculators-availability`;
inquiry checks toward `inquiry-availability`; `api-health` and `api-identity`
toward `api-availability` and `api-latency`, and the deal analysis call toward
`api-availability` (an API failure is counted once, as an API outage, not
again as a calculator outage; the calculator pages themselves still load);
staff checks toward
`staff-availability`. The CORS and redirect checks and `uptime-service` feed
no SLO. A check read from UptimeRobot counts toward the same SLIs as when
the monitor made it, so the error budgets and the status page work as before.

A fast run makes 11 requests, one at a time with a pause between them: 1 to
an outside DNS resolver, 1 to the www address, 1 to UptimeRobot and 8 to the
API. Two are POSTs: the reference calculation, and the read of UptimeRobot's
results (its API is asked with POST; the key can only read). Over a day that
is about 2,300 API requests, if GitHub runs every scheduled time. The monitor
sends nothing to a page of the site or the staff site
(`synthetic-checks.test.mjs` holds it to that).

#### Checks the monitor no longer makes

These were made while the monitor loaded the pages itself. Bot Fight Mode
refuses the page they need, and UptimeRobot's plain "does it load" monitors
cannot do them. They are **not checked by the monitor any more**. This is a
known gap, not a pass:

| Id | What it proved | What covers it now |
| --- | --- | --- |
| `public-not-found` | An unknown address answers 404 (launch audit finding F6) | Nothing on a schedule |
| `public-asset-js`, `public-asset-css` | The script and stylesheet the home page names load | Nothing directly. UptimeRobot loads the page's HTML only |
| `edge-hsts` | The home page sends the HSTS header | Nothing in the SRE monitor |
| `edge-no-analytics-beacon` | Cloudflare's analytics beacon is not in the home page | Nothing in the SRE monitor |
| The three headers of `staff-home` (`no-store`, `default-src 'none'`, `X-Frame-Options: DENY`) | The staff page is never stored, loads nothing from elsewhere, cannot be framed | `scripts/staging-smoke.mjs` and the security scan's live header check |
| The build commit in `public-home` (from `/version.json`) | Which commit the live site was built from | The post-merge check reads Cloudflare Pages' own build result ([release-safety.md](release-safety.md)) |

The page test itself is weaker too. The monitor used to ask for 200, HTML,
the page's own canonical address and a heading (the empty app shell has
neither), and for the Georgia MLS frame on `/search`. An UptimeRobot HTTP(s)
monitor only says whether the page answered. Only `inquiry-page` looks for a
piece of text. So a page that answers but comes back empty would pass, except
on the contact page.

All of these come back when the monitor loads the pages itself: set
`SRE_PAGE_SOURCE=direct` (see `PAGE_SOURCES` in
`scripts/sre/synthetic-checks.mjs`). That is for a run from a network
Cloudflare lets through. GitHub's runners are not one. In that mode
`checks/uptime.mjs` files nothing, so no page is reported twice.

### Telling a blind monitor from a down site

Every other fast check the monitor makes itself looks at our own hosts (the
read of UptimeRobot aside). When the GitHub runner's own
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

The monitor's own checks above, once, after a merge to `main`. It does not
read UptimeRobot: a verdict up to five minutes old says nothing about a build
that just went live. So the post-deploy suite contains no page check. The
pages of a new build are seen by UptimeRobot within about five minutes and
reach the normal 5-minute monitor ([release-safety.md](release-safety.md)).

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
  SLO; the same goes, when the monitor loads the pages itself, for the script
  and stylesheet checks when the home page gave nothing to read them from.
  The checks that ran keep their result, so
  a site that swallows every connection still shows as a failed sev1 home
  page, not as a monitor fault.
- **When a check module itself breaks.** The runner loads the eleven modules
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
| Signing in to the staff site | It needs a real staff account and second factor; the monitor holds no staff secret | `staff-home` and `staff-api-auth` prove the door is there and locked |
| Searching inside the Georgia MLS frame | It is Georgia MLS's service and data; scripted searches against it are not ours to make | One hourly GET of its search page (`search-idx-provider`); that our `/search` page loads (`search-page`) |
| What is inside a page: its heading and canonical address, the search frame, the script and stylesheet, the 404 page, the HSTS header, the analytics beacon, the staff page's headers | Bot Fight Mode refuses the monitor on every page, and UptimeRobot's monitors only say whether a page loads | See "Checks the monitor no longer makes" above |
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
section below, because Cloudflare's bot protection could refuse Google's
checkers too.

## Bot Fight Mode refuses the monitor, so an uptime service loads the pages

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

**The decision (Gbenga, 2026-11-14).** Bot Fight Mode stays on for the zone.
On the Free plan a custom rule cannot skip Bot Fight Mode, so the earlier
plan (a Cloudflare custom rule that let the monitor's User-Agent past the
browser check) is withdrawn. Nothing in Cloudflare is changed for the
monitor.

**What is done instead.**

- **UptimeRobot loads the pages.** It is an outside uptime service on
  Cloudflare's list of verified bots, which Bot Fight Mode lets through. It
  has 12 monitors, one per page, each loading its page every 5 minutes, and
  each **named exactly after the check id**: `public-home`,
  `public-page-agents`, `public-page-about`, `public-page-podcast`,
  `public-page-privacy`, `public-page-terms`, `search-page`,
  `calculators-deal-page`, `calculators-mortgage-page`,
  `calculators-net-sheet-page`, `inquiry-page` (a keyword monitor that looks
  for `de-inquiry-submit`) and `staff-home`. Gbenga creates them: the steps
  are item 1.1 of [needs-from-gbenga.md](needs-from-gbenga.md).
- **The monitor reads the verdicts.** `scripts/sre/checks/uptime.mjs` (fast
  suite only) sends one request to
  `https://api.uptimerobot.com/v2/getMonitors` with a **read-only** key, the
  GitHub secret `UPTIMEROBOT_API_KEY`. The key can read results and change
  nothing; it is never printed or filed. Each monitor's verdict is filed
  under that check's own id, component, severity and SLIs, so incidents,
  error budgets and the status page work unchanged.
- **What each verdict becomes.** "Up": the check passes. "Seems down" or
  "down": the check fails. Paused, not checked yet, missing, or watching
  another address: no check is filed for that page (nothing was measured),
  and `uptime-service` fails and names the page. `uptime-service` also fails
  when the key is missing or UptimeRobot cannot be read; then no page check
  is filed at all. The runbook is
  [monitoring-is-blind.md](runbooks/monitoring-is-blind.md).
- **A second way of being told.** UptimeRobot can email Gbenga directly from
  its own alert contact. That does not pass through GitHub, so it still
  works when the monitor does not.
- **The switch.** `SRE_MONITOR` = `enabled` is set after UptimeRobot and the
  key are set up (the last step of item 1.1). On a pull request the key is
  not given to the preview run, so the preview shows `uptime-service` as not
  set up and no page results.

**When the uptime service cannot be read (a known limitation).** A page
check that is not filed keeps its last result for 20 minutes. After that it
is stale and is ignored. The status page does not then say "unknown" for
every part, because each part but one still has fresh checks the monitor
makes itself:

- **Website:** once the `uptime-service` failure is confirmed (three runs in
  a row for a sev3), it shows "degraded" and a sev3 incident opens saying
  the pages are not being watched. Its other fresh check is
  `public-www-redirect`.
- **Search:** it has no other 5-minute check, so it drops off or shows
  "unknown".
- **Calculators, Inquiry form, Staff site:** they show only what their API
  side says (`calculators-api-analyze`; the inquiry route checks;
  `staff-api-auth`). **During that time "operational" for these three means
  the API side only.** Nobody is checking that the calculator pages, the
  contact page or the staff home page load.

**Said plainly, not measured:**

- Whether UptimeRobot's Free plan terms allow a business website should be
  confirmed by Gbenga when signing up. Reports from 2025 and 2026 conflict.
- The Free plan checks every 5 minutes, from UptimeRobot's own locations.
- Nobody has yet seen UptimeRobot's monitors pass against this site. That
  Cloudflare lets it through rests on its place on the verified-bot list;
  step 3 of item 1.1 is where it is confirmed.

**If Cloudflare still refuses something.** The monitor's only requests to
Cloudflare are now the redirects (`public-www-redirect`, and
`edge-http-redirect` and `edge-www-redirect` in the hourly and post-deploy
suites). If one meets Cloudflare's own refusal page, its detail starts
"Cloudflare refused the request" and points to
[cloudflare-outage.md](runbooks/cloudflare-outage.md). A 403 that the site
itself serves (Cloudflare Pages adds Cloudflare's headers to every answer)
is reported as a plain status. If Cloudflare refuses UptimeRobot, UptimeRobot
reports the pages down and the page checks fail as if the site were down:
the same runbook says how to tell the two apart. Google's uptime checkers
may meet Bot Fight Mode too once the Cloud Monitoring tier is applied;
check them after applying ([edge.md](edge.md), item 9).

## Running the checks yourself

```bash
node scripts/sre/synthetic-checks.mjs --suite fast --out /tmp/run.json
node scripts/sre/synthetic-checks.mjs --suite slow --out /tmp/run.json
node scripts/sre/synthetic-checks.mjs --suite post-deploy --out /tmp/run.json --fail-on-failure
```

It prints one line per check and a total, and writes the run document.
Without `UPTIMEROBOT_API_KEY` in the environment a fast run reports
`uptime-service` as not set up and no page results. Do not put the key in a
command line or a file; in the workflow it comes from the GitHub secret.
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
7. A new public page needs a line in `PAGES` in `checks/pages.mjs` (its
   test fails until the page in `frontend/src/lib/pageMeta.js` is listed)
   and a new UptimeRobot monitor named after its check id, which Gbenga
   creates (item 1.1 of [needs-from-gbenga.md](needs-from-gbenga.md)).
   Until the monitor exists, `uptime-service` fails and names the page.
