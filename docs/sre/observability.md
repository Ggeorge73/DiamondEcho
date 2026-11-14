# Observability: what we can see, and what we choose not to

*Observability* means being able to tell, from the outside, what the site is
doing and why. This page says what already exists, what the SRE work adds,
what is deliberately never collected, and where to look during an incident.
How alerts are raised from all this is in [alerting.md](alerting.md).

## What exists today, with no change

| Source | What it shows | Where |
| --- | --- | --- |
| Cloud Run request log | Every API request: time, method, status, latency, address asked for, browser string and the sender's IP address. Google writes it for every Cloud Run service; we did not switch it on and cannot switch it off. | Logs Explorer, log `run.googleapis.com/requests`, service `diamondecho-api` |
| Cloud Run metrics | Requests by status class, latency percentiles, instance count (active and idle), instance start time, CPU and memory. Free and always on. | Monitoring > Metrics explorer, resource "Cloud Run Revision" |
| API output | Whatever the API prints: start-up lines and uvicorn's error report when a request crashes. The uvicorn access log is off on purpose (`--no-access-log` in `backend/Dockerfile`), so normal requests print nothing. | Logs Explorer, logs `run.googleapis.com/stdout` and `stderr` |
| Cloud Trace | Cloud Run can send a sample of requests to Cloud Trace on its own. Whether any appear for this project has **not been checked**. | Trace > Trace explorer |
| Arrival alert | An email to realtor@diamondecho.com when an inquiry is stored. It announces a request; it is not an outage alert. | [DE-31](../de31-inquiry-routing.md), [DE-13](../de13-production-setup.md) |
| Budget alert | An email at 50, 90 and 100 percent of actual spend against the $25 monthly budget, and at 100 percent of forecast. A cost notice. | [DE-13](../de13-production-setup.md) |
| Security scan | Daily, opens a `security-alert` issue when it fails. | [security-operations.md](../security-operations.md) |

The Cloud Run request log holds visitor IP addresses and the full address of
each request. Only people with access to the Google Cloud project can read it;
today that is Gbenga. Nothing in this work copies it anywhere.

The public pages are served by Cloudflare Pages. Cloudflare's Real User
Monitoring was switched off on 2026-10-06 because it added a script the
Privacy page does not allow for ([DE-13](../de13-production-setup.md)), so
the only view of the pages is from outside: the monitor and the uptime checks.

## What the SRE work adds

1. **The GitHub monitor and its memory.** Every 5 minutes (and every hour for
   the slow checks) `scripts/sre/synthetic-checks.mjs` looks at the site like
   a visitor, and `scripts/sre/state.mjs` files the result on the
   `sre-status` branch. That branch is the record the status page, the alert
   engine, the SLO figures and the weekly report all read. See "The state
   store" below.
2. **Request telemetry in the API** (`backend/observability/`), once wired in
   and deployed: one log line for each server error and each slow request,
   and a `Server-Timing` header on every answer. See "Request telemetry".
3. **Google Cloud definitions** in `deploy/monitoring/`, applied by Gbenga
   with `deploy/monitoring/apply.sh`:
   - `log-metrics/`: counts of the telemetry lines, by route (server errors;
     slow requests).
   - `alert-policies/`: an uptime check failing from 2 or more places, the
     uptime checks going quiet, API server errors above 5 percent, API p95
     latency above 2.5 seconds, the API pinned at its 3-instance maximum, a
     certificate within 14 days of expiry. Each policy's text says why its
     numbers are what they are and which runbook to follow.
   - `dashboards/api-and-uptime.json`: request rate, error share, latency
     percentiles, instances, cold starts, the uptime checks, certificate days
     left, and the telemetry counts by route.
   - `uptime-checks/` (synthetic monitoring role) and `slos/` (SLO role).

None of the Google Cloud parts exist until Gbenga runs `apply.sh --apply`
(item 3.3 in [needs-from-gbenga.md](needs-from-gbenga.md)). Without
`--apply` the script prints its plan and changes nothing.

### Cost

Google's pricing page said, when [DE-31](../de31-inquiry-routing.md) was
written, that alerting will be charged no sooner than 1 September 2027, at
$0.35 a month per alert condition. The six policies here have one condition
each. Log-based metrics, uptime checks and PromQL queries have their own
prices and free allowances, which were **not checked** for this document:
read Google's current price list before applying.

## Request telemetry

`backend/observability/` is a small piece of middleware (code that every
request passes through) with no new dependency. It writes **one JSON line to
standard output** only when a request:

- ends in a server error (status 500 to 599), or raises an error the code did
  not handle; or
- takes longer than `OBSERVABILITY_SLOW_MS` (default 1000 ms, the API latency
  threshold in `scripts/sre/slo.config.mjs`).

Each line has: `severity` (`ERROR` or `WARNING`), `message`, `event`
(`request.error` or `request.slow`), `method`, `route`, `status`,
`duration_ms`, `slow_threshold_ms`, the error's type name for a crash, and
Cloud Logging's trace fields when `GOOGLE_CLOUD_PROJECT` is set. `route` is
the route's pattern, such as `/api/v1/inquiries/staff/{inquiry_id}`, never the
address actually asked for. A request that matches no route is logged as
`(no matching route)`.

The trace field ties the line to Cloud Run's own request log entry for the
same request, so in Logs Explorer "show entries for this trace" finds both.

It also adds `Server-Timing: app;dur=12.3` to every answer: how many
milliseconds the API took before it started answering, apart from the network.

**Wiring (not done yet).** `backend/server.py` belongs to the release role.
Two lines, at the end of the file after the existing middleware, so the
telemetry sees everything else:

