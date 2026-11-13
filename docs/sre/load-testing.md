# Load testing

A *load test* sends many requests to a copy of the API to see how fast it
answers and where it starts to struggle. The results feed
[capacity.md](capacity.md).

## The rules (enforced in code, not by good intentions)

1. **Production is never load-tested.** The generator refuses
   `diamondecho.com`, every subdomain of it, the production API address, any
   Cloud Run address carrying the production project number, the production
   Cloudflare Pages addresses and every address in `scripts/sre/targets.mjs`.
   There is no flag, setting or environment variable that changes this.
   The refusal is checked when the command starts and again before each
   scenario, and the tests in `tests/load/safety.test.mjs` prove it.
2. **The default target is this machine** (`http://127.0.0.1:8080`). Any
   address that is neither this machine nor a listed staging address is
   refused.
3. **Staging only with Gbenga's yes.** The staging API is accepted only over
   https, only with the flag `--i-have-approval-for-staging` typed on the
   command line, and only under hard ceilings: 5 requests a second, 6 at
   once, 120 seconds, 600 requests. Only the two `staging-*` scenarios fit
   under them. Staging costs money per second of use, so a run is short.
4. **Never the inquiry route, the paid routes or the market brief.**
   `/api/v1/inquiries` (every attempt counts against visitors and reaches the
   staff queue), `/api/v1/properties/*` (RentCast and Mapbox charge per call)
   and `/api/v1/market-brief` (outside sources and paid text-to-speech) are
   refused by name. Only the routes listed in `ALLOWED_ROUTES` in
   `tests/load/safety.mjs` can be requested at all.
5. **The heavy routes run on this machine only**, at most 9 requests per
   scenario, one at a time. Their own limiter refuses the 11th request in 10
   minutes from one address, so run `heavy-local` at most once per 10
   minutes or the rest are 429s.
6. **Redirects are never followed**, so a server cannot send the generator
   somewhere else.

Changing any of these means changing `tests/load/safety.mjs` in a pull
request that Gbenga reviews.

## Run it on GitHub (no setup)

Actions > **SRE load test** > Run workflow. Inputs: the scenarios (default
`standard`) and whether to add the heavy routes. The workflow builds the API
container exactly as CI does, starts it on the runner itself with 1 CPU and
1 GiB (like one Cloud Run instance), runs the generator's tests first, then
the scenarios against `http://127.0.0.1:8080`. The job summary shows the
table; the full JSON is the run's `sre-load-test-…` artifact (kept 30 days).
A second job builds the public site and checks its page-weight budget.

The workflow needs no secret and changes nothing outside the runner.

## Run it on your machine

```bash
# 1. Start the API, one worker as in the container
cd backend && uvicorn server:app --host 127.0.0.1 --port 8080 --workers 1 --no-access-log

# 2. In another terminal, from the repository root
node tests/load/loadgen.mjs --list                      # what scenarios exist
node tests/load/loadgen.mjs                             # the standard set
node tests/load/loadgen.mjs --scenario analyze-crowd --duration 30
node tests/load/loadgen.mjs --scenario heavy-local      # once per 10 minutes at most
```

To imitate one Cloud Run CPU on Linux, start the API with `taskset -c 0` in
front and the generator with `taskset -c 1-3`. Results go to
`tests/load/results/load-result.json` (ignored by git) unless `--out` says
otherwise; `--summary FILE` appends a Markdown table.

Options: `--target`, `--scenario a,b`, `--duration`, `--warmup`,
`--concurrency`, `--rate`, `--timeout-ms`, `--think-ms`, `--max-requests`,
`--label` (where it ran, written into the result), `--no-thresholds`.
`node tests/load/loadgen.mjs --help` lists them.

Exit codes: 0 the run met its thresholds; 1 a threshold was missed; 2 the run
was refused or the tool broke.

## The scenarios

