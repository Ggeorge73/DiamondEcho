# Chaos experiments and game days

Things break. This page is about breaking them on purpose, in a safe place,
so we learn how the site behaves before a visitor finds out. It has two
halves:

- **Automated experiments** run by themselves every week inside GitHub's
  runner. They never touch the live site.
- **Game days** are rehearsals on the real service, such as rolling back a
  deploy or restoring the database. Each needs a person, Gbenga's yes and a
  quiet hour. None has been run yet: `docs/de13-production-setup.md` records
  rollbacks and the backup restore as **not rehearsed**.

Written by the SRE chaos role (an AI collaborator). Nothing here was tested
or approved by a person unless it says so.

## Principles

1. **Smallest blast radius.** Break one thing, on the smallest copy that
   shows the effect: a test, then a local process, then staging, and
   production only for a rehearsed game day.
2. **A stop button.** Every experiment has an abort condition and a time
   limit, and stops on its own when either is reached. Every game day has
   an undo that was written down and read through before starting.
3. **A hypothesis first.** "The inquiry route answers 503 within 5 seconds
   when Firestore is down" can be proved wrong. "Let's see what happens"
   cannot.
4. **Never in production without Gbenga's yes and a quiet hour.** No load,
   no submitted inquiries and no calls to the paid property routes, ever.
   The automated experiments run on 127.0.0.1 inside the runner.
5. **Write it down.** Every result is kept as JSON. A weakness gets a file,
   a line, a proposed fix and a test that fails the day it is fixed.

## What runs every week

`.github/workflows/sre-chaos.yml` runs on Wednesdays at 09:41 UTC and by
hand (Actions, "SRE chaos and resilience", Run workflow). It needs no secret
and no setting. It runs four things and keeps their records for 30 days as
an artifact:

| Step | What it breaks | Where |
| --- | --- | --- |
| Runner tests | The safety rails of the two tools below | `tests/chaos/run.test.mjs`, `scripts/sre/fire-drill.test.mjs` |
| Dependency failures | Firestore, Google sign-in, storage, RentCast, Mapbox, FRED and the voice failing, hanging or answering nonsense; broken and oversized request bodies | `backend/tests/test_resilience.py` (no network) |
| Chaos experiments | The real API process: killed, stopped, starved, flooded, cut off from its dependencies | `tests/chaos/run.mjs`, on 127.0.0.1 |
| Fire drill | The monitoring pipeline, with hours of made-up monitor runs | `scripts/sre/fire-drill.mjs`, in a temporary folder |

To run them on your own machine (Python 3.12 with `backend/requirements.txt`
installed):

```bash
python -m pytest backend/tests/test_resilience.py -q -rxX
CHAOS_PYTHON=python node tests/chaos/run.mjs --out chaos.json      # about 2.5 minutes
node scripts/sre/fire-drill.mjs --out drill.json                    # about 40 seconds
node tests/chaos/run.mjs --list                                     # the experiments
node scripts/sre/fire-drill.mjs --list                              # the scenarios
```

### How a known weakness is tracked

A weakness that is found is not fixed from the test files. It is written
down (below) and tracked:

- in `test_resilience.py` as a test marked `xfail` (an expected failure)
  with `strict=True`, whose reason names the file, the line and the fix;
- in the frontend as a `test.fails` test in a `*.resilience.test.jsx` file;
- in a chaos experiment as a check marked `known`.

While the weakness is there, these pass. **The day it is fixed, they fail
the run on purpose**, so the mark is removed and the fix stays protected by
an ordinary test.

## The chaos experiments

`tests/chaos/run.mjs` starts the real API from `backend/` through
`tests/chaos/serve.py`, the way the Dockerfile does (uvicorn, one worker),
on 127.0.0.1. `serve.py` refuses every outbound connection and name lookup,
so the process can reach nothing outside the machine. The process gets an
environment built from nothing: no key, token or sign-in of the person or
runner starting it. Google's libraries are pointed at addresses that refuse
at once. This is a second fence, because gRPC opens its own sockets.

The runner refuses any address that is not 127.0.0.1. A staging run needs
`--staging <address> --approved-by-gbenga`. It runs only the experiment
marked safe for a deployed service (the heavy-route burst, whose requests
are refused by validation and so calculate nothing). It refuses every
production address even with the flag. Exit codes: 0 every hypothesis held;
1 one failed, was aborted, or a known weakness is no longer seen; 2 the
runner broke.

