# Property data providers

DiamondEcho keeps third-party credentials on the server and exposes provider-neutral endpoints to the browser.

Set these environment variables on the backend service:

- `MAPBOX_ACCESS_TOKEN` enables live US address and market suggestions through Mapbox Search Box.
- `RENTCAST_API_KEY` enables US residential and commercial public-record enrichment through RentCast.

Endpoints:

- `GET /api/v1/properties/suggest?q=A&session_token=<uuid>`
- `GET /api/v1/properties/lookup?address=<encoded-address>`

Without credentials, the service returns clearly labeled curated suggestions and review-mode sample records. Public-record coverage and freshness vary by jurisdiction, so users must verify parcel, tax, rent, financing, and legal details before relying on an analysis.

