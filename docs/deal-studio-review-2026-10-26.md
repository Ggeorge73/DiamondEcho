# Deal Studio: the 2026-10-26 end-to-end review and what changed

An independent end-to-end review on 2026-10-26 ran every Intelligence tool
with scenarios recomputed by hand. The Mortgage simulator and the Seller net
sheet reconciled to the cent and needed nothing. Deal Studio's formulas
reconciled to the dollar too; the findings were about how figures flow
between tabs and what the page shows first. This note records each finding,
the change made, and the figures that moved. The AI engineering role prepared
it; Gbenga reviews and merges.

The service formula is now `diamond-underwriting-1.6.0`, the page's
`diamond-underwriting-web-1.7.0`, and the decision's `diamond-decision-1.5.0`.

## The findings and the changes

| # | Reported | Change |
| --- | --- | --- |
| A | The loan amount sat in "Transparent model output" at the foot of the results; a hard-money flipper reads the loan, the points and the monthly interest first | A **Financing** row of four cards sits right under the headline cards on the Fix & flip decision: loan amount (with how it was sized), cash required at closing, origination fee in dollars, and monthly interest (or payment, for an amortizing loan) with the interest over the hold. The model output keeps the loan amount too |
| B | Switching from the Rental example to Fix & flip with a typed $3,000,000 price set a $360,000 example after-repair value beside it: a $2.9 million loss and a $1.95 million loan on a $360,000 house | A typed purchase price (or one loaded for an address) now anchors the other tabs to that property. The shared facts about it (units, square feet, price, closing costs, due diligence, initial capital work) and the asset type stay; only the strategy's timing (hold, interest-only period, loan term) follows the tab; and the destination tab's own example facts are left empty to enter, with a note naming them and a button to put the examples back. Running with them empty gives "After-repair value must be greater than 0", not a figure |
| 1 | Monte Carlo bands went stale on a strategy switch; the vacancy and exit-cap bands stayed at the example's values | Every band re-follows its box on a tab switch unless the visitor set it. The vacancy and exit-cap bands now follow the entered vacancy and exit cap the way the interest band follows the rate (offsets that reproduce the example: 3 / 6 / 14 around 5%, 5.75 / 6.75 / 8 around 6.5%). A state line under the bands says which bands follow which box and which are "set by you", with a button to follow again |
| 2 | Hold period is in months everywhere; "5" on a rental gave a five-month hold and an 82% IRR with a soft footnote | The rental hold box shows its years ("5 years. Rentals are usually held for years; this box is in months"). A hold under twelve months on the rental tab shows a warning block with one button: "Use 5 years (60 months)". The browser engine now carries the service's warning that year-one figures were annualized from a hold shorter than a year |
| 3 | Land's development schedule and absorption did nothing; the facility was drawn in full on day one and charged interest for the whole hold | Both engines spend the development budget evenly over the development months from closing, draw the facility as the money is spent (interest on the drawn balance), take the sales evenly over the absorption months at the end of the hold, and repay the facility from the sales as they close. The residual land value is solved on that timetable (see below). The two boxes carry hints, and the warnings say when the schedule overlaps the hold or leaves idle months |
| 4 | DSCR was computed before replacement reserves and TI while cash-on-cash deducted them | Both engines report `dscr` (on NOI) and `dscr_after_reserves` (NOI less reserves and TI, leasing and capital costs). The page shows both; a "DSCR measured on" choice in the mandate decides which one the minimum DSCR hurdle, the ceiling and the scenario table use. On the building example: 1.45× and 1.18× |
| 5 | Rental's Downside / Upside cases were undisclosed | The assumptions are printed under the table, as flip and land already did |
| 6 | Messages exposed `9007199254740991` and field keys ("rehabCost cannot be negative"), said "Rentable square feet" on the land tab; the rental ceiling solver scaled closing costs with price while flip and land held them; the land contingency's scope was unstated | Every message names the box as the page labels it and never prints the safe-integer bound. All three solvers hold other costs, closing costs included, as entered, and the rental notice says so. The contingency box says "On site work and hard construction only" |

## The land timetable (item 3)

The model, identical in `backend/deal_intelligence/engine.py` and
`frontend/src/lib/dealAnalysis.js`:

- Acquisition costs (price, closing, due diligence, initial capital work)
  fall at closing. The development budget, contingency included, is spent
  evenly over the development months, counted from closing.
- The facility funds its share of every dollar as it is spent: at closing
  the same share of the acquisition, then of each month's spend. A draw lands
  at the end of its month and bears interest from the next. The amortizing
  payment, where there is one, is set on the whole commitment, as the lender
  writes it. Origination fees are charged on the whole commitment at closing.
- Sales are taken evenly over the absorption months at the end of the hold;
  an absorption of 0 is one sale in the final month. Each month's net
  proceeds repay the facility first, as release terms do; what is left of
  the facility at the end of the hold is repaid then. The sponsor's equity
  goes in as the money is spent and comes back once the facility is clear,
  so the cash flows change sign once and the IRR is defined.
- Both schedules are kept inside the hold. When development plus absorption
  is longer than the hold the model overlaps them and says so; when it is
  shorter, the idle months carry costs and interest and the result says so.
- Carrying costs run monthly for the whole hold.

