# Standalone DiamondEcho staff queue (provisional)

This is a **separate staff site**, not a route in the public React application. The public site's `frontend/public/index.html` loads session-recording and analytics scripts; it must never host staff credentials or visitor inquiry details. Deploy this directory on a dedicated, access-restricted staff origin with HTTPS. Do not embed it in the public site's page, iframe, or origin.

The page is intentionally **disabled** in `config.js`. Its bearer-key entry is provisional and is **not** an implemented DiamondEcho staff account or MFA sign-in. Gbenga must approve an existing identity provider or access gateway and its staff account membership before enabling production access. A static page plus bearer key is not sufficient to claim that account-based access is live.

Deployment gates:

1. Isolate this directory on a staff-only HTTPS origin. Serve only `index.html`, `staff.css`, `config.js`, and `app.js`; no public SPA bundle, recorder, analytics, or third-party scripts.
2. Protect the staff origin with the approved staff identity/access gateway. Confirm Gbenga's account and access revocation path. Do not put an access key in `config.js`, URLs, browser storage, or logs.
3. Configure `config.js` with `enabled: true` and the exact HTTPS backend origin in `apiBase`. Replace `https://api.example.invalid` in the `index.html` CSP `connect-src` with that same exact origin. The default `.invalid` placeholder and `enabled: false` fail closed.
4. Set response headers at the staff host: `Content-Security-Policy` matching the HTML policy plus `frame-ancestors 'none'`; `Cache-Control: no-store`; `Referrer-Policy: no-referrer`; `X-Content-Type-Options: nosniff`; and HSTS. Do not relax the policy to `*` or permit inline/third-party scripts.
5. If the API is cross-origin, allow only the exact staff origin in API CORS and permit `Authorization`, `GET`, and `PATCH`. Deny the public origin for staff routes. API responses containing inquiry data should also use `Cache-Control: no-store`. Backend authorization must verify every staff request; CORS and an unlinked URL are not access controls.
6. Tiara verifies unauthorized/disabled responses reveal no PII, valid staff access, acknowledgement, sign-out, mobile/keyboard operation, cache/header behavior, and no recording scripts. Lara confirms queue monitoring and handoff. Gbenga approves the identity approach and release.

Run the lightweight local test with `node --test staff-queue/staff.test.cjs` from the repository root. The test uses the existing `jsdom` dependency and mocked API responses; it does not prove deployed identity or API routing.
