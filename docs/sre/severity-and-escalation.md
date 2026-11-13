# Severity and escalation

How bad a problem is, how fast someone should look at it, who is told, and
what happens when nobody answers. The alert engine
(`scripts/sre/alert-policy.mjs`) follows this document; where it uses a
number, the number here is the same. The reasons behind the alert numbers are
in `docs/sre/alerting.md`. What to do once you are looking is in
[incident-response.md](incident-response.md).

There is one person on call: Gbenga. The AI role agents can read, diagnose and
prepare fixes, but cannot change production, so every timer below is really
"time until Gbenga sees it".

## The four severities

A severity describes what visitors experience, not how interesting the
cause is. When unsure between two, pick the higher one; it can be lowered.

| Severity | In visitor terms | Status page says |
| --- | --- | --- |
| **sev1** | Visitors cannot use the site, or a request a visitor was told we received may be lost. | Major outage |
| **sev2** | A main feature is down or badly broken, but the site still opens. Or the same harm is days away and certain. | Partial outage |
| **sev3** | A minor feature is broken, or an early warning with weeks to act. | Minor problem |
| **sev4** | A notice. Nobody is affected now. | Notice |

### Examples, by part of the site

The monitor gives each check a severity (in `scripts/sre/checks/`). These are
the ones a person will meet most, plus the cases the monitor cannot see,
marked "declared by a person".

| Part (component) | sev1 | sev2 | sev3 | sev4 |
| --- | --- | --- | --- | --- |
| Website (`public-site`) | Home page or the site script does not load (`public-home`, `public-asset-js`) | Advisory or About page, the stylesheet, or `www` redirect broken | Podcast, Privacy or Terms page broken; unknown addresses no longer answer "page not found" | |
| Property search (`search`) | | The `/search` page itself does not load (`search-page`) | The Georgia MLS search inside it is down (`search-idx-provider`): a third party, we can only tell visitors and wait | |
| Intelligence calculators (`calculators`) | | Deal Studio, mortgage simulator or seller net sheet page does not load | Deal Studio's analysis service fails or gives figures that differ from the reference case (`calculators-api-analyze`). Visitors then see "The analysis service could not be reached, so nothing was calculated" (or "Request failed with status code …"), or those figures; Deal Studio's risk simulation, the mortgage simulator and the seller net sheet run in the browser and still work. (With the whole API down, the API incident is the sev2.) | |
| Inquiry form (`inquiry`) | Declared by a person: requests were confirmed on screen but are missing from the staff queue | The form cannot send (`inquiry-route`, `inquiry-preflight`) or the queue is switched off (`inquiry-queue`): the visitor sees an error and nothing is stored | Declared by a person: requests arrive but the arrival email to realtor@diamondecho.com does not | |
| API (`api`) | | Not answering, or wrong build (`api-health`, `api-identity`, `api-cors-allowed`) | Answers calls from other sites, or publishes its route list (`api-cors-refused`, `api-docs-off`) | |
| Staff site (`staff-site`) | | Staff cannot open the queue, or the staff API stops asking for sign-in (`staff-home`, `staff-api-auth`) | | |
| DNS (`dns`) | `diamondecho.com` does not resolve (`dns-apex-resolves`) | Mail records (MX, SPF) wrong, staff address or nameservers wrong | Microsoft 365 or DMARC records wrong | Other records carried over from GoDaddy changed |
| TLS certificates (`tls`) | A certificate has expired, or expires in under 2 days | Expires in under 7 days; or a connection older than TLS 1.2 | Expires in under 21 days and not yet renewed | |
| Domain registration (`domain`) | Expired, expires in under 7 days, on hold, or no longer registered | Expires in under 30 days; a transfer to another registrar is under way, or the registry names a different registrar (refuse it at GoDaddy at once if nobody started it) | Expires in under 60 days, or the transfer lock is off | |
| Monitoring | | Cloudflare is refusing the monitor: every page it serves turns the monitor away while nothing else fails (see "When the monitor itself fails") | The monitor cannot see the site, or a suite has not run | |
| Error budget | | A fast burn (1-hour window): failing so often that the 28-day allowance would be gone in about two days ([error-budget-policy.md](error-budget-policy.md)) | A medium burn (6-hour window) | A slow burn (3-day window): opens no issue; shown in `slo.json` and the weekly report only |

A suspected attack or leak is handled with the security playbook as well,
whatever its severity: see "Attacks and leaks" in
[incident-response.md](incident-response.md).

## Target times

*Acknowledge* means a person has said "I am on it" on the incident issue:
a comment whose first line starts with `ack` or `Acknowledged`, or the
`acknowledged` label. Any other comment does not count. *Mitigate* means visitors are no longer
harmed, usually by a rollback, even if the cause is not yet fixed.

