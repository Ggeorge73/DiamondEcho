# DiamondEcho launch QA strategy and evidence matrix (DE-29)

Owner: Tiara, QA. Gbenga approves release decisions; Adeoba reviews engineering
fixes; Lara owns inquiry operations. This is a proposed execution plan, not a
claim that the tests have run. It derives from Jira's September 22 audit
references because the source audit file is not in the confirmed repository.

## Evidence rule

For each case below, attach or link a test record to its Jira issue using
`DE-<issue>-TC<id>-<build>-<environment>`. Record the exact commit and URL,
browser/device and viewport, test data identifier, steps, expected and actual
result, pass/fail, tester, timestamp, screenshot or video where useful, API
status/request ID where applicable, defect link, and retest result. Redact
visitor contact details, access keys, cookies and provider credentials. A PR
check is evidence for code quality, not for live delivery or device behavior.

## Coverage and test targets

Proposed support targets for Gbenga/Tiara to confirm: current Chrome and Edge
on desktop, Safari on an iPhone, and Chrome on Android. Exercise 320, 390,
430 and 768 px widths in addition to desktop. Use keyboard-only navigation
for all primary paths, visible focus, form labels and errors, dialog focus
entry/return, and a screen-reader smoke check on menu, inquiry and recovery
pages. Run tests on a staging/release-candidate URL, then repeat the critical
smoke on the frozen production URL and commit; emulator checks do not replace
the named real-device run.

| Case | Audit / Jira | Release-candidate test and expected outcome | Evidence location |
| --- | --- | --- | --- |
| TC01 | DE-01 / DE-9 | Buyer, seller and tour submissions validate consent, persist once, appear in Gbenga's approved staff queue with the same reference; failure/retry never gives a false success or duplicate; a tour request is not a booking. | DE-9 attachment + DE-31 queue audit IDs |
| TC02 | DE-02 / DE-8 | Run base and risk for rental/flip/land, switch every strategy pair; no blank screen, uncaught error or unusable navigation. | DE-8 attachment |
| TC03 | DE-03 / DE-7 | Clean checkout/install, frontend and backend tests, production build and GitHub CI pass on the release commit. | DE-7 CI run + release commit |
| TC04 | DE-04 / DE-13 | HTTPS release URL, direct deep links, SPA fallback, configured API/property provider, queue, failure and recovery paths work; no secrets in client build. | DE-13 deployment log + redacted network evidence |
| TC05 | DE-05 / DE-14 | Mixed sale/rental fixture: Rentals shows rentals only with amount and period; sale collection and detail prices agree; empty state works. | DE-14 attachment |
| TC06 | DE-06 / DE-15 | Tour action opens truthful request; save survives its approved persistence boundary; share/copy link opens the same listing; keyboard/mobile activation works. | DE-15 attachment |
| TC07 | DE-07 / DE-11 | Two distinct listings open Deal Studio with matching ID, address, price and supported facts; missing ID and direct entry are labeled. | DE-11 attachment |
| TC08 | DE-08 / DE-10 | Reject 150% vacancy, invalid ranges and cross-field conflicts; server 422 is not replaced locally; edits clear stale base/risk; export matches the successful input snapshot. | DE-10 attachment + workbook comparison |
| TC09 | DE-09 / DE-12 | Switch a multifamily deal to 567 Design Way and another address; prior rent/expenses never appear as new facts, zero and missing values differ, listing/provider/user provenance is visible. | DE-12 attachment |
| TC10 | DE-10 / DE-16 | At 320/390/430/768 px, rental/flip/land form, base, risk, loading and error states have no clipped controls or page-level horizontal overflow. | DE-16 viewport captures |
| TC11 | DE-11 / DE-17 | Gbenga approves claims, advisors, contacts, listing rights, photos and statistics; fixtures are labeled; real contact endpoints reach owners. | DE-17 approval register + contact test |
| TC12 | DE-12 / DE-18 | Privacy/Terms links open readable owner-approved pages; production scripts and consent behavior match the approved inventory; no unintended recording. | DE-18 policy/script sign-off |
| TC13 | DE-13 / DE-19 | Mobile menu items are reachable; Escape closes; focus enters, stays within, and returns to opener; tabs and links work with keyboard/screen reader. | DE-19 device/keyboard record |
| TC14 | DE-14 / DE-20 | Buyer quick prompt, seller follow-up context, source review dates, neutral safety reframing, human queue handoff and service-error recovery work. | DE-20 conversation transcript, redacted |
| TC15 | DE-15 / DE-21 | Neighborhood shortcuts find appropriate listings; padded Austin matches Austin; URL, reload, back/forward preserve filters; reset clears them. | DE-21 query/URL record |
| TC16 | DE-16 / DE-22 | Unknown URL gives a clear 404 with working Home/Search; known deep links and refresh work. | DE-22 URL captures |
| TC17 | DE-17 / DE-23 | A 10,000-iteration browser run discloses the 5,000 cap and exclusions; probabilities show their valid denominator; malformed distributions fail clearly. | DE-23 simulation record |
| TC18 | DE-18 / DE-6 | Public site makes no authenticated-portal or self-service seller claim outside Gbenga's approved brokerage/inquiry launch scope. | DE-6 content review |

## Journey and operational cross-checks

- Buyer: search/listing → inquiry → consent → reference → one queue record →
  Gbenga acknowledgement. Repeat with bad input, unavailable queue, duplicate
  key, and mobile/keyboard operation.
- Seller: seller entry → consultation → consent → reference → one queue record
  → acknowledgement. Check address and message context, invalid email and
  failure/retry. Tour: listing → preferred future time → request (not booking)
  → listing identity in queue.
- Queue staff access must fail closed without configured identity. Verify an
  unauthorized caller cannot list or acknowledge inquiries; an authorized
  Gbenga session can filter, read and acknowledge without exposing secrets in
  the public bundle. Record retention, responder, escalation and out-of-hours
  decisions in DE-31 before production acceptance.
- Open the downloaded workbook in the target spreadsheet application and
  compare its assumptions and calculated outputs with the displayed snapshot.
  Do not rely only on a file-exists assertion.

## Entry, exit, defects and sign-off

Entry to release-candidate QA: frozen commit/URL, green CI, approved scope,
test data and staff access provisioned privately, known issues triaged, and
Tiara has device/browser access. P0 means data exposure/loss or total core
journey failure; P1 means a major broken conversion or materially misleading
financial result; P2 is a significant workaround-able issue; P3 is minor.
Log a Jira defect with steps, build, impact and evidence. Adeoba fixes, Tiara
retests the exact build and nearby regression, and Gbenga approves any scope
or residual-risk exception. Exit requires all 18 rows traceable, buyer and
seller core journeys passing, no open P0/P1, approved operations/deployment,
real-device and workbook evidence, and Tiara's recorded QA sign-off. DE-25
owns full release-candidate acceptance; DE-27 owns the final go/no-go.
