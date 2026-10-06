# DiamondEcho Deal Intelligence V1

This package is a deterministic underwriting engine. It does not use an LLM,
external valuation data, or hidden assumptions. The chatbot and UI should call
the API and quote each metric's `formula`, `components`, `formula_version`, and
`warnings` rather than recalculate results.

## API

Register `router` from `deal_intelligence.router` under the application's
existing `/api` router. This exposes:

- `POST /api/v1/deals/analyze`
- `POST /api/v1/deals/scenarios`
- `POST /api/v1/deals/sensitivity`
- `GET /api/v1/deals/assumption-profiles`

Rates are decimal annual rates: `0.065` means 6.5%. Currency inputs are nominal
dollars. Invalid, infinite, contradictory, or strategy-incompatible inputs are
rejected by Pydantic before calculation.

## Supported V1 analysis

Rental analysis supports single-family, multifamily, and commercial aggregate
income/expense underwriting, including vacancy, credit loss, management fees,
reserves, tenant improvements/leasing commissions or other below-NOI costs,
growth, multiple debt tranches, interest-only periods, amortization, balloons,
and explicit-price or exit-cap valuation.

Flip analysis supports acquisition costs, rehab contingency, holding costs,
multiple debt tranches, selling costs, profit, ROI, IRR/NPV, and the 70% rule as
an explicitly labeled screening heuristic.

Land development analysis supports acquisition and transaction costs, site work,
hard and soft construction, permits and impact fees, remediation, developer fee,
contingency on site and hard costs, monthly carrying costs, construction debt,
and a terminal value taken from an explicit expected value or from stabilized
NOI divided by an exit cap rate. Outputs add development profit, ROI and margin,
total development cost, residual land value (the land price at which the deal
earns exactly the target margin on gross terminal value), break-even
terminal value, and cost per acre, unit and buildable square foot. It mirrors
`analyzeLand` in `frontend/src/lib/dealAnalysis.js`; a reference test pins the
two to the same figures. Development uses are treated as committed at
acquisition, so construction draws are not modeled.

Common outputs include monthly equity cash flows, IRR, NPV, equity multiple,
LTV, and LTC. Rental outputs add GPI, EGI, NOI, cap rate, cash-on-cash, DSCR,
debt yield, and break-even occupancy. Undefined ratios return `null` plus a
warning; the API never emits NaN or Infinity.

## Monte Carlo summaries

Each metric summary reports `sample_size`, the number of iterations its
percentiles and probabilities were measured on.

A losing iteration can have no solvable IRR: nothing came back, or the sale
ended under water after some income. Leaving those out would drop the worst
outcomes and overstate the result, so the IRR summary includes them using a
loss-equivalent annual return:

`(cash returned / cash invested) ^ (12 / hold months) - 1`

Nothing back gives -100%. `loss_without_irr_count` says how many iterations in
`sample_size` were scored this way. An unsolvable IRR on an iteration that made
money is still left out, because its sign is not certain; it shows as the gap
between `iterations_completed` and `sample_size`. The single-deal analysis is
unchanged and still returns `null` with a warning when IRR is undefined. The
browser fallback in `frontend/src/lib/dealAnalysis.js` applies the same rule.

## Deliberate boundaries

V1 does not provide an automated valuation, live market/comps, tax or legal
advice, depreciation, partnership waterfalls, construction draws, or refinance
events. Rehab is funded at acquisition. These are
future versioned capabilities and must not be silently approximated.

Before persistence is added, require authentication and tenant authorization;
redact property/client identifiers from logs; enforce body-size and rate limits
at the edge; use strict production CORS; and store the request, formula version,
response, actor, and timestamp as an immutable audit record.
