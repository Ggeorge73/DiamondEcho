# Deal Studio: the 2026-11-05 pre-launch review and what changed

A reviewer ran Deal Studio end to end on 2026-11-05 ahead of the public
launch and reported four things that must be fixed before launch and three
that should be, so that visitors are not misled. This note records each
finding, what was reproduced, the change made and the figures that moved.
The AI engineering role prepared it; Gbenga reviews and merges.

The service formula is now `diamond-underwriting-1.8.0`, the page's
`diamond-underwriting-web-1.9.0`. The decision version is unchanged
(`diamond-decision-1.6.0`): the land decision reads the engine, so it moved
with the engine without a rule of its own changing.

## Must fix before launch

| # | Reported | Found | Change |
| --- | --- | --- | --- |
| 1 | Re-running the base analysis after a Monte Carlo run hangs on "Calculating…" (hit twice) | The base analysis and the simulation shared one run counter. Starting either one bumped it, so a base result that arrived after "Run Monte Carlo" was pressed was thrown away as stale, and because the code that clears "Calculating…" was guarded by the same counter, the page stayed on "Calculating…" with "Run base analysis" disabled. Reproduced in a real browser (Chromium, production build, the real API delayed by three seconds) on all three tabs: the submit button stayed at "Analyzing" and the IC decision tab showed "Calculating…" indefinitely | The two runs have separate counters (`baseGeneration`, `riskGeneration`). Either can run while the other does; a finished simulation survives a base re-run; a changed input still cancels both. A base re-run no longer discards the simulation |
| 2 | Clicking Monte Carlo before the base analysis finishes crashes the page (React error #185) | The same shared counter. The blank page was not reproduced in headless Chromium (the hang above was, every time); the stuck state is the likeliest path to it on a slower device. Whatever the path, a fault while drawing the results used to take the whole page, and the form, down | Besides the counter fix, the results panel sits inside an error boundary. A fault while drawing it shows "The results could not be drawn" with a button to clear the results; the form and its figures stay. Tested with a result whose metric throws when read |
| 3 | The whole form is wiped on leaving the page or a reload; with 50+ fields and the two bugs above a visitor loses all their work | Nothing was kept | Every change to the form and the evidence checkboxes is written to the browser's own storage on that device a moment after it is made (`diamondecho.deal-studio.draft.v1`), and restored on the next visit with a note saying when it was saved and a "Start over" button. A form left at the example figures keeps nothing. Results are not kept; they take seconds to run again. A listing link (`?listing=`) is not restored over. "Start over" is also in the submit row. Nothing leaves the device |
| 4 | The Market box silently picks the first match: typing "A" saved the market as "Austin, TX" | The list of matches was laid over the next row of boxes (absolute, z-index 30), and a click on a suggestion was a choice. Typing "A" lists eight markets over "Units", "Purchase price" and the rest; a click meant for the box below landed on the second suggestion, Austin, TX. Nothing said so | The list sits in the flow of the page under its box, never over the boxes below; it is shown while the box has focus and closes when the box is left or on Escape; the box says it is a label only. A market chosen from the list is announced ("Market set to Austin, TX, chosen from the list") with an Undo. A market of one or two characters is refused when the analysis runs ("Market: "A" is not a market…"), never accepted. The address box uses the same list and behaves the same way |

## Should fix

| # | Reported | Change |
| --- | --- | --- |
| 5 | Monte Carlo defaults lean pessimistic, so its typical result usually looks much worse than "Base"; add a one-line explanation or center the defaults | The bands are kept as they were (they lean to the downside on purpose, and the rental note already said so) and the page now says why, in the figures of the bands actually set. Each band is a triangular distribution whose mean is (low + mode + high) / 3; where that mean is worse than the base figure the band leans to the downside. The land example: "development costs average 3.33 points over budget beyond the 10% contingency the base analysis spends; the hold averages 1.67 months longer than the one you entered; the interest rate averages 0.25 points above the 6.75% you entered". The sentence sits above the bands in the form and, with the base figure beside the Committee-case median, above the Monte Carlo results. It ends with how to centre the bands. Bands set the same distance either side of the entered figure are reported as centred |
| 6 | No way to model an existing house that is kept, or a piece sold early; people work around it and the returns come out distorted | Four land boxes, under "A piece sold early or kept": the gross price of a piece sold early and the month it closes (counted from closing, within the hold); the value of what is kept at the end of the hold and its net monthly income while held. An early sale lands in its month net of selling costs and repays the facility first; a piece kept is counted at its value in the final month without selling costs (it is not sold) and its income is received every month. Development margin and the residual's target margin are measured on the gross exit value (exit value + early sale + value kept); the break-even exit value is what the exit alone must bring. Both engines, the workbook, the warnings and the assumptions carry them. Empty boxes leave every earlier figure unchanged |
| 7 | The loan is assumed to fund 70% of the land on day one; many lenders require your cash in first, so the returns look rosier than reality | A "Facility funds the deal" choice: "After your equity is spent (most lenders)", now the starting choice, or "Alongside your equity, pro rata from closing", the earlier behaviour. Equity first: nothing is drawn until the sponsor's equity requirement (total cost less the facility) is spent, then the facility funds every dollar. The pro-rata choice carries a warning that says what it assumes. The API's own default stays pro rata, so an unchanged request gets unchanged figures; the page sends `draw_order` only when equity first is chosen |

## The land model (items 6 and 7)

Identical in `backend/deal_intelligence/engine.py` and
`frontend/src/lib/dealAnalysis.js`:

- `drawn[m]`, the facility drawn once a share of the cost is spent: pro rata,
  the facility's share of every dollar (`total debt × spent share`); equity
  first, `min(total debt, max(0, cost × spent share − (cost − total debt)))`.
  The month's draw is the difference, split between loans by their share of
  the commitment. Origination fees stay on the whole commitment at closing.
- The early sale: gross proceeds less selling costs, in its month (clamped to
  the hold; 0 means the final month), added to that month's cash and used to
  repay the facility first, as the exit's own sales are.
- The piece kept: its value is added to the final month's sale proceeds with
  no selling costs and repays nothing (it is not cash); its net income is the
  month's operating cash flow for every month of the hold.
- Gross exit value = exit value + early sale + value kept. Development margin
  = profit ÷ gross exit value; the residual solves for the target margin on
  it. Break-even exit value = (economic cost − early sale net − value kept −
  income kept) ÷ (1 − selling cost rate).

Reference figures, asserted in both test suites
(`test_land_equity_first_draw_order_matches_the_browser_engine`,
`test_land_early_sale_and_kept_piece_match_the_browser_engine`), on the
service's reference deal ($3,000,000 of land, $3,643,250 facility, 60-month
hold, build 24, sell 12):

