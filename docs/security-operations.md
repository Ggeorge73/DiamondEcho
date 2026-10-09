# Security operations

How DiamondEcho is watched for security problems, who (which AI role) handles
what, and what to do when something fires. The security roles are AI
collaborators defined in `.claude/agents/`; Gbenga is the only human approver.

## The security team (AI roles)

| Role | File | Owns |
|---|---|---|
| Security lead | `.claude/agents/security-lead.md` | Threat model, triage, splits work, one risk-ranked summary for Gbenga |
| AppSec engineer | `.claude/agents/appsec-engineer.md` | Backend, frontend, staff queue, assistant: OWASP and abuse flaws, fixes with tests |
| Cloud security engineer | `.claude/agents/cloud-security-engineer.md` | Cloud Run, Firebase rules, Cloudflare headers/CSP, IAM and secrets config (prepares, never applies) |
| Detection and response engineer | `.claude/agents/detection-response-engineer.md` | Scheduled scans, Dependabot/CodeQL/secret alerts, DE-34 dispositions, incident playbook |

Start any security task with the security lead. In Claude Code: "Use the
security-lead agent to …".

## What runs automatically

| Check | When | What it catches | Where it reports |
|---|---|---|---|
| Secret scan (gitleaks, full history) | every PR, push to main, daily 06:17 UTC | committed keys, tokens, private keys | the Security scan run; values are redacted |
| CodeQL `security-extended` (JS and Python) | every PR, push to main, daily | injection, XSS, SSRF, unsafe redirects and similar code flaws | Security tab → Code scanning |
| Live header check | daily, read-only GET of diamondecho.com | HSTS, framing protection, nosniff removed or weakened; site down | the Security scan run |
| Production dependency audit | Mondays 06:41 UTC, and on dependency PRs | scanner failures; findings recorded as evidence (DE-34) | run summary and artifact |
| Dependabot | continuously (alerts), weekly (PRs) | newly published advisories; opens a fix PR when one exists | Security tab and pull requests |
| Security alert | whenever a scheduled run above fails | turns a failed scheduled run into an open `security-alert` issue | Issues |

"Automatically defused" here means: the threat is found within a day, a fix
PR is opened automatically where one exists (Dependabot), and an issue is
opened for everything else. Nothing merges or changes production on its own:
that stays Gbenga's decision (AGENTS.md).

## Controls in the running service

- Staff sign-in: Firebase ID token with revocation check, UID allowlist,
  verified email and TOTP second factor; staff routes origin-gated.
- Firestore: all client reads and writes denied; only the API writes.
- Public inquiry route: per-sender and per-instance limits, salted hashed
  addresses, never logged. The queue stays off until DE controls are verified.
- Heavy calculation routes (`/deals/scenarios`, `/sensitivity`,
  `/monte-carlo`): 10 per 10 minutes per sender, 200 per hour per instance.
- Paid property lookup (`/properties/lookup`): 20 per 10 minutes per sender,
  300 per hour per instance.
- API responses: `nosniff`, `Referrer-Policy: no-referrer`; docs pages off.
- Staff site: strict CSP, `no-store`, DENY framing, COOP `same-origin`.
- Public site: HSTS, DENY framing; Cloudflare adds `nosniff` and a referrer policy.

## Playbook

1. **Read the alert.** Open the failed run or the `security-alert` issue. Ask
   the security lead agent to triage it on the exact commit.
2. **Leaked secret (always Critical).** Revoke and rotate the credential at
   its provider first (Google Cloud, Firebase, Mapbox, RentCast, Cloudflare,
   GitHub). Removing it from git does not make it safe; anyone may already have
   copied it. Then remove it from the code, and record the file and commit (not
   the value) in Jira.
3. **Header check failed.** Compare `frontend/public/_headers` on main with
   the live response. A Cloudflare dashboard rule or a Pages project setting
   may have changed. Redeploy the last good build if needed (DE-13 runbook).
4. **CodeQL alert.** AppSec engineer confirms a real path from a request to
   the sink, fixes it with a regression test, and opens a draft PR.
5. **Dependency advisory.** Detection engineer decides reachable / not
   reachable / false positive, and either reviews the Dependabot PR or records
   the disposition in `docs/de34-advisory-dispositions.md`.
6. **Abuse in progress (traffic spike, quota drain).** The per-sender limits
   hold scripted callers. If a provider bill or Cloud Run traffic still climbs,
   Gbenga can lower `--max-instances`, rotate the provider key, or add a
   Cloudflare/Cloud Armor rate rule. These need console access.

## Settings only Gbenga can switch on (one-time, in GitHub)

Repository → Settings → Code security:

- Dependabot alerts: on. Dependabot security updates: on.
- Secret scanning and **push protection**: on (blocks a push that contains a key).
- Private vulnerability reporting: on (used by `SECURITY.md`).
- Code scanning: the Security scan workflow uploads CodeQL results; no setup
  needed beyond merging it. Turn off "default setup" if GitHub enabled it, so
  results are not duplicated.

Settings → Branches: protect `main` so the Security scan's `secrets` and
`CodeQL` jobs must pass before merge.

## Open findings needing a decision (review of 2026-10-09 at `0a30a2c`)

| # | Severity | Finding | Needs |
|---|---|---|---|
| 1 | Medium | Default compute service account holds Editor; production deploys build from source, so a poisoned build step could reach Firestore PII | Gbenga: give Cloud Build its own service account (`roles/run.builder`, Artifact Registry writer, log writer) and remove Editor from the default account |
| 2 | Medium | Public site has no script CSP; a future XSS or injected script could read the inquiry form | Ship `Content-Security-Policy-Report-Only`, test against the Georgia MLS frame and map on a phone, then enforce. `PublicHeaders.test.js` must change with it |
| 3 | Medium | Podcast staff upload requires `INQUIRY_STAFF_QUEUE_ENABLED=true`, which also opens the public inquiry queue | Engineering change: separate staff-identity settings from the queue switch |
| 4 | Medium | Docker base image not pinned by digest; runtime Python packages are ranges without hashes | Pin `python:3.12-slim@sha256:…` (Dependabot now updates it) and add a hash-locked requirements file (DE-34) |
| 5 | Low | Unpublished podcast episodes stay readable at their old public URL | Revoke public read on unpublish |
| 6 | Low | Staff CSP allows uploads to any Cloud Storage bucket | Narrow `connect-src` to the podcast bucket path |
| 7 | Low | Market-brief audio route caches any past day in memory | Only serve today and the tour key from memory |
| 8 | Low | Dormant Emergent visual-edit loader in `frontend/public/index.html` | Remove if the Emergent editor is no longer used |
| 9 | Info | DE-34 decision 5 (postcss-selector-parser, sprintf-js, moderate, dev-only) still shows "Open" | Gbenga confirms acceptance |

npm: 0 findings in what ships to visitors or staff; 98 build-tool-only findings,
all already accepted in DE-34 and cleared by replacing Create React App (DE-36).
