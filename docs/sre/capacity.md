# Capacity: how much the API can take, and what happens when it is full

Owner: performance and capacity role (an AI role agent). Every number here
says where it was measured. A number that has not been measured says "not
measured" and names the test that would measure it. Nothing here was measured
by load-testing production: that is never done (see
[load-testing.md](load-testing.md)).

## In plain words

The public pages are static files served by Cloudflare. They do not run our
code, so a crowd on the pages costs nothing and does not slow anyone down.

The API (the service behind Deal Studio, the assistant, the inquiry form and
the daily market brief) is different. It runs on Google Cloud Run with these
settings (docs/de13-production-setup.md):

- **Concurrency 1:** each copy of the API (an *instance*) works on one
  request at a time.
- **Maximum 3 instances:** so at most **three requests are being worked on
  at once, across the whole API**. The inquiry form, the calculators and the
  health check all share those three places.
- **Minimum 0 instances:** after a quiet spell Google stops every instance.
  The next visitor waits while one starts (a *cold start*).
- **Timeout 30 seconds:** a request still running after 30 seconds is cut off.

For everyday use this is plenty: the calculation a Deal Studio visitor asks
for takes a few thousandths of a second of the API's time. The API runs out
of room in three ways: a cold start, a long request holding one of the three
places, or more requests arriving at once than three places can take.

## The capacity table

| Question | Answer | Where the figure comes from |
| --- | --- | --- |
| Simultaneous requests the API can work on | **3** (3 instances x 1 request each). A fourth waits for a free instance. | Production settings, docs/de13-production-setup.md |
| Everyday calculations per second, one instance | 287 a second at one at a time; 365 a second with 8 waiting. A Deal Studio analysis takes 1.8 to 5.7 ms (median, by strategy) of one CPU. Cloud Run's CPU is slower than the sandbox's: the same simulation took 5.3 s on staging and 3.9 s in the sandbox. | Sandbox measurement, 2026-11-13 (below). Staging figure: docs/pages-cloud-run-firebase-runbook.md, 2026-10-04 |
| Heavy calculations at once | **3 at most, and then nothing else runs.** One risk simulation (Monte Carlo, a calculation that repeats a deal thousands of times with random changes) can hold an instance for its full 20-second time budget. | Code: `MONTE_CARLO_TIME_BUDGET_SECONDS` default 20. Sandbox: 3 x 5,000 iterations took 18.4 s |
| Cold-start cost | **7.3 s** on staging for the first request after the service scaled to zero. On this machine the API's own start (Python loading the code) took 0.7 to 0.9 s, so most of the 7.3 s is Google starting the container. Production cold start: not measured (none was seen in today's sample). | Staging, 2026-10-04 (docs/pages-cloud-run-firebase-runbook.md); sandbox, 2026-11-13 |
| Where rate limiters cut in | Inquiry: 5 per 10 minutes per sender, 30 per hour per instance (90 an hour with 3 instances). Heavy calculations (scenarios, sensitivity, Monte Carlo together): 10 per 10 minutes per sender, 200 per hour per instance. Property lookup: 20 per 10 minutes per sender, 300 per hour per instance. Everything else (analysis, assistant, market brief, health): **no limit of our own**, only the three places. Counts live in each instance's memory and are lost when it stops. | Code: `backend/inquiries/limits.py`, `deal_intelligence/router.py`, `property_data/router.py` |
| What full looks like | 1. Requests wait in Cloud Run's queue for a free instance: slower answers. 2. If none frees in time, Google refuses the request; its documentation describes this as HTTP 429 "no available instance" (not yet seen on our service). 3. A request over 30 s is cut off (HTTP 504). 4. Our own limiters answer 429 (one sender over its limit) or, on the inquiry route only, 503 "Online requests are busy right now" (the hourly limit). | Cloud Run documentation; code |
| Signals that show it | Cloud Run metrics: instance count pinned at 3; request latency rising; 429, 503 and 504 counts. Our monitor: `api-latency` SLO (95% of probes under 1,000 ms) burning, `calculators-api-analyze` slow or failing. Logs: `httpRequest.status=429` on paths other than the limited ones (that is Cloud Run, not our limiter). | [api-slow-or-saturated.md](runbooks/api-slow-or-saturated.md) |
| Headroom for a marketing spike | Every page view calls the API once for the market brief (the player sits on every page), and once more each 15 minutes while a page stays open. Each Deal Studio "Analyze" press is one call; each assistant question is one call. In the sandbox one instance answered 287 analyses a second, so CPU is not the limit for everyday calls. **The real limits are cold starts** (up to 7.3 s for the first visitors while instances start, one at a time up to 3) **and any long request** holding one of the three places. How many visitors a minute production can take has not been measured. The `staging-spike` scenario would measure it, but needs Gbenga's yes. | Frontend code (`BriefAudio.jsx`, `REFRESH_MS` 15 minutes); sandbox measurement |

