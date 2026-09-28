# Approved Pages + Cloud Run + Firebase architecture

Gbenga approved implementation on September 26, 2026. This replaces the former
MongoDB/shared-key staff prototype. PR #9 is already merged; implementation
continues in a new review PR. Approval covers code and verification, not cloud
billing, project creation, IAM grants, DNS changes, production deployment or PR
merge. Gbenga remains the sole human approver.

## Implementation boundaries

| Component | Responsibility | Deployment artifact |
| --- | --- | --- |
| Cloudflare Pages, public project | Existing React brokerage site; no visitor accounts | Root `npm run build`, output `build` |
| Cloudflare Pages, separate staff project | Named staff email/password, TOTP enrollment and challenge; inquiry queue | Root `npm run build:staff`, output `staff-queue/dist` |
| Cloud Run | Existing FastAPI calculators, property API, assistant and inquiry API | `backend/Dockerfile`; disabled template `deploy/cloud-run.service.yaml` |
| Firebase Auth / Identity Platform | Verified identity and TOTP MFA | Privately provisioned account; exact UID allowlist checked by API |
| Firestore | Durable inquiry documents and transactional acknowledgement | `firestore.rules`, `firestore.indexes.json`, `firebase.json` |
| GoDaddy | Domain registration | No registrar or DNS changes made |

The public frontend and staff interface must have different origins. The staff
bundle self-hosts its Firebase SDK and has no analytics/recording scripts.
Only public Firebase web configuration enters its bundle. Auth uses memory-only
persistence; sign-out clears visitor details and prevents stale responses from
restoring them. Backend verifies signature/issuer/audience/expiry through the
Admin SDK, checks revocation and disabled users, and requires the approved UID,
verified email and `firebase.sign_in_second_factor == totp`.

Visitors submit buyer/seller/tour requests through the API. Firestore atomic
document creation returns success only after a confirmed write. Duplicate
submission keys read the original receipt; changed payloads return 409.
Acknowledgement is a Firestore transaction preserving the first actor/time.
Direct browser Firestore access is denied, including for authenticated staff.
Admin SDK bypasses rules, so API authorization and service-account IAM remain
mandatory. No existing MongoDB data has been migrated or deleted.

## Verification versus release

Local results: 58 backend tests passed; the real-emulator test is deliberately
skipped without the emulator. 53 public frontend tests and seven staff UI tests
passed. Public production build passed. CI additionally builds the container,
runs isolated staff builds and exercises deny rules and real Firestore
transactions using a local demo emulator. These CI results must be recorded
against the final PR commit; local mocks are not proof of cloud delivery.

A live Firebase TOTP sign-in and real staging inquiry journey remain required.
See [deployment runbook](./pages-cloud-run-firebase-runbook.md) and
[Type 7 acceptance](./type-7-staff-queue-acceptance.md).

## Launch-audit improvement and ownership

This directly advances audit DE-01 / Jira DE-9: inquiries can be durably stored
and accessed through an authorized staff queue rather than an unconfigured
email destination. DE-13 covers deployment, DE-31 identity/operations, and
DE-29 test evidence. None is closed merely because code or unit tests exist.
The original Launch Readiness Audit file is still unavailable in the repository;
traceability uses the findings recorded in Jira and the sprint plan.

Adeoba reviews engineering, Tiara verifies the actual staging build, Lara
confirms monitoring/response/retention, and Gbenga approves permissions,
review, release and merge. The operational queue initially belongs to Gbenga's
yet-to-be-provisioned staff account.

## Primary references

- [React on Pages](https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/)
- [FastAPI on Cloud Run](https://docs.cloud.google.com/run/docs/quickstarts/build-and-deploy/deploy-python-fastapi-service)
- [Verify Firebase ID tokens](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [Firebase TOTP MFA](https://firebase.google.com/docs/auth/web/totp-mfa)
- [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions)
