# Deal Studio: the Fix & flip tab's own example (DE-25)

## What was wrong

The three Deal Studio tabs share one set of boxes for the price, the closing
costs, the hold period and the loan. Those boxes start as an apartment-building
example: a $3,000,000 purchase held for five years. On the Fix & flip tab that
read as a flip that held a building for sixty months, and "Run base analysis"
on the untouched page showed a **$930,936 loss**, a -30.54% return, before a
visitor had typed anything. The arithmetic was right. The example was not a
flip. The Land development tab had the same fault and was given its own
example under DE-37; this does the same for Fix & flip. Found in the
release-candidate pass on 2026-10-07; Gbenga asked for it the same day.

## The example

One single-family house, bought, renovated and sold in ten months:

| Figure | Example |
| --- | --- |
| Asset type, units, size | Single-family, 1 unit, 1,800 square feet |
| Purchase price | $180,000 |
| Closing costs, due diligence | $5,500, $1,500 |
| Initial capital work | $0 (the work is in the rehabilitation budget) |
| Rehabilitation budget | $65,000, plus 10% contingency ($71,500) |
| Monthly holding costs | $1,800 |
| Other project costs | $6,000 |
| Hold period | 10 months |
| Loan | 65% of the price, 6.75%, interest only, 1-year term, 1% fee |
| After-repair value | $360,000, 6% selling costs |

Untouched, "Run base analysis" shows:

| Result | Value |
| --- | --- |
| Projected profit | $48,149 |
| Flip ROI | 27.79% |
| Projected IRR | 37.31% |
| Net present value | $32,289 |
| Equity multiple | 1.28× |
| Loan-to-value, loan-to-cost | 65%, 44.23% |
| 70% screening threshold | $180,500 |

The page's calculation and the service's give the same eight figures for it,
to the last digit (checked against a local copy of the service on formula
`diamond-underwriting-1.1.0`).

Why these figures. The price sits just under the page's own 70% screening
figure ($180,500), so the example does not open on a warning about itself, and
the costs a flip really carries are all there (closing, holding, selling,
interest, a contingency). The risk run on the untouched example is not
flattering either: 95.8% of the committee-case results are above zero, 87% in
the downside case and 68.96% under severe stress, with a 10th-percentile loss
of $26,830 in that last case. That is the point of it: a deal that works on
paper and can still lose money.

**These are made-up figures, not a real property, a market estimate, a
forecast of returns or advice.** The page says so in three places: the line
above the form ("Any prefilled numbers are illustrative"), the note shown on
opening the tab, and the line under the results ("Illustrative analysis
only"). Gbenga can replace any of them; they are in `initialForm` and
`FLIP_EXAMPLE_SHARED` in `frontend/src/pages/InvestmentCalculator.jsx`. The
interest rate, loan-to-value, fee, selling costs and discount rate are the
same boxes with the same starting figures on all three tabs and were left
alone.

## How the swap works

The five flip-only boxes (after-repair value, rehabilitation budget,
contingency, monthly holding costs, other project costs) simply start with
these values. Nine boxes are shared with the other tabs: units, square feet,
purchase price, closing costs, due diligence, initial capital work, hold
period, interest-only period and loan term. While one of those still holds an
untouched example figure, opening another tab changes it to that tab's
example, and the note above the form says so.

The asset type follows in the same way, between Rental & commercial
(Multifamily) and Fix & flip (Single-family), while nobody has chosen it and
nothing has loaded it for an address. The note names it. The Land development
tab keeps its own rule: it only analyses Lot / land.

What never changes:

- A figure the visitor typed, or an asset type the visitor chose.
- A figure loaded for an address.
- A box cleared because an address was typed. It stays empty; no example value
  is empty, so a cleared box can never be mistaken for one.

When only some boxes still hold examples, the note lists exactly the ones that
changed, for instance "were set for a fix and flip: asset type, hold period,
interest-only period, loan term."

## What changed for the other tabs

- Rental & commercial: nothing, when opened first. Coming back from Fix & flip
  puts the building example back, with a note.
- Land development: opening it from an untouched page now says the asset type
  "is set back when you leave this tab" rather than naming Multifamily, because
  which type comes back depends on the tab the visitor goes to next.

## Tests

`frontend/src/pages/DealStudioFlip.test.jsx` (8 tests) covers the example, its
results, the way back, typed figures, a chosen asset type, an address typed,
the hand-over with the land tab, and the rule that no example value is empty.
Four tests in `DealStudioLand.test.jsx` that described the old behaviour (the
two building tabs sharing one example) were rewritten. The frontend suite is
516 tests.

Checked in a real browser on a build of this branch at 1280, 390 and 320
pixels wide with a local copy of the service: the figures above, no sideways
scroll on the form, the results or the risk run, no accessibility-rule
violations on the results view (axe-core, WCAG A and AA rules), no page
errors. Not checked: a screen reader, and a real phone.

## Not done

- A Go / No-Go decision for fix and flip. The tab still shows a plain base
  case, as before.
- Nobody with a flipping business has reviewed the example figures. They are
  placeholders chosen to be plausible, and are Gbenga's to change.
