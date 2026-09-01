"""Provider-backed address search and public-record enrichment.

Mapbox Search Box and RentCast are optional production providers. Credentials
stay on the server. Curated demo records keep local development explicit and
usable without representing sample values as live property data.
"""

from __future__ import annotations

import json
import os
from collections import Counter
from datetime import datetime, timezone
from statistics import mean
from typing import Dict, Iterable, List, Optional
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .models import (
    AssumptionEvidence,
    ComparableSummary,
    PropertyDetails,
    PropertySuggestion,
    SuggestionResponse,
    UnderwritingProfileResponse,
)


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


def _rentcast_get(path: str, params: dict):
    api_key = os.getenv("RENTCAST_API_KEY")
    if not api_key:
        raise LookupError("Live underwriting research requires RENTCAST_API_KEY.")
    payload = _get_json(
        f"https://api.rentcast.io/v1/{path}?{urlencode(params)}",
        headers={"X-Api-Key": api_key, "Accept": "application/json"},
        timeout=12,
    )
    return payload


def _latest_value(entries: dict | None, key: str) -> Optional[float]:
    if not entries:
        return None
    value = next(iter(sorted(entries.items(), reverse=True)), (None, {}))[1].get(key)
    return float(value) if isinstance(value, (int, float)) else None


def _number(value) -> Optional[float]:
    return float(value) if isinstance(value, (int, float)) else None


def _positive(values: Iterable) -> List[float]:
    return [float(value) for value in values if isinstance(value, (int, float)) and value > 0]


def _trimmed_average(values: Iterable) -> Optional[float]:
    """Return an outlier-resistant local average while retaining small samples."""
    numbers = sorted(_positive(values))
    if not numbers:
        return None
    if len(numbers) >= 8:
        trim = max(1, int(len(numbers) * .1))
        numbers = numbers[trim:-trim]
    return mean(numbers)


def _predominant(values: Iterable[str | None]) -> Optional[str]:
    normalized = [value for value in values if value]
    return Counter(normalized).most_common(1)[0][0] if normalized else None


def _round_money(value: float, increment: int = 100) -> int:
    return int(round(max(0, value) / increment) * increment)


def _property_details(item: dict, fallback_address: str) -> PropertyDetails:
    assessments = item.get("taxAssessments") or {}
    taxes = item.get("propertyTaxes") or {}
    features = item.get("features") or {}
    return PropertyDetails(
        id=item.get("id", fallback_address),
        formatted_address=item.get("formattedAddress", fallback_address),
        city=item.get("city"), state=item.get("state"), zip_code=item.get("zipCode"),
        county=item.get("county"), latitude=item.get("latitude"), longitude=item.get("longitude"),
        property_type=item.get("propertyType"), bedrooms=item.get("bedrooms"),
        bathrooms=item.get("bathrooms"), square_footage=item.get("squareFootage"),
        lot_size=item.get("lotSize"), year_built=item.get("yearBuilt"),
        unit_count=features.get("unitCount"), zoning=item.get("zoning"),
        last_sale_price=item.get("lastSalePrice"), last_sale_date=item.get("lastSaleDate"),
        assessed_value=_latest_value(assessments, "value"),
        annual_taxes=_latest_value(taxes, "total"),
        provider="rentcast", source_url="https://developers.rentcast.io/reference/property-records",
        warnings=["Public-record availability and freshness vary by jurisdiction; verify before underwriting."],
    )


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
        return _property_details(payload[0], clean)

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


def _form_property_type(property_type: str | None) -> str:
    normalized = (property_type or "").lower()
    if "multi" in normalized or "apartment" in normalized:
        return "multifamily"
    if "condo" in normalized:
        return "condo"
    if "town" in normalized:
        return "single_family"
    if "land" in normalized or "lot" in normalized:
        return "land"
    return "single_family"


def _insurance_rate(state: str | None) -> float:
    """Conservative high-level premium allowance, not an insurance quote."""
    return {
        "FL": .0125, "LA": .0115, "TX": .0090, "OK": .0090,
        "MS": .0090, "AL": .0080, "GA": .0075, "CA": .0070,
        "NY": .0060, "NJ": .0065,
    }.get((state or "").upper(), .0065)


