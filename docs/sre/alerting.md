# Alerting: how a failure becomes an alert, and why each number

An alert must be true, must ask for something a person can do, and must be
sent once. This page explains how the alert engine keeps to that. The
severities themselves, target times and the escalation ladder are defined in
[severity-and-escalation.md](severity-and-escalation.md); every number below
is the same as there and as in `scripts/sre/alert-policy.mjs`, where the code
reads it. What we can see in the first place is in
[observability.md](observability.md).

There are two independent alert paths:

1. **The GitHub path.** The monitor workflow runs the checks, and
   `scripts/sre/alert.mjs` opens, updates and closes GitHub issues labelled
   `sre-incident`, and posts to a chat webhook when one is set up.
2. **The Google Cloud path.** Cloud Monitoring uptime checks and alert
   policies (`deploy/monitoring/`), emailing the notification channel Gbenga
   chooses. Not switched on yet: item 3.3 in
   [needs-from-gbenga.md](needs-from-gbenga.md).

## Where each severity goes

| Severity | GitHub issue | Chat webhook | Reminders | Google Cloud email (once applied) |
| --- | --- | --- | --- | --- |
| sev1 | Yes, at once | Yes, at once | 15 min, 45 min, 2 h | Uptime check failing from 2+ places |
| sev2 | Yes, at once | Yes, at once | 1 h, 4 h | API server errors above 5%; certificate under 14 days |
| sev3 | Yes | No | None | API slow; API at 3 instances; uptime checks gone quiet |
| sev4 | Yes | No | None | None |

A rise into sev1 or sev2 goes to chat at that moment. An incident that went
to chat also says so in chat when it resolves. Chat messages and issues carry
the same public text: what visitors notice, the failing checks, the runbook.

## When an incident opens, and why these numbers

- **Two failed runs in a row for sev1 and sev2.** Every check already retries
  inside a run, so one failed run is two failed attempts. That can still be a
  hiccup on GitHub's shared runner; two runs in a row (5 to 10 minutes) is not.
  The automatic rollback uses the same two-run rule.
- **Three for sev3, six for sev4.** They are not urgent, so they wait longer
  and stay quiet. On the hourly checks (certificates, DNS, registration) six
  runs is six hours, which suits a notice.
- **On and off.** A check that failed 4 of its last 12 runs, in at least two
  separate spells, opens an incident one severity lower, titled "… is failing
  on and off". Without this rule a check that fails every other run would
  never be reported, yet visitors would hit it half the time. One unbroken
  spell of failures is not "on and off": the two-run rule handles it.
- **One incident per part of the site.** Failures in the same component share
  one incident and one issue. Its severity is the worst of its failing checks.
- **The monitor's own blindness is not the site's outage.** If a run reached
  nothing at all, not even outside services (the Georgia MLS search, public
  DNS, the domain registry), the monitor's network failed. That run counts
  against nothing. Two in a row open a sev3 "Monitoring cannot see the site"
  incident, never a false "Website is down".

## While it is open

- **Worse: at once.** When the severity rises, the issue is relabelled and
  retitled, a comment says what changed, and a sev1 or sev2 goes to chat. The
  reminder ladder restarts at the new severity.
- **Other changes: at most hourly.** A check joining or leaving, the severity
  dropping, an error-budget note: gathered into one comment an hour at most.
  No "still failing" comment every run.
- **Error budget.** A fast (sev2) or medium (sev3) burn alert from
  `slo.json` (the share of the 28-day allowance of failures being used up too
  fast; see [slo.md](slo.md)) opens a `budget:<slo>` incident at the alert's
  severity. A slow burn (sev4) opens nothing: as
  [error-budget-policy.md](error-budget-policy.md) says, it is a note for the
  weekly review, and it appears in `slo.json` and the weekly report only. If the component has its
  own incident, or had one in the last 6 hours, the burn is the same trouble
  seen another way: it is noted once on that incident instead. If the budget
  incident came first and the component's own incident opens afterwards, the
  budget issue is closed with "Merged" and a pointer to the other one.
  `slo.json` older than 2 hours is ignored, so a stalled SLO calculation
  cannot open or close anything.

## When it closes

- **Three passing runs in a row** for every check in the incident (15 minutes
  on the fast checks), and none still failing on and off. One good run after
  an outage is not a recovery.
- The issue gets a "Resolved" comment with the duration, and closes. The
  status page keeps it under recent incidents for 90 days.
- **Coming back within 60 minutes** reopens the same issue and the same
  incident rather than starting a new one, so a wobbling service produces one
  thread, not five.
- A budget incident closes after two evaluations in a row without its burn
  alert.

## How to acknowledge

Either of these, on the incident issue:

