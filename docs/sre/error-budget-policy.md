# Error-budget policy

What happens when the site has been failing more than its targets allow.
The targets and how they are measured are in `slo.md`.

**Gbenga decides.** This policy says what the SRE automation and the AI role
agents recommend at each level. It does not stop anyone shipping by itself,
and nothing here merges, deploys or rolls back on its own. The one
automatic action anywhere is the Cloud Run rollback in `auto-remediation.md`,
and that stays off until Gbenga switches it on.

## When it applies

- An SLO's budget state binds only once Gbenga has **accepted** its target
  (`slo.md`, "Accepted targets"). Until then the weekly report still shows
  the state, marked as advice.
- A state is judged only when there is enough data behind it (at least a day
  of probes, and 1,000 for a 99.9% target). Before that the state is "not
  judged yet".
- The budget is measured over a rolling 28 days. It recovers as bad days age
  out of the window; nobody resets it.

## What each level asks for

The share of the 28-day budget still unspent decides the level. The weekly
report (`sre-report` issue) names the level for each SLO, and the alert
engine reads the burn alerts every five minutes.

| Budget left | Level | What happens |
| --- | --- | --- |
| more than 50% | Healthy | Ship as usual. |
| 50% or less | Caution | Ship as usual, but find what spent the budget and plan its fix this week. The weekly report names it. |
| 25% or less | Restricted | Ship only fixes and small, low-risk changes to the affected part, each deploy watched until its checks pass. Reliability work comes before new features. |
| 0% or less | Spent | Stop merging and deploying feature changes that touch the affected part. Only fixes, security patches and reliability work ship until the budget is above zero again or Gbenga records an exception. Write a postmortem (`postmortem-template.md`) for what spent it. |

"The affected part" means the component the SLO belongs to. A spent API
budget holds back API changes, not a fix to the Privacy page wording.

How that maps onto how this site ships:

- **Website** (and the calculator and contact pages): every merge to `main`
  goes live on Cloudflare Pages automatically. "Stop shipping" therefore
  means Gbenga does not merge feature pull requests that touch the website.
- **API**: deployed by hand by Gbenga from Cloud Shell. "Stop shipping" means
  no feature deploys of the API; fixes go through the candidate checks as
  always.
- **Speed SLOs**: a spent speed budget asks for performance work on the slow
  part before features that add to it. It never calls for a freeze of other
  work.
- **Security fixes always ship**, whatever the budget. So do changes that
  only add monitoring or tests.

Burn alerts are separate from the levels. A fast burn alert (`sev2`) is an
incident now and follows `incident-response.md`, whatever budget is left. A
slow burn alert (`sev4`) is a note for the weekly review.

## What counts against the budget

Everything a probe saw fail, whoever caused it: our code, Cloudflare,
Google Cloud, GitHub's network, or the monitor itself. History is never
edited to remove a failure. When a failure is shown not to be the site's
fault (for example the monitor's own network trouble, or Cloudflare blocking
the monitor), say so in that week's report issue. If it changes what may
ship, record it as an exception below.

## Exceptions

An exception lets something ship that the current level would hold back,
for a stated reason and a stated time. Only Gbenga grants one.

How one is recorded:

1. The person or role agent asking writes what should ship, why it cannot
   wait, the SLO and budget left, and until when. This goes in the Jira issue
   for the work, or the `sre-report` issue for that week.
2. Gbenga answers there, yes or no, in his own words.
3. A pull request adds a row to the table below, linking to his answer. AI
   role agents may prepare that pull request. They never fill in "Decided by"
   for him or mark an exception granted before he has answered.
4. When the time runs out, the level applies again without further action.

| Date | SLO | Budget left then | What may ship | Why | Until | Decided by | Record |
| --- | --- | --- | --- | --- | --- | --- | --- |
| (none yet) | | | | | | | |

## Reviewing this policy

Review it together with the targets after the first full 28 days of
measured history, then every three months, or after any `sev1` incident.
Changes follow the same route as a target change (`slo.md`, "Changing a
target").
