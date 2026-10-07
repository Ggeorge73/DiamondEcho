# Deal Studio: land Go / No-Go and the 2026-10-06 test findings (DE-37, found under DE-25)

Gbenga tested the "Intelligence" page on production on 2026-10-06 and reported
eight issues, with one requirement: "I need to be able to run a deals on Land
development to help guide on decisions. The land development deal should be
able to give an idea of profitability and if a deal is a Go or No/Go."

This file says how the land decision is reached, so that any figure on screen
can be checked by hand, and records what each finding turned out to be.

## How the land decision is reached

Everything is calculated from the figures on the form. Nothing is looked up.

### Profit and margin

- **Development profit** = net sale proceeds − project cost − loan fees − loan
  interest − carrying costs, where net sale proceeds = exit value × (1 − selling
  costs).
- **Development margin** = development profit ÷ gross exit value.
- **Return on equity** = development profit ÷ the cash put in.
- **Break-even exit value** = everything spent ÷ (1 − selling costs).
- **Safety cushion** = (exit value − break-even exit value) ÷ exit value: how far
  the exit value can fall before the deal stops making money.

### The highest land price that works

**Residual land value** is the land price at which the deal earns exactly the
target margin. Other costs stay as entered, and the loan stays the same share of
total cost, so fees and interest move with the price:

```
project cost at the ceiling = (exit value × (1 − selling costs − target margin) − carrying costs)
                              ÷ (1 + (loan fees + loan interest) ÷ project cost)
residual land value         = project cost at the ceiling − every cost other than the land
```

Enter the residual as the purchase price and run again: the margin comes out at
the target. That is the check that the two figures agree.

If a target IRR is entered, the page also finds, by repeated calculation, the
highest price at which the IRR target is met. If a comparable land value is
entered, that is a third ceiling. **The lowest ceiling controls.** The
"maximum land price" shown is that ceiling rounded down to the nearest $5,000
($1,000 under $250,000).

### The call

Checked in this order; the first that applies is shown.

| Call | When |
| --- | --- |
| NO-GO — NO EXIT VALUE ENTERED | No exit value, and no stabilized NOI with a cap rate |
| NO-GO — SITE CONDITION | Legal access is "No confirmed access", or utilities are "Unavailable" |
| NO-GO — THE DEAL LOSES MONEY | Profit at the purchase price is zero or negative |
| NO-GO — NO LAND PRICE MEETS YOUR TARGETS | A target cannot be met at any price |
| NO-GO AT THIS PRICE — REPRICE OR PASS | The price is more than 5% above the ceiling |
| NEGOTIATE — WITHIN 5% OF THE CEILING | The price is above the ceiling by 5% or less |
| CONDITIONAL GO — RESOLVE EXCEPTIONS | Targets met, but an exception below applies |
| CONDITIONAL GO — VERIFY BEFORE CLOSING | Targets met, no exception, but diligence items are unverified |
| GO — MEETS YOUR TARGETS | Targets met, no exception, all ten diligence items verified |

Exceptions: the downside case loses money; development plus absorption is longer
than the hold period; remediation is required with no cost entered; the flood
zone is a Special Flood Hazard Area; wetlands are on the site.

### Evidence

Ten items. Six follow the answers on the form (entitlement, utilities, access,
environmental, geotechnical, flood zone looked up). Four are ticked by hand
(title and survey, exit value supported, budget backed by bids, lender terms).
Confidence is High at 8 or more, Medium at 5 to 7, Low below 5.

### The three cases

| Case | Exit value | Development costs | Time | Interest rate |
| --- | --- | --- | --- | --- |
| Downside | 10% lower | 10% higher | 6 months longer | 0.5 points higher |
| Base | as entered | as entered | as entered | as entered |
| Upside | 5% higher | 5% lower | as entered | 0.25 points lower |

A "Go" here means the figures entered meet the targets entered. It is not an
appraisal, an offer, or an investment recommendation, and the page says so.

## The eight findings

| # | Reported | Cause | What changed |
| --- | --- | --- | --- |
| 1 | No IC decision for land deals | The decision was built for rentals only | Land has its own decision, as above |
| 2 | Residual land value ($1,013,695) above the price ($985,000) while the margin missed 20% | The residual took the target margin off *net* proceeds, while the margin is measured on *gross* exit value, and it left out loan fees | The residual is now the price that earns exactly the target margin. Both calculation engines changed and are pinned to the same figures by test |
| 3 | Monte Carlo ran 3,400 of 5,000 on the rental tab | The service has one processor and stops a simulation at 20 seconds | The simulation runs in the visitor's browser in blocks, with progress. Every choice up to 10,000 completes |
| 4 | "(4,997 of 5,000 valid results)" read as a count of valid results | The first number was the count above zero | Now "(4,997 above zero out of 5,000 valid results)" |
| 5 | Typing an address wiped the figures and set the asset type to Single-family; the Rental tab set Lot / land to Multifamily | An earlier fix cleared everything on any address change, and the tabs set the asset type without saying so | Typing an address keeps what the visitor entered, never touches the asset type or tab, clears only the example figures, says so, and offers to put them back. Leaving the land tab returns to the asset type in use before it, with a note |
| 6 | Results off-screen after pressing Run; Monte Carlo tab showed its empty text while running | Results sat at the top of the page; no running state | On a wide screen the results stay beside the form; on a phone the page scrolls to them. Both runs show a running state, the simulation with a progress bar |
| 7 | No address suggestions | Production has no address or public-record provider | Not fixed: needs provider accounts, which is the owner's decision. The page now says plainly that lookup is not available, and no longer offers market names as if they were addresses |
| 8 | "Not verified" typed as the flood zone raised the hazard-zone warning | Any text other than "X" counted as a zone | The box is read as a FEMA designation. Other text means "not verified", with a hint under the box |

