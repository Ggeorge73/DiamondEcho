# Service level objectives (SLOs)

What "working" means for diamondecho.com, in numbers, and how much failure
the site can have before something has to change.

A **service level indicator (SLI)** is a measurement of something a visitor
feels, such as "the home page loaded". A **service level objective (SLO)** is
the share of those measurements that must be good over a period: here, a
rolling 28 days. The **error budget** is the rest: the share that is allowed
to go wrong. Spending it is normal. Spending it fast, or spending all of it,
is the signal to slow down and fix things (`error-budget-policy.md`).

**Every target below is a proposal. Gbenga has not accepted any of them.**
They become binding only when he does, and that is recorded in the table at
the end of this page.

## The two-minute version

| What is measured | Good means | Proposed target | Allowed to go wrong per 28 days |
| --- | --- | --- | --- |
| Website availability | A public page, or the site's script or stylesheet, answers with its own content | 99.9% | about 40 minutes |
| Website speed | That page's HTML arrives in under 1.5 seconds | 99% | 1 probe in 100 may be slow |
| API availability | The API's health, identity and deal-analysis routes answer correctly | 99.5% | about 3 hours 22 minutes |
| API speed | The API answers in under 1 second | 95% | 1 probe in 20 may be slow |
| Calculators | The Deal Studio, mortgage simulator and seller net sheet pages load (Deal Studio's analysis itself counts under API availability) | 99.5% | about 3 hours 22 minutes |
| Inquiry form | The contact page loads and the inquiry route is open (nothing is ever submitted) | 99.5% | about 3 hours 22 minutes |
| Staff site | The staff sign-in page loads with its protections and the staff API asks for sign-in | 99.5% | about 3 hours 22 minutes |

Where these numbers come from: a probe (an automated visit) every five
minutes from one place, GitHub Actions. The minutes are what the budget would
be if every failure were a complete outage. The measurements are counted
per probe, not per minute.

Every Monday an issue labelled `sre-report` gives last week's figures, what
is left of each budget, and what to look at. The status page shows the same
figures once there is enough data behind them.

## How it is measured

- The synthetic checks (`scripts/sre/synthetic-checks.mjs`) tag each result
  with the SLIs it counts toward. The state store files one line per run in
  `history/` on the `sre-status` branch.
- `scripts/sre/slo-calc.mjs` reads the last 28 days of that history and
  writes `slo.json`. For each SLO: good and total measurements, attainment
  (the share that was good), the share of budget left, and the burn rate
  over the last hour, six hours and three days.
- The targets, thresholds and alert rules are data in
  `scripts/sre/slo.config.mjs`. The tests (`*.test.mjs` beside them) check
  them on every change.
- A speed SLI counts only probes that got an answer. A failed probe is
  charged to availability alone, so one outage is not counted twice.
- A figure is not judged until there are at least 288 probes behind it (one
  day). For a 99.9% target it needs at least 1,000, so that one failed probe
  cannot break the target alone. Until then the report and status page say
  "not judged yet".

### What was measured before choosing the targets

On 2026-11-13, from the SRE team's sandbox: one place, through an HTTPS
proxy (which adds its own small delay), a dozen requests each, about five
seconds apart, between 17:26 and 17:29 UTC. These are a sample, not a
history.

| Address | Answers | Time for the whole answer |
| --- | --- | --- |
| API `/health` | 12 of 12 answered 200 | first request **7.7 s** (a cold start: the service had scaled to zero); the other 11 between 0.12 and 0.29 s, middle value 0.22 s |
| Home page | 12 of 12 answered 200 (30,234 bytes) | between 0.22 and 0.63 s, middle value 0.33 s |

An earlier set from the same sandbox at about 01:25 UTC that day gave
similar times: `/health` 0.12 to 0.38 s with no cold start seen, the home
page 0.21 to 0.60 s.

One finding matters for the monitor itself. When the requests carried the
monitor's own name (`DiamondEcho-SRE-Monitor/1 …` as the User-Agent),
Cloudflare refused the home page every time with 403 and "error code: 1010":
a block based on the visitor's browser signature. The same request with an
ordinary client name got the page. If GitHub Actions is treated the same
way, every website probe would fail, and the website budget would be spent
on an outage no visitor saw. This has to be checked from GitHub Actions
before the website figures are trusted. It is listed under blind spots below.

### Why these targets

- **Website, 99.9%.** The pages are prebuilt files served by Cloudflare
  Pages from many places at once; nothing on our side runs for a page view.
  Outages here are rare and usually Cloudflare's or a bad build. 99.9% leaves
  about 40 minutes a month: room for one bad build caught and rolled back,
  not for a habit. It is the strictest target because it is the front door.
- **Website speed, 1.5 s, 99%.** The slowest home page measured was 0.63 s,
  so 1.5 s leaves room for a slower path from GitHub's machines and a
  Cloudflare cache miss. Slower than that is a real problem for a visitor.
- **API availability, 99.5%.** One Cloud Run service in one region
  (us-east1), up to three copies, each taking one request at a time, and
  deployed by hand. A bad deploy, a Google Cloud problem in us-east1 or a
  burst that fills all three copies takes it down. 99.5% (about 3 h 22 min a
  month) is what this setup can honestly be expected to deliver; a stricter
  number would only be met by luck.
  An API outage is felt, though. The inquiry form cannot send, the staff queue
  cannot load, and Deal Studio cannot produce its analysis: it shows "The
  analysis service could not be reached, so nothing was calculated" (or
  "Request failed with status code …"). Only its Monte Carlo risk run, the
  mortgage simulator and the seller net sheet work fully in the browser. So
  the 3 h 22 min are lost inquiries and failed analyses, not an invisible
  blip. 99.5% is still the right proposal. The causes above are what limit
  it, and raising it means paying to remove them (next section), not
  choosing a bigger number. If lost inquiries in that budget are not
  acceptable, the answer is the always-on copy and the other steps in the
  next section.
