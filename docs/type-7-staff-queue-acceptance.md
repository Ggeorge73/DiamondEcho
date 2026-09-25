# Type 7: secure staff queue acceptance (DE-9 / DE-31)

Gbenga approved a DiamondEcho staff queue for buyer, seller and tour requests
instead of email. The original Type 5 SMTP runbook is historical; this document
is the current destination test plan. Gbenga owns account access and PR/merge
approval, Lara owns operations, Tiara tests, and Adeoba reviews implementation.
No password or access key belongs in Git, Jira comments, screenshots or chat.

## Configuration and security gate

Before accepting public traffic, Lara and Gbenga confirm how Gbenga's existing
DiamondEcho staff account signs in and is authorized for this queue. The
provisional bearer-key gate is not that account sign-in. The staff interface
must run on an isolated origin without the public site's third-party scripts,
with a matching restrictive CSP and explicit API CORS origin. They must also
confirm deployment secret provisioning, HTTPS, MongoDB availability, access
logs, data retention, and a backup responder/escalation plan. Without staff
access configuration, the
public API must return 503 with no success receipt. The provisional access-key
mode is not a claim that a production sign-in policy has been approved.

## End-to-end test cases

1. With staff access deliberately unconfigured, submit a clearly labeled test
   buyer request: expect HTTP 503 and no success UI. Configure privately and
   repeat with the same key. Expect HTTP 201, `status: queued` and a stable
   request reference; verify one majority-acknowledged Mongo record.
2. Submit one seller consultation and one tour request with distinct test
   identities and explicit consent. Confirm all three references appear in the
   authenticated Gbenga queue with type, contact, message, listing/address,
   preferred time and consent metadata. Tour copy must not promise a booking.
3. Without a key, with a wrong key, and from an unapproved browser origin,
   attempt staff list and acknowledgement: no visitor details or state changes.
   With authorized access, list, filter and acknowledge each request; verify
   actor/time audit fields. A second acknowledgement must not create a second
   record or contradictory history.
4. Repeat each public POST with the same idempotency key and identical body:
   expect HTTP 200, the same reference and one queue item. A changed body with
   that key must return 409. A concurrent duplicate must also produce one
   record, not two.
5. Simulate unavailable MongoDB and failed writes: no queued receipt. Restore
   service and retry with the same key. Check keyboard/mobile form and staff
   queue states, focus, labels, visible errors, and no horizontal clipping.
6. Lara validates operational monitoring, response SLA, out-of-hours handling,
   failed-attempt recovery and the approved retention/deletion policy. Remove
   only identified test records after sign-off; never bulk-delete customer data.

Record build, URL, request references, redacted screenshots, API/database
observations, browser/device, tester, and timestamps in DE-9 and DE-31. Do not
mark either Done or claim a live lead journey until Lara, Tiara and Gbenga
confirm end-to-end evidence on the target environment.
