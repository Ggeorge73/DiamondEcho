# DE-33 isolated staging handoff

Status: code-side verification prepared; no Cloudflare, Google/Firebase, DNS, billing or IAM resource has been created by this change. This document is not evidence that staging is live.

## Owner-approved configuration needed

Gbenga approves the non-production Cloudflare Pages projects, Google/Firebase project and billing, Cloud Run region, Firestore location, service identities, staff test UID, and exact three staging HTTPS origins. Use separate staging credentials and data, never production credentials in PR previews. Adeoba configures the services; Lara owns the inquiry-routing and test-data procedure; Tiara receives the exact URLs and commit. The staff queue remains disabled until its role/UID checks, abuse controls and Lara's routing are accepted. See `docs/pages-cloud-run-firebase-runbook.md` for the production architecture and explicit gates.

## Deployment evidence to record in DE-33

| Evidence | Record after deployment |
| --- | --- |
| Git commit and Pages deployment IDs | Not yet available |
| Public and staff staging URLs | Not yet available |
| Cloud Run revision URL and image digest | Not yet available |
| Firebase project, region and Firestore location | Not yet approved |
| Staff test UID and role authorization result | Not yet available; do not paste tokens or secrets |
| Tiara's exact-build browser/mobile/keyboard result | Not yet run |
| Lara's routing, monitoring and test-data cleanup result | Not yet run |
| Rollback target and owner | Not yet recorded |

## Read-only smoke check

From the repository root, set `STAGING_PUBLIC_ORIGIN`, `STAGING_STAFF_ORIGIN` and `STAGING_API_ORIGIN` to three distinct **staging** HTTPS origins, without trailing slashes. Then run `node scripts/staging-smoke.mjs`. The script refuses `diamondecho.com` and its subdomains to avoid probing production by mistake. It makes GET requests only. A nonzero exit means one or more checks failed; attach the output, exact commit and URLs to DE-33. Run its offline contract tests with `node --test scripts/staging-smoke.test.mjs`.

The smoke check covers public Pages home and `/inquire` deep link, staff Pages no-store/CSP/frame headers, Cloud Run `/healthz` and `/api/`, allowlisted public/staff CORS, denied unapproved CORS, and unauthenticated staff API denial. It does **not** prove Firebase token authorization, Firestore persistence, provider search, lead delivery, rate limiting, mobile/keyboard behavior, or rollback. Tiara and Lara must verify those separately on the exact staging build before DE-9 or DE-13 can pass. Do not paste inquiry bodies, tokens or secrets into Jira.

## Exit rule

DE-33 stays open until the URLs, commit, deployment metadata and human test evidence above exist. DE-9 then tests real buyer/seller/tour delivery on that build; DE-13 remains a separate production-proof gate. Gbenga alone approves production changes and release.