These targets are **proposed, not yet accepted by Gbenga**. Nobody has
measured how fast a person answers today. Business hours are those already
set for inquiries in [DE-31](../de31-inquiry-routing.md): Monday to Saturday,
9:00 to 17:00 Eastern.

| Severity | Acknowledge | Mitigate | Postmortem |
| --- | --- | --- | --- |
| sev1 | 15 minutes in business hours; outside them, as soon as Gbenga sees the alert | 1 hour after acknowledging | Always |
| sev2 | 1 hour in business hours; the next business morning outside them | 4 business hours after acknowledging | If it lasted over 1 hour, or touched inquiries |
| sev3 | Next business day | Plan a fix within 5 business days | No (yes if it repeats in 30 days) |
| sev4 | Weekly review | As planned work | No |

The sev1 and sev2 acknowledge targets match the engine's first reminder (15
and 60 minutes), so the first reminder means "the target has passed".

## How a problem becomes an incident

All of this is automatic, in `scripts/sre/alert-policy.mjs`:

- **Opening.** A check must fail **2 runs in a row** for sev1 and sev2 (5 to
  10 minutes on the 5-minute checks), **3** for sev3 and **6** for sev4. Every
  check already retries inside a run, so one blip does not page anyone.
- **On and off.** A check that failed 4 of its last 12 runs, in at least two
  separate spells, opens an incident one severity lower ("failing on and off").
- **One incident per part.** Failures in the same component share one
  incident and one GitHub issue. Its severity is the worst of its failing
  checks, and it moves up or down as they change.
- **Resolving.** Every failing check must pass **3 runs in a row**: about
  15 minutes for the 5-minute checks, about 3 hours for the hourly
  certificate, DNS and domain checks. The issue then closes itself.
- **Coming back.** A component that fails again within 60 minutes of closing
  reopens the same issue instead of starting a new one.
- **Error budget.** A fast (sev2) or medium (sev3) burn alert from
  `slo.json` opens a budget incident at that severity, unless the
  component has, or had in the last 6 hours, its own incident; then it is
  noted there instead. It closes after two runs without the alert. A slow
  burn (sev4) opens nothing: it is in `slo.json` and the weekly report.

A person can also declare an incident the monitor cannot see (a visitor
phones to say the form ate their request): open an issue with the
**Incident (reported by a person)** template in `.github/ISSUE_TEMPLATE/`.

## Who is told, and how

| Channel | sev1 | sev2 | sev3 | sev4 | Notes |
| --- | --- | --- | --- | --- | --- |
| GitHub issue labelled `sre-incident` and `sev1`–`sev4` | Yes | Yes | Yes | Yes | The record. Opened, updated and closed by the monitor. Public: no visitor data. |
| GitHub's email about that issue | Yes | Yes | Yes | Yes | Arrives only if Gbenga **watches** the repository with issues included (GitHub, the repository, Watch, Custom, Issues) and has email notifications on in his own GitHub settings. Nobody else can check this for him. |
| Chat message (`SRE_ALERT_WEBHOOK_URL`) | Yes | Yes | No | No | Optional; a Slack or Teams incoming webhook Gbenga sets as a repository secret. New, worse, reminders and resolved. |
| Mention of `SRE_OWNER` on reminders | Yes | Yes | No | No | A repository variable with Gbenga's GitHub name. A mention is a stronger notification than a watched issue. |
| Public status page | Yes | Yes | Yes | Yes | Updated every run from `incidents.json`. Shows the title, severity in words, the engine's update lines, and a person's `Status:` comments (within about 25 minutes: up to 15 for the monitor, about 10 for GitHub Pages). |
| Cloud Monitoring email to realtor@diamondecho.com | | | | | **Not an outage alert.** It announces each new inquiry. Its silence proves nothing. It is described in [DE-31](../de31-inquiry-routing.md). |
| Google Cloud budget email ($25) | | | | | A cost notice, not an outage alert. A surprise one may mean abuse: see [traffic-spike-or-abuse.md](runbooks/traffic-spike-or-abuse.md). |

The monitor never sends a text message or a phone call. If Gbenga wants a
sev1 to ring his phone at night, that is done on his phone: let the chat app
(or GitHub Mobile) through Do Not Disturb for this channel only.

## The escalation ladder

There is no second human today. Escalation therefore means "remind the one
person louder, then stop and leave the record". What the engine does when an
incident is not acknowledged, counted from when it reached its current
severity:

| | sev1 | sev2 | sev3, sev4 |
| --- | --- | --- | --- |
| Reminder 1 (issue comment, mention, chat) | 15 min | 60 min | none |
| Reminder 2 | 45 min | 4 hours | |
| Reminder 3 (the last) | 2 hours | | |

