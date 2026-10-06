# DE-17: what the site claims, and who has approved it

Written by Claude acting as the QA agent, 2026-10-05, from the source on `main`
at `df89a59` plus the changes in the pull request that adds this file. It is an
inventory, not an approval: only Gbenga can approve a claim about his business.

The acceptance line for DE-17 is "every published claim/contact is approved".
This file says, for each claim, which of four states it is in.

## The standard used

A sentence on the site is one of three kinds.

1. **What the site does.** Checked against the code. If the code does it, the
   sentence stays.
2. **A fact about the business** (who, where, what it offers, how to reach it).
   Stays only when Gbenga has supplied or confirmed it.
3. **Brand voice** (taglines and value statements that cannot be true or false in
   a checkable way). Listed for Gbenga to read; not changed without him.

A sentence is changed without waiting when it is the first kind and the code does
not do it, when it is the second kind and nobody has confirmed it, or when it
contradicts the site's own Terms. The Terms say Deal Studio "produces estimates
from the figures you enter", that results are "illustrations, not predictions or
promises of any return", and that they are "not financial, investment, tax or
legal advice".

## 1. Approved by Gbenga (on the DE-17 record)

| Claim | Where | Approved |
| --- | --- | --- |
| Georgia office: 2750 Premiere Pkwy, Ste. 200, Duluth, GA 30097 | Footer, menu, inquiry notice, Privacy, Terms | Supplied 2026-10-06: "the Office address for DiamondEcho has to be same as for Virtual Properties Realty.com". It replaces 8735 Dunwoody Place, GA 30350 (approved 2026-09-29) |
| Direct (678) 516-9717; realtor@diamondecho.com | Footer, menu, inquiry notice, Privacy, Terms | Supplied 2026-10-03; he reported both working 2026-10-04 |
| Brokerage: Virtual Properties Realty.com; Office (770) 495-5050 | Same places, shown before the direct number | Confirmed 2026-10-04 |
| The property search is his Georgia MLS page | Home, Search | Accepted homepage, 2026-09-29 |
| Search-page wording (what the link keeps, "Start a new search", blank-search line) | Search | 2026-10-05, DE-21 |
| "Know the payment before the offer."; "See what you keep after closing." | Mortgage simulator, seller net sheet | 2026-10-06: "Its reads fine. use it" (DE-40) |
| The paragraphs on the mortgage simulator and seller net sheet | Privacy, Terms | 2026-10-06, the same answer |
| No commission rate is pre-filled; the visitor types their own | Seller net sheet | 2026-10-06: "allow for users to insert commission rate" |
| A "Get pre-approved" button | Mortgage simulator | 2026-10-06: "add it". No lender was named, so the button asks an agent for an introduction and the page says "DiamondEcho is not a lender" |

## 2. Describes what the site does; checked against the code

| Claim | Where | Check |
| --- | --- | --- |
| Search Georgia MLS by location, price and property preferences | Home, Search, Advisory, About | The frame loads his Georgia MLS search |
| Rental (Residential) is pre-selected on the Rentals link | Home, Search | `GAMLS_RENTAL_SEARCH_URL`; verified on the real frame (DE-21) |
| Deal Studio models rentals, flips, multifamily, commercial and land with IRR, cash-on-cash, DSCR and Monte Carlo | Home, Deal Studio | Strategies "Rental & commercial", "Fix & flip", "Land development"; asset types include multifamily, office, retail, industrial, mixed-use, hospitality; metrics in `frontend/src/lib/dealAnalysis.js` |
| Deal Studio gives a verdict and a downloadable workbook | Home tile | `dealDecision.js`; "Download deal-specific Excel" |
| Georgia MLS selections are not imported into Deal Studio or inquiries | Home, Search | No code reads the frame |
| Online requests are not open yet | Inquiry pages | The forms are not shown on the launch build |
| Individual advisor profiles will appear only after verification | Advisory | No profiles are published |
| The photographs are illustrative | About image; Privacy names Unsplash | Stock photographs |
| "Get pre-approved" opens the buyer request with the message started; nothing typed in the simulator goes with it | Mortgage simulator, request page | `MortgageSimulator.jsx`, `Inquire.jsx`; tests in `MortgageSimulator.test.jsx` and `Inquire.test.jsx` |
| The mortgage simulator estimates a monthly payment (principal and interest, taxes, insurance, association fees, mortgage insurance) from the figures entered | Intelligence page, footer, Terms | `frontend/src/lib/mortgage.js`; DE-39, `docs/buyer-seller-calculators.md` |
| The seller net sheet estimates net proceeds (payoff, commission, closing costs, Georgia transfer tax, concessions, prorations) from the figures entered | Intelligence page, footer, Terms | `frontend/src/lib/netProceeds.js`; DE-39 |
| Both tools calculate in the browser; the figures are not sent or saved | Both tools, Privacy | A test reads their source for any network or storage call (`Policies.test.jsx`) |
| Georgia transfer tax: $1.00 on the first $1,000, then 10 cents per $100; the same in every county; the seller owes it unless the contract says otherwise | Seller net sheet | Georgia Department of Revenue; O.C.G.A. 48-6-1 |
| Commission is negotiable and not set by law | Seller net sheet | National Association of REALTORS, practice changes of August 17, 2024 |

