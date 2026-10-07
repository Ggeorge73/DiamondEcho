# DE-25: accessibility and layout sweep

An automated pass over every page, run on 2026-10-06, and what it found. It
does not replace a person using a phone, Safari, Firefox or a screen reader;
none of those has been done yet.

## What was run

Chromium, driven by a script, against a production build served by the
Cloudflare Pages emulator, with a local copy of the API so the request forms
and the assistant are present. Requests to any other host were blocked, so the
Georgia MLS frame itself is empty in these runs and was not checked.

- **15 addresses**: `/`, `/search`, `/search?status=rent`,
  `/investment-calculator`, the mortgage and net-sheet tools, `/agents`,
  `/about`, the four request forms (buyer, seller, tour, pre-approval),
  `/privacy`, `/terms`, and an unknown address.
- **4 widths**: 320, 390, 768 and 1280 px.
- **States that need an action**: a Deal Studio result on each of the three
  tabs, the assistant open with two answers, and the menu open (at the three
  narrower widths).
- That is 79 page states. For each: the status, exactly one visible main
  heading, no sideways scroll, no script error, and axe-core 4 with the WCAG
  2.0 and 2.1 A and AA rules.

## What it found

No wrong status, missing heading, sideways scroll or script error in any of the
79 states. axe-core reported three failing rules, all rated serious: colour
contrast, links told apart by colour alone, and spoken names that leave out the
visible words. They are rows 1 to 5 below. Row 6 was not reported by the tool;
it turned up while checking the fixes and was then measured:

| # | Fault | Where | Fix |
| --- | --- | --- | --- |
| 1 | The footer line naming the brokerage and "Equal Housing Opportunity" was 8px at 34% opacity: contrast 2.76 to 1 (AA asks 4.5) | Every page | 11px, 6.7 to 1 |
| 2 | The "not an appraisal", "not a loan offer" lines under Deal Studio and the two calculators were 7px at 30% opacity: 2.4 to 1 | Intelligence pages | 11px, 6.7 to 1 |
| 3 | Menu item numbers in the darker blue: 3.02 to 1. The note under the assistant's box: 3.68 to 1 | Menu, assistant | Brighter blue; lighter grey |
| 4 | Links inside the Privacy text were told apart from the text by colour alone (1.08 to 1 against it) | Privacy | Underlined |
| 5 | Three controls had a spoken name that did not contain the words on them, which defeats voice control: the header wordmark ("DiamondEcho home" over "DIAMOND ECHO / PRIVATE REAL ESTATE"), the assistant button ("Open DiamondEcho assistant" over "Ask DiamondEcho"), the menu's Close button ("Close site menu" over "Close menu") | Every page | Names now contain the visible words |
| 6 | **The Ask DiamondEcho button covered the Privacy and Terms links at the foot of every page.** Measured on the build that is live now (`50705a5`): covered at 1280 px and 390 px wide, clear at 1920 px. The links still worked by keyboard | Every page, on builds that offer the assistant | The footer has room below its last line |

After the fixes, the same 79 states: no axe-core violation.

One report was set aside as not a fault: for a third of a second after the
pointer leaves the "Run base analysis" button its background is still fading
while its text has already changed colour, and a check that lands in that
moment reads 3.83 to 1. The button is 5.49 to 1 at rest.

## What changed on screen

The two legal lines are larger, so they wrap: the footer line takes two lines
on a desktop and three on a phone, and there is a band of empty space under it
for the Ask DiamondEcho button to sit in. Nothing else moves. The header wordmark looks the same; the change is a
space between its two lines when they are read as text.

## Limits

- An automated checker finds only part of what can be wrong; its makers put
  it at a little over half. It cannot judge reading order, whether a name makes
  sense, or how the page behaves with a real screen reader.
- The Georgia MLS frame is another company's page and was not loaded.
- Text is still small in places by design (9 and 10px labels in Deal Studio).
  Those pass the contrast rule and were left alone; WCAG sets no minimum size.
- The run was on a merge of the open pull requests (#64, #65, #66 and this
  one), not on `main`. It should be repeated on the commit that launches.

## Running it again

The script is not in the repository, because it needs Playwright and axe-core,
which are not project dependencies. What it does is described above; any tool
that loads each address at each width and runs axe-core with the tags `wcag2a`,
`wcag2aa`, `wcag21a` and `wcag21aa` repeats it. Let the pointer rest away from
buttons for a moment before each check.
