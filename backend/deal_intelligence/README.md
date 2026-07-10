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

Common outputs include monthly equity cash flows, IRR, NPV, equity multiple,
LTV, and LTC. Rental outputs add GPI, EGI, NOI, cap rate, cash-on-cash, DSCR,
debt yield, and break-even occupancy. Undefined ratios return `null` plus a
warning; the API never emits NaN or Infinity.

## Deliberate boundaries

V1 does not provide an automated valuation, live market/comps, tax or legal
advice, depreciation, partnership waterfalls, construction draws, refinance
events, or Monte Carlo simulation. Rehab is funded at acquisition. These are
future versioned capabilities and must not be silently approximated.

Before persistence is added, require authentication and tenant authorization;
redact property/client identifiers from logs; enforce body-size and rate limits
at the edge; use strict production CORS; and store the request, formula version,
response, actor, and timestamp as an immutable audit record.
