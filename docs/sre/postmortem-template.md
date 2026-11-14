# Postmortem: <short title, in visitor terms>

<!--
How to use this template
- Copy it into a new issue with the "Postmortem" issue template, or into
  docs/sre/postmortems/YYYY-MM-DD-<name>.md through a pull request.
- Required for: every sev1; a sev2 that lasted over an hour or touched
  inquiries; any loss or exposure of visitor data; any incident where an
  automatic action (such as the API rollback) acted; whatever spends an error
  budget (docs/sre/error-budget-policy.md). Optional for anything else that
  taught us something.
- Draft within 5 business days of the incident. The incident commander agent
  drafts it from the incident issue's timeline; Gbenga reviews and accepts it.
  An AI role's draft is a draft until he does.
- Blameless. Describe what people and systems did and why it made sense at the
  time. Ask what made the failure possible and what would have caught it
  sooner, never who is at fault.
- Public. No visitor names, emails, phone numbers or messages; refer to a
  request only by its reference. No passwords, keys or tokens. No attack
  details that would help a repeat (those go to the security record).
- Only measured numbers. Where a number was not measured, write "not
  measured" and say how it could be next time.
- Delete this comment and every line in <angle brackets>.
-->

| | |
| --- | --- |
| Incident issue | <#number> |
| Severity | <sev1 to sev4, highest reached> |
| Parts affected | <components, for example Website, Inquiry form> |
| Started | <YYYY-MM-DD HH:MM UTC, when visitors were first affected> |
| Detected | <HH:MM UTC, and how: monitor issue, visitor, Gbenga> |
| Acknowledged | <HH:MM UTC> |
| Mitigated | <HH:MM UTC, when visitors stopped being harmed> |
| Resolved | <HH:MM UTC> |
| Author | <who drafted it; "AI role agent (sre-incident-commander)" if so> |
| Status | Draft / Accepted by Gbenga on <date> |

## Summary

<Three sentences: what visitors experienced, for how long, and what ended it.>

## Impact on visitors

- **What they could not do:** <for example "open any page", "send a request">
- **How long:** <minutes, from Started to Mitigated>
- **How many:** <only if measured, for example from Cloud Run request logs;
  otherwise "not measured">
- **Requests (inquiries):** <were any lost, delayed, or stored without the
  alert email? Give counts only if measured. "None could have been lost
  because the form showed an error" is a valid answer when true.>
- **Error budget:** <from slo.json or the weekly report: share of the 28-day
  budget this incident used, per SLO. Say whether the target was accepted.>
- **What still worked:** <for example "the mortgage simulator and seller net
  sheet, which run in the browser">

## Timeline (UTC)

<Copied from the incident issue and the monitor's updates. One line each.
Include the decisions, not only the events.>

| Time | What happened |
| --- | --- |
| HH:MM | <the change or event that started it> |
| HH:MM | <monitor opened issue #…> |
| HH:MM | <Gbenga acknowledged> |
| HH:MM | <rollback started / finished> |
| HH:MM | <monitor closed the issue> |

## What happened

<A plain account of the failure and the response, for a reader who was not
there. Link the commits, pull requests and runbooks involved.>

## Contributing causes

<Usually several. For each: what it was, and why it made sense at the time.
Think about: the change itself; what tests or checks could have caught it;
why detection took as long as it did; why mitigation took as long as it did;
anything about the setup (one region, one person on call, a provider).>

1. <cause>
2. <cause>

## What went well

- <for example "the rollback took 2 minutes and worked first time">

## What was hard or lucky

- <for example "the runbook named a revision that no longer existed">
- <for example "it happened during business hours; at night it would have
  lasted until morning">

## Actions

<Each action has one owner and a date. An owner is Gbenga or a named role
agent (for example sre-release-engineer) that prepares a pull request for
Gbenga. Anything that changes Google Cloud, Cloudflare, DNS, billing, IAM or
secrets is written as an exact step for Gbenga and also added to
docs/sre/needs-from-gbenga.md. Prefer actions that prevent or detect over
actions that only document.>

| # | Action | Kind | Owner | Due | Tracking |
| --- | --- | --- | --- | --- | --- |
| 1 | <what will be done> | prevent / detect / mitigate / document | <owner> | <YYYY-MM-DD> | <issue or PR> |

## Runbook changes

- [ ] <runbook file>: <what was wrong, missing or slow, and the fix>
- [ ] "Last reviewed" updated on every runbook used.

## Sign-off

- [ ] Gbenga has read this and accepts the actions and their dates.