Results below were measured on 2026-11-13 in the SRE agents' sandbox
(Linux, 4 processors, Node 22, Python 3.12), on 127.0.0.1. They describe how
the code behaves, not Cloud Run's speed. Each figure comes from one run. The
two `dependencies-` rows were measured again the same day after the W1 and W2
fix (same kind of sandbox, Python 3.13), three runs each; ranges are shown.

| Experiment | Hypothesis | Blast radius | Abort | Result |
| --- | --- | --- | --- | --- |
| `kill-mid-request` | When the process dies (SIGKILL) during a long calculation, the caller is told at once and a fresh process answers within 15 s | One local process and one request | No `/health` in 30 s; 60 s limit | **Held.** Caller saw the connection close 12 ms after the kill; restart to `/health` 0.93 s |
| `sigterm-mid-request` | On SIGTERM (Cloud Run's 10 s warning) a running calculation finishes and the process exits inside the 10 s | One local process; 5 s calculation budget | No `/health` in 30 s; 45 s limit | **Held.** Answered 200 in 5.2 s; exited 4.1 to 4.3 s after SIGTERM. See finding O2 for production's 20 s budget |
| `kill-during-burst` | Killing the process under 8 parallel request loops gives each caller a 200 or a prompt connection error, never a wrong answer or a hang | One local process, about 600 cheap analysis requests | No `/health` in 30 s; 60 s limit | **Held.** 583 sent, 575 answered 200, 8 connection errors, slowest 63 ms; restart 1.04 s |
| `dependencies-refused` | With every dependency refusing, the API starts, `/health` and the calculators answer, and every dependent route answers its documented 502/503 in JSON within 2 s | One local process, every feature on against a demo project | No `/health` in 30 s; 60 s limit | **Held.** Started in 0.93 s; all 9 dependent routes answered cleanly within 2 s; the only outbound attempts (RentCast, Mapbox) were blocked |
| `dependencies-hang` | When every dependency accepts connections and never answers, each route gives up on its own deadline under 25 s and `/health` stays under 2 s | One local process and one local silent port | 75 s limit | **Held** since the W1 and W2 fix. `/health` slowest 47 ms. Inquiry submit 503 in 5.0 s; staff routes and the podcast list 503 in 10.0 to 10.1 s; market brief and its audio 5.0 s and 10.0 s (whichever waits second for the brief's lock); property routes 502 in 8.0 s. Before the fix the staff routes (W2), market brief, its audio and the podcast list (W1) gave no answer within 35 s |
| `dependencies-refuse-at-call-time` | Same, with every dependency refusing each call after start | One local process; a closed local port | 75 s limit | **Held** since the W1 fix. Inquiry submit 503 in 7.3 to 8.9 s (before: **54.3 s**), market brief 4.6 to 7.1 s, podcast list 4.1 to 8.5 s (the retry waits are random), the brief's audio 10.1 to 16.0 s (it waits behind the brief request for the same lock); staff and property routes within 50 ms. Before the fix inquiry submit, market brief and podcast list gave no answer within 35 s |
| `busy-worker` | With 10 of the largest simulations running at once (one sender's whole allowance) under the production 20 s budget, `/health` stays under 2 s, each simulation ends inside 30 s, an 11th gets 429 | One local process and this machine's CPU for about 25 s | No `/health` in 30 s; 70 s limit | **Held.** Simulations took 20.6 to 20.9 s; `/health` slowest 458 ms; everyday analysis 144 ms; 11th refused with 429 |
| `inquiry-burst` | A sender's 6th inquiry in 10 minutes gets 429 with Retry-After and no-store; waiting that long lets them back; rotating senders are held at 30 per hour with a 503; nothing refused is stored | One local process with an in-memory queue and a stepped limiter clock. **Local only, never a deployed service** | 45 inquiries at most; 60 s limit | **Held.** Retry-After 600 s, honest to the second; held at exactly 30 per hour; 31 stored for 31 admitted |
| `heavy-route-burst` | The three heavy routes share 10 per 10 minutes per sender; the 11th gets 429 on all three; analysis and `/health` unaffected; Retry-After is honest | One local process (or staging with approval) | 45 s limit | **Held.** Retry-After 600 s on all three |

## The fire drill

`scripts/sre/fire-drill.mjs` replays made-up monitor runs through the real
pipeline in a temporary folder: `state.mjs record`, `slo-calc.mjs`,
`alert.mjs --slo` and `remediate.mjs`, in the order of
`.github/workflows/sre-monitor.yml`. `SRE_NOW` is set to the simulated time,
so hours replay in seconds. The runs are built with `lib/schema.mjs` from the
real suites' check names. Nothing can reach production:

- `alert.mjs` and `remediate.mjs` run without `--apply`, with an environment
  built from nothing (no GitHub token, no webhook);
- the only `gcloud` they can find is the release role's fake
  (`scripts/sre/cloudrun/fakes/gcloud.mjs`). It answers from a file, logs
  every call, and the drill fails if anything but a read was asked;
- `SRE_NOW` being set already keeps `remediate.mjs` from acting.

It also compares every file the commands write with the shapes in
`scripts/sre/README.md` and lists each difference.

| Scenario | What it shows (2026-11-13: all 11 passed) |
| --- | --- |
| `site-down-and-recovers` | No incident on the first failed run; one sev1 Website incident on the second; one, not more, while it lasts; one good run is not a recovery; closed after three (35 minutes); the day's bar counts the 6 failed runs; no rollback |
| `single-blip` | One failure: no incident, the page stays operational |
| `flapping` | Failing every other run never makes two in a row. The error-budget rule opens a sev2 budget incident first (13:30); 10 minutes later the on-and-off rule takes it over as a sev3 API incident on the same issue. One issue in all; closed when it settles |
| `api-fails-after-deploy` | The new revision is recorded. The first look writes only a plan ("pending confirmation"). The next failed run proposes a rollback to the revision seen before, **as a dry run**. Cloud Run was only read (4 read calls) |
| `api-fails-without-deploy` | Incident, no rollback; reason "no recent deploy". One cause opened two incidents (API sev2, calculators sev3) |
| `monitor-network-fails` | Every check without an answer: no site incident, nothing counted against the SLOs, one sev3 "monitoring" incident after two runs, closed when the monitor sees again |
| `cloudflare-refuses-monitor` | Cloudflare answering the monitor with its refusal (seen for real once) while the API answers: no site incident, no outage on the page, nothing counted; one sev2 monitoring incident after two runs; closed when the pages answer |
| `slow-burn` | One failure in six for 3 hours: no ordinary incident; the 6-hour burn rule (11.1 times the budget rate) opens one budget incident |
| `fast-suite-stops` | The hourly run notices the five-minute checks stopped and opens a sev3 monitoring incident; closed when they resume |
| `monitor-stops-six-hours` | Nothing can be written while nothing runs (that old time is how the status page knows to say stale). On resuming no incident is invented and only measured runs are counted. Telling a person during the gap needs the Google Cloud uptime checks (`docs/sre/alerting.md`) |
| `certificate-nearing-expiry` | (time compressed: each hourly run stands for a later day) one TLS incident at sev3 on the third failing run, raised to sev2 under 7 days and sev1 under 2, closed after renewal |

## Weaknesses found

Most serious first. The open ones are tracked by tests as described above.
W1, W2, W4, W5 and W8 are fixed (see [Fixed](#fixed) below). O1 to O5 are
observations that need a decision rather than a fix.

| | What happens | Where | Proposed fix | Tracked by |
| --- | --- | --- | --- | --- |
| **W3** | A body containing the bare word `NaN` or `Infinity` makes every public POST route answer 500 and log a stack trace. Anyone can raise the 5xx rate at will | `backend/server.py`, where `app = FastAPI(...)` is created (no handler) | A `RequestValidationError` handler answering 422 from `exc.errors(include_input=False, include_context=False)` | `test_a_body_with_nan_or_infinity_is_refused_with_a_422` |
| **W6** | No route limits the body size, and the 422 answer echoes the input: a 3 MB message comes back as a 3 MB 422 | `backend/server.py` (`protect_staff_surface`) | Refuse a Content-Length above about 64 KiB with 413, and drop the echoed input (the W3 handler) | `test_an_oversized_body_is_refused_with_a_short_answer` |
| **W7** | The inquiry form sends with no time limit; a stalled connection leaves "sending" on screen with no advice | `frontend/src/components/InquiryForm.jsx:93` | `timeout: 35000` on the request; the existing message and same-key retry then apply | `InquiryForm.resilience.test.jsx` (`test.fails`) |
| **W9** | When sending fails, the inquiry alert says to retry but offers no phone or email (with the form open the page shows only the form) | `frontend/src/components/InquiryForm.jsx:149` | One line in the alert with the office phone and email links | `InquiryForm.resilience.test.jsx` (`test.fails`) |
| **W10** | Deal Studio shows "Request failed with status code 504" for a platform error page | `frontend/src/lib/dealValidation.js:254` | Plain words for a 5xx with no `detail`: "The analysis service is not answering right now, so nothing was calculated." | `InvestmentCalculator.resilience.test.jsx` (`test.fails`) |
| **W11** | Failed staff podcast answers carry no `Cache-Control: no-store` | `backend/server.py` (`protect_staff_surface`, last lines) | Include `/api/v1/podcast/staff` in the no-store condition | `test_failed_staff_podcast_answers_are_never_stored_by_a_browser` |
| **W12** | RentCast answering an object instead of a list gives 404 with the detail `0` | `backend/property_data/service.py:83`; `router.py:40` | Raise a provider error unless the payload is a list of objects | `test_rentcast_answering_an_object_instead_of_a_list_is_a_502` |
| **W13** | An empty RentCast record (`[{}]`) is shown as a found property | `backend/property_data/service.py:83-99` | Treat a record with no id and no address as not found | `test_an_empty_rentcast_record_is_not_presented_as_a_found_property` |
| O1 | With the API down, Deal Studio's base analysis says "could not be reached, so nothing was calculated". It does **not** calculate on the device, though the same engine is there. It falls back only for an older formula or a refused field. The SRE brief and the wording in de13 suggest a wider fallback | `frontend/src/pages/InvestmentCalculator.jsx:799-818` | Gbenga's decision: keep it (and correct the descriptions) or fall back on 5xx and no answer as well | `InvestmentCalculator.resilience.test.jsx` pins today's honest behaviour |
| O2 | uvicorn waits without limit for running requests on SIGTERM. A 20 s simulation that starts less than 20 s before Cloud Run stops an instance can be cut by SIGKILL after the 10 s grace. The browser simulator does not use this route | `backend/Dockerfile` (`CMD`) | Acceptable today; if scripted callers matter, a shorter budget or `--timeout-graceful-shutdown 8` | chaos `sigterm-mid-request` (with 5 s budget) |
| O3 | One API outage opens two incidents (API sev2, calculators sev3), as the per-part design says | `scripts/sre/alert-policy.mjs` | Decision for the observability role: fold a calculators incident whose only failing check calls the API into the API incident | fire drill `api-fails-without-deploy` |
| O4 | While flapping, a sev2 budget incident opens first and is then followed in a sev3 incident: the severity steps down | `scripts/sre/alert-policy.mjs` (`judgeBudgets`) | Decision for the observability role: keep the higher severity when one incident takes over another | fire drill `flapping` |
| O5 | The submission limits live in each process's memory: a restart or a new instance clears them, and a sender who rotates addresses can use up an instance's 30 per hour, so real visitors are told to call for up to an hour | `backend/inquiries/limits.py` (documented there) | As that file says: a challenge at the form if it happens | chaos `inquiry-burst` |

### Fixed

Fixed on 2026-11-13 by the engineering role (an AI collaborator), measured in
its sandbox, not on Cloud Run. Each test named here was the weakness's
`xfail` and is now an ordinary test, so the weakness cannot come back
unnoticed. All deadlines live in `backend/deadlines.py`.

| | What happened | What changed | After the fix | Protected by |
| --- | --- | --- | --- | --- |
| **W1** | Firestore calls passed only `timeout=5` or `10`, which bounds one attempt, and kept the client's default retry, which gives each new attempt the full timeout again. Against an unreachable database a read gave up after 293 s, a query after 259 s, a write after 57 s; an inquiry submission answered 503 after 54 s, so on Cloud Run the visitor got the platform's 504 at 30 s | Every call in `inquiries/firebase.py`, `market_brief/service.py`, `podcast/service.py` and `server.py` also passes `retry=FIRESTORE_RETRY` (`Retry(timeout=10)`): transient errors are retried for 10 s in all, and an attempt that timed out is not retried. Found while fixing it: the staff acknowledgement runs a Firestore transaction whose begin and commit calls take no `retry=` (60 s each by default), so `acknowledge` now waits 10 s at most for the whole transaction and answers "not confirmed" | Chaos, three runs, database refusing: inquiry submit 503 in 7.3 to 8.9 s, market brief 4.6 to 7.1 s, podcast list 4.1 to 8.5 s, the brief's audio up to 16.0 s (behind the brief, see above). Database hanging: 5.0 to 10.1 s | `test_firestore_calls_give_up_in_total_not_only_per_attempt`, `test_the_inquiry_replay_read_gives_up_in_total_too`, `test_the_status_routes_give_up_in_total_too`, `test_a_staff_acknowledgement_that_hangs_is_not_confirmed_within_its_deadline`; chaos `dependencies-hang`, `dependencies-refuse-at-call-time` |
| **W2** | The staff sign-in check used the Firebase SDK's default 120 s HTTP timeout | The Firebase app is started with `httpTimeout` 5 s. The SDK retries a timed-out request once and may first fetch Google's public keys, so the worst case is about 15 s | Chaos, sign-in hanging: staff routes 503 in 10.0 s | `test_the_staff_sign_in_check_has_a_deadline_inside_the_request_timeout`; chaos `dependencies-hang` |
| **W4** | The first build of a day's brief ran the tour voice, up to three mortgage reads and the market voice one after another inside a visitor's request: about 64 s with slow providers | The sources get 10 s in all (`sources.COLLECT_SECONDS`); a source still being read then is listed as not read. The voice is waited for until 15 s after the request began (`BUILD_SECONDS`), and the tour's voice speaks while the figures are read. A voice still speaking then finishes in the background: that visitor gets the figures without audio, and the first visit after it has finished gets the audio without paying for it again | Unit tests with both deadlines shrunk: a voice that does not answer, and a mortgage source that hangs, are both cut off on time | `test_the_slowest_possible_brief_still_fits_inside_the_request_timeout` (now times a real build instead of adding up per-call timeouts, which no longer describe it), `test_a_source_that_hangs_is_left_out_when_the_time_for_the_sources_is_up` |
| **W5** | A finished brief whose Firestore write failed answered 503, and every later visit paid for the voice again | `_keep` catches the write error and serves the brief from that instance's memory for the rest of the day. It is not stored, so another instance or a restart pays for the voice once more | Three visits with writes failing: three 200s with audio, two voice calls (the tour and the day's brief) | `test_a_brief_that_cannot_be_saved_is_still_served_and_the_voice_is_not_paid_for_twice` (the test that pinned the old 503 was removed) |
| **W8** | The podcast storage calls had no deadline: 60 s a try, retried for up to 120 s | Both calls pass `timeout=10` and the storage library's own retry shortened to 10 s in all | Not measured on the real process: in the chaos experiments the staff podcast routes stop at sign-in first | `test_podcast_storage_calls_have_a_deadline_inside_the_request_timeout` |

Limits of the fix: each call is bounded, but a route that makes several
calls adds them up. A database that refuses on and off (each retry ends just
before the 10 s deadline, then one more attempt hangs) can take one call to
about 15 s, and the staff queue checks sign-in before it reads, so both
failing at their very worst could approach 30 s. Neither was seen in the
experiments.

## Game days

A game day rehearses a recovery on the real service. Each one below needs
**Gbenga present, his yes for that day, and a quiet hour.** A quiet hour
means a time he chooses when few visitors are expected and nobody is
waiting on an inquiry. There is no measured traffic figure yet to choose it
by.

For every game day:

- Read the whole plan and its undo aloud before starting. Have the undo
  command typed out and ready.
- One person drives (Gbenga, in Cloud Shell or the Cloudflare dashboard),
  and a second watches the monitor and the site. An AI role may watch and
  take notes; it does not hold production access.
- Write the start time, each step's time, the result and anything
  surprising into the incident issue or the DE-13 record. Afterwards, add
  the measured recovery time to the runbook it rehearsed.
- **Abort at once** on the abort condition. Abort is always the undo, never
  "one more try".

### 1. Rehearsed Cloud Run rollback

Why: an API rollback has never been done on this project (de13, item 6).
The automatic rollback (`docs/sre/auto-remediation.md`) depends on it.

The blast radius is kept small by rolling between two revisions of **the
same code**, so a visitor sees no difference whichever one answers.

Steps:

1. `bash scripts/sre/cloudrun/status.sh`. Write down the serving revision
   (call it R), its commit (`curl -s <API>/api/` names it) and whether
   traffic is pinned.
2. Create a second revision of the same commit through the normal deploy:
   `bash scripts/sre/cloudrun/deploy.sh --commit <R's commit>` (dry run),
   then the same with `--apply` (see `docs/sre/release-safety.md`,
   "Deploying the API"). Its gated traffic steps are part of the rehearsal.
   Call the new revision N.
3. Roll back:
   `bash scripts/sre/cloudrun/rollback.sh --to R` (dry run), then the same
   with `--apply`. Time it from Enter to the script's own `/health` check.
4. `status.sh` again: R at 100 percent; `curl -s <API>/api/` names R.

Expected: each step finishes in minutes with no failed check. If the
monitor is on, it records two revision changes and opens no incident. The automatic rollback
(off or dry run) logs nothing, because there is no incident.

Abort if: any `/health` or identity check fails, the monitor opens an API
incident, or a step runs past 10 minutes. Undo:
`bash scripts/sre/cloudrun/rollback.sh --to R --apply`, or without the
repository
`gcloud run services update-traffic diamondecho-api --to-revisions=R=100 --project diamondecho-prod --region us-east1`.

Afterwards: the service is pinned to R. Read "After a rollback" in
`docs/sre/release-safety.md` before the next settings change.

### 2. Rehearsed Cloudflare Pages rollback

Why: a website rollback has never been done here; `release-safety.md` says
the dashboard steps follow Cloudflare's documentation and are not rehearsed.

Small blast radius: roll back to a deployment of **the same commit**.

Steps:

1. `curl -s https://diamondecho.com/version.json`. Write down the commit
   and `built_at`.
2. Cloudflare dashboard, Workers & Pages, `diamondecho`, Deployments. On the
   current production deployment choose **Retry deployment**. This builds
   the same commit again. Wait until it is live and `version.json` shows a
   new `built_at` with the same commit.
3. On the previous deployment (the original build of that commit) choose
   **Rollback to this deployment**. Time it until `version.json` shows the
   original `built_at`.
4. Check the home page, `/search`, `/investment-calculator` and `/inquire`
   in a browser and on a phone.

Expected: the switch takes effect within a minute or two (to be measured),
the commit never changes, and the monitor (if on) opens no incident.

Abort if: any page fails, `version.json` shows another commit, or the
switch has not shown after 10 minutes. Undo: **Rollback to this
deployment** on the deployment that was live at step 2.

### 3. Backup restore drill

Why: a restore has never been tested (de13), so the honest answer to "how
long would it take to get the inquiries back" is unknown.

The steps are in `docs/sre/backup-and-restore.md`, "The restore drill". It
restores into a scratch database (`restore-drill-<date>`), never over
`(default)`. It counts the restored documents against the source and
deletes the scratch database afterwards. Each step that creates or deletes
something needs Gbenga's yes.

Expected: the restore finishes and the counts match. The time it took is
written into `backup-and-restore.md` as the first measured recovery time.

Abort if: any command names `(default)` as its destination, or the restore
is still running after 2 hours. Undo: delete the scratch database. The
live database is not touched.

### 4. End-to-end alert delivery

Why: an alert that nobody receives is no alert. Nothing has yet shown that
the email and the phone actually ring.

This needs no change to the site and **never** a submitted inquiry.

1. **GitHub issue path.** Gbenga confirms he watches the repository with
   issue notifications on, by email and in the GitHub mobile app. A test
   issue titled "Alert delivery test" with the incident labels is opened by
   hand and closed afterwards. Expected: the email and the phone
   notification arrive. Write down the minutes it took.
2. **Chat webhook** (only if `SRE_ALERT_WEBHOOK_URL` is set). Gbenga posts
   one test message to it from his own shell; the address is a secret and
   never goes in chat or an issue. Expected: the phone shows it, and the
   channel is not muted at the hours that matter.
3. **Google Cloud email.** Cloud console, Monitoring, Alerting, notification
   channels: use **Send test notification** on the email channel the alert
   policies use. Expected: it arrives at realtor@diamondecho.com and on the
   phone. Check the spam folder, and note the Microsoft 365 / Proofpoint
   delay.
4. **The alert engine itself, once the monitor is on.** A one-off run of
   `alert.mjs --apply` fed a made-up sev1 run document (built with
   `lib/schema.mjs`, titled as a drill) and a scratch state folder, never
   the `sre-status` branch. It opens a real issue and posts to the webhook
   without touching the site. It needs a small manual workflow job with
   `issues: write`, to be added by the observability role or the lead.
   Time it from the run to the phone ringing, then close the issue.

Expected: each channel delivers within minutes. Write down the minutes per
channel, the device, and whether it woke anyone.

Abort if: anything would require posting to the inquiry route or changing a
production setting that was not agreed for the day.

## Not covered yet

- Staging: no staging service address is set. A staging run of the
  heavy-route burst needs `--staging <address> --approved-by-gbenga`.
- Faults inside Google's network or Cloudflare's: only simulated here.
- Real phones and real browsers on a slow network: QA's device checks.
- Load: `docs/sre/load-testing.md` (the performance role).