- a comment whose first line starts with `ack` or `Acknowledged` (for
  example "ack, rolling back"), or
- the `acknowledged` label.

That stops the reminders. It does not close the incident: the monitor closes
it when the checks pass.

Any other comment does **not** acknowledge, on purpose. AI role agents may
comment on an incident issue through the account of the person who asked
them; if every comment counted, an agent's note could silence a sev1's
reminders without the person ever seeing it. Agents must never write `ack`
or `Acknowledged` on someone's behalf. Bot comments and comments written
before the incident opened never count.

## Telling visitors what is happening

A comment by a person whose first line starts with `Status:` goes onto the
status page as an update, for example
`Status: We are restoring the previous version.` Only that first line is
used (at most 280 characters, without `<` and `>`); nothing else from the
issue is ever copied to the status page. It is public: no visitor details,
no internal names. The engine reads comments on every run while a reminder
could still be due, and otherwise at most every 15 minutes, so an update can
take up to 15 minutes to appear.

## Quiet hours

There are none in the engine. It treats every hour alike: sev1 and sev2 go
to the issue and to chat at once, day or night, and the reminders follow the
ladder at any hour; sev3 and sev4 are always quiet (issue only). The ways to
keep nights quiet are on Gbenga's side: mute the chat channel on the phone,
or ask for sev2 chat messages to be held outside business hours (a change to
`alert-policy.mjs` with its test). See "Quiet hours" in
[severity-and-escalation.md](severity-and-escalation.md).

## How to silence safely

- **One incident:** add the `sre-silenced` label. The engine stops commenting
  and stops chat messages for that incident. It still shows on the status
  page and still closes itself when the checks pass. Closing the issue by
  hand has the same effect and is treated as an acknowledgement.
- **Never** silence by disabling the "SRE monitor" workflow: that also stops
  the status page and the history, and nothing tells you it is off.
- **Never** silence by deleting the issue or editing `incidents.json` on the
  `sre-status` branch: the engine treats a damaged file as lost and starts
  again, which re-announces everything open.
- **Chat at night:** mute the channel on the phone, not in the engine.
- **A Google Cloud policy:** disable it, do not delete it (the same rule as
  the arrival alert in [DE-13](../de13-production-setup.md)).

## The dead-man's switch problem

An alert engine cannot report its own death. If the GitHub workflow stops
(paused, broken, or GitHub down), no run happens, so no issue can be opened
about it. What covers each failure:

| What stops | Who notices |
| --- | --- |
| One suite stops (the 5-minute or the hourly checks) | The other suite, at its next run: sev3 "Monitoring cannot see the site" after 45 minutes (5-minute checks) or 3 hours (hourly checks) |
| The monitor's network | The blind-run rule above, after two runs |
| The whole workflow, or GitHub | **The Google Cloud uptime checks**, which run in Google Cloud from several continents and alert by email on their own. This is the independent heartbeat. Until Gbenga applies them, nobody is told; the status page shows "stale" to visitors after 30 minutes |
| The uptime checks themselves | The "uptime checks have stopped reporting" policy, after 30 minutes without a result |
| Both paths at once | Nothing. The 9:00 look at the inquiry queue ([DE-31](../de31-inquiry-routing.md)) is the human safety net for inquiries |

An outside heartbeat service (a website that alerts when the monitor stops
pinging it) would cover the "whole workflow" row without Google Cloud. It
needs an account and a secret, so it is not included; it can be added if
Gbenga prefers it to the uptime checks.

## Settings

| Name | Kind | Used by | Without it |
| --- | --- | --- | --- |
| `GITHUB_TOKEN` | provided by GitHub Actions | `alert.mjs`, `state-git.sh` | Issues are a logged dry run; the state cannot be saved |
| `SRE_ALERT_WEBHOOK_URL` | repository secret | `alert.mjs` | No chat messages; issues only. The address is never printed |
| `SRE_OWNER` | repository variable (a GitHub user name) | `alert.mjs` | Reminders do not mention anyone |
| `NOTIFICATION_CHANNEL`, `PROJECT_ID` | typed by Gbenga in Cloud Shell | `deploy/monitoring/apply.sh` | The Google Cloud path stays off |

## Changing a number

Reproduce the problem first, offline, with `scripts/sre/fire-drill.mjs`
(which replays runs through the real engine using `SRE_NOW`). Then change the
number in `scripts/sre/alert-policy.mjs` together with a test in
`scripts/sre/alert-policy.test.mjs` that fails with the old number and passes
with the new one, and update this page and
[severity-and-escalation.md](severity-and-escalation.md). The Google Cloud
thresholds (5 percent, 2.5 seconds, 14 days) are proposed starting values:
there is no measured traffic yet to tune them against.