```python
from observability import RequestTelemetry
app.add_middleware(RequestTelemetry)
```

Then a deploy, with `GOOGLE_CLOUD_PROJECT=diamondecho-prod` added to the
service's settings for the trace link (optional; without it the lines are
still written, just not linked).

## What is deliberately not collected, and why

The Privacy page says DiamondEcho's pages "do not use advertising trackers,
analytics or session recording, and they do not set cookies". The SRE work
keeps that promise and goes no further than it needs:

- **No measurement in visitors' browsers.** No real-user monitoring, no
  analytics script, no beacon. The `edge-no-analytics-beacon` check fails if
  one appears in the home page.
- **Nothing a visitor typed, in any log we write.** The telemetry never
  writes the address as sent, query strings, request or response bodies,
  headers, cookies, IP addresses, browser strings, exception messages or
  tracebacks: any of these can carry a name, an email address or a phone
  number. A test (`backend/tests/test_observability.py`) sends all of them
  and checks none reaches the log.
- **No log line for a normal request.** Cloud Run's request log already has
  one; a second copy would only be a second place to protect.
- **The monitor stores results, not pages.** `status.json` and the history
  keep pass or fail, status code, timing and one short sentence per check;
  never a page body, a header or a full address with a query string.

One gap remains: when the API crashes, uvicorn prints its own error report to
`stderr`, and that report includes the error's message, which in rare cases
could quote input. That was true before this work and is unchanged by it.
Changing it means changing how the server is started (release role).

## The state store

The `sre-status` branch (never merged into `main`), written by
`scripts/sre/state.mjs` and saved by `scripts/sre/state-git.sh`. The shapes
are in `scripts/sre/README.md`; the rules are here.

- **A check counts as failing** for the status page only once it has failed
  as many runs in a row as the alert engine needs to open an incident: 2 for
  sev1 and sev2, 3 for sev3, 6 for sev4. One failed run never changes what
  the page says.
- **A part of the site** (a *component*) is:
  - *outage* when a sev1 check is failing, or every sev1 and sev2 check of it
    is;
  - *degraded* when a sev2 or sev3 check is failing;
  - *operational* otherwise (a sev4 failure is a notice only);
  - *unknown* when none of its checks has a fresh result: older than 20
    minutes for a 5-minute check, 150 minutes for an hourly one.
- **The headline** is the worst real problem; otherwise *unknown* if any part
  has no fresh data; *operational* only when every part was seen working.
- **"Since"** for an outage or degraded part is when its first failing check
  first failed, not when the failure was confirmed.
- **A blind run** is one where the monitor reached nothing at all, not even
  outside services that do not touch our hosts (`outside-dns-probe` in the
  5-minute suite; the Georgia MLS search, the public DNS resolvers and the
  domain registry in the hourly suite). That is the monitor's network, not
  the site. It is kept in the history as a line with no results, so it
  counts against no check and no SLO, and the alert engine opens a
  "Monitoring cannot see the site" incident if it happens twice in a row.
  Until `outside-dns-probe` is in the 5-minute suite, a 5-minute run is
  never called blind.
- **Cloudflare refusing the monitor.** When every failing check on the parts
  Cloudflare serves was refused by Cloudflare (or not made because its page
  was), those checks are left out the same way: the history line keeps only
  the rest and notes `"refused": N`, and the page shows the last measured
  result until it goes stale. See [alerting.md](alerting.md).
- **Deploys.** When a check reports a different `revision` or `commit` than
  last time, a line goes into `deploys.jsonl`. The first sighting is not a
  deploy, and a failed check that could not read the facts does not erase
  them. The automatic rollback uses these lines to know what served before.
- **Retention.** History day files and the day-by-day uptime are kept 400
  days, then deleted. A check not seen for 7 days is dropped (it was removed
  from the monitor).
- **Two writers at once.** The workflows share one concurrency group, so this
  is rare. If it happens, `state-git.sh` rebases: lines added to `*.jsonl`
  files by both runs are all kept; for whole files (`status.json`,
  `incidents.json`) the newer run's copy wins, and the log names the file.
  It retries five times and never touches `main`.

`SRE_NOW` (an ISO time) replaces the clock in every one of these scripts, so
`scripts/sre/fire-drill.mjs` and the tests can replay days in seconds.

## Where to look during an incident

In this order; stop when you have the answer.

1. **The incident issue** (label `sre-incident`): what fails, since when, the
   runbook to follow.
2. **The status page**: what visitors are being told.
3. **The latest monitor run**: GitHub, Actions, "SRE monitor", the newest run,
   its summary. Or, from a clone:
   ```bash
   git fetch origin sre-status && git show origin/sre-status:status.json | head -n 60
   ```
4. **Cloud Run** (Gbenga): Monitoring > Dashboards > "DiamondEcho SRE: API
   and uptime" once applied; until then Cloud Run > diamondecho-api >
   Metrics.
5. **The telemetry lines** (Gbenga): Logs Explorer, with
   ```
   resource.type="cloud_run_revision"
   resource.labels.service_name="diamondecho-api"
   jsonPayload.event=("request.error" OR "request.slow")
   ```
6. **The crash report** (Gbenga): the same, with `severity>=ERROR` and log
   `run.googleapis.com/stderr`. It may quote input: do not copy it into an
   issue or chat.
7. **What deployed recently:**
   ```bash
   git show origin/sre-status:deploys.jsonl | tail -n 5
   ```

Never paste a log line from Google Cloud into GitHub or chat without reading
it first: the request log holds visitor IP addresses.
