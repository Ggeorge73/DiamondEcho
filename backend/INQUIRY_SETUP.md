# Inquiry API: Firestore staff queue

The SMTP/Mongo/shared-key prototype is superseded by the approved Pages +
Cloud Run + Firebase architecture. No live data was migrated or removed.

See [release runbook](../docs/pages-cloud-run-firebase-runbook.md) for exact
configuration, IAM, deployment gates and rollback.

POST /api/v1/inquiries accepts buyer, seller and tour requests with explicit
consent and a UUID X-Idempotency-Key. A confirmed Firestore create returns
201 queued; identical replay returns 200 and the original reference/time.
Conflicting payload returns 409, invalid input 422, and absent configuration
or unconfirmed storage 503. Queued means stored for staff review, not an
appointment, email delivery or completed response.

GET /api/v1/inquiries/staff?limit=50 and
PATCH /api/v1/inquiries/staff/{request_id}/acknowledge require a verified,
nonrevoked Firebase ID token, approved UID, verified email and TOTP sign-in.
Acknowledgement records the first actor/time transactionally. The API checks
staff browser origin as well as identity; CORS is not authorization.
All inquiry responses use no-store. Database browser rules deny all access.

Run python -m pytest backend/tests for contracts/security. Real Firestore
transaction coverage requires the local demo emulator (CI job provided).
A live Firebase account/staging journey is still required before release.