The residual land value is no longer a closed form. It is the price at which
the development profit equals the target margin on gross terminal value,
found by the secant method on the deal's own cash flows with other costs as
entered, the facility at its modeled share of project cost, and the same
timetable. The profit is linear in the price on a normal schedule, so the
first step lands on the answer and the second confirms it; re-running the
deal at the residual returns the target margin (tested in both engines, for
several schedules). The simulation leaves the residual out, since it does not
read it and the solve costs two more passes.

Figures that moved, same inputs as before:

| Deal | Before | After |
| --- | --- | --- |
| Reference deal in both engines' tests (price $3,000,000, 24 / 12 months, 60-month hold) | profit −$2,756,112; residual $2,315; IRR −37.37% | profit −$2,483,459; residual $188,394; IRR −32.28% |
| The reviewer's $985,000 deal (18 / 6 months, 24-month hold) | profit $574,469 (13.36%); residual $724,062; IRR not defined by the review's own path | profit $693,172 (16.12%); residual $831,051; IRR 36.48% |
| The land tab's own example ($375,000, 12 / 12 months, 24-month hold) | profit $474,542 (20.81%); ceiling $391,945 | profit $548,441 (24.05%); ceiling $461,207 |

The reviewer's check that moved nothing now moves: 12 / 12 months and 6 / 1
months give $721,413 and $601,406 of profit on the $985,000 deal.

## Second pass, the same day

A second end-to-end run after the merge verified every change above (the new
flip example recomputed by hand to the dollar, the band following an 8%
rate as 7 / 8 / 9.75, the DSCR ceiling moving from $3.62M to $2.96M with the
basis) and found two more things, plus one cosmetic. The service formula is
now `1.7.0`, the page's `web-1.8.0`, the decision's `1.6.0`.

| # | Reported | Change |
| --- | --- | --- |
| 7 | A flip whose hold outran the loan term (13 months on a one-year loan) had the whole $117,000 balance paid from the investor's pocket at maturity, interest stopped, and return on cash fell from 27.8% to 13.3% with no warning. The downside case (three months longer) hit the same trap | In both engines, for every strategy, a loan whose term ends before the hold does is extended to the end of the hold at the same rate: interest runs to the sale and the balance is repaid from it. The result carries a note naming the hold and the term and asking for the extension terms and fee to be confirmed and added to the costs. The flip decision's exception says the same. Three extra months now cost three months of holding and interest, nothing more |
| 8 | A land hold shorter than build plus sell-out (3 months on 12 + 12) compressed the schedule and read as a conditional Go with a 741,908% IRR | A hard stop in both engines and in the page's validation: "Hold period must be at least the development schedule plus the absorption (24 months). Lengthen the hold or shorten the schedule." A simulation iteration that shortens the hold below the schedule is excluded, not shown. The reverse case (idle months) keeps its warning |
| 9 | "construction financing must leave a positive equity contribution" reached the page in lower case | The service's three equity sentences start with a capital letter and end with a full stop, and the page capitalizes any plain sentence a service sends |

What moved: only deals whose hold is longer than the loan term, and the
land Downside case, whose six extra months run past the two-year facility of
the reviewer's deal (its downside profit is $158,240, not $185,648, because
the facility now carries interest for those months instead of being paid off
at maturity with the interest stopping).

## Until the service is redeployed

Production ran revision 22 of the API, formula `1.5.0`, until the second
redeploy of 2026-10-26 (revision 25, `1.6.0`). The second pass needs `1.7.0`
for every strategy, so until the next redeploy the page calculates all three
on the device and says so in the result's notes. Redeploying from `main` is a production change for Gbenga;
the steps are in `docs/de13-production-setup.md`.

## Not changed, on purpose

- Typed figures are still never wiped by a tab switch. The review suggested
  resetting every box to the tab's example on each switch; that would lose a
  visitor's typed figures on a stray click and contradict the DE-25 rule
  that the page never changes a typed figure silently. The anchor rule above
  removes the nonsense the review saw without that cost.
- The rental and flip loans are still drawn in full at closing; only the
  land facility follows a draw schedule.
- A lender that takes release prices from each sale is modeled; one that
  lets the sponsor keep interim proceeds while the facility runs is not.

## Tests

- `frontend/src/lib/dealValidation.test.js`: the messages, by label.
- `frontend/src/lib/dealAnalysis.test.js` and
  `backend/tests/deal_intelligence/test_engine.py`: the timetable (spend,
  draws, releases, overlap and idle warnings, zero absorption), the residual
  re-run on several schedules, the simulation leaving the residual out, the
  two coverages, the short-hold warning, and the reference figures pinned to
  the same digits in both engines.
- `frontend/src/lib/dealDecision.test.js`: the land decision at the new
  figures, the rental ceilings with closing costs held, the DSCR basis.
- `frontend/src/pages/DealStudioReview.test.jsx`: the financing cards, the
  bands and their state line, the review's own interest-rate path, the hold
  helper, the DSCR choice on the hurdle and the table, the rental case note,
  the messages, and the land hints on the real page.
- `frontend/src/pages/DealStudioFlip.test.jsx` and `DealStudioLand.test.jsx`:
  the anchor rule (a typed price keeps the property facts, clears the
  destination's example facts, offers them back) and the new land figures.

Not checked: a real browser or a real phone on this build, and the service
is not redeployed by this change.
