# Type 5 — inquiry acceptance runbook (DE-9 / audit DE-01)

This runbook is for Tiara (QA) and Lara (operations), with Gbenga as the
approval and merge owner. Passing automated tests is not proof that a real
recipient received an inquiry. Do not mark DE-9 Done until the evidence below
is recorded in Jira.

## Before staging acceptance

1. Lara identifies the monitored recipient and delivery provider; Gbenga
   approves them. Configure the backend and MongoDB in the non-production
   acceptance environment. Keep credentials out of Git and screenshots.
2. Confirm the frontend is built with the staging API URL and that backend
   CORS allows the frontend origin. A static frontend alone cannot persist or
   route inquiries.
3. Agree on three unique, clearly labelled test names, such as
   `DE9-BUY-<timestamp>`, `DE9-SELL-<timestamp>`, and `DE9-TOUR-<timestamp>`.
   Use authorized test contact details, not real customer information.

## Evidence for each of buyer, seller, and tour

- Submit once with required fields and contact consent. Capture the displayed
  request reference and the API response, without publishing contact details.
- Verify exactly one MongoDB record for that request reference, including
  type, consent version/time, listing identity for tour, and routing state.
- Have Lara verify the same reference in the approved recipient inbox/provider
  log. SMTP acceptance alone is not evidence of inbox receipt or human review.
- Confirm the tour message says **request received**, not **tour booked**.
- Repeat submission with the same idempotency key. Confirm the same request
  reference and one persisted record; a changed payload with that key must
  return a conflict.

## Failure, accessibility, and cleanup

- Reject blank/invalid fields and unchecked consent without a success message
  or new record. Simulate unavailable routing and storage separately; the UI
  must show an error and support a same-key retry without a duplicate record.
- Complete all three paths by keyboard and at a narrow mobile viewport. Check
  label/error focus, readable layout, and that a rapid double-click does not
  create an extra request.
- Record build/commit, environment, test references, timestamps, and result in
  DE-9. Lara confirms the recipient evidence; Tiara confirms QA; Gbenga accepts.
- After evidence is captured, remove only the identified test records from the
  staging database and test messages from the agreed test inbox, then record
  cleanup. Never bulk-delete customer data.

Production deployment and service connections remain tracked separately by
DE-13 / audit DE-04. Do not infer production readiness from staging acceptance.
