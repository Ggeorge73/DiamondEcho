# Homepage GAMLS search

Home now embeds the same working agent-specific GAMLS search as /search through
a shared GamlsSearch component. The homepage frame loads lazily. Both routes
retain on-site buyer inquiry and Deal Studio links and no external-search button.

Removed from Home: sample-property carousel and its local property links,
mock neighborhood previews, fictional business/listing counters, starting-price
claims for sample inventory, and the hard-coded Austin investment example.
Hero photography remains decorative; it is not presented as MLS inventory.
The sample property inventory, public property-detail route, and sample-listing
inquiry/autofill paths have now been removed. Deal Studio may still show
explicitly labeled illustrative assumptions or example records; those are not
listed properties or search results.

Listings and results stay inside the GAMLS document. No data scraping or custom
listing feed is introduced. The provider's white background is retained as
requested. GAMLS lead routing follows the user's member account configuration;
it is independent of DiamondEcho's inquiry API.

Regression checks cover the homepage frame, removed sample claims/sections,
internal inquiry link, and section navigation targets. Existing search tests
continue to cover legacy query intent and absence of an external-search link.

Before release acceptance, verify the Cloudflare preview: scroll to Property
search, submit a city query, open a result, and check a phone-width layout.
CI does not validate provider contents or real-browser search results.
