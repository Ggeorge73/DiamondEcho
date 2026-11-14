# Runbook: The website (or the staff site) does not load

| | |
| --- | --- |
| Component | `public-site` (also `staff-site`) |
| Usual severity | sev1 for the public site, sev2 for the staff site, see [severity-and-escalation.md](../severity-and-escalation.md) |
| Alerts that lead here | **None at present.** The page checks that led here (`public-home`, `public-asset-js`, `public-asset-css`, `public-page-*`, `staff-home`) are not made: pages are not loaded, 2026-11-14. What leads here now: a visitor or a member of staff says the site does not load; someone on the team sees it; a "Post-merge check failed" issue saying the site build failed |
| Last reviewed | 2026-11-14, not yet tested |

## Symptoms

- A visitor sees an error page, a blank page, or an old version of the site at
  `https://diamondecho.com`.
- **No incident issue will say so.** The monitor does not load any web page
  (Bot Fight Mode refuses it and stays on, and no outside monitoring service
  is used: Gbenga, 2026-11-14). So a site that does not load opens no
  incident, and the status page still shows "Operational" with its notice
  that pages are not loaded. A person has to notice: a visitor's call or
  email, staff who cannot open the queue, or someone on the team opening
  the site. When that happens, open an incident by hand
  ([incident-response.md](../incident-response.md)) and start here.
- A "Website" incident can still open, but only for the `www` redirect
  (`public-www-redirect`). That is a Cloudflare redirect rule, not the
  pages: use [cloudflare-outage.md](cloudflare-outage.md).
- This runbook is NOT for: the address not being found at all (that is DNS:
  [dns-problem.md](dns-problem.md)); the form or calculators erroring while
  pages load (that is the API: [api-down.md](api-down.md)); a certificate
  warning (`tls-certificate.md`).

## Impact on visitors

Nobody can read the site, use the calculators or reach the form, because the
form lives on the site's pages. The API itself keeps running, so no stored
request is lost; new requests simply cannot be sent until the pages are back.
Mail to `realtor@` is not affected. If only the staff site is down, visitors
are unaffected but nobody can read the queue.

## Check first

1. **Anyone.** Open https://diamondecho.com in a private window, on a phone
   with Wi-Fi off. Healthy: the home page loads with its pictures and menu.
   If it does not load for you, it is down for visitors, whatever the status
   page says: no check loads a page, so "Operational" there does not cover
   this.
2. **Anyone.** Paste:
   ```bash
   curl -sS -o /dev/null -w '%{http_code}\n' https://diamondecho.com/
   curl -sS -o /dev/null -w '%{http_code}\n' https://diamondecho.pages.dev/
   ```
   Healthy: `200` and `200`. If the `pages.dev` copy answers 200 but
   `diamondecho.com` does not, the pages are fine and the problem is the
   address (DNS or the custom domain): go to [dns-problem.md](dns-problem.md).
3. **Anyone.** Open https://www.cloudflarestatus.com. If "Pages" or "CDN/Cache"
   shows an incident, the cause is Cloudflare: go to
   [cloudflare-outage.md](cloudflare-outage.md) and post a status update.
4. **Anyone.** On GitHub, open the repository's commits on `main`. Note the
   last merge and its time. A broken site that started minutes after a merge
   is almost always that merge.
5. **Gbenga.** Cloudflare dashboard, Workers & Pages, `diamondecho` (or
   `diamondecho-staff`), Deployments. Healthy: the newest production
   deployment shows "Success" and its commit is the last merge. A "Failed"
   build leaves the previous deployment live, so a failed build alone does not
   take the site down.

## Fix

1. **Gbenga. Documented rollback** ([release-safety.md](../release-safety.md),
   Cloudflare Pages): in the Deployments list of step 5, on the last
   production deployment that worked, open the "…" menu and choose
   "Rollback to this deployment". It takes effect in about a minute.
   Worked when: the home page loads in a private window, and again on a
   phone with Wi-Fi off. No monitor run confirms it: `public-home` is not
   made at present.
2. **AI role agent.** Prepare a pull request that reverts the bad merge, so
   the next build does not bring the fault back. It changes nothing until
   Gbenga merges it.
3. **Gbenga. Needs Gbenga's yes:** merge the revert. Cloudflare rebuilds from
   `main` automatically. Worked when: the newest deployment is "Success" on
   the revert's commit and the site loads.
4. If step 3 of "Check first" showed a Cloudflare incident: there is nothing to
   change on our side. Post a status update and wait. Do not move DNS away from
   Cloudflare during an outage: it takes hours to take effect and risks mail.

If none of these works within the time to mitigate in
[severity-and-escalation.md](../severity-and-escalation.md), go to "When to
escalate".

## When to escalate and to whom

| When | Who | How |
| --- | --- | --- |
| The rollback did not bring the site back | Gbenga | The incident issue; see [severity-and-escalation.md](../severity-and-escalation.md) |
| Cloudflare reports an incident, or Pages refuses the rollback | Cloudflare support | The Free plan has no phone support: https://dash.cloudflare.com, Support, and https://community.cloudflare.com. Give the project name `diamondecho` and the time it started |
| The site shows content we did not publish | security-lead role agent | [security-operations.md](../../security-operations.md) |

## Afterwards

- [ ] Confirm by hand that the home page, a calculator page, `/search`,
      `/inquire` and the staff site load (no check does it), and close the
      incident issue you opened.
- [ ] Post the "resolved" update (wording in
      [incident-response.md](../incident-response.md)).
- [ ] If you rolled back in Cloudflare: the next merge to `main` deploys
      again as normal. Make sure the fix is merged before anything else.
- [ ] Open a postmortem if
      [postmortem-template.md](../postmortem-template.md) says one is
      required.
- [ ] Correct this runbook if any step was wrong, missing or slow, and update
      "Last reviewed".
