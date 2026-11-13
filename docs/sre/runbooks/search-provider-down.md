# Runbook: Property search shows nothing, or the Georgia MLS search is down

| | |
| --- | --- |
| Component | `search` |
| Usual severity | sev3 when only the Georgia MLS provider fails; sev2 when our own `/search` page fails (see [severity-and-escalation.md](../severity-and-escalation.md)) |
| Alerts that lead here | `search-idx-provider` (hourly), `search-page` (every 5 minutes) |
| Last reviewed | 2026-11-13, not yet tested in a drill |

## Symptoms

- A visitor opens https://diamondecho.com/search (or the search on the home
  page) and the search box area stays blank, shows a browser error such as
  "refused to connect", or shows a Georgia MLS error page.
- The incident issue names **Georgia MLS search (outside provider)** with a
  detail such as `Answered 503, expected 200.`, `No answer: timed out after
  10 s.`, or `Georgia MLS now forbids showing its search inside another site
  (X-Frame-Options).`
- Or it names **Property search page** (`search-page`): then our own page is
  wrong, for example `The page came back without the Georgia MLS search
  frame.` Go to step 1 of "Check first" anyway: it tells the two apart.
- This runbook is NOT for the whole site being down: use
  [site-down.md](site-down.md).

## Impact on visitors

Visitors cannot search Georgia MLS listings on diamondecho.com. Everything
else works: the other pages, the calculators and the inquiry form. No inquiry
is lost, because the search does not send requests to us; a visitor who
wants help can still use https://diamondecho.com/inquire or call.

## Check first

1. **Anyone.** Open https://diamondecho.com/search in a private window.
   Healthy: below the heading, the Georgia MLS search form appears within a
   few seconds.
2. **Anyone.** Open https://georgeolugbe.georgiamls.com/idxsearch/ directly
   in a new tab. Healthy: the same Georgia MLS search form. If it does not
   load here either, Georgia MLS is down: go to Fix, step 1.
3. **Anyone.** If it loads directly but not inside our page, Georgia MLS may
   have started refusing to be shown inside other sites. Paste:
   ```bash
   curl -sI https://georgeolugbe.georgiamls.com/idxsearch/ | grep -i -E '^HTTP|^x-frame-options|^content-security-policy'
   ```
   Healthy: `HTTP/2 200` (or `HTTP/1.1 200`), and no `x-frame-options: DENY`
   or `SAMEORIGIN`, and no `frame-ancestors` that leaves out
   `diamondecho.com`. If one of those appears, go to Fix, step 2.
4. **Anyone.** If Georgia MLS is fine but our page has no search, paste:
   ```bash
   curl -s https://diamondecho.com/search | grep -c 'georgeolugbe.georgiamls.com/idxsearch/'
   ```
   Healthy: a number above 0. A 0 means our latest build dropped the search
   frame: go to Fix, step 3.

## Fix

1. **Gbenga.** Georgia MLS is down. Nothing on our side can bring it back.
   Report it to Georgia MLS support through the Georgia MLS member account
   (the IDX search is provided under that account), quoting the address
   `https://georgeolugbe.georgiamls.com/idxsearch/` and the time it stopped.
   Worked when: step 2 of "Check first" shows the form again. The monitor
   looks once an hour, so the incident closes after the next good hourly run.
2. **Gbenga.** Georgia MLS now refuses to be shown inside our page. Ask
   Georgia MLS support whether the change is deliberate and how an IDX
   customer is meant to embed the search now. **AI role agent** may prepare a
   draft pull request that follows their answer (for example a new search
   address in `frontend/src/components/GamlsSearch.jsx`). Merging it **needs
   Gbenga's yes**, and the IDX search must be re-checked on the exact build
   before it goes live (DE-32's rule).
3. **Gbenga. Documented rollback** ([release-safety.md](../release-safety.md)):
   our own build lost the frame, so put the previous Cloudflare Pages
   deployment back as that section describes. Worked when: step 4 of
   "Check first" shows a number above 0 and `search-page` passes on the next
   run (within 5 minutes). **AI role agent** then prepares the code fix as a
   draft pull request.
4. **AI role agent.** If Georgia MLS is down for more than a day, prepare a
   draft pull request that shows a short, true notice on `/search` ("The
   Georgia MLS search is not answering at the moment. Please try again later,
   or contact us.") linking to `/inquire`. No made-up listings or results.
   Merging it **needs Gbenga's yes**.

If none of these works within the time to mitigate for this severity, go to
"When to escalate".

## When to escalate and to whom

| When | Who | How |
| --- | --- | --- |
| Georgia MLS is down or refuses the frame | Georgia MLS support | Through the Georgia MLS member account; say which address fails and since when |
| Our own `/search` page is wrong and the rollback did not help within an hour | Gbenga | The incident issue; see [severity-and-escalation.md](../severity-and-escalation.md) |
| The search frame shows something that is not Georgia MLS (another site, an advert, a login form) | security-lead role agent | [security-operations.md](../../security-operations.md); treat it as a possible takeover of the frame |

## Afterwards

- [ ] Confirm `search-idx-provider` and `search-page` pass again and the
      incident issue has closed.
- [ ] Post the "resolved" update (wording in
      [incident-response.md](../incident-response.md)).
- [ ] If a notice was added to `/search` (Fix, step 4), prepare its removal.
- [ ] If Georgia MLS changed how the search may be embedded, record what they
      said in `docs/gamls-search-integration.md` and re-check the search on
      the build that went live.
- [ ] Open a postmortem if
      [postmortem-template.md](../postmortem-template.md) says one is
      required.
- [ ] Correct this runbook if any step was wrong, missing or slow, and update
      "Last reviewed".
