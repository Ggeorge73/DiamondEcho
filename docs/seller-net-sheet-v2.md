# Seller net sheet, version 2 (`diamond-net-sheet-2.0.0`)

Written by Claude acting as the Engineering and QA agent, 2026-11-09, with the
`super-agent-realtor` and `ga-closing-attorney` skills loaded. Gbenga asked for
a closing-expert review of the Seller Net Sheet after the Mortgage Simulator's,
then: VPR charges no flat seller fee, the listing rate is negotiated; and use
the ring chart as on the mortgage page. He first asked for 2.5%, 2.75% and 3%
quick picks on the listing rate, then the same afternoon decided to leave the
field as it was, "which leaves room for negotiation instead of suggesting 3
options". No rate is suggested. This file records what changed, the rule and source behind each figure,
which figures are examples, and what is still not modelled. Version 1 is in
`docs/buyer-seller-calculators.md`, which still holds for the rest.

Everything still runs in the visitor's browser. Nothing is sent or saved; the
source test in `frontend/src/pages/Policies.test.jsx` still passes. The one
new path to the request form is opt-in (below).

## The review that drove it

Checked against the closing-attorney skill's eleven questions:

| # | Question | Version 1 | Now |
| --- | --- | --- | --- |
| 1 | Closing date drives payoff interest, taxes and dues | Taxes only | All three |
| 2 | Payoff, not balance | A typed "remaining balance" | Balance + per-diem interest to closing + wire cushion + release fee, or the lender's letter |
| 3 | Lines allocated by contract default | Transfer tax on the seller; closing costs 1.5% of price | Transfer tax and deed prep on the **buyer** (GAR default) with a toggle; seller's side itemised and flat |
| 4 | Taxes prorated on the right bill, true-up noted | Correct proration | Unchanged, plus the prior-year and true-up wording |
| 5 | Association dues both ways; letter and transfer fee separate | One deduction | Prorated over month, quarter or year, credit or deduction; past due, closing letter and transfer fee lines with who pays |
| 6 | Residency → Georgia 3% and FIRPTA | Absent | Georgia resident / US / not US; principal-residence exemption; gain affidavit; FIRPTA 15/10/0 |
| 7 | Buyer-broker compensation negotiated per offer | A rate field | Unchanged, said so in the hint, and per offer in the comparison |
| 8 | Brokerage admin fee | Absent | None: Gbenga confirmed VPR charges no flat seller fee |
| 9 | Transfer tax by statute; intangible tax on the loan side | Correct | Unchanged |
| 10 | Compare offers on net | One scenario | Offer B: price, contribution, buyer-broker rate, closing date |
| 11 | Placeholders labelled, source documents named | Yes | Yes, plus "what the attorney will ask you for" |

## Rules and sources

### Who pays what

The GAR F201 Purchase and Sale Agreement's "Items Paid by Buyer" paragraph has
the buyer pay the Georgia transfer tax, the title and tax record search and the
preparation of the warranty deed, and "all other costs, fees and charges to
close", with the seller paying to clear title and any contribution written into
the contract. The statute (O.C.G.A. 48-6-1 et seq.) names the seller as liable
for the transfer tax, which is why most online net sheets put it on the seller;
the contract shifts it. The sheet defaults transfer tax and deed preparation to
the buyer, shows a Buyer / Seller toggle, and says which the contract decides.
Source: GAR F20 sample, 2014 printing, ¶B.4 (the clause is unchanged in
substance in later years; GAR revises the forms each January, and the 2025
changes article confirms the proration true-up in ¶B.3(d)),
<https://images.kw.com/docs/0/8/1/081421/1398705356665_Purchase_and_Sale___Sample.pdf>,
<https://www.qgdigitalpublishing.com/article/Changes+to+the+2025+C+GAR+Contract+Forms/4922581/839296/article.html>.
**Verify against the current year's F201 before quoting a paragraph number.**

