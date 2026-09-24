# Inquiry intake setup and release check

`POST /api/v1/inquiries` stores buyer, seller, and tour requests in the configured
MongoDB database's `inquiries` collection, then hands each request to an SMTP
server. The endpoint is intentionally fail-closed: it returns HTTP 503, never a
success receipt, if persistence or delivery cannot be confirmed. A `routed`
receipt means SMTP accepted the message; it does **not** prove it reached the
recipient's inbox or that a tour was booked.

## Configuration

In addition to existing `MONGO_URL` and `DB_NAME`, set these as secret deployment
environment variables (not in source control):

| Variable | Purpose |
| --- | --- |
| `INQUIRY_APPROVED_RECIPIENT_EMAIL` | Lara-approved, monitored intake mailbox. No default. |
| `INQUIRY_SMTP_FROM_EMAIL` | Valid sender address authorized by the mail provider. |
| `INQUIRY_SMTP_HOST` | SMTP provider hostname. |
| `INQUIRY_SMTP_PORT` | SMTP port (defaults to 587). |
| `INQUIRY_SMTP_SECURITY` | `starttls` (default) or `ssl`. Plaintext SMTP is disallowed. |
| `INQUIRY_SMTP_USERNAME` | SMTP account username. |
| `INQUIRY_SMTP_PASSWORD` | SMTP credential. |

Do not invent or silently default the recipient. Without all required settings,
the request is saved with a failed routing status and the API returns 503. The
frontend must preserve the same `X-Idempotency-Key` UUID and request body when
the visitor retries. A changed body with the same key returns 409. Once SMTP
accepts a request, repeated identical submissions return the same request ID
without another send.

The database stores request details, consent version/timestamp, stable request
ID, routing state, and attempt count. Treat this collection as personal data:
limit operator access, encrypt in transit/at rest, set a retention/deletion
policy, and do not log request bodies or credentials. This code does not define
a retention period; Gbenga/Lara must approve one before live operation.

## Release verification

1. Lara confirms the monitored mailbox and authorized mail provider. Deploy API,
   MongoDB, SMTP secrets, and a restricted frontend CORS origin. Confirm network
   access from the API host to MongoDB and the SMTP provider.
2. Tiara submits a consented test buyer, seller, and tour request using clearly
   labeled test data. Record API request IDs and verify **actual inbox receipt**
   and content with Lara. A `routed` API receipt alone is insufficient.
3. Retry one identical request with the same key: expect HTTP 200 and the same
   request ID, with no second message. Change the body with the same key: expect
   409. Temporarily withhold SMTP configuration in staging: expect 503 and no
   success UI; restore it and retry with the same key.
4. Delete the identified test records and test messages after sign-off under the
   agreed retention policy. Verify production monitoring and ownership of
   failed/pending records before marking DE-9 complete.

SMTP does not support exactly-once delivery. If SMTP raises after acceptance,
or a process crashes after acceptance but before the MongoDB `routed` update,
the record remains `sending` and retry returns 503 instead of blindly sending
a possible duplicate. Lara's
operator must reconcile stale claims against the mailbox/provider using the
stable request ID before manually deciding whether to resend or close. The
five-minute lease timestamp is an investigation signal, not an automatic resend.
