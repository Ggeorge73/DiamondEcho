# Deal Studio: the Fix & flip tab's Go / No-Go, interest band and contingency (2026-10-22)

On 2026-10-22 an advisor drove the Fix & flip tab as a visitor would, with a
real rural fixer: a $93,000 house needing $85,000 of work, financed with hard
money at 11%. The tab's arithmetic matched a hand calculation to the dollar.
Three of the eight findings were about what the tab does with those figures,
and this change answers them. The other five (price-history and seller
signals, loan sizing on rehab, hold period as a risk driver, derived holding
costs, after-repair-value sanity checks) are not in this change.

| # | Finding | What changed |
| --- | --- | --- |
| 1 | The simulation drew the loan's interest rate from three boxes shown only on the Rental tab, so a flip typed at 11% was simulated at about 6.75% | The band is on every tab, and it follows the entered rate until the visitor edits it |
| 3 | No Go / No-Go and no maximum offer for a flip; the 70% warning said "exceeds" but not by how much | The tab has an IC decision: the highest price that earns the minimum profit and the minimum return on cash, and a call |
| 6 | The simulation shocked the rehab budget and then applied the contingency on top, so a 35% overrun with a 15% contingency became 55% | The drawn overrun replaces the contingency reserve; a draw equal to the contingency is the base case |

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
produced it. The land simulation still applies its contingency on top of a
development-cost draw; it has the same shape of fault and is not changed
here.

## Tests

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
