# Mortgage simulator, version 2 (`diamond-mortgage-2.0.0`)

Written by Claude acting as the Engineering and QA agent, 2026-11-09. Gbenga asked
what a Georgia loan officer would want in the simulator, then said "implement all
your suggestions". This file records what was added, the rule and source behind
each figure the tool now carries, which figures are examples, and what is still
not modelled. The first version is described in `docs/buyer-seller-calculators.md`,
which still holds for everything not mentioned here.

Everything still runs in the visitor's browser. Nothing is sent or saved; the
test in `frontend/src/pages/Policies.test.jsx` reads the sources for network
and storage calls. The one new path to the request form is opt-in and described
under "Pre-approval request" below.

## What was added, and why

| Loan officer's question | What the simulator now does |
| --- | --- |
| Which loan program? | A loan type choice: Conventional, FHA, VA, USDA. It sets the minimum down payment, the upfront fee, whether mortgage insurance exists, what it costs and when it ends |
| What is your credit score? | A score band. It sets the conventional PMI rate from a rate grid. The interest rate is still the lender's quote, typed by the visitor |
| Which county, and will you live there? | A county choice that fills a starting tax rate, and a primary-residence box. Both change the notes about homestead and about which programs apply |
| How much do you need to bring? | A cash-to-close panel: down payment, closing costs including Georgia's intangible tax, prepaids and escrow reserve, less seller credit and earnest money |
| What do you earn and owe? | Debt-to-income on the purchase against the program's usual ceilings, and the price the same income would carry |
| Points or a buydown? | Discount points go into the cash to close; a 2-1 or 1-0 buydown shows the early-year payments and what the buydown costs |
| What happens when the ARM adjusts? | The visitor's own later-rate path (as before) and the worst case the usual caps allow |
| Extra payments? | Extra principal a month on a fixed loan: payoff date and interest saved |
| First-time buyer help? | A note under the cash to close pointing to Georgia Dream, with no figures of its own |
| Can I take this to a lender? | A print button, and an opt-in box that puts a plain-text summary of the figures into the pre-approval request |

The example now puts **5% down** instead of 20%, so the mortgage insurance line
is on screen. It is still labelled as an example.

## Rules and sources

### Loan types

| Type | Minimum down | Upfront fee | Monthly insurance or fee | Ends |
| --- | --- | --- | --- | --- |
| Conventional | 3% (first-time buyers; otherwise 5%) | none | PMI from the grid below, on the base loan, under 20% down | At 78% of the price or the term's midpoint (Homeowners Protection Act), as in version 1 |
| FHA | 3.5% | 1.75% of the base loan (UFMIP) | Annual MIP on the balance: 0.50% at LTV ≤ 95%, 0.55% above, for loans up to $726,200 on terms over 15 years; 0.70% / 0.75% above that loan size; 0.15% / 0.40% / 0.65% on terms of 15 years or less | 11 years at LTV ≤ 90%; otherwise the life of the loan |
| VA | 0% | Funding fee: 2.15% first use / 3.3% after, under 5% down; 1.5% at 5–10%; 1.25% at 10% or more. None if exempt | none | — |
| USDA | 0% | 1.00% guarantee fee | 0.35% a year on the balance | Life of the loan |

The upfront fee is added to the loan by default (a box lets the visitor pay it
at closing instead). FHA's LTV for the MIP tier is the base LTV before the UFMIP.
FHA and USDA charge on the balance, so the tool recalculates monthly on the
scheduled balance; HUD and USDA use the year's average scheduled balance, which
differs by cents.

Sources:
- FHA: Bankrate's guide to FHA mortgage insurance, last modified 2026-09-30,
  <https://www.bankrate.com/mortgage/fha-mortgage-insurance-guide> (HUD's
  Mortgagee Letter 2023-05 is the primary source for the same table).
- VA: U.S. Department of Veterans Affairs, "VA funding fee and loan closing
  costs", rates effective 2023-04-07, page updated 2026-10-05,
  <https://www.va.gov/housing-assistance/home-loans/funding-fee-and-closing-costs/>.
- USDA: Rural Development SFH Guaranteed bulletins for FY2026 and FY2027
  (1.00% upfront, 0.35% annual),
  <https://content.govdelivery.com/accounts/USDARD/bulletins/3f192a6> and
  <https://content.govdelivery.com/accounts/USDARD/bulletins/42b1054>.

The minimum down payments and the 580 FHA score floor are program rules the
page states in the hints; the FHA 3.5% figure and the conventional 3% first-time
figure are the programs' own.

### Conventional PMI grid

`PMI_GRID` in `frontend/src/lib/mortgage.js`: four LTV bands (80.01–85, 85.01–90,
90.01–95, 95.01–97) by nine score bands (760+ down to below 620). It is
**representative of published borrower-paid monthly rate cards** for a fixed
loan over 20 years; it is not any one insurer's card, and the page says the
insurer's card governs. The visitor can switch the field to "Mine" and type the
rate from their quote. Below 620 the lowest row is used and a note says most
conventional lenders need 620.

### County tax rates

`GEORGIA_COUNTIES`: fourteen metro Atlanta counties with an effective rate,
rounded to two decimals, from the Georgia Public Policy Foundation's
"Georgia property taxes by county" (2023 median property taxes paid over 2023
median home value),
<https://www.georgiapolicy.org/wp-content/uploads/2025/08/Georgia-property-taxes-by-county.pdf>.
Those medians reflect owners with homestead exemptions and are placeholders.
The hint says exemptions do not transfer, that a buyer's first bill is often
higher, and that homestead must be filed with the county by April 1. Typing a
tax figure switches the county to "Other". The 1.2% placeholder from version 1
remains for a link that carries no county and for "Other" with nothing typed.

