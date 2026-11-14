# Incident response

What to do when diamondecho.com, or part of it, stops working for visitors.
Severities and who is told are in
[severity-and-escalation.md](severity-and-escalation.md). The step-by-step
fixes are the runbooks, indexed by symptom in
[runbooks/README.md](runbooks/README.md).

## The checklist

Keep this open during an incident. Times in the incident issue are in UTC.

1. **Look as a visitor.** Open the page in a private window on your phone.
   Comment on the incident issue, starting the first line with `ack`, then
   what you see and the time in UTC (for example `ack: home page blank on my
   phone, 14:58 UTC`). Only a first line starting `ack` or `Acknowledged`, or
   the `acknowledged` label, stops the reminders.
2. **Set the severity** if the monitor's is wrong
   ([how](severity-and-escalation.md#changing-a-severity-by-hand)).
3. **Open the runbook** named in the issue, or find it by symptom in
   [runbooks/README.md](runbooks/README.md). Follow "Check first".
4. **Roll back first, diagnose later.** If anything was deployed or merged
   in the last two hours, put the previous version back (see "Stabilise").
   This is the one production change that does not need a separate decision.
5. **Tell visitors** if it will last more than a few minutes. The status page
   already shows the incident; add a comment whose first line starts with
   `Status:` (wording below). It appears on the status page within about 25
   minutes: up to 15 for the monitor to read it, and up to about 10 for
   GitHub Pages to serve the new page.
6. **Ask for help.** Ask the `sre-lead` agent to diagnose and prepare a fix.
   For anything that looks like an attack or a leak, also ask
   `security-lead`.
7. **Keep the timeline.** One comment per decision or finding.
8. **Confirm it is over.** The monitor closes the issue once the failing
   checks pass 3 runs in a row: about 15 minutes for the 5-minute checks
   (pages, API, form), about 3 hours for the hourly ones (certificates, DNS,
   domain). Look again as a visitor.
9. **Review.** For a sev1, or a sev2 over an hour or touching inquiries,
   open a postmortem within 5 business days
   ([postmortem-template.md](postmortem-template.md)).

**Never** paste a visitor's name, email, phone or message, a password, a key
or a token into the issue, a chat or the status page. Refer to a request by
its reference only. The incident issue is public.

## Who does what

There is one human, Gbenga, and a team of AI role agents. The agents can
read anything, test locally and prepare changes. They cannot sign in to
Google Cloud, Cloudflare, GoDaddy or Microsoft 365, cannot merge, and never
change production.

| Who | During an incident |
| --- | --- |
| **Gbenga** | Acknowledges. Decides. Does every console step: rollbacks, Cloud Run, Cloudflare, DNS, GoDaddy, switching the inquiry queue, rotating a secret, calling a provider's support. Merges a fix. Accepts any remaining risk. Speaks to clients. |
| `sre-lead` | First call for any incident. Splits the work between the roles below and gives Gbenga one summary: what is broken, what to do next, which step is his. |
| `sre-incident-commander` | Runs this process: severity, the runbook, the UTC timeline, status wording, the postmortem draft and its follow-up actions. |
| `sre-observability-engineer` | Reads the state on the `sre-status` branch and the incident issue: what fails, since when, which checks. |
| `sre-synthetic-monitoring-engineer` | Repeats the failing check by hand (read-only) to tell a real failure from a monitor fault. |
| `sre-release-engineer` | Finds the last deploy or merge and prepares the exact rollback command. |
| `sre-infrastructure-engineer` | Cloud Run, Firestore and the automatic-rollback log: reads and explains, prepares steps. |
| `sre-edge-security-engineer` | DNS, certificates, the domain, Cloudflare. |
| `sre-performance-engineer` | Slowness, saturation, provider quotas. Never load-tests production. |
| `sre-slo-engineer` | Afterwards: how much error budget the incident used. |
| `sre-chaos-engineer` | Afterwards: a drill that proves the fix holds. |
| `security-lead` | Attacks, abuse, leaked secrets ([security-operations.md](../security-operations.md)). |

**Two rules for agents.** An agent working through Gbenga's GitHub account
can post findings and timeline notes on an incident issue, because an
ordinary comment does not acknowledge it. But an agent must **never**:

- start a comment's first line with `ack` or `Acknowledged`, or add the
  `acknowledged` label. That would stop the reminders before Gbenga has
  seen the incident. Only Gbenga acknowledges.
- post a `Status:` comment unless Gbenga has approved its exact words. That
  line is published on the public status page.

## Detect

Most incidents start as a GitHub issue labelled `sre-incident`, opened by the
monitor after the same check fails twice in a row (sev1 and sev2). Others
start with a person: a visitor phones, Gbenga notices something, a provider
emails. For those, open an issue with the **Incident (reported by a person)**
template; the monitor does not watch those issues, so remind yourself.

## Acknowledge

Comment on the issue with a first line starting `ack` or `Acknowledged`
(add your first observation after it), or add the `acknowledged` label. Any
other comment does not stop the reminders. Targets are in
[severity-and-escalation.md](severity-and-escalation.md#target-times).

## Assess

Answer three questions in the first timeline comment:

- **What do visitors see?** In their words: "the home page is blank", "the
  form says try again later".
- **Since when?** The issue's "Failing since" line, or the visitor's report.
- **What changed?** A merge to `main` (publishes the website), an API deploy,
  a setting, a provider status page. The issue lists `bad-deploy.md` first
  when a deploy was seen shortly before.

A false alarm (the monitor cannot reach the site, but you can, from two
networks) is still recorded: say so on the issue, and the
[monitoring-is-blind.md](runbooks/monitoring-is-blind.md) runbook applies.

## Stabilise: roll back first

Stop the harm before looking for the cause. In order of preference:

1. **Something was deployed: put the previous version back.** These are
   documented rollbacks and need no separate decision:
   - API: [release-safety.md, "Rolling back the API by hand"](release-safety.md#rolling-back-the-api-by-hand-cloud-run).
     Gbenga, in Cloud Shell. Then read
     [release-safety.md, "After a rollback"](release-safety.md#after-a-rollback):
     the service stays pinned until the next deploy.
   - Website: [release-safety.md, "Rolling back the website"](release-safety.md#rolling-back-the-website-cloudflare-pages).
     Gbenga, in the Cloudflare dashboard, then revert the merge on GitHub.
   - The automatic API rollback ([auto-remediation.md](auto-remediation.md))
     may already have done this, once Gbenga has switched it on. Check its
     line in `remediation-log.jsonl` before rolling back again.
2. **A provider is down** (Cloudflare, Google Cloud, Georgia MLS, GoDaddy):
   nothing to roll back. Confirm on their status page, tell visitors, follow
   the runbook, and wait.
3. **Requests could be lost** (sev1 on the inquiry form): Gbenga decides
   whether to switch the inquiry queue off, so visitors see an error instead
   of a false "received". The switch is in the "Undo" section of
   [DE-13](../de13-production-setup.md#undo). Needs Gbenga's yes. If the API
   was rolled back first, the switch makes a new revision that gets **no**
   traffic until it is moved there
   ([release-safety.md, "After a rollback"](release-safety.md#after-a-rollback)).
4. **Anything else** that changes production follows the runbook's Fix
   steps, each one marked "needs Gbenga's yes".

Only then diagnose. Agents prepare the real fix as a draft pull request, with
a test, reviewed by a second role; nothing reaches production until Gbenga
merges or deploys it.

## Communicate

**The status page** is updated by the monitor every 5 minutes: which parts
are down, the incident title, severity in words, and the monitor's own update
lines (opened, worse, improving, resolved). It is public and holds no visitor
data.

**Human updates** go on the monitor's incident issue as a comment whose
first line starts with `Status:`. The monitor copies that one line (up to 280
characters, without markup) onto the status page. It reads comments every
run while a sev1 or sev2 is unacknowledged, and otherwise at most every 15
minutes; GitHub Pages then takes up to about 10 minutes to serve the change.
So allow about 25 minutes. Only the first line is published; nothing else
from the issue is.

After the monitor closes the issue it still reads `Status:` lines for 24
hours, so post the closing "Resolved" update **within 24 hours of the
close**. If a person closes the issue by hand, post the update **before**
closing it. A line posted later never reaches the page. A person-reported
incident (made with the
issue template) is not on the status page, so post its `Status:` lines on a
monitor issue for the same part if there is one.

Write for a visitor: what they can and cannot do, what to do instead, and
when the next update comes. No causes that name systems, no blame, no
guesses, no promises of a time you do not know.

| Moment | Example |
| --- | --- |
| Investigating | `Status: Some visitors cannot open diamondecho.com. We are looking into it. Next update within 30 minutes.` |
| Identified | `Status: We know why pages are not loading and are putting back the previous version of the site.` |
| Mitigated | `Status: The website is loading again. We are watching it closely.` |
| Resolved | `Status: Resolved. The website was unavailable from 14:50 to 15:20 UTC. It is working normally.` |
| Form broken | `Status: The contact form cannot send requests right now. Please use the phone number or email on the Contact page instead. Nothing you sent while the form showed an error was stored.` |
| Requests may be lost | `Status: If you sent a request between 14:50 and 15:20 UTC and did not hear from us, please send it again or call us. We are sorry for the trouble.` |
| Search provider down | `Status: The property search, provided by Georgia MLS, is not showing listings. The rest of the site works. We are waiting on Georgia MLS.` |
| Deal Studio | `Status: Deal Studio cannot analyse a deal right now. The mortgage simulator and seller net sheet work as usual. Please try Deal Studio again later.` |

Never write: names of visitors or staff, error messages or stack traces,
internal addresses, revision names, commit hashes, check ids, the security
details of an attack, or a time the problem "will be fixed by".

## Resolve

A monitor incident resolves itself once every failing check has passed 3
runs in a row (about 15 minutes for the 5-minute checks, about 3 hours for
the hourly certificate, DNS and domain checks); the issue closes with the
duration. Before leaving it:

- Look at the site again as a visitor.
- Post the "Resolved" status comment within 24 hours of the close (before
  closing, if you close the issue yourself), or it will not reach the status
  page.
- Undo anything temporary from the runbook's "Afterwards" list (a pinned
  revision, a queue switched off, a silenced alert).

A person-reported incident is closed by Gbenga when he agrees it is over.

## Review

A postmortem is required for every sev1, for a sev2 that lasted over an hour
or touched inquiries, for any data loss or exposure, for any incident where
an automatic action (rollback) acted, and for whatever spends an error budget
([error-budget-policy.md](error-budget-policy.md)). Use the **Postmortem**
issue template; the incident commander agent drafts it from the timeline, and
Gbenga accepts it. It is blameless: it asks what made the failure possible,
not who.

Every follow-up action has one owner (Gbenga, or a named role agent preparing
a pull request for Gbenga) and a date. Anything that changes Google Cloud,
Cloudflare, DNS, billing, IAM or secrets is written as an exact step for
Gbenga and added to [needs-from-gbenga.md](needs-from-gbenga.md).

## Attacks and leaks

An attack is also an incident, run with the security team:

- **Traffic flood, junk requests, rising bills:** follow
  [traffic-spike-or-abuse.md](runbooks/traffic-spike-or-abuse.md) and the
  security playbook step "Abuse in progress" in
  [security-operations.md](../security-operations.md#playbook). Ask
  `security-lead` to triage.
- **A secret may have leaked:** it is always Critical. Gbenga rotates it at
  the provider first; removing it from git does not make it safe. Record the
  file and commit, never the value. The playbook is in
  [security-operations.md](../security-operations.md#playbook).
- **Visitor data may have been exposed:** sev1. Do not copy the data
  anywhere to "show" it. Gbenga decides who must be told; that may include
  legal duties this document cannot settle.
- Keep attack details out of the public issue and the status page: say
  "a problem" and "we are working on it". The details go to the security
  record.

## Practice

Runbooks that have never been tried fail when they are needed. The game days
in [chaos-and-game-days.md](chaos-and-game-days.md) rehearse the Cloud Run
rollback, the Pages rollback and an end-to-end alert, each with Gbenga
present.