| Id | What it does | Why |
| --- | --- | --- |
| `analyze` | One visitor sends Deal Studio analyses (rental, flip, land) back to back. | What one instance does, one request at a time. |
| `analyze-crowd` | Eight visitors at once against one worker. | Shows the queue a single worker forms. |
| `read-routes` | Health, service identity, assistant health, starter assumptions. | The light routes; the floor for latency. |
| `visitor-session` | Six visitors each ask the assistant, run Deal Studio a few times, ask again, with 250 ms pauses. | A realistic mix in the order the site sends it. |
| `spike` | 5 arrivals a second, then 50 a second for 8 seconds, then 5. Reported per stage. | A sudden crowd. Arrivals keep coming whether or not earlier ones were answered. |
| `heavy-local` | Scenarios, sensitivity and Monte Carlo up to 3 x 5,000 iterations, once each. This machine only. | How long each heavy request holds the worker. |
| `staging-gentle` | Three visitors (one per instance) walking the session with one-second pauses, one minute. | For an approved staging run. |
| `staging-spike` | 1 a second, then 5 a second for 20 seconds, then 1. | For an approved staging run: shows instances starting and cold starts. |

The request bodies in `tests/load/payloads/` are the reference deals the
backend's own tests use. They are illustrative deals, not listed properties.
The assistant questions are general and contain nothing personal.

Two ways of applying load:

- **Closed loop:** a fixed number of pretend visitors, each sending the next
  request only after the previous answer. Answers "how fast with N at once".
- **Open loop:** requests arrive at a set rate regardless, as real visitors
  do. If more than the scenario's limit are already waiting, a new arrival is
  not sent and is counted as `shed`, so a queue the generator would have
  caused is reported, not hidden.

## Reading a result

```json
{ "schema": 1, "tool": "diamondecho-loadgen", "production": false,
  "label": "…", "note": "Measured on …; not a production measurement.",
  "target": { "origin": "http://127.0.0.1:8080", "kind": "local" },
  "started_at": "…", "finished_at": "…", "environment": { "node": "…", "cpus": 4, "cpu_model": "…" },
  "scenarios": [ { "id": "analyze", "requests": 4306, "ok": 4306, "failed": 0, "error_rate": 0,
                   "errors": {}, "throughput_rps": 287.06,
                   "latency_ms": { "count": 4306, "min": 1.2, "mean": 3.5, "p50": 3, "p90": 6.5, "p95": 6.8, "p99": 7.4, "max": 48.6 },
                   "by_step": {}, "by_stage": {}, "thresholds": [], "passed": true } ],
  "passed": true }
```

- **p50, p90, p95, p99** (*percentiles*): p95 is the time 95 out of 100
  answers beat. Each is a time that was really measured (nearest-rank), never
  an average of two. With few requests the high percentiles equal the
  slowest one.
- **Latency counts successful answers only.** Failures are counted beside
  it by kind, so a fast refusal never makes the latency look good.
- **Error kinds:** `http_429`, `http_503`, … (the status the API answered),
  `body` (status 200 with the wrong content), `timeout` (no answer in time),
  `connection` (could not connect), `shed` (open loop: not sent, too many
  already waiting).
- **throughput_rps:** successful answers per second over the time load was
  applied. Warm-up requests are sent but not counted.
- **thresholds:** per scenario, in `tests/load/scenarios.mjs`. Local limits
  are set from the 2026-11-13 sandbox measurement with wide headroom (for
  example p95 100 ms where 6.8 ms was measured) because a shared CI runner is
  slower and noisier. They catch a change that makes a route several times
  slower or starts failing it. They do not police milliseconds.

A result is labelled with where it ran. Never put a sandbox or runner number
in a document without that label, and never present one as production.

## A staging run (only with Gbenga's yes)

1. Gbenga agrees to the run, its time and its cost, in writing (the pull
   request or the Jira issue).
2. Check that staging is on the commit to be measured.
3. Run:
   ```bash
   node tests/load/loadgen.mjs \
     --target https://diamondecho-api-staging-299705773978.us-east1.run.app \
     --i-have-approval-for-staging \
     --scenario staging-gentle,staging-spike \
     --label "staging, approved by Gbenga on YYYY-MM-DD"
   ```
4. Record the result in [capacity.md](capacity.md) with the date, commit and
   label. Set staging thresholds in `scenarios.mjs` from it.

## Tests

```bash
node --test tests/load/*.test.mjs scripts/sre/perf-budget.test.mjs
```

The tests never touch the network: `tests/load/fake-io.mjs` stands in for
the network and the clock, so a 20-second scenario is checked in
milliseconds.
