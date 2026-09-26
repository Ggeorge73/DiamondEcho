# Type 7: Firebase staff queue acceptance (DE-9 / DE-31)

Gbenga approved Pages + Cloud Run + Firebase implementation. This supersedes
SMTP, MongoDB and the shared-key gate. Adeoba reviews engineering; Tiara
verifies staging; Lara owns operations; Gbenga alone approves permissions,
PR review, merge and release.

## Required release evidence

Record exact commit/build, public/API/staff URLs, Firebase project, redacted
test references, device/browser, tester and timestamps. Do not put visitor PII,
passwords, tokens, enrollment secrets or Admin keys in Jira/screenshots/chat.

1. With queue configuration absent or disabled, submit synthetic buyer request:
   expect 503 and no success UI. Configure staging privately and repeat using
   the same UUID key: expect confirmed 201 queued and one Firestore document.
2. Buyer, seller and tour with explicit consent each appear in the authenticated
   staff queue with contact/property/time/consent metadata. Tour is a request,
   not a booking. Queued means storage, not a completed human response.
3. Verify staff email/password and first TOTP enrollment; after enrollment a
   fresh MFA sign-in is required. Wrong code, unverified email, nonstaff UID,
   missing MFA, expired/revoked token and disabled user cannot read or change
   visitor data. A public-origin request is denied even with a valid staff token.
4. Direct Firestore reads/lists/writes are denied for anonymous, nonstaff and
   staff browser identities. Separately verify the authorized Admin/API flow.
5. Identical retries return 200 and stable reference; changed payload/key reuse
   returns 409. Concurrent duplicates create one record. Unavailable storage,
   unconfirmed writes or staff identity provider outage must not show success.
6. Acknowledgement is confirmed by API/database, retains the first actor/time
   under concurrent retry and survives page refresh. It is not proof the staff
   member contacted the visitor. Missing reference returns 404.
7. Sign-out/page exit clears visitor details and MFA secret; late responses
   cannot restore them. No tokens/visitor details in browser persistence,
   analytics, logs or public bundles. Confirm no-store and CSP on deployed host.
8. Keyboard/mobile: labels, focus, errors, TOTP/enrollment, queue and buttons;
   no horizontal clipping. Verify API CORS and deep-linked public Pages routes.
9. Lara confirms queue monitoring, response SLA, backup responder, outages,
   retention/deletion, backup/recovery and abuse/quotas protection. Gbenga
   approves costs, IAM, project/location, DNS and final release.

Local: 57 backend, 53 frontend and 7 staff UI tests passed; public build passed.
Real emulator test is skipped locally without Java 21/emulator. CI adds
Firestore rules/transaction tests and a container build/smoke check; record
final CI evidence separately. Real Firebase Auth/TOTP and staging results are
still required. DE-9/DE-13/DE-31/DE-29 stay open until their evidence gates pass.

## Technical Project Manager lesson

Architecture approval is a design decision, not a release decision.
Authentication answers “who signed in?”; authorization answers “is that UID
allowed to see this queue?”; MFA proves a second factor participated in sign-in.
Firestore rules protect browser access, while the Admin API needs its own
authorization because it bypasses those rules.

Idempotency makes retries safe: the same submission key creates one lead even
when a response is lost. A transaction keeps acknowledgement history stable
when staff retry or act concurrently. Unit tests prove these contracts under
controlled conditions; emulator tests exercise the storage SDK/rules; staging
tests prove the configured user journey. Those are different evidence levels.

This advances audit DE-01 (missing lead journey) and DE-31 operations work, but
does not close the original Launch Readiness Audit or establish live delivery.
Use the Jira finding register until the original audit file is supplied.
