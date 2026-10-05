# Georgia MLS framed search

The public /search route embeds the owner-supplied URL:
https://georgeolugbe.georgiamls.com/idxsearch/

Search remains embedded at the owner's request; there is no external-search button.
An iframe load event cannot prove usable search; the page does not report success
based on that event. Host notices and the iframe canvas use the DiamondEcho palette.
GAMLS controls the document inside the cross-origin iframe, including its input
colors and opaque backgrounds. Those require provider-supported theme settings
or a provider fix; host CSS cannot change them.

The frame opens with property types pre-selected, using the parameters Georgia MLS
uses in its own search-page links (see "Pre-selected types" below). A q link shows
intent guidance only; the requested location is never passed to GAMLS.
Home embeds the same GAMLS search; its sample cards and mock market links are removed.
Legacy /property/:id links redirect to /search rather than display fictional listings.

The hosted search does not supply records to Deal Studio or the inquiry queue.
Visitors must provide an address/MLS number in an inquiry or enter the property
in Deal Studio. With no property-data credentials, Deal Studio accepts manual inputs rather
than returning fabricated addresses or property records. Its default numerical
assumptions are labeled illustrative, not listed properties. No scraping, data feed, subscription or DNS change is needed.

## Pre-selected types

Verified by Claude acting as the QA agent on 2026-10-03, in Microsoft Edge 154 on
Windows, directly on the provider page and not through the DiamondEcho frame.

What the provider does:

- The plain address `/idxsearch/` opens the form titled "For Sale" with no Type box
  ticked. A search then returns every type, rentals included. Dunwoody returned 48
  listings between $1,496 and $2,475,000, 12 of them rentals. This was finding F1
  on DE-32.
- The provider's own tab and Reset links on that page carry `styp`, `gtyp` and `typ`
  (for example `/idxsearch/?styp=sale&gtyp=loc&typ=`), and its Buy and Rent menus
  use `styp` and `typ` with the values `sd`, `sa`, `ll`, `mf`, `cm`, `rr` and `rc`.
- `typ` accepts a comma-separated list and ticks those boxes. It does not hide the
  other boxes, so a visitor can still change the selection.

What DiamondEcho now passes:

| Route | Frame address | Result of the check |
| --- | --- | --- |
| `/search` and the home page | `/idxsearch/?styp=sale&gtyp=loc&typ=sd,sa,ll,mf,cm` | Five for-sale types ticked. Dunwoody: 36 listings between $192,000 and $2,475,000, none labelled Rental. Duluth, sorted lowest price first: 193 listings from $150,000, none labelled Rental on the first page |
| `/search?status=rent` | `/idxsearch/?styp=sale&gtyp=loc&typ=rr` | Rental (Residential) ticked. Dunwoody: 12 listings between $1,496 and $8,400, each typed Rental |

Why rentals do not use the provider's "For Rent" form: `/idxsearch/?styp=rent` shows
a form titled "For Rent" with rent, pets and furnished fields, but that form has no
Type field and submits without one. A Dunwoody search from it returned all 48
listings, including homes for sale at $2,475,000. Until Georgia MLS fixes that form,
the "For Sale" form with Rental (Residential) ticked is the one that returns only
rentals. Its title still reads "For Sale", so the host notice says so.

Limits of this change:

- It pre-selects; it does not enforce. A visitor who unticks every Type box gets the
  mixed results again.
- Rents inside the frame are still shown as a bare dollar amount with no period.
  Only Georgia MLS can change that.
- The parameters are taken from the provider's own links, not from provider
  documentation. If Georgia MLS changes them, the frame falls back to whatever the
  provider shows for an unrecognised address. Re-check after any provider change.
- Rental (Commercial) is not pre-selected on the rental route.

## Link parameters and history (DE-21)

The audit finding behind DE-21 was about the old sample search: neighborhood and
keyword shortcuts that found nothing, a padded query that failed, and filters lost
on reload. That search and its shortcuts are gone. This section records what the
site owns now, and what it cannot own.

### What a DiamondEcho link can decide

| In the address | Effect | Accepted spellings |
| --- | --- | --- |
| nothing, or any other `status` | Search opens with the five for-sale types ticked | |
| `status=rent` | Search opens with Rental (Residential) ticked, and the rental note shows | `rent`, `rental`, `rentals`, in any letter case, with spaces around them |
| `q=<text>` | A note says what the link was looking for. The text is **never** sent to Georgia MLS | Spaces at the ends are removed, runs of spaces, tabs and line breaks become one space, control characters are dropped, and the text is cut at 80 characters. Empty text shows no note |

The page rewrites its own address to the plain form (`status=rent`, tidied `q`), so
the link a visitor copies says what the page is doing. The rewrite replaces the
history entry, so Back still leaves in one step. Parameters the site does not own,
such as a campaign tag, are left as they are. The code is in
`frontend/src/lib/searchCriteria.js`.

### What it cannot decide