## What the visitor sees when the API is full

- **Deal Studio** shows "The analysis could not be completed. Review the
  assumptions and try again." when the API does not answer or answers 429,
  503 or 504. It does **not** calculate on the device in that case. It does
  that only when the API answers with an older formula or rejects a new
  field (read from `frontend/src/pages/InvestmentCalculator.jsx` at commit
  `672aa79`; not tried in a browser). The request has no time limit of its
  own, so the visitor waits as long as Cloud Run takes. The mortgage
  simulator and seller net sheet do not use the API.
- **The inquiry form** shares the same three places. A refused submission
  is not stored and the visitor is asked to call or email.
- **The market brief** section stays empty or keeps its last figures; the
  page itself is unaffected.
- **The assistant** gives an error for that question.

## Routes that hold the worker

The API runs one Python process with one worker, as in the container
(`backend/Dockerfile`: `--workers 1`). Python runs one piece of calculation at
a time. FastAPI handles a route in one of two ways:

- **`async def` routes run on the event loop**, the single line every request
  passes through. While one of them calculates, nothing else in that instance
  moves, not even `/health`. `POST /api/v1/deals/analyze` and
  `POST /api/assistant/chat` are `async def` and calculate on the loop.
- **Plain `def` routes run in a worker thread.** Other requests still get
  answered, sharing the CPU. The three heavy routes (`/scenarios`,
  `/sensitivity`, `/monte-carlo`) are plain `def` on purpose.

Measured in the sandbox (light read routes, one visitor, API pinned to one
CPU core):

| Light reads (health, identity, assistant health, starter assumptions) | Median | 95th percentile | Max |
| --- | ---: | ---: | ---: |
| Alone | 1.2 ms | 1.6 ms | 7.1 ms |
| While 8 visitors press Analyze nonstop (`async def` on the loop) | 18.2 ms | 32.2 ms | 65.4 ms |
| While one 3 x 5,000 Monte Carlo runs (plain `def`, in a thread) | 2.0 ms | 7.2 ms | 50.2 ms |

**What that means at concurrency 1 x 3 instances: today, nothing.** Cloud
Run sends each instance one request at a time, so there is never a second
request in the instance to block. Every route holds its instance for its whole
duration whatever its type. It starts to matter the day concurrency is raised
above 1 (option 4 below): then an analysis or an assistant answer would stall
every other request on its instance for its few milliseconds, and a Monte
Carlo run would share the CPU with them and finish fewer iterations in its 20
seconds. Before raising concurrency, `analyze` and `chat` should become plain
`def` routes (an engineering change with tests), and the change should be
load-tested on staging.

A worst case for the analysis route: a 600-month hold (the largest allowed)
took about 10 ms and returned 109 kB (sandbox, five runs, 9.6 to 13.0 ms).

### A scripted caller can fill the API

The website no longer sends Monte Carlo to the API (Deal Studio runs it in
the browser since DE-25). But the route is public. One sender may make 10
heavy requests in 10 minutes. Three at once hold all three instances for
about 20 seconds, and in that time the inquiry form, the calculators and the
health check all wait. Ten requests is about a minute of a full API per 10
minutes from one address. A sender with many addresses meets only the
per-instance cap of 200 an hour, which is more than an hour's worth of
20-second runs. The response is in
[traffic-spike-or-abuse.md](runbooks/traffic-spike-or-abuse.md); option 6
below would shrink the window.

