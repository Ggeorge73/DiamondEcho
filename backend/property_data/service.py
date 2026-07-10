"""Provider-backed address search and public-record enrichment.

Mapbox Search Box and RentCast are optional production providers. Credentials
stay on the server. Curated demo records keep local development explicit and
usable without representing sample values as live property data.
"""

from __future__ import annotations

import json
import os
from typing import Dict, List
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from .models import PropertyDetails, PropertySuggestion, SuggestionResponse


MARKETS = [
    "Atlanta, GA", "Austin, TX", "Boston, MA", "Charlotte, NC",
    "Chicago, IL", "Dallas, TX", "Denver, CO", "Houston, TX",
    "Las Vegas, NV", "Los Angeles, CA", "Miami, FL", "Nashville, TN",
    "New York, NY", "Orlando, FL", "Philadelphia, PA", "Phoenix, AZ",
    "Raleigh, NC", "San Antonio, TX", "San Diego, CA", "San Francisco, CA",
    "Seattle, WA", "Tampa, FL", "Washington, DC",
]

DEMO_PROPERTIES: Dict[str, dict] = {
    "1245 ocean drive, miami beach, fl 33139": {
        "id": "demo-miami-ocean-drive",
        "formatted_address": "1245 Ocean Drive, Miami Beach, FL 33139",
        "city": "Miami Beach", "state": "FL", "zip_code": "33139",
        "county": "Miami-Dade", "latitude": 25.7907, "longitude": -80.1300,
        "property_type": "Single Family", "bedrooms": 6, "bathrooms": 5.5,
        "square_footage": 6800, "lot_size": 15000, "year_built": 2020,
        "last_sale_price": 4500000, "assessed_value": 4200000,
        "annual_taxes": 45000,
    },
    "789 sunset boulevard, los angeles, ca 90069": {
        "id": "demo-la-sunset",
        "formatted_address": "789 Sunset Boulevard, Los Angeles, CA 90069",
        "city": "Los Angeles", "state": "CA", "zip_code": "90069",
        "county": "Los Angeles", "latitude": 34.0901, "longitude": -118.3814,
        "property_type": "Single Family", "bedrooms": 7, "bathrooms": 6,
        "square_footage": 8500, "lot_size": 22000, "year_built": 2018,
        "last_sale_price": 6200000, "assessed_value": 5900000,
        "annual_taxes": 62000,
    },
    "2100 park avenue, new york, ny 10029": {
        "id": "demo-ny-park-avenue",
        "formatted_address": "2100 Park Avenue, New York, NY 10029",
        "city": "New York", "state": "NY", "zip_code": "10029",
        "county": "New York", "latitude": 40.7943, "longitude": -73.9526,
        "property_type": "Condo", "bedrooms": 4, "bathrooms": 3.5,
        "square_footage": 4200, "year_built": 2021,
        "last_sale_price": 5500000, "assessed_value": 5100000,
        "annual_taxes": 55000,
    },
    "567 design way, austin, tx 78701": {
        "id": "demo-austin-design-way",
        "formatted_address": "567 Design Way, Austin, TX 78701",
        "city": "Austin", "state": "TX", "zip_code": "78701",
        "county": "Travis", "latitude": 30.2711, "longitude": -97.7437,
        "property_type": "Single Family", "bedrooms": 4, "bathrooms": 3.5,
        "square_footage": 4800, "lot_size": 10000, "year_built": 2022,
        "last_sale_price": 3200000, "assessed_value": 3000000,
        "annual_taxes": 32000,
    },
}


def _get_json(url: str, headers: dict | None = None, timeout: int = 8):
    request = Request(url, headers=headers or {})
    with urlopen(request, timeout=timeout) as response:  # nosec B310 - provider URLs are fixed
        return json.loads(response.read().decode("utf-8"))