## Rule changed from the launch audit (for the owner's acceptance)

Audit item DE-09 (Jira DE-12) asked that figures never carry from one property
to another, and the fix cleared every figure whenever the address changed.
Finding 5 is that fix seen from the visitor's side. The rule is now: figures
the visitor did not enter (examples, or facts loaded for another address) are
still cleared, with a notice; figures the visitor typed are kept. A visitor who
analyses one property and then types a different address keeps their own
typed figures and must change them. Results are always cleared when anything
changes.

## Until the service is redeployed

The residual formula lives in both the page and the analysis service. The page
checks the service's formula version: for a land deal answered by a service
older than `diamond-underwriting-1.1.0`, it calculates on the device instead, so
the older residual is never shown. Redeploying the service from `main` is a
production change that needs Gbenga's yes; after it, the service answers land
deals itself again.

## Found on production after the merge (DE-38)

The simulation paused between blocks with a zero-delay timer. A browser slows
the timers of a tab that is not in view: to one a second, and after about five
minutes to one a minute. On production on 2026-10-06, in a tab that was not in
view in Edge, a land run of 10,000 iterations for each of three cases reached
4,500 of 30,000 after about a minute and then advanced 375 in the next 20
seconds or more. In view, the same run takes about 2 seconds. The figures were
never wrong; the run was only slow, and showed its progress throughout.

The pause now waits on a message (`MessageChannel`), which browsers do not
slow, and falls back to a timer where there is no message channel
(`nextTask` in `frontend/src/lib/dealAnalysis.js`). A browser that puts a tab
to sleep entirely still stops the run until the visitor returns.

## The land tab's own example

Before this, the Land development tab opened on the apartment-building
example's price and hold period: a $3,000,000 purchase held five years. With
the land costs beside it, the untouched page read "NO-GO — THE DEAL LOSES
MONEY", a $2,756,112 loss, before a visitor had typed anything.

The land tab now opens on an example of its own, twelve finished lots on six
acres, sold as lots:

| Figure | Example |
| --- | --- |
| Land price | $375,000 |
| Closing costs, due diligence | $15,000, $25,000 |
| Site work and infrastructure | $780,000 |
| Soft costs, permits and impact fees, developer fee | $110,000, $60,000, $60,000 |
| Contingency | 10% of site work |
| Carrying costs | $12,000 a year |
| Development, then sales | 12 months, then 12 months |
| Loan | 65% of cost, 6.75%, interest only, 2 years |
| Sale of the lots | $2,280,000 ($190,000 a lot), 6% selling costs |
| Target margin | 20% of exit value |

Untouched, it reads **"CONDITIONAL GO — VERIFY BEFORE CLOSING"**: a $474,542
profit, 20.81% of exit value, a highest workable land price of $391,945
(shown as $390,000), and 0 of 10 diligence items verified. The page and the
service give the same figures for it. It was chosen to show a deal that works
on paper and still has every piece of diligence to do, which is the state a
real land deal starts in.

**These are made-up figures, not a real property, a market estimate or advice.**
The page says so in two places: the line above the form ("Any prefilled numbers
are illustrative") and the note shown on opening the tab. Gbenga can replace
any of them; they are in `initialForm` and `LAND_EXAMPLE_SHARED` in
`frontend/src/pages/InvestmentCalculator.jsx`.

How the swap works. The land-only boxes simply start with these values. Six
boxes are shared with the other two tabs (purchase price, closing costs,
initial capital work, hold period, interest-only period, loan term). While one
of those still holds an untouched example figure, opening the land tab changes
it to the land example's and leaving puts the building's back, and the note
says so. A figure the visitor typed is never changed. A box cleared because an
address was typed stays empty. Buildable square feet is not swapped between the
building and land examples, because its land value would be an empty box, and
an empty box must never be refilled with an example.

The Fix & flip tab has an example of its own as well, added later and described
in [deal-studio-flip-example.md](deal-studio-flip-example.md). It works the
same way and shares three more boxes (units, square feet, due diligence), so
moving from the flip tab to the land tab sets those three back to the figures
the land tab has always shown.

## Not done

- Address suggestions and public-record prefill (finding 7).
- A Go / No-Go for fix and flip.
- The decision is not written into the Excel workbook.