## Measurements

### Sandbox, 2026-11-13 (this is not production)

Machine: 4-core Intel Xeon at 2.1 GHz. API started with `uvicorn server:app
--workers 1 --no-access-log` from `backend/`, Python 3.12.3 (the container
uses 3.14), pinned to one CPU core with `taskset`, no Firebase, no provider
keys. Load generator on the other cores, commit `672aa79` plus the working
tree of this change. Generator: `node tests/load/loadgen.mjs`. Latency is
from request sent to last byte received, successful requests only.

| Scenario | Requests | Failed | Per second | p50 ms | p95 ms | p99 ms | Max ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `analyze`: one visitor, rental, flip, land in turn | 4,306 | 0 | 287 | 3.0 | 6.8 | 7.4 | 48.6 |
| `analyze-crowd`: 8 visitors at once | 5,480 | 0 | 365 | 20.3 | 32.1 | 41.3 | 79.4 |
| `read-routes`: 2 visitors, light GET routes | 11,998 | 0 | 1,200 | 1.6 | 2.5 | 4.6 | 12.5 |
| `visitor-session`: 6 visitors, 250 ms pauses | 466 | 0 | 23 | 5.6 | 19.7 | 28.5 | 30.1 |
| `spike`: 5, then 50, then 5 arrivals a second | 480 | 0 | 20 | 3.0 | 8.2 | 10.2 | 12.3 |

By route (from the same runs, median): analysis rental 2.9 ms, flip 1.8 ms,
land 5.7 ms; assistant question 3.9 to 4.1 ms; health 1.7 ms.

Heavy routes, once each, one at a time (`heavy-local`): scenarios (3 cases)
58 ms; sensitivity 3 cells 11.5 ms, 9 cells 16.4 ms; Monte Carlo 300
iterations 468 ms, 3 x 1,000 3.9 s, 3 x 5,000 18.4 s (all 5,000 finished).

Eight visitors at once on one worker: each waits behind the others, so the
median answer rose from 3.0 ms to 20.3 ms, about 8 times the 2.7 ms each
request takes. That is the queue a single worker forms.

API start to first answer (process start until `/health` answered): 708,
889 and 799 ms in three starts.

### Production, seen from outside, 2026-11-13

A few spaced, read-only requests from the sandbox with curl, at human pace
(the 01:28 to 01:30 UTC set was taken by the previous session of this role,
the 17:37 to 17:38 UTC set by this one). The sandbox reaches the internet
through a proxy, so these times include that detour; they are a sanity check,
not a monitor.

| Request | Count | Fastest | Median | Slowest |
| --- | ---: | ---: | ---: | ---: |
| Home page `https://diamondecho.com/` (whole HTML, 30,234 bytes) | 18 | 236 ms | 295 ms | 605 ms |
| API `/health` | 18 | 118 ms | 212 ms | 259 ms |
| `POST /api/v1/deals/analyze`, reference rental deal, warm | 7 | 166 ms | 218 ms | 287 ms |
| The same, first of each session | 2 | 362 ms (17:37) and 413 ms (01:27) | | |

The two "first" requests were not cold starts (a cold start took 7.3 s on
staging), so an instance was already running each time. Against the SLO
thresholds in `scripts/sre/slo.config.mjs` (website 1,500 ms, API 1,000 ms)
every sample was well inside.

Not measured yet: production cold start; server time per request in
production (Cloud Run's request latency metric shows it; Gbenga's console);
how long a market-brief audio download (about 1 MB, docs/market-brief.md)
holds an instance; the first market-brief request after each scheduled
re-read (it reads eight outside sources, up to 8 s each, and may record new
audio); how full looks on Cloud Run itself (needs a staging run).

## Options, each needs Gbenga's yes

