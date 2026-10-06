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

## Not done

- Address suggestions and public-record prefill (finding 7).
- A Go / No-Go for fix and flip.
- A land-specific example: the land tab's untouched example figures reuse the
  rental example's price and hold period and read as a loss-making deal.
- The decision is not written into the Excel workbook.
