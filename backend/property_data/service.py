"""Provider-backed address search and public-record enrichment.

Mapbox Search Box and RentCast are optional production providers. Credentials
stay on the server. Without provider credentials, no fabricated address or
property record is returned; Deal Studio can still use manual illustrative assumptions.
"""

from __future__ import annotations

import json
import os
from typing import List
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
    for market in MARKETS:
        if market.lower().startswith(lower) or lower in market.lower():
            local.append(PropertySuggestion(
                id=f"market-{market.lower().replace(' ', '-').replace(',', '')}",
                label=market, kind="market", provider="curated", market=market,
            ))
    return SuggestionResponse(
        suggestions=local[:8], provider="curated",
        warning="Live address autocomplete requires MAPBOX_ACCESS_TOKEN; enter an address manually or choose a market.",
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

    raise LookupError(
        "Live property lookup requires RENTCAST_API_KEY. Enter property facts manually or configure the provider."
    )
