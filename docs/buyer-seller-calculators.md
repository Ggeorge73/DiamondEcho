# Buyer Mortgage Simulator and Seller Net Sheet (DE-39)

Written by Claude acting as the Engineering and QA agent, 2026-10-06. Gbenga
asked for "a Buyer Mortgage Simulator and a Seller Net Proceeds Calculator" on
the Intelligence page and said "you can build on what you think is best". This
file says what each tool calculates, where each rule comes from, which figures
are examples, and where the build differs from the request and why.

Both tools calculate in the visitor's browser. They send nothing and save
nothing; a test reads their source for any network or storage call.

## Where they are

The Intelligence page (`/investment-calculator`) now holds three tools, chosen
by a row of three links under the page heading:

| Tool | Address | Code |
| --- | --- | --- |
| Deal Studio (unchanged) | `/investment-calculator` | `frontend/src/pages/InvestmentCalculator.jsx` |
| Mortgage simulator | `/investment-calculator?tool=mortgage` | `frontend/src/components/calculators/MortgageSimulator.jsx`, `frontend/src/lib/mortgage.js` |
| Seller net sheet | `/investment-calculator?tool=net-proceeds` | `frontend/src/components/calculators/SellerNetSheet.jsx`, `frontend/src/lib/netProceeds.js` |

A buyer or seller tool is built the first time it is opened and then kept, so
moving between the tools keeps what was typed in each. Changing only the tool
does not scroll the page back to the top. The footer links to both.

Results update as the visitor types; there is no Run button. On a phone the
results sit below the form, so the headline figure also rides under the site
header while the form is on screen, with a "See breakdown" button.

## Mortgage simulator

### What it calculates

| Figure | Rule |
| --- | --- |
| Down payment | Dollars, or a percentage of the price; never more than the price |
| Loan amount | Price less down payment |
| Principal and interest | The level payment `P × i / (1 − (1 + i)^−n)`, `i` the yearly rate over 12, `n` the months, rounded to the cent. With no interest, `P / n` |
| Schedule | Each month: interest is the balance times `i`, rounded to the cent; the rest of the payment is principal. The last payment clears the cents that rounding leaves |
| Property taxes per month | The yearly figure over 12. The yearly figure is typed, or a percentage of the price |
| Insurance per month | Typed per month, or the yearly figure over 12 |
| Mortgage insurance (PMI) | Charged when the down payment is under 20%: the loan times the yearly PMI rate, over 12 |
| When PMI ends | The last month whose opening balance is above 78% of the price, and never later than halfway through the term |
| Total monthly payment | The five parts added, for the first month |

The PMI ending rule is the Homeowners Protection Act's for conventional loans:
the servicer ends it when the balance is first scheduled to reach 78% of the
original value, and at the midpoint of the term at the latest. A borrower can
ask at 80%; the tool shows the automatic date. FHA and VA loans are outside the
Act, and the page says so.
Source: Federal Reserve, Homeowners Protection Act examination procedures,
<https://www.federalreserve.gov/boarddocs/caletters/2004/0405/CA04-5Attach1.pdf>.

### Loan terms

30, 20 and 15-year fixed, and 10, 7 and 5-year adjustable. An adjustable loan
here is a 30-year loan whose rate holds for the fixed years and then moves
**once**, to a rate the visitor types and the page labels as their assumption.
The payment is worked out again on the balance then owing, over the months
left. Real adjustable loans follow an index and margin within caps and can move
again; the tool does not model that and says so beside the field.

### Example figures and who chose them

| Field | Starts at | Why |
| --- | --- | --- |
| Price | $450,000 | An example, labelled as one above the form |
| Down payment | 20% | The point at which PMI stops applying |
| Interest rate | 6.5% | An example; the hint says to use a lender's quote. It is not a statement of today's rates |
| Rate after the fixed years | Starting rate plus 2 points, filled in when an adjustable term is first chosen | An example so the later payment is not shown as unchanged |
| Property taxes | 1.2% of the price | Gbenga's request ("default estimate ~1.2% if missing"). The hint calls it a placeholder, not a county's rate |
| Insurance | $1,800 a year | An example; the hint says to ask an insurer |
| HOA | $0 | |
| PMI rate | 0.5% of the loan a year | An example; a lender sets it from credit and down payment |