### Georgia intangible recording tax

$1.50 for each $500, or fraction of $500, of the note, capped at $25,000, on a
long-term note secured by real estate. The lender passes it to the borrower in
a purchase. O.C.G.A. 48-6-60 to 48-6-77; Georgia Department of Revenue,
<https://dor.georgia.gov/node/2141>. House Bill 586 (effective 2025-07-01)
changed only the long-term threshold to 62 months, which does not affect an
ordinary purchase mortgage (Troutman Pepper Locke summary, June 2025). The
transfer tax is customarily the seller's and stays in the seller net sheet.

### Cash to close

```
closing costs = lender fees + attorney/title/settlement + recording and other
              + intangible tax + discount points + HOA initiation
              + upfront fee if not financed
prepaids      = first year of insurance + escrow reserve + prepaid interest
escrow reserve   = months × (annual taxes + annual insurance) / 12
prepaid interest = loan × rate / 365 × days
seller credit    = min(entered, cap % of price, closing costs + prepaids)
due at closing   = down payment + closing costs + prepaids − seller credit − earnest money
total cash needed = due at closing + earnest money + appraisal, inspections and application fees
```

Seller concession caps: Conventional 3% under 10% down, 6% from 10% to under
25%, 9% at 25% or more; FHA 6%; VA 4%; USDA 6%. These are the agencies' limits
on interested-party contributions. Earnest money is held at the down payment.

Example figures in the form (lender fees $1,500; attorney, title and settlement
$2,500; recording and other $250; appraisal, inspections and application fees
$1,000; earnest money $5,000; escrow reserve 3 months; prepaid interest 15
days) are placeholders chosen to be in the usual metro Atlanta range. None is a
quote, and the footnote says a Loan Estimate states them.

### Affordability

```
front = housing payment / monthly income
back  = (housing payment + other monthly debts) / monthly income
```

Usual ceilings used: Conventional back 45%; FHA 31% front, 43% back; VA back
41%; USDA 29% front, 41% back. These are the manual-underwriting figures; the
page says automated underwriting sometimes allows more. "Price this income
carries" is found by bisection on the price that keeps the first month's
housing payment at or under the ceiling, with the same down payment
percentage, rate, insurance and tax rate; it is rounded down to the thousand.

### Buydowns and points

A 2-1 buydown charges the buyer the payment at the note rate less 2 points in
year 1 and less 1 point in year 2; 1-0, less 1 point in year 1. The loan itself
amortises at the note rate. Cost = the sum of the monthly differences, shown as
usually paid from the seller's credit. Points cost `base loan × points / 100`
at closing; the rate the visitor types is taken as the rate quoted with those
points (the tool does not guess how much a point buys).

### Adjustable worst case

Caps per product: 5-year, 2/1/5; 7-year and 10-year, 5/1/5 (initial, each
later adjustment, lifetime). The worst case raises the rate by the initial cap
at the first adjustment and by the periodic cap each year after until the
lifetime cap, and shows the payment at that rate on the balance then owing.
The hint says the note's caps govern. The visitor's own later-rate path from
version 1 is unchanged.

### Extra principal

Fixed loans only. The payoff month and the interest saved against the ordinary
schedule.

## Pre-approval request

The "Get pre-approved" link is unchanged unless the visitor ticks **"Include my
figures in the pre-approval request"**. Then the link carries a `figures`
parameter with `summarizeMortgage()`'s one-paragraph text (price, down
payment, loan type and term, rate, estimated payment, cash to close, and the
debt-to-income figures if income was entered). `Inquire.jsx` accepts it only on
the pre-approval topic, strips everything but letters, digits, spaces and
`$,.%()-:;/`, requires a dollar figure and at most 600 characters, and appends
it to the starting message for the visitor to edit. No name, email or phone is
ever carried. The request still sends only what the form sends.

## Print

"Print this estimate" calls `window.print()`. A print stylesheet hides the
form, the site header and footer and the buttons, and prints the results on
white.

## Tests

- `frontend/src/lib/mortgage.test.js`: the version-1 tests unchanged (a typed
  PMI rate still wins), plus FHA, VA, USDA, PMI grid, minimum down payments,
  intangible tax, cash to close, seller credit caps, buydowns, ARM worst case,
  extra payments, affordability, counties and the summary. Reference figures
  were worked in Python's Decimal.
- `frontend/src/components/calculators/MortgageSimulator.test.jsx`: the page on
  the new example and every new block; the pre-approval link carries nothing
  until the box is ticked.
- `frontend/src/pages/Inquire.test.jsx`: the figures join the message only on
  the pre-approval topic, cleaned and bounded.
- Frontend suite on this branch: 53 files, 811 tests. Build and prerender pass.
- Screenshots of the built page at 1280 and 390 px were checked in headless
  Chrome; not checked on a real phone, Safari or Firefox.

## Not modelled

- Rate pricing by score (the rate is still the lender's quote).
- Loan limits (conforming, FHA county limits) and jumbo rules.
- USDA property and income eligibility (the hint names them; the visitor checks).
- An ARM that resets every six months; the worst case steps yearly.
- Lender credits in exchange for a higher rate.
- Georgia Dream amounts and limits (linked, not computed).
- Capital contribution and transfer fee rules of any particular association.
- Condo warrantability.

## Decisions for Gbenga

1. The example figures: 5% down, Gwinnett, the fee placeholders above. Change
   any he dislikes.
2. Whether the pre-approval request should keep the opt-in figures box.
3. When he names a lender, "Get pre-approved" can open the lender's page; the
   figures box would then need the lender's own form, so it would go.
