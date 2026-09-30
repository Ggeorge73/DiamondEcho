# Georgia MLS framed search

The public /search route embeds the owner-supplied URL:
https://georgeolugbe.georgiamls.com/idxsearch/

Search remains embedded at the owner's request; there is no external-search button.
An iframe load event cannot prove usable search; the page does not report success
based on that event. Host notices and the iframe canvas use the DiamondEcho palette.
GAMLS controls the document inside the cross-origin iframe, including its input
colors and opaque backgrounds. Those require provider-supported theme settings
or a provider fix; host CSS cannot change them.

Existing q and status=rent links show intent guidance only. No undocumented query
parameters are passed to GAMLS. Automatic filters require provider verification.
Home embeds the same GAMLS search; its sample cards and mock market links are removed.
Legacy /property/:id links redirect to /search rather than display fictional listings.

The hosted search does not supply records to Deal Studio or the inquiry queue.
Visitors must provide an address/MLS number in an inquiry or enter the property
in Deal Studio. With no property-data credentials, Deal Studio accepts manual inputs rather
than returning fabricated addresses or property records. Its default numerical
assumptions are labeled illustrative, not listed properties. No scraping, data feed, subscription or DNS change is needed.

## Deployment coordination

This change is separate from PR #10 (Pages + Cloud Run + Firebase).
Keep /search SPA deep links working on the public host. If it sets a
Content-Security-Policy, allow https://georgeolugbe.georgiamls.com in frame-src.
Do not loosen the separate staff site's policy. GAMLS must also permit framing
on the deployed DiamondEcho origin.

## Acceptance

Regression tests cover the member URL, absence of external search links, removal of mock search
results, inquiry link, and truthful legacy filter handling.
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