- **API speed, 1 s, 95%.** A warm API answered in 0.12 to 0.29 s; a cold
  start took 7.7 s. The one-second line therefore separates "warm" from
  "cold", and this SLI mostly measures how often someone meets a cold start.
  95% allows one probe in 20. With no history yet this is a guess to be
  corrected, not a promise.
- **Calculators, inquiry form, staff site, 99.5%.** The calculator and
  contact pages are website pages, but they matter only when the parts behind
  them work; the staff site has one user. 99.5% for each until history says
  otherwise.

Speed SLOs never raise anything above `sev3` (slow is "degraded", not
"down"); the staff site never above `sev3` either.

### Why not "five nines"

99.999% over 28 days allows 24 seconds of failure. That would be false here,
for reasons that money alone does not fix:

- A probe every five minutes cannot see a 24-second outage, and one failed
  probe already counts for far more than 24 seconds. The measurement is
  coarser than the promise.
- GitHub's scheduler delays and drops scheduled runs. The monitor itself
  is not five-nines reliable.
- One Cloud Run region, scale-to-zero cold starts, three copies taking one
  request each, and hand deploys. Each of these alone rules it out.
- Google's own Cloud Run service level agreement promises less than five
  nines, and Cloudflare's Free plan comes with no uptime promise at all. We
  cannot promise more than the services we stand on.
- Firestore runs in one region, and a restore from backup has never been
  tested (docs/de13-production-setup.md).

## What raising a target would take

Raise a target only when the measured history has met the current one
comfortably for at least one full 28-day window, and the thing that made it
the limit has been fixed. Costs below are kinds of cost; the exact amounts
should be priced in the Google Cloud and Cloudflare calculators before
deciding.

