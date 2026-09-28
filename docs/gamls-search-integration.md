# Georgia MLS framed search

The public /search route embeds the owner-supplied URL:
https://georgeolugbe.georgiamls.com/idxsearch/

An always-visible link opens the same search in a new tab. This remains available
when privacy settings or provider frame restrictions prevent embedding.
An iframe load event cannot prove usable search; the page does not report success
based on that event.

Existing q and status=rent links show intent guidance only. No undocumented query
parameters are passed to GAMLS. Automatic filters require provider verification.
Home sample cards and property routes remain labeled for existing Deal Studio demos.
Illustrative market links lead to buyer inquiry rather than imply MLS coverage.

The hosted search does not supply records to mockData, Deal Studio, or the inquiry
queue. Visitors must provide an address/MLS number in an inquiry or enter the
property in Deal Studio. No scraping, data feed, subscription or DNS change is needed.

## Deployment coordination

This change is separate from PR #10 (Pages + Cloud Run + Firebase).
Keep /search SPA deep links working on the public host. If it sets a
Content-Security-Policy, allow https://georgeolugbe.georgiamls.com in frame-src.
Do not loosen the separate staff site's policy. GAMLS must also permit framing
on the deployed DiamondEcho origin.

## Acceptance

Regression tests cover the member URL, direct fallback, removal of mock search
results, inquiry link, and truthful legacy filter handling.
Run the full frontend suite and production build through repository CI.

Before launch, verify on the actual HTTPS staging origin:
- Frame displays and property search/detail navigation works.
- Direct fallback works independently, including when the iframe is blocked.
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
