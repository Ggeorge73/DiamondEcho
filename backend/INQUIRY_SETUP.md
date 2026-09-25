# Inquiry queue setup and release check

Gbenga subsequently approved Cloudflare Access as the interim DiamondEcho
staff-account sign-in direction. See `docs/staff-identity-decision.md`. The
bearer-key configuration below is a disabled-by-default prototype and must
not be activated as the production sign-in merely by setting environment
variables; Access session validation and isolated hosting still need to be
implemented and tested.

`POST /api/v1/inquiries` stores buyer, seller, and tour requests in MongoDB's
`inquiries` collection. A 201 `queued` receipt means the database acknowledged
a majority+journaled write. It does **not** mean a staff member read the request
or a tour was booked. Repeating the same body and `X-Idempotency-Key` UUID
returns 200 and the same request ID; changing the body with that key returns 409.

The queue is **disabled by default**. No SMTP recipient or provider is used.

## Provisional staff access configuration

This access-key design is provisional until Gbenga approves the final DiamondEcho
staff sign-in system. It should not be treated as approval of a production
authentication architecture. Configure the following deployment secrets only in
an approved environment, in addition to `MONGO_URL` and `DB_NAME`:

| Variable | Meaning |
| --- | --- |
| `INQUIRY_STAFF_QUEUE_ENABLED` | Must be explicitly `true`; otherwise public intake and staff routes return 503. |
| `INQUIRY_STAFF_ACCOUNT_NAME` | Staff account label for acknowledgements (for example, Gbenga's account name). No default. |
| `INQUIRY_STAFF_ACCESS_KEY_SHA256` | Lower/uppercase 64-character SHA-256 hex digest of a randomly generated, 32-byte-or-longer bearer key. No default. |

Generate a key with a cryptographically secure random generator and store the
raw key in an approved secrets manager, never in source, logs, URLs, or browser
storage. The app receives only the digest. Rotate/revoke it by changing the
digest and restarting the service. Staff API requests supply
`Authorization: Bearer <raw key>`. The server compares digests in constant
time and rejects missing, short, or incorrect keys with 401. Missing/invalid
configuration returns 503 without saving a public request.

This is a shared-key provisional control, not an interactive account login:
it has no MFA, per-person authorization, access lifecycle, or individual audit
identity. Production operation requires Gbenga's sign-in decision and security
review. Run only over HTTPS, restrict CORS to the real site, rate-limit the public
endpoint upstream, restrict database access, and ensure PII and secrets are not
logged. Never embed the raw key in a public frontend bundle.

## Staff API

- `GET /api/v1/inquiries/staff?limit=50` returns up to 100 newest queued and
  acknowledged requests, including inquiry details, consent timestamp/version,
  and status. Requires the bearer key.
- `PATCH /api/v1/inquiries/staff/{request_id}/acknowledge` marks a queued
  request acknowledged by the configured account. Repeating the PATCH returns
  the same acknowledgement. It does not delete the inquiry or claim response
  to the visitor. Requires the bearer key.

The database stores request details, consent version/timestamp, stable request
ID, and queue state. Treat this collection as personal data: encrypt in transit
and at rest; set a Gbenga/Lara-approved retention/deletion policy; create an index
on `request_id` for staff acknowledgements; restrict and monitor staff access.
This code does not define retention, a sign-in UI, staff notifications, or an
operational response SLA.

## Release verification

1. Gbenga chooses and approves the final DiamondEcho staff sign-in design.
   Configure API, MongoDB, approved staff access, HTTPS, and restricted CORS.
   Verify database majority+journaled write capability.
2. Tiara submits consented test buyer, seller, and tour requests with unique
   identifiers. Record the API request IDs, find each in the authenticated staff
   queue, and verify content and consent fields. A `queued` receipt alone is
   insufficient to prove staff retrieval.
3. Retry an identical request with the same key: expect HTTP 200 and one record.
   Change its body with the same key: expect 409. Withhold queue configuration
   and test storage failure: expect 503 and no success UI. Verify unauthorized
   list and acknowledgement requests return 401. Acknowledge a request and
   verify the state persists.
4. Check mobile/keyboard access to the staff interface, operator monitoring,
   response ownership, and the approved data-retention procedure. Remove test
   records after sign-off. Do not mark DE-9 complete until the deployed journey
   and staff access are evidenced.