A comment whose first line starts with `ack` or `Acknowledged`, or the
`acknowledged` label, stops the reminders. Other comments (questions, notes,
`Status:` updates) do not.

The `sre-silenced` label stops the engine's updates, reminders and chat
messages for that incident. It still shows on the status page, and when it
resolves the engine still posts its one closing comment and closes the
issue (only closing the issue by hand stops that comment too). If the same
part fails again within 60 minutes, the reopened incident starts fresh: it
is no longer silenced or acknowledged, and it comments and messages again.

A change of severity, up or down, restarts the ladder at reminder 1, unless
the incident is already acknowledged.

What keeps happening while nobody answers:

- The status page keeps telling visitors what is broken, in plain words.
- The monitor keeps checking every 5 minutes and closes the incident if the
  site recovers on its own.
- The automatic API rollback in [auto-remediation.md](auto-remediation.md)
  could put the previous API version back, but **only after Gbenga switches it
  on**. Today it only writes down what it would have done.
- The AI role agents, when asked, can diagnose and prepare a fix as a draft
  pull request. Nothing reaches production until Gbenga acts.
- The mortgage simulator and seller net sheet keep working: they run
  entirely in the visitor's browser. Deal Studio's analysis needs the API and
  shows an error while it is down; only its risk simulation runs in the
  browser. Nothing protects the inquiry form: a visitor sees an error and the
  request is not stored.

**Decision for Gbenga: a backup contact.** Someone who, after the last sev1
reminder, can at least do the two documented rollbacks (Cloud Run and
Cloudflare Pages), or call him. That needs a person, their consent, and
their own accounts with only those permissions. Until then, an incident at a
moment Gbenga cannot answer lasts until he can. This is listed in
`docs/sre/needs-from-gbenga.md`.

## Quiet hours

The engine has no clock for business hours; it treats every hour alike. In
practice:

- **sev3 and sev4 are always quiet.** They go to the issue only: no chat
  message, no reminders. They wait for the next business day.
- **sev1 always goes out at once,** any hour. That is the point of sev1.
- **sev2 also goes to chat at any hour,** and reminds at 1 and 4 hours. If
  that wakes Gbenga for things that can wait until morning, the choice is
  his: silence the chat channel at night on his phone (sev1 then waits too),
  or ask the observability role to hold sev2 chat messages outside business
  hours. Until he says, sev2 goes out at any hour.

## When the monitor itself fails

- **It reached nothing** for 2 runs in a row, not even the outside services
  (the Georgia MLS search, the public DNS resolvers, the domain registry):
  the monitor's own network failed, not the site. Only the hourly checks
  include outside services, so only they can show this. It opens a sev3
  "Monitoring cannot see the site" incident, and the status page says a
  recent check measured nothing. When the 5-minute checks reach nothing,
  that counts against the site as usual.
- **Cloudflare turns the monitor away**: in 2 runs in a row, every failing
  check of the parts Cloudflare serves (website, search page, calculator
  pages, contact page, staff site) was refused by Cloudflare, and nothing
  else failed. Those checks are left out, so they cause no outage of their
  own. Instead one sev2 "Cloudflare is refusing the monitor" incident opens,
  pointing at [cloudflare-outage.md](runbooks/cloudflare-outage.md): visitors
  may be blocked too. The status page says a recent check was turned away.
  If any of those checks failed for another reason, the normal rules
  apply.
- **A suite has not run** for 45 minutes (5-minute checks) or 3 hours (hourly
  checks): same sev3 incident. GitHub sometimes starts scheduled runs late.
- **The whole GitHub workflow stops** (paused, broken, or GitHub down): no
  issue can be opened about it. The status page then turns "stale" after 30
  minutes, which a visitor can see but nobody is told. The independent Cloud
  Monitoring uptime checks (in `needs-from-gbenga.md`, item 3.3) are the
  answer, once switched on.

Runbook: [monitoring-is-blind.md](runbooks/monitoring-is-blind.md).

## Changing a severity by hand

A person may change the `sev` label on a monitor issue; the engine leaves it
alone. It changes labels only when its own severity, worked out from the
checks, changes: it then removes the label it set before and adds the new
one, so a hand-set label can end up beside it. The status page always shows
the engine's severity, not the label.

To record that an incident is worse than the checks show (for example,
requests were lost):

1. Comment on the issue, saying why, and change the label if that helps you.
2. Open a separate issue with the **Incident (reported by a person)**
   template at the higher severity, linking the two. Its timeline and
   postmortem follow the higher severity.
3. Tell visitors with a `Status:` comment on the monitor issue (see
   [incident-response.md](incident-response.md#communicate)).
