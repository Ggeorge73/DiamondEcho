# Type 6 acceptance: DE-10 / DE-12

Gbenga reviews and merges the PR; Tiara owns QA acceptance and Adeoba owns
engineering review. These checks map to launch-readiness audit DE-08 (invalid
and stale calculator results) and DE-09 (property autofill provenance). The
source audit file was not available in the confirmed repository; Jira DE-10
and DE-12 supply the acceptance criteria.

## Calculator safety (DE-10)

1. On the release-candidate build, enter 150% vacancy, zero purchase price,
   negative rent, an interest-only period longer than the loan term, and
   unordered Monte Carlo low/mode/high values. Each must give a clear error
   without a base result, simulation, or export.
2. With an API configured, send invalid input that returns HTTP 422 from base
   analysis. The browser must show the rejection and must not calculate a
   local replacement. Test service/network failures separately. (Since DE-25
   Monte Carlo runs on the visitor's device and makes no request; an invalid
   simulation input is refused on the page before anything runs.)
3. Analyze at one price, then edit price, rent, vacancy, market, asset type,
   or a simulation driver. Prior base/risk output must clear immediately; a
   late response for the prior inputs must not restore it.
4. A workbook download requires a successful current base analysis and uses
   that exact form/request/result snapshot. After any input edit or API 422,
   download must be blocked until a successful rerun.

## Property change (DE-12)

1. Starting from the labeled illustrative multifamily analysis with $360,000
   rent, type a different address. Prior rent, expenses, price and other
   property-dependent assumptions must clear, not become facts about it.
2. If live property-data credentials are configured, select a provider address.
   Only supported public-record facts may populate; historical sale price must
   not become a current purchase price. Without credentials, lookup must fail
   closed and manual entry must remain available.
3. Open a legacy `?listing=1` link. It must show no fabricated record or ask.
   For provider data, verify explicit zero remains zero and missing values
   stay blank. Source labels must distinguish provider facts and user entries.
   Analysis must require review of missing financial values before treating
   blanks as zero.
4. Repeat the critical paths by keyboard and on a narrow mobile viewport;
   record browser, viewport, build, test values, and results in Jira. Confirm
   named reviewer acceptance before moving either issue to Done.

Production behavior remains subject to DE-13 deployment and the release
candidate acceptance issue DE-25; a green PR check is not a production claim.