None of these is switched on. Prices change and differ by region, so this
page gives the formula; check the current Cloud Run price list for `us-east1`
(https://cloud.google.com/run/pricing) before deciding. The service template
(`deploy/cloud-run.service.yaml`, `cpu-throttling: true`) bills CPU only while
a request is being handled; whether production matches is in its service
description (Gbenga's console). The existing $25 budget alert covers any of
these.

| # | Option | What it fixes | Cost | Risk |
| --- | --- | --- | --- | --- |
| 1 | **Minimum instances 1** (`--min-instances 1`) | The 7.3 s cold start for the first visitor after a quiet spell, while one instance is enough. | One instance kept idle all month: about 2,592,000 seconds x (idle price per vCPU-second x 1 vCPU + idle price per GiB-second x 1 GiB). Check both idle prices; they are lower than the busy prices. | Low. Reversible in one command. Does not help when the 2nd and 3rd instances start. |
| 2 | **Startup CPU boost** (`--cpu-boost`) | Shortens cold starts by giving extra CPU while an instance starts. How much shorter: not measured; measure on staging. | Extra CPU billed only during startup. | Low. |
| 3 | **More instances** (for example `--max-instances 5`) | More requests at once: 5 places instead of 3. | Nothing while unused; more under a flood. | Medium. The in-memory limits are per instance, so the inquiry ceiling rises to 30 an hour per instance and an abuser can spend more. `limits.py` asks to keep the maximum small. |
| 4 | **Concurrency above 1** (for example 4) | Requests that mostly wait on other services (market brief, podcast list, property lookup, inquiry save) stop holding a whole instance each. | None directly. | Medium to high. Gives nothing for calculations (one Python worker). First make `analyze` and `chat` plain `def` routes, then load-test on staging. A Monte Carlo would finish fewer iterations in its 20 seconds. |
| 5 | **Cache at the edge** (serve the API at an address behind Cloudflare, for example `api.diamondecho.com`) | The market brief and its audio already say "keep for 10 minutes / 1 hour / 1 day", but no shared cache honours that today, so every visitor's browser asks the API. Behind Cloudflare most of those calls would never reach Cloud Run, and Cloudflare's rate limiting becomes available. | Cloudflare Free plan: no charge. Engineering and configuration time. | Medium. A DNS change on the zone that also carries the company email, and CORS and staff-site settings change with the address. |
| 6 | **Tighter heavy-route limits** (for example 3 per 10 minutes per sender, an engineering change) | Shrinks the window in which one sender can fill the API with 20-second simulations. The website does not call these routes. | None. | Low. A script that uses the routes legitimately (none known) is refused sooner. |

Recommendation for Gbenga to weigh, not a decision: options 1 and 6 cost
least for the most visible gain. Option 4 should wait for the code change and
a staging measurement.

## Page weight

`scripts/sre/perf-budget.mjs` checks the built site (`build/`, after `npm run
build`) against `scripts/sre/perf-budget.json`. The budget is today's build
plus 10 percent, measured on 2026-11-13 at commit `672aa79`:

| What | Measured | Limit |
| --- | ---: | ---: |
| All script files, compressed (what a visitor downloads) | 205.8 kB | 227 kB |
| All script files, as stored (what the phone parses) | 661.9 kB | 729 kB |
| All style files, compressed | 26.0 kB | 29 kB |
| Largest prerendered page, as stored (`seller-net-sheet.html`) | 68.5 kB | 76 kB |
| Largest image (`og-image.png`, the link preview picture) | 160.8 kB | 177 kB |
| Everything published, as stored | 1,283 kB | 1,412 kB |

The site ships as one script file of 662 kB, and Vite warns that it is over
500 kB. Splitting it so that each page loads only what it needs would cut
what a first-time visitor downloads; that is an engineering change for
another day, not an incident.

**When the check fails:** first see whether the change can be smaller (a
large library added for one small use is the usual cause). If the growth is
worth it, run `node scripts/sre/perf-budget.mjs --propose` after `npm run
build`, copy only the line that grew into `perf-budget.json`, and say why in
the commit. Never raise every line at once to make a failure go away.

## When to measure again

- After any change to `backend/deal_intelligence/`, `backend/ai/` or the
  Dockerfile: run the load-test workflow ([load-testing.md](load-testing.md)).
- Before changing any Cloud Run setting above: a staging run with
  `staging-gentle` and `staging-spike`, approved by Gbenga.
- Monthly: compare Cloud Run's request latency and instance count with this
  page.
