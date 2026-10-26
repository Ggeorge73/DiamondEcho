# Deal Studio: the Fix & flip tab's Go / No-Go, interest band and contingency (2026-10-22)

On 2026-10-22 an advisor drove the Fix & flip tab as a visitor would, with a
real rural fixer: a $93,000 house needing $85,000 of work, financed with hard
money at 11%. The tab's arithmetic matched a hand calculation to the dollar.
All eight findings are answered by the changes below, made the same day in
three steps: items 1, 3 and 6; then 4 and 5; then 2, 7 and 8. One limit
stands: the site still looks nothing up. Item 2's facts are typed in, or
loaded for an address where a public-record provider is configured, which
is an account decision for Gbenga (see `docs/deal-studio-land-decision.md`,
finding 7).

| # | Finding | What changed |
| --- | --- | --- |
| 1 | The simulation drew the loan's interest rate from three boxes shown only on the Rental tab, so a flip typed at 11% was simulated at about 6.75% | The band is on every tab, and it follows the entered rate until the visitor edits it |
| 2 | Price history and seller signals never reached the visitor: bought $135K, relisted $141.9K, cut to $93K, agent-owned, no disclosure, as-is | A "Listing history & seller" box; the decision says what those facts usually mean, as exceptions to resolve |
| 3 | No Go / No-Go and no maximum offer for a flip; the 70% warning said "exceeds" but not by how much | The tab has an IC decision: the highest price that earns the minimum profit and the minimum return on cash, and a call |
| 4 | The loan was sized on the price alone, so the hard-money flip showed a 32.6% loan-to-cost that no flipper borrows at | A "Rehab financed by the loan" box: the loan funds that share of the rehab budget on top of loan-to-value times the price |
| 5 | The hold period was not a risk driver, though timeline is what kills a slow rural flip | A hold-period band, in months, on the Fix & flip and Land development tabs |
| 6 | The simulation shocked the rehab budget and then applied the contingency on top, so a 35% overrun with a 15% contingency became 55% | The drawn overrun replaces the contingency reserve; a draw equal to the contingency is the base case |
| 7 | Holding costs were one guessed lump sum | Taxes, insurance and utilities boxes; insurance and utilities can be estimated from the size; the decision checks the lump sum against the parts |
| 8 | No sanity check on the after-repair value | Price and after-repair value per square foot, a check against renovated comparable sales per square foot, and the reminder that a different kind of property does not price this one |

Everything is calculated from the figures on the form. Nothing is looked up.

## The reference deal

The figures the advisor used, kept in the tests as the fixture for this tab
(no address; it is a set of figures, not a listing):

| Figure | Value |
| --- | --- |
| Purchase price, closing, due diligence | $93,000, $3,000, $2,000 |
| Loan | 70% of the price, 11%, interest only, 1-year term, 2 points |
| Rehab budget, contingency | $85,000, 15% ($97,750 funded) |
| Monthly holding costs, other costs | $450, $4,000 |
| After-repair value, selling costs | $250,000, 7% |
| Hold period, discount rate | 7 months, 10% |

Base case, identical in the page and the service: profit $24,121, 16.83% on
cash, IRR 31.56%, NPV $15,296, 1.17× multiple, loan-to-cost 32.6%, 70% rule
figure $77,250. Both engines are pinned to these figures by test.

## The decision (item 3)

Two targets, both the visitor's to set, in the new "Targets & evidence" box:
a **minimum profit** in dollars (starts at $30,000) and a **minimum return on
cash**, which is flip ROI, profit over all the cash put in (starts at 20%; 0
switches it off).

### The highest price that works

For each target the page finds, by repeated calculation, the highest purchase
price at which the target is still met. Other costs stay as entered; the loan
stays the same share of the price, so points and interest move with it. **The
lowest ceiling controls.** The "maximum offer" shown is that ceiling rounded
down to the nearest $1,000 under $250,000, $5,000 above.

For the reference deal, profit moves $1.0589 for every dollar of price (the
dollar itself, 2 points on 70% of it, and seven months' interest on 70% of
it), so $30,000 of profit needs the price $5,553 lower: **$87,447**. Run the
deal at that price and the profit is $30,000. The 20% return ceiling is
$88,989, so the profit target binds.

The **70% rule figure** (70% of after-repair value less rehab and
contingency, here $77,250) is listed beside the two ceilings, marked SCREEN.
It never sets the maximum. A price above it is an exception to resolve, with
the amount: "The price is $15,750 above the 70% rule screening figure of
$77,250."

### The call

Checked in this order; the first that applies is shown.