### Filling in from a listing

The request asked for the price, taxes and HOA fee to come from the listing
when the tool is opened from a property page. **The site has no property page
and no listing data.** Listings are shown inside a Georgia MLS frame that the
site cannot read (`docs/de17-content-claims.md`, section 2).

What is built instead is the receiving end: a link can carry the three figures,

`/investment-calculator?tool=mortgage&price=525000&taxes=6100&hoa=140`

and the simulator opens with them, says they "came from the link you followed"
and asks the visitor to check them against the listing. Only plain positive
numbers are accepted. When the site has listing pages, each one needs only this
link.

### Calls to action

Three, in this order:

1. **"Get pre-approved"** opens the buyer request with the eyebrow "Mortgage
   pre-approval" and the message already started ("I would like to get
   pre-approved for a mortgage."), which the visitor can change.
2. **"Contact an agent about this purchase"** ("about this property" when the
   figures came from a link) opens the ordinary buyer request.
3. **"Search Georgia homes"** opens the Georgia MLS search.

The first build (PR #61) left "Get Pre-Approved" out, because pre-approval is
something a lender does and no lender was on record. Asked whether he had a
lender to refer buyers to, Gbenga answered "add it" (2026-10-06, DE-40). He
did not name a lender, so the button asks an agent for an introduction instead
of opening a lender's page. Under the buttons, and on the request page, the
site says: "DiamondEcho is not a lender. Pre-approval comes from a lender: send
a request and an agent can introduce you to one." Nothing typed in the
simulator is carried in the link or sent with the request.

When Gbenga names a lender, the button can open that lender's page directly:
one address in `MortgageSimulator.jsx`.

## Seller net sheet

### What it calculates

Net proceeds are the sale price, less every deduction, plus any credit.

| Line | Rule |
| --- | --- |
| Mortgage payoff, other liens | As typed |
| Listing brokerage commission | Sale price times the listing rate |
| Buyer brokerage compensation | Sale price times the buyer-brokerage rate |
| Closing costs, title and attorney fees | Dollars, or a percentage of the sale price |
| Georgia transfer tax | By statute, below; or a typed figure |
| Recording and government fees, other costs | As typed |
| Seller concessions and repair credits | As typed |
| Prorated property taxes | Estimated, below; or a typed figure |
| Outstanding HOA dues | As typed |

Lines with nothing entered are left out. If the costs exceed the price, the
result is shown as a shortfall, in words and in the chart, not as zero.

### Georgia transfer tax

"$1 for the first $1,000 or fractional part of $1,000 and at the rate of 10
cents for each additional $100 or fractional part of $100." The seller is
liable, "though frequently the parties agree in the sales contract that the
buyer will pay the tax." It is a state tax, so the rate is the same in every
county. O.C.G.A. 48-6-1 to 48-6-10.
Source: Georgia Department of Revenue, <https://dor.georgia.gov/real-estate-transfer-tax>.

On $450,000 that is $1.00 + 4,490 × $0.10 = $450.00. Nothing is charged at
$100 or less. No county recording fee is filled in; the field is there to type.

### Property tax proration

Georgia counties tax by the calendar year and usually issue bills in the
autumn. The tool counts the seller's days as January 1 to the day before
closing, on a 365 or 366-day year.

- Bill not yet paid: the seller's share is a deduction, credited to the buyer.
- Bill already paid by the seller: the rest of the year comes back as a credit.

With no closing date there is no estimate and the page asks for one. The real
split is the closing attorney's, and may use last year's bill.
Source for the calendar year and the direction of the credit: Martin Snow LLP,
<https://www.martinsnow.com/areas-of-practice/real-estate-law/buyersborrowers/tax-proration/>.

### Commission

The request asked for "configurable splits: total %, listing agent %, buyer
agent %". There are two boxes to type in, listing brokerage and buyer's
brokerage, and the total is shown beside them. Three linked boxes fight each
other while a visitor is typing.

**Both boxes start empty.** What a brokerage charges is agreed with each
seller, and a figure pre-filled on a licensee's website reads as that
licensee's rate. Nobody has approved one. With the boxes empty the result says
"No commission is entered" until the visitor types their own. Beside the boxes:
"Commission is negotiable and is not set by law. Enter the rates in your
listing agreement. Whether to offer anything toward the buyer's brokerage is
the seller's choice." That follows the practice changes that took effect on
August 17, 2024.
Source: National Association of REALTORS, <https://www.nar.realtor/the-facts/what-the-nar-settlement-means-for-home-buyers-and-sellers>.

Gbenga confirmed this on 2026-10-06: "allow for users to insert commission
rate". No starting rate is shown.

### Example figures

| Field | Starts at | Why |
| --- | --- | --- |
| Sale price | $450,000 | An example, labelled as one |
| Mortgage balance | $250,000 | An example |
| Closing costs | 1.5% | Gbenga's request ("default ~1–2% of sale price"). The hint calls it a placeholder |
| Transfer tax | Georgia's rate | Statute |
| Everything else | Empty | |

### Call to action

The request offered "Request an Accurate Home Valuation" or "Connect with a
Listing Specialist". The page uses **"Request a home valuation"**, which opens
the seller request form, with the line "A valuation here is an agent's opinion
of price from comparable sales. It is not an appraisal."

"Accurate" is left out because it promises a result. "Listing specialist" is
left out because it describes a person's standing, and the site publishes no
advisor profiles yet.

## The charts

- **Payment breakdown:** a ring with one colour per part, a two-pixel gap
  between parts, and a table beside it with every amount and share. Pointing at
  a part or its row shows that part in the middle of the ring. The picture has
  a text description for screen readers.
- **Sale price to net proceeds:** a staircase of horizontal bars, one row per
  line, each named and signed in text. Choosing a row (pointer or keyboard)
  says what is left after that line.

Colours were checked with a colour-blindness validator against the page
background. In the ring, two pairings do not pass it (taxes beside HOA, and
taxes beside mortgage insurance); they only touch when insurance is zero.
Colour is never the only cue: every part and every row is named.

## Tests

| File | Covers |
| --- | --- |
| `frontend/src/lib/mortgage.test.js` | Payment formula; full schedules against figures worked separately in decimal arithmetic; closed-form balance; PMI start, end at 78% and at the midpoint; adjustable loans; units; cash purchase; link figures |
| `frontend/src/lib/netProceeds.test.js` | Transfer tax at each boundary; dates and leap years; proration both ways; the worked example line by line; shortfall; the staircase |
| `frontend/src/components/calculators/*.test.jsx` | Each tool on screen: example labels, unit switches, PMI, adjustable loans, the schedule, the charts, the calls to action, labels on every field |
| `frontend/src/pages/IntelligenceTools.test.jsx` | The three tools on the page with the real router: addresses, what is typed is kept, only one tool reachable |
| `frontend/src/pages/Policies.test.jsx` | Privacy and Terms wording; the tools send and store nothing |

## Not done

- Price, taxes and HOA from a listing (needs listing pages or listing data).
- A lender referral or pre-approval path (needs a lender Gbenga names).
- FHA, VA and USDA loans, points, lender fees, cash to close, extra payments.
- An adjustable rate that moves more than once.
- County-specific property tax rates or recording fees.
- Capital gains or any income tax on a sale.
- Printing or saving a result.
- Not tested on a real phone, Safari or Firefox.

## Decided by Gbenga, 2026-10-06 (DE-40)

Asked five things after PR #61, he answered: "1: #61 is merged; 2: allow for
users to insert commission rate; 3: add it; 4: Its reads fine. use it; 5: #60
is merged."

| Item | Decision |
| --- | --- |
| Commission rates | The visitor types them. No starting rate |
| Pre-approval button | Add it. No lender named yet, so it opens a request for an introduction |
| The headings "Know the payment before the offer." and "See what you keep after closing." | Approved as written |
| The new Privacy and Terms paragraphs | Approved as written |

## Still open

1. The lender's name and link, if the pre-approval button should go straight to
   one.
2. Whether "Request a home valuation" is the service he wants to offer under
   that name. He merged the page with it; he has not been asked again.