def _age_capex_per_square_foot(year_built: int | None) -> float:
    age = max(0, datetime.now(timezone.utc).year - (year_built or 1985))
    if age <= 10:
        return 5
    if age <= 20:
        return 10
    if age <= 40:
        return 20
    return 30


def _market_growth(market_data: dict | None, data_key: str, value_key: str) -> Optional[float]:
    data = (market_data or {}).get(data_key) or {}
    history = data.get("history") or {}
    values = [
        entry.get(value_key) for _, entry in sorted(history.items())
        if isinstance(entry.get(value_key), (int, float)) and entry.get(value_key) > 0
    ]
    if len(values) < 2:
        return None
    months = max(1, len(values) - 1)
    annualized = (values[-1] / values[0]) ** (12 / months) - 1
    return max(-.05, min(.08, annualized))


def _comparable_price(item: dict) -> Optional[float]:
    return _number(item.get("price") or item.get("rent") or item.get("listedPrice"))


def build_underwriting_profile(
    address: str,
    strategy: str = "rental",
    radius_miles: float = .5,
) -> UnderwritingProfileResponse:
    """Build an editable, evidence-labelled screening profile from an address.

    Observed facts and local comparable averages are kept separate from
    DiamondEcho screening defaults. The latter fill gaps for high-level review
    but are never represented as verified bids, quotes, leases, or legal facts.
    """
    if strategy not in {"rental", "flip", "land"}:
        raise ValueError("Strategy must be rental, flip, or land.")
    radius = max(.1, min(2.0, float(radius_miles)))
    subject = lookup(address)
    provider_warnings: List[str] = []

    def optional_provider_call(path: str, params: dict, fallback):
        try:
            return _rentcast_get(path, params)
        except Exception:
            provider_warnings.append(f"{path} was unavailable; the profile used lower-confidence fallback assumptions for affected fields.")
            return fallback

    if subject.is_demo:
        area_records: List[dict] = []
        rent_avm: dict = {}
        value_avm: dict = {"price": subject.last_sale_price or subject.assessed_value}
        market_data: dict = {}
    else:
        center = (
            {"latitude": subject.latitude, "longitude": subject.longitude}
            if subject.latitude is not None and subject.longitude is not None
            else {"address": subject.formatted_address}
        )
        area_records = optional_provider_call("properties", {**center, "radius": radius, "limit": 200}, []) or []
        rent_params = {
            "address": subject.formatted_address, "maxRadius": radius,
            "compCount": 15, "lookupSubjectAttributes": "true",
        }
        value_params = dict(rent_params)
        rent_avm = optional_provider_call("avm/rent/long-term", rent_params, {}) or {}
        value_avm = optional_provider_call("avm/value", value_params, {}) or {}
        market_data = optional_provider_call(
            "markets", {"zipCode": subject.zip_code, "dataType": "All", "historyRange": 18}, {}
        ) if subject.zip_code else {}

    rent_comps = rent_avm.get("comparables") or []
    sale_comps = value_avm.get("comparables") or []
    predominant_type = _predominant(
        [item.get("propertyType") for item in area_records] + [subject.property_type]
    )
    average_rent = _trimmed_average(_comparable_price(item) for item in rent_comps)
    average_sale = _trimmed_average(_comparable_price(item) for item in sale_comps)
    average_sale_ppsf = _trimmed_average(
        (_comparable_price(item) / item.get("squareFootage"))
        if _comparable_price(item) and isinstance(item.get("squareFootage"), (int, float)) and item.get("squareFootage") > 0
        else None
        for item in sale_comps
    )

    property_type = _form_property_type(subject.property_type or predominant_type)
    unit_count = int(subject.unit_count or (2 if subject.property_type == "Multi-Family" else 1))
    square_feet = int(subject.square_footage or 0)
    lot_size = float(subject.lot_size or 0)
    avm_value = _number(value_avm.get("price")) or average_sale or subject.last_sale_price or subject.assessed_value or 0
    monthly_rent_per_unit = (
        average_rent if unit_count > 1 and average_rent
        else _number(rent_avm.get("rent")) or average_rent or max(750, avm_value * .006)
    )
    annual_rent = monthly_rent_per_unit * unit_count * 12

    nearby_tax_ratios = []
    for record in area_records:
        tax = _latest_value(record.get("propertyTaxes"), "total")
        assessment = _latest_value(record.get("taxAssessments"), "value")
        if tax and assessment:
            nearby_tax_ratios.append(tax / assessment)
    local_tax_rate = _trimmed_average(nearby_tax_ratios)
    annual_taxes = subject.annual_taxes or (avm_value * (local_tax_rate or .012))
    insurance = avm_value * _insurance_rate(subject.state)
    age_capex_rate = _age_capex_per_square_foot(subject.year_built)
    initial_capex = max(2500 * unit_count, square_feet * age_capex_rate)
    closing_costs = avm_value * .03
    due_diligence = min(25000, 1500 + unit_count * 500 + square_feet * .15)
    other_income = annual_rent * .015
    vacancy = 5 if len(rent_comps) >= 8 else 7
    repairs = max(annual_rent * .05, square_feet * 1.25)
    utilities = unit_count * (900 if unit_count > 1 else 2400)
    payroll_admin = max(unit_count * 350, annual_rent * .025)
    management_fee = 4 if unit_count >= 20 else 5 if unit_count >= 5 else 7
    reserves = max(unit_count * 500, square_feet * .35)
    annual_below_noi = max(unit_count * 250, annual_rent * .02)
    rent_growth = _market_growth(market_data, "rentalData", "averageRent") or .03
    expense_growth = max(.025, min(.05, rent_growth + .005))
    stabilized_noi = (annual_rent + other_income) * (1 - vacancy / 100) - (
        annual_taxes + insurance + repairs + utilities + payroll_admin
        + (annual_rent + other_income) * (1 - vacancy / 100) * management_fee / 100
        + reserves
    )
    derived_cap = stabilized_noi / avm_value if avm_value > 0 else .065
    exit_cap = max(.05, min(.10, derived_cap + .0025))

    inputs: Dict[str, str] = {}
    assumptions: List[AssumptionEvidence] = []

    def add(
        field: str,
        value,
        label: str,
        source_kind: str,
        source_name: str,
        method: str,
        confidence: str,
        sample_size: int | None = None,
        source_url: str | None = None,
        note: str | None = None,
        local: bool = False,
    ) -> None:
        if isinstance(value, float):
            rendered = f"{value:.2f}".rstrip("0").rstrip(".")
        else:
            rendered = str(value)
        inputs[field] = rendered
        assumptions.append(AssumptionEvidence(
            field=field, value=value, label=label, source_kind=source_kind,
            source_name=source_name, method=method, confidence=confidence,
            sample_size=sample_size, radius_miles=radius if local else None,
            source_url=source_url, note=note,
        ))

    records_url = "https://developers.rentcast.io/reference/property-records"
    valuation_url = "https://developers.rentcast.io/reference/property-valuation"
    market_url = "https://developers.rentcast.io/reference/market-data"
    add("market", ", ".join(filter(None, [subject.city, subject.state])), "Market", "subject_record", "Public record", "Subject address", "high", source_url=records_url)
    add("propertyType", property_type, "Asset type", "subject_record", "Public record", "Subject property type", "high", source_url=records_url)
    add("units", unit_count, "Units", "subject_record", "Public record", "Recorded unit count; conservative fallback when absent", "medium", source_url=records_url)
    add("rentableSquareFeet", square_feet, "Rentable square feet", "subject_record", "Public record", "Recorded building area", "high" if square_feet else "low", source_url=records_url)
    add("purchasePrice", _round_money(avm_value, 1000), "Purchase price", "provider_avm", "RentCast value AVM", "Current value estimate supported by local comparable sales", "medium", len(sale_comps), valuation_url, local=True)
    add("closingCosts", _round_money(closing_costs), "Closing costs", "location_model", "DiamondEcho screening model", "3% acquisition allowance", "low", note="Replace with title, lender, transfer-tax, and closing quotes.")
    add("dueDiligenceCosts", _round_money(due_diligence), "Due diligence", "location_model", "DiamondEcho screening model", "Base inspection plus per-unit and building-size allowance", "low", note="Not a vendor quote.")
    add("initialCapex", _round_money(initial_capex), "Initial capital work", "location_model", "DiamondEcho age/size model", f"${age_capex_rate:.0f}/sf age-adjusted screening allowance", "low", note="Requires physical inspection and contractor scope.")
    add("holdMonths", 60, "Hold period", "policy_default", "DiamondEcho investment policy", "Five-year screening hold", "medium")
    add("ltv", 70 if strategy != "land" else 65, "Loan leverage", "financing_benchmark", "Screening debt benchmark", "Conservative leverage assumption", "low", note="Replace with a lender term sheet.")
    add("interestRate", float(os.getenv("UNDERWRITING_INTEREST_RATE", "7.25")), "Interest rate", "financing_benchmark", "Screening debt benchmark", "Configurable non-binding rate assumption", "low", note="Not a lender quote.")
    add("amortizationYears", 30, "Amortization", "financing_benchmark", "Screening debt benchmark", "Standard screening amortization", "low")
    add("interestOnlyMonths", 0, "Interest-only period", "financing_benchmark", "Screening debt benchmark", "No interest-only benefit assumed", "low")
    add("loanTermYears", 10, "Loan term", "financing_benchmark", "Screening debt benchmark", "Ten-year screening term", "low")
    add("originationFee", 1, "Origination fee", "financing_benchmark", "Screening debt benchmark", "1% lender-fee allowance", "low")
    add("discountRate", 10, "Discount rate", "policy_default", "DiamondEcho investment policy", "Screening discount rate", "medium")
    add("sellingCosts", 6, "Selling costs", "location_model", "DiamondEcho transaction model", "Brokerage and disposition allowance", "low")

    if strategy == "rental":
        add("annualRent", _round_money(annual_rent), "Annual scheduled rent", "radius_average" if average_rent else "provider_avm", "0.5-mile rental evidence", "Average nearby asking rent × units × 12", "medium", len(rent_comps), valuation_url, local=True)
        add("otherIncome", _round_money(other_income), "Other annual income", "location_model", "DiamondEcho screening model", "1.5% of scheduled rent", "low")
        add("vacancy", vacancy, "Vacancy", "location_model", "DiamondEcho local-liquidity model", "5% with 8+ local comps; otherwise 7%", "low", len(rent_comps), valuation_url, local=True)
        add("propertyTaxes", _round_money(annual_taxes), "Property taxes", "subject_record" if subject.annual_taxes else "radius_average", "Public tax records", "Latest subject bill or local effective-tax average", "high" if subject.annual_taxes else "medium", len(nearby_tax_ratios), records_url, local=not bool(subject.annual_taxes))
        add("insurance", _round_money(insurance), "Insurance", "location_model", "DiamondEcho regional insurance model", "State risk factor × value", "low", note="Replace with a binding insurance quote.")
        add("repairsMaintenance", _round_money(repairs), "Repairs & maintenance", "location_model", "DiamondEcho age/size model", "Greater of 5% rent or $1.25/sf", "low")
        add("utilities", _round_money(utilities), "Utilities", "location_model", "DiamondEcho unit-cost model", "Per-unit owner-paid utility allowance", "low", note="Verify meter separation and 12 months of bills.")
        add("payrollAdmin", _round_money(payroll_admin), "Payroll & administration", "location_model", "DiamondEcho operating model", "Greater of $350/unit or 2.5% rent", "low")
        add("managementFee", management_fee, "Management fee", "location_model", "DiamondEcho scale model", "Scale-based percent of effective income", "low")
        add("reserves", _round_money(reserves), "Replacement reserves", "location_model", "DiamondEcho reserve model", "Greater of $500/unit or $0.35/sf", "low")
        add("annualBelowNoiCosts", _round_money(annual_below_noi), "TI / leasing / capital", "location_model", "DiamondEcho capital model", "Greater of $250/unit or 2% rent", "low")
        add("incomeGrowth", round(rent_growth * 100, 2), "Income growth", "zip_trend" if market_data else "policy_default", "RentCast market history" if market_data else "DiamondEcho policy", "Annualized rent trend capped at −5% to +8%", "medium" if market_data else "low", source_url=market_url)
        add("expenseGrowth", round(expense_growth * 100, 2), "Expense growth", "location_model", "DiamondEcho inflation model", "Rent growth plus 0.5%, bounded 2.5%–5%", "low")
        add("exitCap", round(exit_cap * 100, 2), "Exit cap rate", "location_model", "DiamondEcho local income model", "Modeled stabilized NOI/value plus 25 bps", "low", len(sale_comps), valuation_url, local=True)
        add("explicitSalePrice", "", "Explicit sale price", "not_applied", "Exit-cap method selected", "Intentionally blank so the exit cap controls", "high")
        add("targetCashOnCash", 8, "Target cash-on-cash", "policy_default", "DiamondEcho investment policy", "Screening hurdle", "medium")
        add("minimumDscr", 1.2, "Minimum DSCR", "policy_default", "DiamondEcho investment policy", "Screening coverage hurdle", "medium")
        add("targetIrr", 15, "Target levered IRR", "policy_default", "DiamondEcho investment policy", "Screening return hurdle", "medium")
        add("preliminaryMarketCeiling", _round_money(avm_value, 1000), "Market-value ceiling", "provider_avm", "RentCast value AVM", "Current value estimate", "medium", len(sale_comps), valuation_url, local=True)
        add("maxImmediateCapex", _round_money(avm_value * .10, 1000), "Maximum immediate capital work", "policy_default", "DiamondEcho investment policy", "10% of screened value", "low")
        add("maxAnnualTaxes", _round_money(annual_taxes * 1.1), "Maximum annual taxes", "policy_default", "DiamondEcho investment policy", "110% of modeled tax", "low")
        add("maxAnnualInsurance", _round_money(insurance * 1.1), "Maximum annual insurance", "policy_default", "DiamondEcho investment policy", "110% of modeled premium", "low")
        for field, value, label in [
            ("mcRentMin", -10, "Rent change low"), ("mcRentMode", 2, "Rent change mode"), ("mcRentMax", 10, "Rent change high"),
            ("mcVacancyMin", 3, "Vacancy low"), ("mcVacancyMode", vacancy + 1, "Vacancy mode"), ("mcVacancyMax", max(14, vacancy + 7), "Vacancy high"),
            ("mcExitCapMin", round(max(3, exit_cap * 100 - .75), 2), "Exit cap low"),
            ("mcExitCapMode", round(exit_cap * 100, 2), "Exit cap mode"),
            ("mcExitCapMax", round(exit_cap * 100 + 1.25, 2), "Exit cap high"),
        ]:
            add(field, value, label, "risk_default", "DiamondEcho risk policy", "Triangular stress range", "medium")
    elif strategy == "flip":
        arv = avm_value or (average_sale_ppsf or 0) * square_feet
        rehab_rate = max(35, age_capex_rate * 2.25)
        rehab = max(10000, square_feet * rehab_rate)
        monthly_holding = annual_taxes / 12 + insurance / 12 + utilities / 12 + avm_value * .70 * .075 / 12
        add("arv", _round_money(arv, 1000), "After-repair value", "provider_avm", "RentCast value AVM", "Current value and local sale comps", "medium", len(sale_comps), valuation_url, local=True)
        add("rehabCost", _round_money(rehab, 1000), "Rehabilitation budget", "location_model", "DiamondEcho age/size model", f"${rehab_rate:.0f}/sf screening allowance", "low")
        add("rehabContingency", 15, "Rehab contingency", "policy_default", "DiamondEcho construction policy", "15% screening contingency", "medium")
        add("monthlyHolding", _round_money(monthly_holding), "Monthly holding costs", "location_model", "DiamondEcho carrying-cost model", "Taxes, insurance, utilities, and interest allowance", "low")
        add("otherProjectCosts", _round_money(arv * .02), "Other project costs", "location_model", "DiamondEcho project model", "2% of ARV", "low")
    else:
        site_acres = lot_size / 43560 if lot_size else 1
        buildable_sf = max(1000, lot_size * .25) if lot_size else max(1000, square_feet)
        planned_units = max(1, round(site_acres * 3))
        hard_cost = buildable_sf * 225
        site_work = max(50000, site_acres * 125000)
        soft_cost = hard_cost * .12
        permit_cost = hard_cost * .04
        developer_fee = (hard_cost + site_work) * .04
        terminal = max(avm_value * 1.2, hard_cost + site_work + soft_cost + permit_cost)
        add("siteAcres", round(site_acres, 3), "Site area", "subject_record", "Public record", "Recorded parcel area", "high" if lot_size else "low", source_url=records_url)
        add("parcelCount", 1, "Parcel count", "subject_record", "Public record", "Subject record count", "medium", source_url=records_url)
        add("units", planned_units, "Planned units / lots", "location_model", "DiamondEcho density screen", "Three units per gross acre placeholder", "low", note="Not zoning or entitlement confirmation.")
        add("rentableSquareFeet", _round_money(buildable_sf, 100), "Buildable square feet", "location_model", "DiamondEcho land screen", "25% gross parcel-area placeholder", "low", note="Requires survey, zoning, setbacks, stormwater, and civil design.")
        add("currentZoning", subject.zoning or "VERIFY", "Current zoning", "subject_record" if subject.zoning else "verification_required", "Public record", "Recorded code when available", "medium" if subject.zoning else "low", source_url=records_url)
        add("proposedZoning", subject.zoning or "VERIFY", "Proposed zoning", "policy_default", "No rezoning benefit assumed", "Current code carried forward pending concept approval", "low")
        add("developmentType", "single_family_subdivision", "Development type", "policy_default", "DiamondEcho land screen", "Residential lot screen", "low")
        add("dispositionStrategy", "build_and_sell", "Disposition strategy", "policy_default", "DiamondEcho land screen", "Build-and-sell screen", "low")
        add("entitlementStatus", "unentitled", "Entitlement status", "verification_required", "Conservative assumption", "No entitlement credit without evidence", "medium")
        add("utilityStatus", "verify", "Utility availability", "verification_required", "Conservative assumption", "Capacity not verified", "medium")
        add("accessStatus", "verify", "Legal access", "verification_required", "Conservative assumption", "Access not verified", "medium")
        add("environmentalStatus", "phase_i_required", "Environmental diligence", "verification_required", "Conservative assumption", "Phase I required", "medium")
        add("geotechnicalStatus", "not_started", "Geotechnical diligence", "verification_required", "Conservative assumption", "Study not assumed", "medium")
        add("floodZone", "VERIFY", "FEMA flood zone", "verification_required", "Conservative assumption", "Official FEMA determination required", "low")
        add("wetlandsAcres", 0, "Wetlands area", "verification_required", "Unverified placeholder", "Zero entered for calculation only", "low", note="Do not treat as a wetlands determination.")
        add("developmentMonths", 24, "Development schedule", "policy_default", "DiamondEcho land screen", "Two-year screening schedule", "low")
        add("absorptionMonths", 12, "Sales / lease-up absorption", "policy_default", "DiamondEcho land screen", "Twelve-month absorption allowance", "low")
        add("siteWorkCost", _round_money(site_work, 1000), "Site work & infrastructure", "location_model", "DiamondEcho land-cost model", "$125,000 per gross acre with minimum", "low")
        add("hardConstructionCost", _round_money(hard_cost, 1000), "Hard construction cost", "location_model", "DiamondEcho construction model", "$225 per buildable square foot", "low")
        add("softCosts", _round_money(soft_cost, 1000), "Soft costs / A&E", "location_model", "DiamondEcho construction model", "12% of hard cost", "low")
        add("permitsImpactFees", _round_money(permit_cost, 1000), "Permits & impact fees", "location_model", "DiamondEcho construction model", "4% of hard cost", "low")
        add("environmentalRemediation", 0, "Environmental / remediation", "verification_required", "Unverified placeholder", "No remediation assumed pending diligence", "low")
        add("developerFee", _round_money(developer_fee, 1000), "Developer fee", "policy_default", "DiamondEcho construction policy", "4% of hard and site-work cost", "medium")
        add("landContingency", 10, "Construction contingency", "policy_default", "DiamondEcho construction policy", "10% screening contingency", "medium")
        add("annualCarryingCosts", _round_money(annual_taxes + insurance + avm_value * .01), "Annual taxes & carrying", "location_model", "DiamondEcho carrying-cost model", "Taxes, insurance, and 1% value allowance", "low")
        add("expectedTerminalValue", _round_money(terminal, 1000), "Expected gross terminal value", "location_model", "DiamondEcho residual-value screen", "Greater of 120% land value or modeled direct cost", "low")
        add("stabilizedNoi", 0, "Stabilized NOI", "not_applied", "Build-and-sell method selected", "Not used in this disposition method", "high")
        add("stabilizedExitCap", 0, "Stabilized exit cap", "not_applied", "Build-and-sell method selected", "Not used in this disposition method", "high")
        add("targetProfitMargin", 20, "Target development margin", "policy_default", "DiamondEcho investment policy", "20% screening hurdle", "medium")

    add("mcIterations", 2500, "Monte Carlo iterations", "risk_default", "DiamondEcho risk policy", "Balanced screening precision", "high")
    if strategy != "rental":
        for field, value, label in [
            ("mcArvMin", -15, "Value change low"), ("mcArvMode", 0, "Value change mode"), ("mcArvMax", 10, "Value change high"),
            ("mcRehabMin", 0, "Cost overrun low"), ("mcRehabMode", 10, "Cost overrun mode"), ("mcRehabMax", 30, "Cost overrun high"),
        ]:
            add(field, value, label, "risk_default", "DiamondEcho risk policy", "Triangular stress range", "medium")
    for field, value, label in [
        ("mcInterestMin", 5.75, "Interest low"), ("mcInterestMode", float(inputs["interestRate"]), "Interest mode"),
        ("mcInterestMax", 9, "Interest high"), ("mcExpenseMin", -3, "Expense change low"),
        ("mcExpenseMode", 3, "Expense change mode"), ("mcExpenseMax", 15, "Expense change high"),
    ]:
        add(field, value, label, "risk_default", "DiamondEcho risk policy", "Triangular stress range", "medium")

    warnings = list(subject.warnings) + provider_warnings
    warnings.extend([
        "Values marked as modeled or policy defaults are screening assumptions, not 0.5-mile observed quotes.",
        "User overrides take priority and should preserve the original source trail for audit.",
        "Do not mark leases, zoning, insurance, lender terms, title, survey, inspections, or permits verified from this automated profile.",
    ])
    if len(rent_comps) < 5 and strategy == "rental":
        warnings.append("Fewer than five rental comparables were available inside the selected radius; rent confidence is limited.")
    if len(sale_comps) < 5:
        warnings.append("Fewer than five sale comparables were available inside the selected radius; value confidence is limited.")

    return UnderwritingProfileResponse(
        property=subject, strategy=strategy, radius_miles=radius,
        inputs=inputs, assumptions=assumptions,
        comparables=ComparableSummary(
            radius_miles=radius, property_records=len(area_records),
            rental_comps=len(rent_comps), sale_comps=len(sale_comps),
            predominant_property_type=predominant_type,
            average_monthly_rent=average_rent,
            average_sale_price=average_sale,
            average_price_per_square_foot=average_sale_ppsf,
        ),
        generated_at=datetime.now(timezone.utc).isoformat(), provider="rentcast",
        warnings=warnings,
    )
