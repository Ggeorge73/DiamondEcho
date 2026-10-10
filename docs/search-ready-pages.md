# Search-ready pages

Written by Claude, 2026-10-10, for DE-44 (epic DE-43). First step of the plan to bring buyers, sellers
and investors to `diamondecho.com` from search engines. This file says what
the site now gives a search engine, how it is made, and how to change it.

## What was wrong

The site is one script. Until that script had run in a browser, every address
answered with the same empty page: the title "DiamondEcho | Private Real
Estate", one shared description, and the words "You need to enable JavaScript
to run this app." Nothing in it said Georgia, Atlanta or Duluth. Google runs
the script before it reads a page, but later and less reliably; Bing, link
previews in messages and social posts, and AI assistants mostly read the HTML
alone. The two calculators had no address of their own
(`/investment-calculator?tool=mortgage`), so they could not be listed as pages.

## What a search engine gets now

| | Before | Now |
| --- | --- | --- |
| HTML at each address | The empty shell | The page itself: headings, text, links, contact details |
| Title and description | The same on every page | One of each per page, naming Georgia or metro Atlanta where it is true |
| The address to list | Not stated | `<link rel="canonical">` on every page |
| Business details | None | schema.org `RealEstateAgent`: name, office address, telephone, hours, the seven cities, the brokerage |
| Link previews | No picture, shared text | Open Graph and Twitter tags, one picture (`og-image.png`) |
| Icon in results and tabs | None | `favicon.ico`, `favicon.svg`, `apple-touch-icon.png` |
| Calculators | `?tool=` on one address | `/mortgage-calculator`, `/seller-net-sheet` |
| Where DiamondEcho works | Not on the site | A section on the home page naming the seven cities |

Nothing here loads a script from anyone, sets a cookie or measures a visitor.
The Privacy page stays true as written.

## The pages

`frontend/src/lib/pageMeta.js` is the one list. A page is its address, its
name, its title and its summary:

| Address | Title |
| --- | --- |
| `/` | Metro Atlanta Real Estate: Buy, Sell & Invest \| DiamondEcho |
| `/search` | Homes for Sale & Rent in Metro Atlanta, GA \| DiamondEcho |
| `/investment-calculator` | Real Estate Investment Calculator: Deal Studio \| DiamondEcho |
| `/mortgage-calculator` | Mortgage Calculator for Georgia Home Buyers \| DiamondEcho |
| `/seller-net-sheet` | Georgia Seller Net Sheet: Estimate Sale Proceeds \| DiamondEcho |
| `/agents` | Buy, Sell or Invest With a Georgia Agent \| DiamondEcho |
| `/about` | About DiamondEcho \| Real Estate in Duluth, Georgia |
| `/inquire` | Contact DiamondEcho \| Buy or Sell a Home in Georgia |
| `/podcast` | Georgia Real Estate Podcast \| DiamondEcho |
| `/privacy` | Privacy \| DiamondEcho |
| `/terms` | Terms of use \| DiamondEcho |

A title or summary is a published claim like any other
(`docs/de17-content-claims.md`). Tests keep each within the length a search
result shows, unique, and free of words nobody has approved ("best", "#1",
"luxury", "trusted", "guarantee" and the like).

The cities are in the same file (`SERVICE_AREAS`): Alpharetta, Roswell,
Duluth, Atlanta, Suwanee, Cumming and Lawrenceville, as Gbenga named them on
2026-10-10. The home page section, the search page's summary and the business
details all read that list. Add or remove a city there and nowhere else.

The business details are built from `frontend/src/lib/contact.js`. Nothing is
typed twice, and nothing is stated that the pages do not show: no ratings,
reviews, price range, licence number or map position.

## How a page becomes HTML

1. `npm run build` builds the app as before.
2. `frontend/scripts/prerender.mjs` then bundles the same app for Node and
   draws each page to text with the router fixed at that page's address
   (`frontend/src/prerender.jsx`). It writes `about.html` for `/about`, and so
   on, with that page's head tags. Cloudflare Pages serves `about.html` at
   `/about` and sends `/about/` there.
3. It writes `404.html`: the empty shell, titled "Page not found" and marked
   not to be listed.

The build stops, rather than publish a weaker page, if a page is drawn without
exactly one main heading, without the brokerage's name and telephone number
(Georgia Real Estate Commission Rule 520-1-.09), or with a title or summary
another page already uses; or if `REACT_APP_BACKEND_URL` for this step differs
from the one in the built script.

