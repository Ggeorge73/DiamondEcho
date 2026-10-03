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

## Deployment coordination

This change is separate from PR #10 (Pages + Cloud Run + Firebase).
Keep /search SPA deep links working on the public host. If it sets a
Content-Security-Policy, allow https://georgeolugbe.georgiamls.com in frame-src.
Do not loosen the separate staff site's policy. GAMLS must also permit framing
on the deployed DiamondEcho origin.

## Acceptance

Regression tests cover the member URL, the pre-selected type parameters for the sale and
rental routes, absence of external search links, removal of mock search results, the inquiry
link, and that a requested location is disclosed and never passed to the provider.
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

Browser verification is pending because the local browser runtime could not start.
No claim of live embedding or deployment is made.
QA mapping: DE-14 rental behavior, DE-17 sample content, DE-21 search shortcuts,
DE-13 deployment, and DE-29 evidence. These issues are not closed by this change.