| To raise | What it would take | What it would cost |
| --- | --- | --- |
| Website to 99.95% or more | A second monitor in another place (so a monitor's own network trouble is not counted as an outage), probes every minute, and a tested way to roll back a bad build in minutes | Another monitoring service or Cloud Monitoring uptime checks; owner time to roll back |
| Website speed | Little to gain: the pages are already prebuilt and cached | none |
| API availability to 99.9% | At least one copy always running, more than three copies at peak, automatic rollback switched on, and later a second region with a load balancer in front | One always-on instance is billed every hour, idle or not; a load balancer has a standing monthly charge; a second region doubles the service and needs the database question answered first |
| API speed to 99% | Keeping one copy always warm (`min-instances 1`) removes most cold starts; faster start-up helps a little | The same always-on charge as above. The $25 budget alert would likely need raising |
| Calculators | The pages: as the website. Deal Studio's analysis needs the API, so raising what a Deal Studio visitor gets means raising API availability | as the website, and as the API |
| Inquiry form | Higher API availability, and a test of real delivery to the staff queue (which this SLO does not measure) | as the API, plus a safe test path agreed with Gbenga |
| Staff site | Not worth it for one user | none |

## Two views: probes and real requests

**Probes (what the scripts measure).** An outside view: could a visitor have
done this, five minutes ago, from one place? Probes see the whole path,
including DNS, Cloudflare and the website pages. They see nothing between
probes, and they come from one place.

**Real requests (Cloud Monitoring, prepared, not switched on).** Google
Cloud counts every request that reaches the Cloud Run service, with its
status and how long it took. `deploy/monitoring/slos/` defines two SLOs on
those built-in counts, no visitor data involved:

- `api-availability.json`: 99.5% of requests reaching `diamondecho-api` not
  answered with a 5xx server error, over 28 days.
- `api-latency.json`: 95% answered in under 1,000 ms, over 28 days.
- `service.json`: the "service" these two belong to in Cloud Monitoring.

This view counts every real visitor's request, not just probes. But it sees
only the API, and only requests that reached it. It sees nothing of the
website (served by Cloudflare, not Google). It cannot see a DNS failure or
anything else that stops a request from arriving. It also counts bots, and
it includes the heavy calculation routes, which are meant to take longer
than a second. When the two views disagree, look at both: probes failing
with real requests fine usually means the monitor's own trouble or a part
outside Google; real requests failing with probes fine means a problem the
probe routes do not touch.

There is no real-request view of the website pages: Cloudflare's Real User
Monitoring was switched off on 2026-10-06 because the Privacy page promises
no analytics, and that stays so.

### Switching the real-request view on (Gbenga, when he decides)

Off until then. It needs a person signed in to Google Cloud with permission
to edit monitoring in `diamondecho-prod` (the project owner has it). It
creates no alert and changes nothing the site uses. It uses only Cloud
Run's built-in metrics; check the billing page afterwards to confirm nothing
new is charged. `deploy/monitoring/apply.sh` (observability) applies the
`slos/` folder together with the rest of `deploy/monitoring/`. It matches
each SLO by its `sli` label, so a later change of target updates it rather
than adding a second one. In Cloud Shell, from a checkout of the repository,
first print the plan, which changes nothing, then apply:

```bash
PROJECT_ID=diamondecho-prod NOTIFICATION_CHANNEL=… bash deploy/monitoring/apply.sh
PROJECT_ID=diamondecho-prod NOTIFICATION_CHANNEL=… bash deploy/monitoring/apply.sh --apply
```

`NOTIFICATION_CHANNEL` is needed for the alert policies in the same folder;
`docs/sre/observability.md` explains it. Read the plan before applying: it
covers every monitoring definition, not only these SLOs.

The files follow the Cloud Monitoring API's published shape but have not
been sent to it yet: the SRE team has no Google Cloud sign-in. The first
apply is also the first real check of them.

## Burn-rate alerts

The **burn rate** says how fast the budget is going: 1 means "on course to
spend exactly the whole budget in 28 days", 10 means ten times that fast.
`slo-calc.mjs` raises a burn alert (in `slo.json`, which the alert engine
reads) when a rule below holds. Each rule looks at two windows. The long one
proves the burn is big enough to matter; the short one proves it is still
going on, so the alert stops soon after the trouble does.

| Rule | Long window | Short window | Burn rate at least | Also needs | Severity (at most) |
| --- | --- | --- | --- | --- | --- |
| fast | 1 hour | 15 minutes | 14.4 (2.1% of the budget in an hour) | 3 separate failed probes, and at least 4 probes in the hour | sev2 |
| medium | 6 hours | 1 hour | 6 (5.4% in six hours) | 4 failed probes, at least 24 probes | sev3 |
| slow | 3 days | 6 hours | 1 (10.7% in three days) | 6 failed probes, at least 288 probes | sev4 |

The burn rates are the usual ones. The extra conditions are what make them
fit five-minute probes. An hour holds 12 probes, so one failed probe is 8% of
the hour: a burn rate of 83 against 99.9%. Without a minimum count of failed
probes, a single blip would page someone. With it, the fast rule needs three
failed probes within the hour, one of them in the last 15 minutes. A hard
outage therefore raises it on its third failed probe, about 10 to 15
minutes in; the alert engine's own "failed twice in a row" rule usually
opens the incident first. The minimum number of probes (a third of the
schedule) stops anything being concluded from a window the monitor mostly
missed.

## Blind spots

- **One place, every five minutes, when GitHub keeps time.** Anything
  shorter than the gap between probes can be missed, and GitHub's scheduler
  delays and drops runs. The weekly report lists the gaps.
- **The monitor's name may be blocked by Cloudflare** (error 1010, seen from
  the sandbox). Until it is checked from GitHub Actions, a run of website
  failures with every other part fine should be suspected of being this.