| Case | Development profit | IRR | Residual land value | Closing cash call |
| --- | --- | --- | --- | --- |
| Pro rata (unchanged) | −$2,483,459 | −32.28% | $188,394 | −$1,165,183 |
| Equity first | −$2,406,352 | −28.91% | $221,050 | −$1,998,183 |
| Equity first, $600,000 sold in month 18, $350,000 kept earning $1,500 a month | −$1,266,433 | −11.78% | $1,029,755 | −$1,998,183 |

Equity first means less interest (the facility is drawn later) and an earlier
cash call (the sponsor pays the whole acquisition), so profit is higher and
the IRR is lower; the reviewer's "rosier" was the IRR on cash that in reality
goes in first.

## The figures that moved on the page

The land example and the land tests start with "after your equity is spent",
so their figures moved. The reviewer's four-lot deal ($985,000 of land,
$4,300,000 exit, 65% facility, hold 24): residual land value $831,051 →
$866,435; margin at the asking price 16.12% → 17.03%; maximum land price
$830,000 → $865,000; the Downside case's profit $158,240 → $200,602. The land
example (twelve finished lots on six acres, $375,000): profit $548,441 →
$561,624; margin 24.05% → 24.63%; maximum land price $460,000 → $470,000. The
pro-rata figures are still reachable by choosing "Alongside your equity", and
one page test asserts the $831,051 there.

## Tests

- `frontend/src/pages/DealStudioLaunchReview.test.jsx`: items 1 to 4 (the
  simulation started during a base run, the base re-run after a simulation,
  the contained fault, the draft kept and restored, a damaged draft, the
  market list and its undo).
- `frontend/src/lib/monteCarloLean.test.js`: item 5, the wording for each
  example and for centred bands.
- `frontend/src/lib/dealAnalysis.test.js`, `DealStudioLand.test.jsx`,
  `backend/tests/deal_intelligence/test_engine.py`: items 6 and 7, the
  reference figures above, the request carrying the boxes only when set, the
  warnings, the early-sale month refused outside the hold.
- Every page test now clears the device's draft before it starts, because a
  test's figures are kept like a visitor's.
- Browser check (Chromium, production build served locally, the real API run
  locally with its response delayed three seconds): before the change, "Run
  Monte Carlo" during a base run left "Analyzing" disabled and "Calculating…"
  on the IC decision tab on every tab; after it, the base result appears, the
  button is enabled, the simulation finishes.

## Still to do before launch

- The service must be redeployed from this commit for the API to know the
  new land boxes and the draw order; until then the page refuses the
  service's land answer (it needs formula 1.8.0) and calculates on the device,
  and says so. DE-13 records redeploys.
- The reviewer's blank page (item 2) was not reproduced; the stuck state it
  most likely came from is gone and the results panel is now contained. A
  retest on the reviewer's phone, on the deployed build, is the evidence that
  closes it. A QA pass should also confirm the draft survives a tab closed on
  iOS Safari, where storage can be cleared under memory pressure.
