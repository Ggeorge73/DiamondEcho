# Staff queue identity decision (Type 7, 2026-09-24)

Decision owner: Gbenga. Approved interim approach: Cloudflare Access for an
individual DiamondEcho staff account. This is an architecture decision, **not**
a claim that the account, Access application, deployment, or end-to-end queue
exists yet. No credential belongs in Git, Jira, chat, or client configuration.

## Intended boundary

1. Lara provisions a dedicated HTTPS staff hostname, separate from the public
   site and its recording/analytics scripts. Cloudflare Access protects the
   entire staff hostname, including the staff page and its `/api/v1/inquiries/staff`
   routes. The public intake POST remains a separate visitor route.
2. Gbenga has a named identity with MFA and an explicit Allow policy; all other
   identities are denied. No "everyone" or unrestricted email-domain policy.
3. The staff API verifies the Access application JWT (signature, issuer,
   audience, expiry, and permitted identity) or uses a validated Cloudflare
   Tunnel configuration. It must not trust an email header, CORS, or an
   unlinked URL as authentication. Direct origin bypass must be blocked.
4. The staff page uses the resulting session, not a pasted shared bearer key.
   Disable the current provisional key mode before production. Keep strict CSP,
   no-store responses, no third-party scripts, and an isolated origin.
5. Tiara tests unauthorized and revoked access, sign-in/sign-out, buyer/seller/
   tour receipt-to-queue-to-acknowledgement, mobile/keyboard, and failure paths
   on the exact release candidate. Lara confirms monitoring, retention,
   response ownership, and escalation. Gbenga approves release and PR merge.

## Ability to change later

Inquiry records and request IDs remain in DiamondEcho's MongoDB collection,
not in Cloudflare Access. A later identity-provider change therefore should
not require migrating inquiry data. It **will** require changing the gateway
configuration and, if the token format or verifier changes, the staff API
authentication adapter and staff page session flow. Re-test authorization,
revocation, and the full queue journey before switching providers. This is a
design expectation, not a guarantee of a zero-effort migration.

Open prerequisites: confirm domain/DNS and staff hosting, establish the
Cloudflare account and Gbenga membership/MFA, obtain Access application
audience/issuer and approved identity in deployment configuration, and choose
the exact staff/API routing. Until these are met, the queue remains disabled
and draft PR #9 is not production-ready.

## Domain discovery (read-only, 2026-09-24)

Gbenga identified `diamondecho.com` and confirmed GoDaddy also hosts the
website; the specific GoDaddy hosting product is not yet known. Public DNS
currently delegates to
`ns55.domaincontrol.com` and `ns56.domaincontrol.com` (GoDaddy-managed DNS).
The apex has A records, `www` is a CNAME to the apex, and the domain has MX
and TXT records used for email. These records alone do not establish the
hosting product or where the FastAPI/MongoDB services run. No DNS change was
made.

An HTTPS read of `https://diamondecho.com/` on 2026-09-24 returned a short
JavaScript redirect to `/lander`; that page identified itself as a GoDaddy
`parking-lander`. Gbenga clarified that the GitHub DiamondEcho site **will be
deployed to GoDaddy hosting and this domain**. The parking page is therefore
an expected prelaunch state, not evidence of a failed deployment. The GitHub
application is not yet serving at the checked URL. DE-13 must verify the
React build-to-GoDaddy process, the public API and MongoDB runtime location,
HTTPS/deep-link routing, and a release-candidate URL before code changes can
be claimed as improvements to the live domain.

Lara must inventory **all** DNS records and current web/email services before
any cutover. Cloudflare's full DNS setup would leave domain registration at
GoDaddy but change authoritative nameservers; a partial CNAME setup would
retain GoDaddy DNS but currently requires Cloudflare Business or Enterprise.
Gbenga must approve the selected cost and migration risk before either path.
