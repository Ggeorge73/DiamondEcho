# Runbook: <the symptom, in the words a visitor or Gbenga would use>

<!--
How to use this template
1. Copy this file to docs/sre/runbooks/<name>.md and fill in every section.
   Keep the six headings, in this order, with these exact names.
2. Keep it to one screen or two. A runbook is read during an incident, on a
   phone, by someone who is not an engineer.
3. Add the runbook to the index in docs/sre/runbooks/README.md (the incident
   commander owns that file: tell them the file name and the symptom line).
4. Delete this comment and every line in <angle brackets>.

Rules for every step
- One action per step. A step is a command to paste or a click to make, never
  "investigate" or "check the logs". Say where to click, what to type and what
  you should see.
- Say who can do the step: "Anyone", "AI role agent" or "Gbenga". The
  repository has no Google Cloud or Cloudflare credential, so every console
  step is Gbenga's.
- A step that only reads (a page load, a `curl -sI`, a look at a dashboard)
  needs no approval.
- A step that changes production (Google Cloud, Cloudflare, DNS, GoDaddy,
  GitHub settings, secrets, a deploy) must carry the words
  **needs Gbenga's yes** on the same line. The only exception is a rollback
  already documented in docs/sre/release-safety.md or
  docs/sre/auto-remediation.md: mark it **documented rollback** and link the
  section.
- Never run a monitor's forbidden actions as a check: do not submit an
  inquiry, do not post to /api/v1/inquiries, do not call the paid routes
  (/api/v1/properties/lookup, /suggest), do not load-test production.
- No visitor data, secrets or tokens in a runbook, in the incident issue or on
  the status page. Refer to an inquiry by its reference (DE-…), never by name,
  email or phone.
- No invented numbers. If a threshold is not measured yet, write "not measured
  yet" and link the document that will hold it.
- Roll back first, diagnose later. If a rollback would stop the harm, it is
  the first step under Fix.
-->

| | |
| --- | --- |
| Component | <one key from COMPONENTS in scripts/sre/lib/schema.mjs, for example `public-site`> |
| Usual severity | <sev1 to sev4, see [severity-and-escalation.md](../severity-and-escalation.md)> |
| Alerts that lead here | <check ids or alert names, for example `public-home`> |
| Last reviewed | <YYYY-MM-DD, and "tested in a drill" or "not yet tested"> |

## Symptoms

<What you see, as short bullets. Start with what a visitor sees, then what the
monitor reports. Include the exact text of the alert or error where there is
one.>

- <A visitor sees …>
- <The incident issue says …>
- <This runbook is NOT for …: use [other-runbook.md](other-runbook.md).>

## Impact on visitors

<Two or three sentences. Who is affected, what they cannot do, and what still
works. Say plainly whether an inquiry can be lost: that is the costliest harm
for the brokerage.>

## Check first

<Read-only steps that confirm the problem and narrow it down, in order,
quickest first. Each step says what a healthy answer looks like. Stop at the
first step that explains the problem and go to Fix.>

1. **Anyone.** <Open https://… in a private window. Healthy: the page loads
   and shows ….>
2. **Anyone.** <Paste:>
   ```bash
   curl -sI https://diamondecho.com/ | head -n 1
   ```
   <Healthy: `HTTP/2 200`.>
3. **Gbenga.** <Console: Google Cloud > Cloud Run > diamondecho-api >
   Revisions. Healthy: the newest revision has a green tick and 100% of
   traffic.>

## Fix

<Steps that stop the harm, safest first. Put the rollback first when there is
one. After each step say how to tell that it worked and how long to wait.>

1. **Gbenga. Documented rollback** ([release-safety.md](../release-safety.md)):
   <the command or the click>. Worked when: <what you see>.
2. **Gbenga. Needs Gbenga's yes:** <a step that changes production>. Worked
   when: <what you see>.
3. **AI role agent.** <Prepare a fix as a draft pull request. It changes
   nothing until Gbenga merges it.>

If none of these works within <the time to mitigate for this severity>, go to
"When to escalate".

## When to escalate and to whom

<Be exact: who, how to reach them, and what to tell them. There is one human
on call. An outside provider's support desk is an escalation too.>

| When | Who | How |
| --- | --- | --- |
| <The fix did not work after … minutes> | <Gbenga> | <the incident issue; see [severity-and-escalation.md](../severity-and-escalation.md)> |
| <The fault is at a provider> | <Cloudflare / Google Cloud / Georgia MLS / GoDaddy support> | <the support page or number; what to tell them> |
| <It looks like an attack or a leak> | <security-lead role agent> | <[security-operations.md](../../security-operations.md)> |

## Afterwards

- [ ] Confirm the monitor shows the component as operational again and the
      incident issue has closed.
- [ ] Post the "resolved" update (wording in
      [incident-response.md](../incident-response.md)).
- [ ] <Anything this incident leaves behind: a setting to restore, a revision
      to remove, a secret Gbenga should rotate.>
- [ ] Open a postmortem if
      [postmortem-template.md](../postmortem-template.md) says one is
      required.
- [ ] Correct this runbook if any step was wrong, missing or slow, and update
      "Last reviewed".
