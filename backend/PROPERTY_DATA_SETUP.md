# Property data providers

DiamondEcho keeps third-party credentials on the server and exposes provider-neutral endpoints to the browser.

Set these environment variables on the backend service:

- `MAPBOX_ACCESS_TOKEN` enables live US address and market suggestions through Mapbox Search Box.
- `RENTCAST_API_KEY` enables US residential and commercial public-record enrichment through RentCast.

Endpoints:

- `GET /api/v1/properties/suggest?q=A&session_token=<uuid>`
- `GET /api/v1/properties/lookup?address=<encoded-address>`
- `GET /api/v1/properties/underwriting-profile?address=<encoded-address>&strategy=rental&radius_miles=0.5`

The underwriting-profile endpoint performs address-first screening. It combines:

- subject public records;
- current value and rent AVMs;
- comparable rental and sale evidence constrained to the requested radius;
- predominant nearby property type and local tax evidence;
- transparent DiamondEcho cost, financing, policy, and risk defaults where no reliable local quote exists.

Every returned input includes source kind, method, confidence, sample size, radius, and a note where applicable. Values described as modeled defaults are not represented as observed 0.5-mile vendor prices. The browser preserves this provenance when a user overrides a field.

Without credentials, the service returns clearly labeled curated suggestions and review-mode sample records. Public-record coverage and freshness vary by jurisdiction, so users must verify parcel, tax, rent, financing, and legal details before relying on an analysis.