## What the browser does with it

The saved HTML is the page the app would have drawn, so the app takes it over
as it stands (`hydrateRoot` in `frontend/src/index.js`): nothing is redrawn,
and the Georgia MLS search already loading in the page is kept, not loaded a
second time.

- **Fields and buttons** are held inert in the saved HTML and released the
  moment the app starts. Otherwise a figure typed into a calculator before the
  script arrived would be thrown away when it did. Links are not held: they
  work with or without the script.
- **An address that changes the page.** `/inquire?type=seller` is answered with
  the HTML of the buyer request, and an old `/investment-calculator?tool=mortgage`
  link with Deal Studio's. A few lines written into each page
  (`frontend/src/lib/prerendered.js`) clear the saved page before the browser
  paints it, and the app draws the right one from nothing, as it always did.
  Campaign tags (`utm_…`, `gclid`, `fbclid`, `msclkid`) change nothing on a
  page and are let through.
- **The year in the footer** is the year of the build in the saved HTML. The
  app sets it from the visitor's clock.
- **`/search?status=rent` opened directly** asks Georgia MLS for the for-sale
  form (in the saved HTML) and then, once cleared, for the rentals form: two
  requests where there was one. The first is dropped within moments. Opening
  Rentals from the menu is unchanged. A page of its own for rentals would
  remove this and is worth doing with the city pages.

## Old addresses

| Old | Now |
| --- | --- |
| `/investment-calculator?tool=mortgage` (with or without `price`, `taxes`, `hoa`) | Opens the mortgage simulator; the address bar becomes `/mortgage-calculator` with the same figures |
| `/investment-calculator?tool=net-proceeds` | Opens the seller net sheet; the address bar becomes `/seller-net-sheet` |
| `/property/…` | Answered with a 302 to `/search` (it was the app shell, which then moved on by script) |
| `/about/` and other closing slashes | 308 to the address without the slash (both answered 200 before) |

The assistant's replies now link to the new addresses
(`backend/ai/assistant.py`). The service in production keeps sending the old
ones until it is next redeployed, and they keep working.

## Changing things

- **A title or summary:** edit `PAGES` in `frontend/src/lib/pageMeta.js`.
- **A new page:** add its `<Route>` in `frontend/src/App.js` and its entry in
  `PAGES`, and its line in `frontend/public/sitemap.xml`. `PublicRoutes.test.js`
  fails until all three agree.
- **A city:** `SERVICE_AREAS` in the same file.
- **The link-preview picture or the icon:** replace the files in
  `frontend/public/`. The picture is 1200 × 630 and names the brokerage and its
  telephone number, because it is shown wherever a link to the site is shared.

## Checked, and how to check again

Tests in the repository (run by CI on every pull request):

- `frontend/src/Prerender.test.jsx` draws all eleven pages as the build does,
  with and without the request service, and hands each to the app: none may
  need redrawing.
- `frontend/src/lib/pageMeta.test.js`, `prerendered.test.js`,
  `intelligenceTools.test.js`, `PublicRoutes.test.js`,
  `pages/IntelligenceTools.test.jsx`.
- The build step itself (see the stops above).

In a real browser, against the Cloudflare Pages emulator
(`npx wrangler pages dev frontend/build`), on the production build of this
change: each of the eleven pages compared element by element with the same
page drawn from nothing (identical); no console message on any; the Georgia MLS
frame requested once on `/search`; the odd addresses in the table above; a
visitor in another time zone after the new year; a phone width; and the pages
with scripts switched off. The pull request records the results.

After a deployment, from any computer:

```
curl -s https://diamondecho.com/about | grep -o '<title>[^<]*</title>'
curl -s -o /dev/null -w '%{http_code}\n' https://diamondecho.com/no-such-page
```

The first prints the About title; the second prints `404`. Google's Rich
Results Test (`https://search.google.com/test/rich-results`) reads the business
details of any address.

## Not done here

- Registering the site with Google Search Console and Bing Webmaster Tools and
  submitting `sitemap.xml`. Each needs Gbenga's own account and one proof of
  ownership (a DNS record at Cloudflare, or a file in `frontend/public/`).
- A Google Business Profile, and the same name, address and telephone number
  on the other directories.
- A page for each city, the buyer, seller and investor guides, and a page for
  rentals.
- A header wordmark or titles that carry the brokerage's name: the broker's
  call (`docs/de17-content-claims.md`, section 5).
