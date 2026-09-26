# Cloudflare Pages + Firebase deployment direction

Owner decision, 2026-09-26: Gbenga is moving hosting to **Cloudflare Pages**
and selecting **Firebase Authentication + Firestore**. Domain registration
for `diamondecho.com` remains at GoDaddy unless Gbenga separately requests a
transfer. This supersedes Websites + Marketing as the application host,
Cloudflare Access as staff identity, and MongoDB as inquiry-queue storage.

This is a migration plan, not implemented or deployed architecture. Draft
PR #9 still contains the disabled MongoDB/shared-key queue prototype. Do not
enable it or merge it as a Firebase-ready release. No subscription, DNS,
account, project, billing, security-rule or live-data changes were made.

## Target boundaries and unresolved backend choice

- Cloudflare Pages publishes the existing React build, with PR previews and
  an owner-controlled production release. Verify this repository's build
  command/output rather than copying Vite defaults from a generic guide.
- Firebase Authentication supplies named staff identity. Backend verification
  and a provisioned staff UID/role allowlist authorize queue access. Public
  visitor accounts or a seller portal are not added by this change.
- Firestore stores buyer/seller/tour inquiries, consent, stable receipt IDs,
  idempotency fingerprints and acknowledgement actor/time. Retrying a request
  must not duplicate a lead; a receipt only follows confirmed storage.
- The existing FastAPI calculator, property-data and AI APIs still need a
  runtime. Pages Functions use Workers, not a drop-in FastAPI server. Proposed:
  retain FastAPI on Google Cloud Run. **Gbenga approval pending**, including
  billing/region/permissions. Rewriting APIs for Workers is a separate scope.

## Security and acceptance gates

1. Keep the staff interface isolated from the public site's recording and
   analytics scripts; Firebase Auth does not solve that exposure by itself.
2. Public inquiries go through server-side validation, abuse controls and
   idempotent persistence. Do not expose inquiry reads to visitors or grant
   every signed-in Firebase user staff access. Verify Firebase ID tokens,
   staff identity and revocation at each protected operation.
3. Default-deny Firestore browser access to inquiry data when the API mediates
   it. Firebase Admin/server clients bypass Firestore Security Rules, so API
   authorization and least-privilege IAM are mandatory. Test rules and API
   authorization separately with emulators/mocks before a staging deployment.
4. Provision Firebase project, allowed auth domains, approved sign-in/MFA,
   staff role, Firestore location, retention, backups, quotas/budget alerts,
   secrets and monitoring privately. Never place Admin credentials in a
   Pages bundle. Inventory any existing MongoDB inquiry data before proposing
   migration; no deletion or migration is implicitly authorized.
5. Tiara verifies the release-candidate build/URL: buyer/seller/tour receipt,
   queue retrieval, acknowledgement, retry/conflict, storage failure,
   unauthorized/non-staff/revoked access, sign-out, mobile and keyboard.
   Lara confirms monitoring, response SLA/escalation and data retention.
   Gbenga alone approves release and PR merge.

DE-13 covers hosting/deployment; DE-9 covers the intake journey; DE-31 covers
staff identity and operations; DE-29 covers test evidence. All stay open until
the relevant deployed acceptance evidence exists. Passing old MongoDB tests
is not verification of the new Firebase architecture.

## Primary references

- [React on Pages](https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/)
- [Pages Functions runtime](https://developers.cloudflare.com/pages/functions/)
- [FastAPI on Cloud Run](https://docs.cloud.google.com/run/docs/quickstarts/build-and-deploy/deploy-python-fastapi-service)
- [Verify Firebase ID tokens](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [Firestore access mechanisms](https://firebase.google.com/docs/firestore/security/overview)
- [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions)
