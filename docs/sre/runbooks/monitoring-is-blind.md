# Runbook: The monitor cannot see the site, or has stopped

| | |
| --- | --- |
| Component | `monitoring` (an incident about the monitor, not about a part of the site) |
| Usual severity | sev3, see [severity-and-escalation.md](../severity-and-escalation.md) |
| Alerts that lead here | "Monitoring cannot see the site" issues; the Google Cloud policy "DiamondEcho SRE: uptime checks have stopped reporting"; the status page showing "stale" |
| Last reviewed | 2026-11-13, not yet tested |

## Symptoms

- The incident issue "Monitoring cannot see the site" says either that the
  monitor reached nothing in its last runs (not even outside services), or
  that the 5-minute or hourly checks have not run since a given time.
- The status page says its data is out of date, or shows parts as unknown.
- An email from Google Cloud: "the Google Cloud uptime checks have gone
  quiet".
- This runbook is NOT for: the site itself failing while the monitor works
  (the issue then names a part of the site): use that part's runbook.

## Impact on visitors

None directly: this is about the watch, not the site. The risk is that a
real outage goes unnoticed while the monitor is blind. The status page tells
visitors its information is out of date rather than showing "working".

## Check first

1. **Anyone.** Open https://diamondecho.com and
   https://diamondecho.com/inquire in a private window. Healthy: both load. If
   not, the site is down too: follow [site-down.md](site-down.md) first.
2. **Anyone.** Open https://www.githubstatus.com. If GitHub Actions has an
   incident, the cause is GitHub: wait for it, and rely on the Google Cloud
   uptime checks meanwhile (if applied).
3. **Anyone.** In the repository: Actions, "SRE monitor". Healthy: a run in
   the last 10 minutes, green. Look for: the workflow disabled (a banner says
   so; GitHub disables scheduled workflows after 60 days without repository
   activity), runs failing at a step, or no runs at all.
4. **Anyone.** Open the newest run's summary. If every check failed with "No
   answer", including the Georgia MLS search, the runner's network failed;
   it usually clears by itself within a few runs.
5. **Anyone.** See what the state branch last recorded:
   ```bash
   git fetch origin sre-status && git show origin/sre-status:status.json | grep -A 3 '"last_runs"'
   ```
   Healthy: `fast` within the last 10 minutes and `slow` within the last
   70 minutes.
6. **Gbenga.** If the Google Cloud email came: Monitoring > Uptime checks.
   Healthy: six checks, all enabled, with recent results.

## Fix

1. **Gbenga. Needs Gbenga's yes:** if the workflow is disabled, enable it:
   Actions, "SRE monitor", "Enable workflow". Worked when: a run starts at
   the next 5-minute mark and the incident closes after two good runs.
2. **Anyone.** If a run fails at the same step every time, open that step's
   log, and hand the error line to an AI role agent to prepare a fix as a
   draft pull request. Never paste a token or a log line with an address in
   it into the issue.
3. **Anyone.** If the runner's network was the cause (step 4) and it has
   passed, do nothing: the incident closes itself after two runs that reach
   the site.
4. **Gbenga. Needs Gbenga's yes:** if uptime checks were deleted or paused,
   restore them with `bash deploy/monitoring/apply.sh` (plan), then
   `--apply`. Worked when: results appear within 10 minutes and the Google
   Cloud alert closes.
5. **AI role agent.** If saving the state fails ("could not save to
   sre-status"), check that the workflow still has `contents: write` and that
   no branch rule blocks the bot from pushing to `sre-status`. Prepare the
   change as a draft pull request; branch rules are Gbenga's to change.

If none of these works within a business day, go to "When to escalate".

## When to escalate and to whom

| When | Who | How |
| --- | --- | --- |
| The monitor has been blind for more than a business day | Gbenga | The incident issue; see [severity-and-escalation.md](../severity-and-escalation.md) |
| GitHub Actions is down or misbehaving | GitHub support | https://support.github.com, with the run link |
| Cloud Monitoring is not recording uptime results | Google Cloud support | The support page in the console |
| Someone disabled the workflow, the checks or a branch rule without saying so | security-lead role agent | [security-operations.md](../../security-operations.md) |

## Afterwards

- [ ] Confirm the status page shows fresh data and the incident issue has
      closed.
- [ ] Look through the gap: was any real incident missed while the monitor
      was blind? Check the Cloud Run dashboard and the inquiry queue for that
      time.
- [ ] If the workflow was disabled for inactivity, note it in
      [needs-from-gbenga.md](../needs-from-gbenga.md) so it is expected next
      time.
- [ ] Open a postmortem if
      [postmortem-template.md](../postmortem-template.md) says one is
      required.
- [ ] Correct this runbook if any step was wrong, missing or slow, and update
      "Last reviewed".