def suggest(query: str, session_token: str) -> SuggestionResponse:
    clean = " ".join(query.strip().split())[:256]
    if not clean:
        return SuggestionResponse(suggestions=[], provider="none")

    token = os.getenv("MAPBOX_ACCESS_TOKEN")
    if token:
        params = urlencode({
            "q": clean, "session_token": session_token, "access_token": token,
            "language": "en", "country": "US", "limit": 8,
            "types": "address,place,postcode,neighborhood",
        })
        payload = _get_json(f"https://api.mapbox.com/search/searchbox/v1/suggest?{params}")
        suggestions = []
        for item in payload.get("suggestions", []):
            label = item.get("full_address") or ", ".join(
                value for value in [item.get("name"), item.get("place_formatted")] if value
            )
            suggestions.append(PropertySuggestion(
                id=item["mapbox_id"], label=label, kind=item.get("feature_type", "place"),
                provider="mapbox", market=item.get("place_formatted"),
            ))
        return SuggestionResponse(suggestions=suggestions, provider="mapbox")

    lower = clean.lower()
    local: List[PropertySuggestion] = []
    for address, record in DEMO_PROPERTIES.items():
        if lower in address:
            local.append(PropertySuggestion(
                id=record["id"], label=record["formatted_address"],
                kind="address", provider="demo", market=f'{record["city"]}, {record["state"]}',
            ))
    for market in MARKETS:
        if market.lower().startswith(lower) or lower in market.lower():
            local.append(PropertySuggestion(
                id=f"market-{market.lower().replace(' ', '-').replace(',', '')}",
                label=market, kind="market", provider="curated", market=market,
            ))
    return SuggestionResponse(
        suggestions=local[:8], provider="curated",
        warning="Live address autocomplete requires MAPBOX_ACCESS_TOKEN; showing curated review data.",
    )


def lookup(address: str) -> PropertyDetails:
    clean = " ".join(address.strip().split())
    api_key = os.getenv("RENTCAST_API_KEY")
    if api_key:
        params = urlencode({"address": clean, "limit": 1})
        payload = _get_json(
            f"https://api.rentcast.io/v1/properties?{params}",
            headers={"X-Api-Key": api_key, "Accept": "application/json"},
        )
        if not payload:
            raise LookupError("No property record was found for that address.")
        item = payload[0]
        assessments = item.get("taxAssessments") or {}
        taxes = item.get("propertyTaxes") or {}
        latest_assessment = next(iter(sorted(assessments.items(), reverse=True)), (None, {}))[1]
        latest_tax = next(iter(sorted(taxes.items(), reverse=True)), (None, {}))[1]
        return PropertyDetails(
            id=item.get("id", clean), formatted_address=item.get("formattedAddress", clean),
            city=item.get("city"), state=item.get("state"), zip_code=item.get("zipCode"),
            county=item.get("county"), latitude=item.get("latitude"), longitude=item.get("longitude"),
            property_type=item.get("propertyType"), bedrooms=item.get("bedrooms"),
            bathrooms=item.get("bathrooms"), square_footage=item.get("squareFootage"),
            lot_size=item.get("lotSize"), year_built=item.get("yearBuilt"),
            last_sale_price=item.get("lastSalePrice"), last_sale_date=item.get("lastSaleDate"),
            assessed_value=latest_assessment.get("value"), annual_taxes=latest_tax.get("total"),
            provider="rentcast", source_url="https://developers.rentcast.io/reference/property-records",
            warnings=["Public-record availability and freshness vary by jurisdiction; verify before underwriting."],
        )

    normalized = clean.lower().replace(".", "")
    for key, item in DEMO_PROPERTIES.items():
        if normalized == key or normalized in key or key in normalized:
            return PropertyDetails(
                **item, provider="demo",
                source_url="https://developers.rentcast.io/reference/property-data",
                is_demo=True,
                warnings=["Review-mode sample record. Configure RENTCAST_API_KEY for live public-record data."],
            )
    raise LookupError(
        "Live property lookup requires RENTCAST_API_KEY. Select one of the review addresses or configure the provider."
    )
