# Runbook: Cloudflare is down, or Cloudflare is turning visitors away

| | |
| --- | --- |
| Component | `public-site` (also `staff-site` and `dns`, which Cloudflare also serves) |
| Usual severity | sev1 when the site does not load for visitors; sev3 when only the monitor is stopped. See [severity-and-escalation.md](../severity-and-escalation.md) |
| Alerts that lead here | `edge-http-redirect`, `edge-hsts`, `edge-www-redirect`, `edge-no-analytics-beacon` with "Cloudflare refused the monitor" or "answered the monitor with a challenge page"; page checks failing with a Cloudflare error page; `dns-*` failing at both resolvers at once |
| Last reviewed | 2026-11-13, not yet tested |

## Symptoms

- A visitor sees a Cloudflare-branded page instead of the site:
  - "Access denied … used Cloudflare to restrict access", "Error 10xx", or
    "Sorry, you have been blocked": one of **our** Cloudflare security
    settings refused them;
  - "Just a moment…" or "Verify you are human" that does not go away: a bot
    or security-level setting is challenging them;
  - "Error 5xx" with "Cloudflare" in the middle of a diagram, or nothing at
    all: Cloudflare itself, or the path behind it, is failing.
- The incident issue says "Cloudflare refused the monitor with its own
  'Access denied' page, status 403 (error 1010 …)". That is a block of the
  monitor; real visitors may or may not be affected.
- Several unrelated checks fail at once (pages, staff, DNS): Cloudflare
  serves all three, so a Cloudflare-wide problem looks like this.
- Not for a page that loads but is wrong or old: use [site-down.md](site-down.md)
  or [bad-deploy.md](bad-deploy.md). Not for wrong DNS records: use
  [dns-problem.md](dns-problem.md).

## Impact on visitors

If Cloudflare is down, the website and staff site do not load and our DNS may
not answer, which also delays incoming email (sending servers usually retry
for a while, so most mail arrives late rather than never). The API on
`run.app` is outside Cloudflare and keeps working, but visitors reach it only
through the site. If a setting is blocking visitors, those visitors cannot
open the site or send an inquiry; others are fine, which makes it easy to
miss.

## Check first

1. **Anyone.** https://www.cloudflarestatus.com. If it reports an incident for
   CDN, DNS or Pages, this is Cloudflare's outage: go to Fix step 1.
2. **Anyone.** Paste:
   ```bash
   curl -sI https://diamondecho.com/ | head -n 1; curl -sI https://diamondecho.pages.dev/ | head -n 1
   ```
   Healthy: `HTTP/2 200` twice. If `pages.dev` answers 200 and
   `diamondecho.com` does not, Pages is fine and something in **our zone's
   settings** (firewall, bot, redirect rules) is the cause: go to step 4.
3. **Anyone.** Does a normal browser get through? Open https://diamondecho.com
   in a private window, then on a phone using mobile data. If both load and
   only the monitor is refused, real visitors are not (or not all)
   affected: go to Fix step 3.
4. **Gbenga.** Cloudflare > diamondecho.com > Security > Events. Filter the
   last hour by action "Block" or "Challenge". Healthy: few events, none for
   ordinary pages. Note which **service** produced the blocks (for example
   "Browser Integrity Check", "Bot Fight Mode", a custom rule name, "Security
   Level") and the error number on the page.
5. **Gbenga.** Cloudflare > the zone's audit log (Manage Account > Audit Log).
   Note any security, bot or rule change in the last days.

## Fix

1. **Anyone.** Cloudflare-wide outage: nothing on our side restores it
   faster. Post an update (wording in
   [incident-response.md](../incident-response.md)) and wait. Do **not** move
   the nameservers away from Cloudflare during an outage: the .com registry
   tells resolvers to keep nameserver answers for up to two days, so it would
   not help in time and would risk mail for days afterwards.
2. **Gbenga. Needs Gbenga's yes:** a setting changed recently and the blocks
   started then: put that setting back as it was (the audit log shows the old
   value). Worked when: the private-window and phone loads work and the
   Security Events for ordinary pages stop within minutes.
3. **Gbenga. Needs Gbenga's yes:** a feature is blocking real visitors or the
   monitor (step 4 named it). Choose the narrowest change and follow its
   undo in [edge.md](../edge.md), "Recommended baseline", item 9:
   - only the monitor is blocked: first have the SRE lead change the
     monitor's User-Agent (a pull request, no Cloudflare change);
   - visitors are blocked by Browser Integrity Check or a custom rule: switch
     that one feature or rule off;
   - visitors are challenged by Bot Fight Mode: switch Bot Fight Mode off.
   Worked when: the edge checks pass on the next hourly run, or the next
   page check, and step 3 works on a phone.
4. **Gbenga. Needs Gbenga's yes:** "I'm Under Attack" was left on after an
   attack: set Security Level back to its previous value.
5. **AI role agent.** Record what changed and why in the incident issue, and
   update [edge.md](../edge.md) if the baseline changed.

## When to escalate and to whom

| When | Who | How |
| --- | --- | --- |
| Visitors are blocked and the fix did not work within the time in [severity-and-escalation.md](../severity-and-escalation.md) | Gbenga | the incident issue |
| Cloudflare reports no incident but `pages.dev` and the site both fail | Cloudflare | https://community.cloudflare.com and the support page in the dashboard (the Free plan has limited support); give the zone name and the Ray ID shown at the bottom of the error page |
| The blocks are a real attack (a flood, one source hammering the site) | security-lead role agent, and [traffic-spike-or-abuse.md](traffic-spike-or-abuse.md) | [security-operations.md](../../security-operations.md) |

## Afterwards

- [ ] Confirm the edge and page checks pass and the components are
      operational on the status page; the incident issue has closed.
- [ ] Post the "resolved" update (wording in
      [incident-response.md](../incident-response.md)).
- [ ] If a bot or security setting changed, re-check the property search on
      `/search` in a real browser (the DE-32 check), because the Georgia MLS
      frame has not been tested with Cloudflare settings changed.
- [ ] Any setting switched off as a stop-gap: decide with Gbenga whether it
      stays off, and record it in [edge.md](../edge.md).
- [ ] Open a postmortem if
      [postmortem-template.md](../postmortem-template.md) says one is
      required.
- [ ] Correct this runbook if any step was wrong, missing or slow, and update
      "Last reviewed".
