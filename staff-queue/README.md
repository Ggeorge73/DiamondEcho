# Isolated DiamondEcho staff interface

This is a separate Cloudflare Pages project, NOT a route in the public React
site. It bundles Firebase Auth locally; no analytics or third-party recording
script is loaded. Named staff email/password and TOTP MFA replace the old
shared bearer key. Tokens remain in SDK memory. Visitor details render with
textContent, never HTML, and clear on sign-out/page exit.

First login by a verified user without TOTP presents an enrollment secret.
After enrollment, sign out and sign in again; the API will not authorize an
enrollment-only session. Only the privately provisioned staff UID is permitted
by the backend. The UI cannot grant roles or create a staff account.

From repository root: npm run test:staff and npm run build:staff.
Output staff-queue/dist has generated public config and restrictive _headers.
Default builds are disabled. Do not publish these source files directly.
See [release runbook](../docs/pages-cloud-run-firebase-runbook.md) for required
build environment, account provisioning and staging verification.

Tests use a mocked identity adapter and synthetic visitor data. They are not
evidence of a real Firebase MFA sign-in. TOTP enrollment, recovery, revocation,
actual CSP and mobile/keyboard must be checked in staging by Tiara.