- **Probes load HTML; they do not run the page.** A page whose script fails
  in a real browser still counts as good if its HTML and files load.
- **Probes keep the API warm.** A probe every five minutes keeps a copy of the
  API running much of the time. The cold starts a visitor meets after a
  quiet spell are therefore rarer in the probe figures than they would be
  without the monitor. The real-request view counts them properly.
- **The inquiry SLO never sends an inquiry** (that would use up real
  visitors' allowance and store a fake request). Delivery to the staff queue
  and the arrival email are not measured here.
- **Property search results are not in any SLO.** The `/search` page itself
  counts toward website availability and speed. The Georgia MLS frame inside
  it (a third party) is watched by its own check as a dependency only, so a
  search that loads its page but shows no listings is not counted against
  any target.
- **Capacity refusals.** When all three copies are busy, Cloud Run refuses
  extra requests with 429. The real-request SLO counts only 5xx as failures,
  so those refusals are not counted (the API also answers 429 on purpose
  when one sender sends too much, and the built-in counts cannot tell the
  two apart).
- **The inquiry kill switch.** If the inquiry queue is switched off on
  purpose, the form answers 503 and the inquiry and real-request figures
  count it as failure. Note such a period in the weekly issue.

## Changing a target

1. Wait for history: at least one full 28-day window measured, with the
   weekly reports showing good coverage.
2. Propose the change in a pull request that edits `slo.config.mjs` and this
   page, with the measured figures that justify it.
3. Gbenga accepts it, or not. For an accepted target the pull request sets
   `accepted: true`, `accepted_on` (the date) and `accepted_record` (the Jira
   key or link where he said so), and adds a row below. The tests refuse
   `accepted: true` without the other two. If the SLO also has a
   real-request file in `deploy/monitoring/slos/`, the same pull request sets
   its `goal` and its `status` label to `accepted`; the tests check that the
   file and the configuration agree.
4. Gbenga merges it. Only he merges.

## Accepted targets

| SLO | Target | Accepted on | Record |
| --- | --- | --- | --- |
| (none yet) | | | |
