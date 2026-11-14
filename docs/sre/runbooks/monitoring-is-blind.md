# Runbook: The monitor cannot see the site, or has stopped

| | |
| --- | --- |
| Component | `monitoring` (an incident about the monitor, not about a part of the site) |
| Usual severity | sev3, see [severity-and-escalation.md](../severity-and-escalation.md) |
| Alerts that lead here | "Monitoring cannot see the site" issues; the check `uptime-service` ("Uptime service reports every page") failing; the Google Cloud policy "DiamondEcho SRE: uptime checks have stopped reporting"; the status page showing "stale"; the Website shown as "degraded" with an incident that says the pages are not being watched |
| Last reviewed | 2026-11-14, not yet tested |

## Symptoms

- The incident issue "Monitoring cannot see the site" says either that the
  monitor reached nothing in its last runs (not even outside services), or
  that the 5-minute or hourly checks have not run since a given time.
- The status page says its data is out of date, or shows parts as unknown.
- **"Uptime service reports every page" is failing** (check id
  `uptime-service`, sev3). The pages are loaded by an outside uptime
  service, UptimeRobot, and the monitor reads its results
  ([synthetic-monitoring.md](../synthetic-monitoring.md)). This check fails
  when that reading did not give a result for every page. Its text says
  which case it is:
  - "the UptimeRobot key is not set up": the GitHub secret
    `UPTIMEROBOT_API_KEY` is missing or empty;
  - "UptimeRobot refused the read (HTTP …): check the read-only key": the
    key is wrong, or was deleted or replaced in UptimeRobot;
  - "UptimeRobot did not answer": UptimeRobot's API is down or cannot be
    reached from GitHub;
  - "UptimeRobot did not report N of 12 pages", then each page with a
    reason: "no monitor with this name" (deleted or renamed), "paused",
    "not checked yet" (just created or just resumed), or "the monitor
    watches another address".

  While it fails, the pages it names are **not being watched**. No check is
  filed for them. With a missing or wrong key, or UptimeRobot down, that is
  all 12 pages. The API, inquiry route and redirect checks are not affected.
  Because this check belongs to the website, its incident is filed under
  the website, as a sev3, once it has failed three runs in a row.
- **What the status page shows meanwhile (a known limitation).** A page's
  last result is kept for 20 minutes, then it is stale and ignored. After
  that:
  - **Website** shows "degraded": `uptime-service` is failing, and the sev3
    incident says the pages are not being watched;
  - **Search** drops off or shows "unknown": it has no other 5-minute check;
  - **Calculators, Inquiry form and Staff site** show only what their API
    side says (the reference calculation; the inquiry route checks; the
    staff API's sign-in check). **"Operational" there means the API side
    only.** It does not mean the calculator pages, the contact page or the
    staff home page load. Do not read it as "the pages are fine".
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
   answer", including the outside checks that do not touch our hosts
   (`outside-dns-probe` in the 5-minute checks; the Georgia MLS search, the
   DNS and the domain-registry checks in the hourly ones), the runner's
   network failed; it usually clears by itself within a few runs. If the
   outside checks answered and only ours did not, it is the site: go to
   [site-down.md](site-down.md).
5. **Anyone.** See what the state branch last recorded:
   ```bash
   git fetch origin sre-status && git show origin/sre-status:status.json | grep -A 3 '"last_runs"'
   ```
   Healthy: `fast` within the last 10 minutes and `slow` within the last
   70 minutes.
6. **Gbenga.** If the Google Cloud email came: Monitoring > Uptime checks.
   Healthy: six checks, all enabled, with recent results.
7. **Anyone.** If "Uptime service reports every page" is failing: read its
   text in the incident issue or the newest run's summary, and match it to
   the four cases under Symptoms. If it says UptimeRobot did not answer,
   open https://status.uptimerobot.com: an incident there is the cause.
8. **Gbenga.** For the other cases, sign in at https://uptimerobot.com and
   open the list of monitors. Healthy: 12 monitors, all "Up", each named
   exactly after its check and watching the address in the table of item
   1.1 of [needs-from-gbenga.md](../needs-from-gbenga.md). Look for: one
   shown as Paused; one missing; a name with a different spelling, a space
   or a capital letter; an address that differs from the table. Then
   **Integrations & API** > **API**: a read-only API key should exist.

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

6. **Gbenga. Needs Gbenga's yes:** "Uptime service reports every page" is
   failing. By its text (Check first, steps 7 and 8):
   - a monitor is paused: in UptimeRobot, open it and choose Start (resume);
   - a monitor is missing, renamed or watches another address: correct its
     name or address, or create it again, exactly as the table in item 1.1
     of [needs-from-gbenga.md](../needs-from-gbenga.md) gives it (the
     contact page's is a keyword monitor);
   - the key is missing or refused: in UptimeRobot, **Integrations & API**
     > **API**, create (or copy) the **read-only** key, never the main key.
     In GitHub: the repository, Settings, Secrets and variables, Actions,
     Secrets, `UPTIMEROBOT_API_KEY`, and paste it as the new value. Never
     paste the key into an issue, a pull request or a chat;
   - UptimeRobot itself is down: nothing on our side restores it. Until it
     is back, open the site by hand now and then (Check first, step 1).

   In every case, until it is fixed, check the pages by hand (Check first,
   step 1, plus a calculator page and https://staff.diamondecho.com): the
   status page cannot vouch for them.

   Worked when: Actions, "SRE monitor", Run workflow (suite `fast`) shows
   "Uptime service reports every page" and the 12 page checks passing. A
   monitor just created or resumed shows "not checked yet" until UptimeRobot
   has loaded the page once, so wait a few minutes before judging. The
   incident closes itself once the check keeps passing.

If none of these works within a business day, go to "When to escalate".

## When to escalate and to whom

| When | Who | How |
| --- | --- | --- |
| The monitor has been blind for more than a business day | Gbenga | The incident issue; see [severity-and-escalation.md](../severity-and-escalation.md) |
| GitHub Actions is down or misbehaving | GitHub support | https://support.github.com, with the run link |
| Cloud Monitoring is not recording uptime results | Google Cloud support | The support page in the console |
| UptimeRobot is down, or its monitors or key keep failing with no change on our side | UptimeRobot support, and the synthetic monitoring role agent to prepare another verified uptime service | UptimeRobot's dashboard, Support (what the Free plan includes has not been checked) |
| Someone disabled the workflow, the checks or a branch rule without saying so | security-lead role agent | [security-operations.md](../../security-operations.md) |

## Afterwards

- [ ] Confirm the status page shows fresh data and the incident issue has
      closed.
- [ ] Look through the gap: was any real incident missed while the monitor
      was blind? Check the Cloud Run dashboard and the inquiry queue for that
      time. If only the uptime service's reading failed, UptimeRobot kept
      loading the pages: its own dashboard and emails show whether a page
      was down meanwhile.
- [ ] If the workflow was disabled for inactivity, note it in
      [needs-from-gbenga.md](../needs-from-gbenga.md) so it is expected next
      time.
- [ ] Open a postmortem if
      [postmortem-template.md](../postmortem-template.md) says one is
      required.
- [ ] Correct this runbook if any step was wrong, missing or slow, and update
      "Last reviewed".