## 3. Changed in this pull request

| Was | Why it could not stay | Now |
| --- | --- | --- |
| Commercial: "Coverage: National" | Where the business operates is a fact about the business. Nobody confirmed it, and the licence on record is Georgia | Removed. The item now describes modeling commercial property in Deal Studio |
| New Development: "Coverage: Sunbelt · Coasts" | Same | Removed |
| Commercial: "evaluated on tenancy, credit, and basis — with clear-eyed views on repositioning risk"; link to Advisory | Reads as an advisory service. The Advisory page offers search, Deal Studio and an inquiry | Describes Deal Studio; opens Deal Studio |
| New Development: "entitlement guidance, construction finance, and pre-sale strategy under one roof"; link to Advisory | Three services nobody confirmed. "Construction finance" could be read as lending | Describes Deal Studio's land strategy; opens Deal Studio |
| Multifamily: "underwritten on real rent rolls" | Deal Studio uses the figures the visitor types. The site never sees a rent roll | "from the rent and expense figures you enter" |
| Multifamily: "Typical hold 5–10 yrs"; Fix & Flip: "Cycle 6–12 mo" | Market statistics with no source | Replaced by the Deal Studio strategy each item uses |
| Fix & Flip: "so the downside is known before the offer goes in" | Certainty about an outcome; the Terms say results are estimates | "so you can see a spread of outcomes" |
| Home: "explains the verdict in plain language you can act on" | Presents a result as advice; the Terms say it is not | "explains the result in plain language for you to review. Results are estimates from the figures you enter, not advice." |
| Deal Studio: "Address-enriched, institutional-grade analysis" | Address lookup needs a property-data service the launch build does not have | "Institutional-grade analysis … from the figures you enter." |
| Assistant tile: "for financing, taxes, neighborhoods, and negotiation" | The assistant has no neighborhood or negotiation answers. Shown only on builds with a service | "General answers on buying, selling, renting, financing, and taxes, with their sources. Educational information, not advice." |

`frontend/src/pages/ContentClaims.test.jsx` fails if any of the removed phrases
returns to any page, and checks that each strategy and asset type named on the
home page exists in Deal Studio.

## 4. Brand voice: for Gbenga to read and approve or change

Not changed. These are his to keep or reword.

| Line | Where | Note |
| --- | --- | --- |
| "Private real estate · Global standards"; "Diamond Echo — Private Real Estate" | Header, home hero, footer | Brand line |
| "Operating privately. Leading with intelligence." | Home, About | Brand line |
| "Every asset class, one standard." | Home | Brand line |
| "Every opportunity, fully illuminated." | Home | Brand line |
| "Underwrite with absolute clarity." | Deal Studio | Brand line |
| "Institutional-grade" and "institutional rigor" | Home, Deal Studio | A quality claim about a calculator. Kept as voice; he may prefer plainer words |
| "Some addresses are found. Others find you." | Home | Brand line |
| Client-first: "Every decision and transaction begins with the client's goals — and ends only when they are met. Priorities are stated, agreed, and protected." | About | "ends only when they are met" reads as a promise of an outcome |
| Integrity: "the numbers we present are the numbers we would act on ourselves." | About | Sits beside Terms that say Deal Studio's numbers are estimates from the visitor's own figures, and not advice |
| Excellence: "From market analysis to closing logistics, we hold a single standard: work we would put our own name on, because we do." | About | Names two services: market analysis and closing logistics |
| "Requests can be sent at any hour. We reply during business hours: Monday to Saturday, 9:00 AM to 5:00 PM Eastern."; out of hours, "Your request arrived outside our business hours. We reply Monday to Saturday, 9:00 AM to 5:00 PM Eastern, and will be in touch once we reopen." | Request form and its receipt, shown only when online requests are open | Added 2026-10-05 (DE-31). The hours and the instruction to say so are his; the sentences are the agent's. A promise of a reply, not of a time. See `docs/de31-inquiry-routing.md` |

## 5. Still open on DE-17

1. Gbenga's read of section 4.
2. The broker question recorded on the ticket: whether the header wordmark must
   carry the firm's name at matching prominence under Georgia Real Estate
   Commission Rule 520-1-.09, and the broker's sight of the site.
3. "Live recipients receive test inquiries" through the site's own forms. The
   forms are not open; that depends on DE-9 and DE-33.

This is a reading of the site against its own Terms and the record on the ticket.
It is not legal advice.