The seller's own closing costs are itemised: payoff processing, wire and
courier ($150 placeholder); recording of each lien cancellation at the flat $25
per instrument (O.C.G.A. 15-6-77(f), HB 288, from 2020-01-01,
<https://superiorcourtclerk.chathamcountyga.gov/Superior/RealEstateFees>);
clearing title; mail-away or power of attorney; a home warranty if the contract
provides one; recording and other fees; other costs. Version 1's single
"closing costs" figure is still read if an old form supplies it.

### Payoff

```
per diem        = balance × rate / 100 / 365
interest days   = days from the paid-through date (default: the first of the closing month) to closing, plus a cushion (default 2)
payoff estimate = balance + per diem × interest days + release and statement fees
```

Mortgage interest is paid in arrears; the escrow balance is not netted and is
refunded by the servicer within 30 days of payoff (Reg X, 12 CFR 1024.34(b)).
A second mortgage or HELOC has its own line and the hint says a line of credit
must be closed in writing. The visitor can switch to the figure from the
lender's letter.

### Prorations

Taxes as in version 1 (calendar year, seller's days are 1 January to the day
before closing). The hint adds the metro billing season and the prior-year
fallback with the GAR true-up. Association dues are prorated over the period
that contains the closing (month, quarter or year), as a credit when paid and a
deduction when not. The association's statement of amounts due is governed by
O.C.G.A. 44-3-232(c) (POA Act; five business days; a fee only if the
instruments allow one), <https://law.justia.com/codes/georgia/2020/title-44/chapter-3/article-6/section-44-3-232/>;
management companies' closing-letter charges of $150–400 are a contract charge,
which is what the "Association closing letter" line holds.

### Withholding

Georgia, O.C.G.A. 48-7-128 and Ga. Comp. R. & Regs. 560-7-8-.35: 3% of the
price from a seller whose principal residence is outside Georgia at closing;
3% of the gain with a sworn gain affidavit (IT-AFF2); none if the home was the
seller's principal residence, if the price is under $20,000, or if the tax on
the gain would be under $600. Sources:
<https://www.law.cornell.edu/regulations/georgia/Ga-Comp-R-Regs-R-560-7-8-.35>,
<https://law.justia.com/codes/georgia/2020/title-48/chapter-7/article-5/section-48-7-128>.

FIRPTA, IRC 1445: 15% of the price from a seller who is not a US resident; 10%
when the price is over $300,000 and up to $1,000,000 and the buyer will live in
the home; nothing at $300,000 or less with a buyer who will live in it. The
seller's own use does not exempt FIRPTA. The notes route the affidavits and any
withholding certificate to the closing attorney and a CPA.

### Commission

Both rates are typed and start empty, as in version 1. Gbenga, 2026-11-09:
"VPR doesn't charge a flat fee for Seller, it's based on negotiation", and
later the same day, on the quick picks he had first asked for: "leave the Real
Estate Commission toggle as it is, which leaves room for negotiation instead of
suggesting 3 options." The note says commission is negotiable and not set by
law, in line with the practice changes of 2024-08-17. The buyer's brokerage
rate carries a hint that it differs offer by offer.

### Offer comparison

Offer B takes a price, a contribution to the buyer's costs, a buyer-broker rate
(blank: the one above) and a closing date (blank: the one above). Everything
else is shared. The table shows price, contribution, commission, payoff, the
rest, the two nets and the difference in words.

### The ring

`PaymentDonut` now takes `labels`, so the same component draws the mortgage
payment and "Where the sale price goes": what the seller keeps and each group
of deductions (loans and liens, commission, closing costs, credits to the
buyer, prorations and association, withholding). Credits are inside the net, so
the ring's total is the price plus credits. In a shortfall the "You keep" part
is zero and left out.

## Example figures

| Field | Starts at | Why |
| --- | --- | --- |
| Sale price | $450,000 | Example, labelled |
| Closing date | empty | Prorations and payoff interest wait for it |
| Mortgage balance, rate | $250,000 at 6.25% | Example; the hint says a payoff is more |
| Release and statement fees | $50 | Placeholder |
| Payoff processing | $150 | Placeholder |
| Deed preparation | $150, buyer's by default | Placeholder, only counted if the seller pays |
| Listing, buyer rates | empty | No suggested rate |
| Residency | Georgia resident, principal residence | The usual case |
| Everything else | empty | |

With these, the page opens on $199,775 net: $450,000 less $250,050 (balance
plus release fee, no interest until a date), $150 and $25.

## Pre-approval-style request

"Request a home valuation" now opens `/inquire?type=seller&topic=net-sheet`,
which starts the seller message ("I would like a valuation of my home and to
talk through what I would net from a sale.") and says a valuation is not an
appraisal. If the visitor ticks "Include my figures", the link carries a
one-paragraph summary (price, closing date, payoff, commission, deductions,
net, withholding) through the same `figures` parameter and cleaning as the
mortgage simulator; the message says it came from the seller net sheet. No
name, email or phone is ever carried. A print button prints the results.

## Tests

- `frontend/src/lib/netProceeds.test.js`: transfer tax at each boundary and the
  date tests unchanged; dues proration over month, quarter and year; payoff
  estimate; the version-2 worked example ($167,058.94 net); transfer-tax
  toggle; the lender's letter; cancellation recording per lien; Georgia
  withholding (resident, exempt, price, gain, small gain, under $20,000);
  FIRPTA (15/10/0, principal residence does not exempt); association fees by
  payer; the ring shares; the offer comparison; the summary; version-1 inputs.
  Reference figures worked in Python's Decimal.
- `frontend/src/components/calculators/SellerNetSheet.test.jsx`: the page on
  the new example and every new block.
- `frontend/src/pages/Inquire.test.jsx`: the seller topic and its figures.
- Frontend suite on this branch: 53 files, 825 tests. Build and prerender pass.
  Headless Chrome screenshots at 1280 and 390 px checked. Not on a real phone,
  Safari or Firefox.

## Not modelled

- Rents, deposits and utility prorations on a tenanted sale.
- A payoff on a 360-day interest basis (some servicers), or a prepayment penalty.
- The association's $10 statutory statement fee as distinct from the management
  company's charge (the one line holds whatever is quoted).
- FIRPTA withholding certificates and the gain basis for Georgia (typed by the
  seller from a CPA's figure).
- Federal or Georgia income tax on the gain (§121 is named, not computed).
- Seller-paid buyer-broker compensation shown separately from the buyer's
  brokerage rate (it is the same line).

## Decisions for Gbenga

1. Transfer tax and deed preparation defaulting to the buyer, as the GAR form
   has it. The toggle is one click if a contract differs.
2. The seller closing-cost placeholders ($150 processing, $50 release, $150 deed
   preparation).
3. Whether the valuation request should keep the opt-in figures box.
4. The residency wording, which names O.C.G.A. 48-7-128 and IRC 1445 and sends
   the affidavits to the attorney and CPA. He has closed with O'Kelley &
   Sorohan before; their figures were not used anywhere here.