| Call | When |
| --- | --- |
| NO-GO — NO AFTER-REPAIR VALUE ENTERED | No after-repair value |
| NO-GO — THE DEAL LOSES MONEY | Profit at the purchase price is zero or negative |
| NO-GO — NO PRICE MEETS YOUR TARGETS | A target cannot be met at any price |
| NO-GO AT THIS PRICE — REPRICE OR PASS | The price is more than 5% above the ceiling |
| NEGOTIATE — WITHIN 5% OF THE CEILING | The price is above the ceiling by 5% or less |
| CONDITIONAL GO — RESOLVE EXCEPTIONS | Targets met, but an exception below applies |
| CONDITIONAL GO — VERIFY BEFORE CLOSING | Targets met, no exception, but evidence items are unticked |
| GO — MEETS YOUR TARGETS | Targets met, no exception, all seven evidence items ticked |

Exceptions: the downside case loses money; the price is above the 70% rule
figure; the after-repair value can fall less than 10% before the deal loses
money; the hold is longer than the loan term.

The reference deal at list is **NO-GO AT THIS PRICE — REPRICE OR PASS**: "At
$93,000 the deal is modeled to earn $24,121 (16.83% on cash), short of your
$30,000 minimum profit and your 20% return on cash. The highest price that
meets your targets is $87,447, which is $5,553 below this price." At $90,000
it is NEGOTIATE. At $77,000 it meets the targets with no exception, and is a
conditional Go until the evidence is ticked, then a Go. This is the advisor's
own read of the deal: it works near the 70% figure, or in the high $80,000s
for a $30,000 minimum profit.

### Also shown

- **Break-even after-repair value** = after-repair value − profit ÷ (1 −
  selling costs), because profit moves one for one with net sale proceeds.
- **Safety cushion** = (after-repair value − break-even) ÷ after-repair
  value: how far the value can fall before the deal loses money. Beside it,
  the further rehab overrun beyond the contingency that uses up the profit
  (profit ÷ rehab budget, since rehab is paid from equity dollar for dollar).
- **Three cases**:

| Case | After-repair value | Rehab | Time |
| --- | --- | --- | --- |
| Downside | 10% lower | 15% over budget; the overrun replaces the contingency | 3 months longer |
| Base | as entered | as entered, contingency as a cost | as entered |
| Upside | 5% higher | on budget, contingency unspent | as entered |

### Evidence

Seven items, all ticked by hand: after-repair value supported by sold
comparables of the same kind of house; rehab budget backed by a contractor
walk-through and bids; inspection complete (roof, structure, HVAC, electrical,
plumbing, septic or well where they apply); holding costs priced; lender term
sheet confirmed; title, survey, access and liens reviewed; exit plan and
selling costs confirmed. Confidence is High at 6 or more, Medium at 3 to 5,
Low below 3.

A "Go" here means the figures entered meet the targets entered. It is not an
appraisal, an offer, or an investment recommendation, and the page says so.

## The interest band (item 1)

The simulation's three interest-rate boxes (low, mode, high) are now on all
three tabs, under the strategy's own drivers. They start one point below the
entered interest rate, at it, and 1.75 points above it (the offsets of the
original 5.75% / 6.75% / 8.5%), and they **follow the entered rate** until
the visitor types in any of the three; from then on they stay as typed. A
note under them says so, and says that for a fixed-rate loan the three should
be set to that rate.

Typing 11% on the Fix & flip tab gives a band of 10% / 11% / 12.75%, and that
is what the simulation draws. Before, the band stayed at the example's 6.75%
and the risk run was quietly rosier on financing than the base case. The
Land development tab had the same hidden band and gets the same fix.

## The contingency in the simulation (item 6)

The "Rehab overrun" draw is the overrun that happened, and the contingency is
the reserve held for it. The draw now **replaces** the reserve instead of
being added on top: simulated rehab = budget × (1 + draw), with no
contingency on top. A draw equal to the contingency rate reproduces the base
case, which treats the whole reserve as spent; a smaller draw means the
reserve was not all needed; a larger one costs only the excess. A 35%
overrun with a 15% contingency therefore costs 35% over budget, not
1.35 × 1.15 = 55%.

Both engines changed in the same way, and both are pinned to the same figures
by test (`backend/tests/deal_intelligence/test_monte_carlo.py`,
`frontend/src/lib/dealAnalysis.test.js`). The base analysis is unchanged; the
formula versions are `diamond-underwriting-1.2.0` (service) and
`diamond-underwriting-web-1.3.0` (page), so a risk result says which rule
produced it. The land simulation had the same shape of fault and was given
the same rule the same day (service `1.3.0`, page `1.4.0`); see
`docs/deal-studio-land-decision.md`.

## Rehab financed by the loan (item 4)