Everything chosen inside the frame belongs to Georgia MLS: city, county, price,
bedrooms, the Type boxes, the sort order, the results page and the open listing.
The frame is on another origin, so DiamondEcho cannot read those choices, put
them in its address, or restore them. The page says so next to the search:
anyone sent the link starts a new search.

### Shortcuts on the site

Every link the site writes to its own search is `/search` or `/search?status=rent`.
None names a place, a neighborhood or a keyword. `SearchShortcuts.test.jsx` reads
the source files and fails if another form appears.

| Where | Label | Goes to |
| --- | --- | --- |
| Header and phone menu | Search homes; Rentals | `/search`; `/search?status=rent` |
| Header button; phone menu | Search homes; Search Georgia MLS | `/search` |
| Home hero | Residences ("Search Georgia MLS"); Rentals ("Explore rental options") | `/search`; `/search?status=rent` |
| Home, "Portfolio" list | Homes for sale; Rental properties | `/search`; `/search?status=rent` |
| Home, "Explore" tile | Search Georgia MLS | `/search` |
| Footer | Residences; Rentals; Search Georgia MLS | `/search`; `/search?status=rent`; `/search` |
| Advisory page | Search properties | `/search` |
| Inquiry pages; not-found page | Search Georgia MLS; Continue browsing | `/search` |

Changed for DE-21: the footer said "Search the collection" (there is no
DiamondEcho collection; it is the Georgia MLS search), and the home "Rental
properties" text told visitors to tick the rental box themselves, which the link
has done for them since PR #25.

### Back, Forward, reload and reset

Measured in headless Chromium with a local stand-in page in place of the Georgia
MLS frame, so that only the browser's history behaviour was under test.

| Action | Before DE-21 | Now |
| --- | --- | --- |
| On `/search`, choose Rentals, then Back | The address and note still said rentals while the frame showed the for-sale form | Address, note and frame all return to for-sale |
| Forward after that | Did nothing; the forward step had been lost | Returns to rentals |
| Search in the for-sale frame, choose Rentals, search, then Back twice | For-sale results shown under the rentals note | Rental form, then the for-sale form |
| Header on `/search` | "Search homes" and "Rentals" both marked as the current page | Only the one the visitor is on |
| Search inside the frame, then Back | Returns to the form inside the frame | Same |
| Reload | Frame returns to its starting form | Same |

Cause of the first three rows: changing a frame's address adds a step to the
browser's history. The frame is now replaced, not re-pointed, when the visitor
moves between for-sale and rentals.

"Start a new search" reloads the form the page was opened for. It is the site's
own reset; the provider's Reset and Revise Search buttons inside the frame are
unchanged. The page cannot detect a failed or blank frame (see the note on the
load event above), so it tells the visitor what to do if the search is blank.

Limits:

- Moving between for-sale and rentals starts that search from its form. Results
  from the search the visitor left are not kept.
- After searching in the frame and then moving between for-sale and rentals, Back
  can need extra presses that appear to do nothing, one for each step taken in the
  frame that was replaced. Measured in Chromium: two searches gave two such presses.
- A fix that keeps those results (re-pointing the frame without adding a history
  step) depends on each browser restoring the frame correctly on Back. That could
  not be tested in Safari or Firefox here, so the predictable behaviour was chosen.
- History behaviour was measured in Chromium only. Safari and Firefox are untested.
- `q` is not passed to Georgia MLS. The provider's own Revise Search link carries
  `city=`, so pre-filling City from a link looks possible, but `q` may hold a
  neighborhood or keyword that City would not match. That is a scope decision for
  Gbenga, not made here.

## Deployment coordination

This change is separate from PR #10 (Pages + Cloud Run + Firebase).
Keep /search SPA deep links working on the public host. If it sets a
Content-Security-Policy, allow https://georgeolugbe.georgiamls.com in frame-src.
Do not loosen the separate staff site's policy. GAMLS must also permit framing
on the deployed DiamondEcho origin.

## Acceptance

Regression tests cover the member URL, the pre-selected type parameters for the sale and
rental routes, absence of external search links, removal of mock search results, the inquiry
link, that a requested location is disclosed and never passed to the provider, the
accepted spellings of `status` and `q`, the tidied address, the single current
header item, the frame being replaced on a for-sale/rentals change, and the reset.
Run the full frontend suite and production build through repository CI.

Before launch, verify on the actual HTTPS staging origin:
- Frame displays and property search/detail navigation works.
- No external-search button appears; verify provider navigation separately.
- Keyboard navigation and 320/390/430/768 px layouts are usable.
- Rental and location controls reflect actual provider capabilities.
- GAMLS attribution remains visible; no overlay hides provider content.
- Provider contact actions reach the intended agent; do not assume they enter
  the DiamondEcho staff queue.
- /search refresh, buyer inquiry, and manual Deal Studio links work.

Browser verification of the framed search is recorded on DE-32 (exact-build
tests) and DE-21. No claim of production deployment is made.
QA mapping: DE-14 rental behavior, DE-17 sample content, DE-21 search shortcuts,
DE-13 deployment, and DE-29 evidence. These issues are not closed by this change.
