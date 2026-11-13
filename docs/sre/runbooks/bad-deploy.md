# Runbook: Something broke right after a merge or an API deploy

| | |
| --- | --- |
| Component | `public-site` after a merge; `api` (also `inquiry`, `calculators`) after an API deploy |
| Usual severity | sev2; sev1 when the home page or the form is down, see [severity-and-escalation.md](../severity-and-escalation.md) |
| Alerts that lead here | The issue "Post-merge check failed for …"; a failed run of `SRE post-merge check` or `SRE deploy API`; `deploy.sh` ending with exit 1 or 3; any monitor incident that opened within an hour of a merge or deploy |
| Last reviewed | 2026-11-13, not yet tested (scripts tested against fakes only) |

## Symptoms

- A page, the form or Deal Studio stopped working minutes after a pull
  request was merged or the API was deployed.
- The issue "Post-merge check failed for `<commit>`" lists failed checks, or
  says the site did not show the commit within 15 minutes.
- `deploy.sh` printed `REFUSED: …` (exit 1: the old revision still serves) or
  `ACT NOW: the rollback did not complete` (exit 3).
- This runbook is NOT for: a fault with no change before it
  ([site-down.md](site-down.md), [api-down.md](api-down.md)); the Georgia MLS
  search ([search-provider-down.md](search-provider-down.md)); Cloudflare
  itself ([cloudflare-outage.md](cloudflare-outage.md)).

## Impact on visitors

Depends on what the change broke: anything from one wrong label to the whole
site. A broken form loses requests that visitors do not resend, so treat a
form fault as urgent. When the API fails, Deal Studio's base analysis fails
with an error; the mortgage simulator and seller net sheet run in the browser
and keep working. A refused `deploy.sh` run (exit 1) has no visitor impact: the old
revision serves.

## Check first

1. **Anyone.** Which builds are live (read-only):
   ```bash
   curl -s https://diamondecho.com/version.json
   curl -s https://diamondecho-api-180189726732.us-east1.run.app/api/
   ```
   Note the two `commit` values. If the site's commit is the merge named in
   the issue, the merge is live. If the API's `revision` is the one `deploy.sh`
   just made, the new API is live.
2. **Anyone.** Open the failed workflow run (link in the issue) and read the
   summary: what failed, and whether an automatic rollback ran.
3. **Anyone.** If the issue says the site never showed the commit: the old
   build is still serving and visitors are not affected by the merge. Gbenga
   looks at Cloudflare, Workers & Pages, `diamondecho`, Deployments, for a
   failed build. If the status is 403, read "Known problem" in
   [release-safety.md](../release-safety.md#the-post-merge-check-public-site).
4. **Gbenga.** For the API: `bash scripts/sre/cloudrun/status.sh` in Cloud
   Shell. Healthy after a refused deploy: the old revision has 100 percent.

## Fix

Roll back first, find the cause afterwards.

1. **Gbenga. Documented rollback** ([release-safety.md, "Rolling back the
   website (Cloudflare Pages)"](../release-safety.md#rolling-back-the-website-cloudflare-pages)):
   if the merged build is live and broken, Cloudflare, Workers & Pages,
   `diamondecho`, Deployments, the deployment before it, "…" menu,
   **Rollback to this deployment**. Worked when: `version.json` names the
   earlier commit and the failed check passes, within a few minutes.
2. **Gbenga. Documented rollback** ([release-safety.md, "Rolling back the API
   by hand (Cloud Run)"](../release-safety.md#rolling-back-the-api-by-hand-cloud-run)):
   if the new API revision is serving and broken, or `deploy.sh` exited 3:
   ```bash
   bash scripts/sre/cloudrun/rollback.sh --to <revision before the deploy>          # dry run
   bash scripts/sre/cloudrun/rollback.sh --to <revision before the deploy> --apply
   ```
   The revision before is in the deploy's record ("Before: …"). Worked when:
   `status.sh` shows it at 100 percent and `/api/` names it. Then read
   [release-safety.md, "After a rollback"](../release-safety.md#after-a-rollback):
   the service is pinned.
3. **AI role agent.** Prepare a revert of the merge as a pull request, so the
   next build does not publish the change again. **Needs Gbenga's yes** to
   merge it.
4. **AI role agent.** Find the cause on a branch, with a test that fails
   before the fix. It ships through the normal checks.

If none of this works within the time to mitigate for the severity
([severity-and-escalation.md](../severity-and-escalation.md)), go to "When to
escalate".

## When to escalate and to whom

| When | Who | How |
| --- | --- | --- |
| Any rollback is needed, or `deploy.sh` exited 3 | Gbenga | The incident issue; he holds the only Cloud Shell and Cloudflare access |
| A rollback did not bring the service back | Gbenga, then Google Cloud or Cloudflare support | [api-down.md](api-down.md) or [site-down.md](site-down.md) |
| The change wrote wrong data to Firestore | Gbenga | [backup-and-restore.md](../backup-and-restore.md); a rollback does not undo data |
| It looks like an attack or a leak | `security-lead` role agent | [security-operations.md](../../security-operations.md) |

## Afterwards

- [ ] The monitor shows the component as operational and the incident issue
      is closed (the post-merge issue closes itself when a later merge
      passes).
- [ ] Post the "resolved" update ([incident-response.md](../incident-response.md)).
- [ ] After an API rollback: the bad revision stays at 0 percent; the service
      stays pinned until the next `deploy.sh` run or an `update-traffic
      --to-latest` by Gbenga.
- [ ] Record the API rollback in `docs/de13-production-setup.md` (revision,
      times, why).
- [ ] Ask why the checks before the merge or the candidate checks missed it,
      and add a check or a test that would have caught it.
- [ ] Open a postmortem if [postmortem-template.md](../postmortem-template.md)
      says one is required.
- [ ] Correct this runbook if a step was wrong, missing or slow, and update
      "Last reviewed".