The loan was loan-to-value times the purchase price, nothing else, so on the
reference deal it was $65,100 on $199,750 of cost: a 32.6% loan-to-cost.
Hard-money lenders commonly fund most of the price and all of the rehab.

The "Project & disposition" box now has **Rehab financed by the loan**, a
percentage of the rehabilitation budget (before contingency; the contingency
stays the investor's). The loan is loan-to-value × price + that share × rehab
budget, in both engines (`rehab_financed_rate` on the loan, 0 by default so
every earlier figure, including the page's example, is unchanged). An
explicit loan principal is taken as given. The whole loan is drawn at
purchase and carries interest from the first month, as the rest of the
model already assumed for the rehab; a draw schedule is not modeled.

On the reference deal at 100%: loan $150,100, loan-to-cost 75.1%, and the
extra $85,000 costs 2 points and seven months of 11% interest, $7,154, so
profit falls to $16,967 while the return on cash rises, because less cash is
in. The decision and the maximum offer follow from the same calculation.

**Loan basis.** A "Loan sized on" choice beside it: the loan is the
percentage in the Capital structure box times the **purchase price** (the
default and the earlier behaviour, plus the financed share of the rehab), the
**total project cost** (price, closing, diligence, capital work, rehab with
contingency and other costs), or the **after-repair value**. The rehab share
applies to the price basis only, because the other two already carry the
rehab. The label on the percentage follows the choice (loan-to-value,
loan-to-cost, loan-to-after-repair value), and a "Loan amount" tile states
the figure and how it was sized. On the reference deal at 70%: $65,100 on the
price, $139,825 on the $199,750 of project cost, $175,000 on the after-repair
value. In both engines (`loan_basis` on the loan; an after-repair-value basis
is rejected for a rental or land deal, where there is no such value).

A lender sizes the loan once, at origination, on the underwritten figures. So
the simulation and the three stressed cases keep each flip loan at its base
amount: a draw that lowers the after-repair value, or a stressed rehab on a
loan that funds the budget, does not resize it. Before this, a loan that
funded the rehab would have grown with a simulated overrun. One cap: a
pinned loan never exceeds the project cost of the case it is in, because a
lender funds the cost and no more; a case that spends no contingency under
an after-repair-value loan is sized that way rather than failing.

## The hold period as a risk driver (item 5)

The simulation has a new driver, **hold period change**, in months. Three
boxes on the Fix & flip and Land development tabs (low 0, mode 1, high 4 to
start); the stress cases stretch the high end like the other drivers (×1.25
in the downside case, ×1.75 under severe stress). A draw is added to the
hold period entered and rounded to whole months, never below one. Every
monthly cost moves with it: holding costs, interest, and the loan's
amortization or balloon if the hold runs past the interest-only period or
the term. Both engines carry the driver (`hold_months_change`); a fixed
draw of three months on the reference deal reproduces the base analysis at
ten months exactly. The Rental tab does not show the band: a few months on
a five-year hold is not the risk there.

Formula versions after items 4 and 5: `diamond-underwriting-1.4.0` (service)
and `diamond-underwriting-web-1.5.0` (page); after the loan basis,
`1.5.0` and `web-1.6.0`.

## Listing history and seller signals (item 2)

The single most important fact about the reference property, that the seller
paid $135,000 eighteen months earlier and was now asking $93,000 after nine
months of cuts, with no disclosure, never reached the visitor. The site has
no public-record provider, so the facts are typed into a new "Listing history
& seller" box: last sale price and month, original list price, days on
market, who is selling (owner-occupant, investor, licensed agent, builder,
estate or bank), whether a disclosure was given, and whether the sale is
as-is. Where a provider is configured, the last sale and the tax bill load
with the record. Typing a different address clears them all, except figures
the visitor typed, as for every other box (DE-25).

The decision (`buildListingSignals` in `frontend/src/lib/listingSignals.js`)
turns the facts into reads, each a **caution** (an exception to resolve, so
a deal that meets its targets becomes a conditional Go) or a **note**:

| Fact | Read |
| --- | --- |
| Asking less than the seller paid | Caution: selling below their own basis (after a short hold, if within 36 months) usually means a failed project or a problem found |
| Asking 20% or more than paid within 24 months | Note: check what work was done, and whether it was permitted |
| Cut 10% or more from the original list price | Caution: the market has already passed at higher prices; verify the ARV against sold, not asking, prices. A smaller cut is a note |
| 90 days or more on market | Caution: a thin buyer pool; the resale may take longer, so stress the hold period. 60 to 89 days is a note |
| Investor, agent or builder with no disclosure | Caution: assume they know something; order the inspections, and septic and well tests where they apply |
| No disclosure, any seller | Caution: the inspections are the only account of the house |
| Investor, agent or builder with a disclosure | Note: a priced, professional negotiation |
| Estate, bank or relocation company | Note: no disclosure, slow, by the book, as-is |
| As-is with a contingency under 15% | Caution: 15% to 20% is usual when the seller will not negotiate repairs. At 15% or more, a note |

On the reference listing at $93,000 that is four cautions (below basis, a 34%
cut over 270 days, 270 days on market, agent-owned with no disclosure) and one
note (as-is with a 15% contingency). The facts and the notes are shown in a
"Property intelligence" section of the decision; the cautions join the
exceptions.

## Holding costs from their parts (item 7)

The "Project & disposition" box has three new figures: annual property taxes
(a public figure, never estimated), annual insurance, and monthly utilities.
Two buttons: **Estimate insurance and utilities from N sf** fills the two
that follow from the size of the house, at $0.75 per square foot a year for
vacant-property or builder's-risk cover and $0.10 per square foot a month for
utilities (rough starting points, to be replaced by quotes); **Use $X as the
monthly holding cost** puts the parts' total into the holding-cost box. The
decision raises an exception when no monthly holding cost is entered, or when
the entered figure is more than 10% (and $25) away from the parts. On the
reference house (1,655 sf, $1,220 of taxes) the parts come to $371 a month,
against the $450 the advisor guessed.

## After-repair value sanity checks (item 8)

The decision always shows the after-repair value and the purchase price per
square foot ($151/sf and $56/sf on the reference house). An optional
"Renovated comparable sales" box takes the sold price per square foot of
renovated houses of the same kind; the implied value for this size is shown,
and an after-repair value more than 10% above it is an exception, worded with
the reminder that a cabin, acreage or new-build sale does not price an older
frame house. Without comparables the reminder is a note.

Decision version after items 2, 7 and 8: `diamond-decision-1.4.0`. The
formula versions are unchanged, because the calculation is.

## Until the service is redeployed (2026-10-26)

The service is redeployed by hand from Cloud Shell (see
`docs/de13-production-setup.md`) and lagged the page after the 22 October
changes: production stayed on formula `1.1.0`, which does not know the two
new loan fields and, like every service model, refuses a request carrying a
field it does not know. For four days "Run base analysis" on the live Fix &
flip tab answered an error. Two changes make the page work against an older
service:

- The two loan options (`rehab_financed_rate`, `loan_basis`) are sent only
  when they differ from their defaults, so the usual deal reaches an older
  service as it always did.
- When the service answers a fix and flip with a formula older than `1.5.0`,
  or refuses a field with "Extra inputs are not permitted", the page
  calculates on the device, as it already did for land on a service older
  than `1.1.0`, and says so in the result's notes. The device engine is
  pinned to the service's figures by test. Any other rejection is still
  shown as an error.

Redeploying the service from `main` is still the right end state: the
service then answers every fix and flip itself, with formula `1.5.0`.

## Changed again on 2026-10-26

The end-to-end review of that day added a Financing row to the decision
(loan, cash required, points, monthly interest), changed what a tab switch
does when a purchase price has been typed, made the Monte Carlo bands show
whether they follow their boxes, and polished the messages. See
`docs/deal-studio-review-2026-10-26.md`. The flip figures in this note are
unchanged.

## Tests (items 2, 7 and 8)

- `frontend/src/lib/listingSignals.test.js`: the reference listing's four
  cautions and one note word for word, the milder reads, the as-is and
  estate cases, the month arithmetic, the holding-cost estimate and total,
  and the per-square-foot checks.
- `frontend/src/lib/dealDecision.test.js`: the reference deal at $77,000 with
  every evidence item ticked turns from a Go into a conditional Go on these
  facts alone; nothing typed means no exceptions.
- `frontend/src/lib/propertyAutofill.test.js`: a public record fills the last
  sale and the tax bill, and a new address clears them.
- `frontend/src/pages/DealStudioFlip.test.jsx`: the boxes, the intelligence
  section, and the two buttons on the real page.

## Tests (items 1, 3 and 6)

- `frontend/src/lib/dealDecision.test.js`: ten tests for the flip decision
  (the ceiling and the profit at it, the screen, every call, exceptions, the
  optional return target, the three cases, the untouched example).
- `frontend/src/pages/DealStudioFlip.test.jsx`: six tests on the real page
  (the decision panel for the example and the reference deal, a Go with the
  evidence ticked, the interest band following and then holding, a simulation
  run on the tab).
- `frontend/src/lib/dealAnalysis.test.js` and
  `backend/tests/deal_intelligence/test_monte_carlo.py`: the reference
  figures and the contingency rule in both engines.

Not checked: a real browser or a real phone on this build. The service is not
redeployed by this change; redeploying it from `main` is a production change
for Gbenga.
