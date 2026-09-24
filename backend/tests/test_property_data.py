from backend.property_data import service
from backend.property_data.models import PropertyDetails
from backend.property_data.service import build_underwriting_profile, lookup, suggest


def test_market_suggestions_start_with_first_character(monkeypatch):
    monkeypatch.delenv("MAPBOX_ACCESS_TOKEN", raising=False)
    result = suggest("a", "test-session")

    labels = [item.label for item in result.suggestions]
    assert "Atlanta, GA" in labels
    assert "Austin, TX" in labels
    assert result.provider == "curated"


def test_review_address_returns_explicit_demo_record(monkeypatch):
    monkeypatch.delenv("RENTCAST_API_KEY", raising=False)
    result = lookup("567 Design Way, Austin, TX 78701")

    assert result.formatted_address == "567 Design Way, Austin, TX 78701"
    assert result.square_footage == 4800
    assert result.annual_taxes == 32000
    assert result.is_demo is True
    assert result.provider == "demo"


def test_underwriting_profile_uses_half_mile_evidence_and_fills_rental_inputs(monkeypatch):
    subject = PropertyDetails(
        id="subject", formatted_address="827 Oak St NW, Atlanta, GA 30318",
        city="Atlanta", state="GA", zip_code="30318", latitude=33.778,
        longitude=-84.414, property_type="Multi-Family", bedrooms=8,
        bathrooms=4, square_footage=2820, lot_size=8276, year_built=2006,
        unit_count=2, last_sale_price=275000, assessed_value=310000,
        annual_taxes=4200, provider="rentcast",
        source_url="https://developers.rentcast.io/reference/property-records",
    )
    monkeypatch.setattr(service, "lookup", lambda address: subject)

    calls = []

    def provider(path, params):
        calls.append((path, params))
        if path == "properties":
            return [
                {"propertyType": "Multi-Family", "propertyTaxes": {"2025": {"total": 4400}}, "taxAssessments": {"2025": {"value": 320000}}},
                {"propertyType": "Multi-Family", "propertyTaxes": {"2025": {"total": 4700}}, "taxAssessments": {"2025": {"value": 350000}}},
                {"propertyType": "Single Family"},
            ]
        if path == "avm/rent/long-term":
            return {"rent": 2200, "comparables": [{"price": 2100}, {"price": 2200}, {"price": 2300}, {"price": 2250}, {"price": 2150}]}
        if path == "avm/value":
            return {"price": 420000, "comparables": [{"price": 390000, "squareFootage": 2700}, {"price": 420000, "squareFootage": 2850}, {"price": 450000, "squareFootage": 3000}, {"price": 410000, "squareFootage": 2800}, {"price": 430000, "squareFootage": 2900}]}
        if path == "markets":
            return {"rentalData": {"history": {"2025-01": {"averageRent": 2100}, "2026-01": {"averageRent": 2200}}}}
        raise AssertionError(path)

    monkeypatch.setattr(service, "_rentcast_get", provider)
    result = build_underwriting_profile(subject.formatted_address, "rental", .5)

    assert result.radius_miles == .5
    assert result.comparables.predominant_property_type == "Multi-Family"
    assert result.comparables.rental_comps == 5
    assert result.comparables.sale_comps == 5
    assert result.inputs["purchasePrice"] == "420000"
    assert result.inputs["annualRent"] == "52800"
    assert result.inputs["propertyTaxes"] == "4200"
    assert result.inputs["explicitSalePrice"] == ""
    assert result.inputs["preliminaryMarketCeiling"] == "420000"
    assert result.inputs["mcExitCapMode"] == result.inputs["exitCap"]
    assert all(params.get("radius") == .5 for path, params in calls if path == "properties")
    annual_rent_evidence = next(item for item in result.assumptions if item.field == "annualRent")
    assert annual_rent_evidence.radius_miles == .5
    assert annual_rent_evidence.sample_size == 5


def test_land_profile_marks_zoning_and_environmental_fields_for_verification(monkeypatch):
    subject = PropertyDetails(
        id="land", formatted_address="1 Test Lot, Atlanta, GA 30318",
        city="Atlanta", state="GA", zip_code="30318", latitude=33.77,
        longitude=-84.41, property_type="Land", lot_size=43560,
        assessed_value=100000, annual_taxes=1200, provider="rentcast",
        source_url="https://developers.rentcast.io/reference/property-records",
    )
    monkeypatch.setattr(service, "lookup", lambda address: subject)
    monkeypatch.setattr(service, "_rentcast_get", lambda path, params: {
        "properties": [], "avm/rent/long-term": {},
        "avm/value": {"price": 150000, "comparables": []}, "markets": {},
    }[path])

    result = build_underwriting_profile(subject.formatted_address, "land", .5)

    assert result.inputs["siteAcres"] == "1"
    assert result.inputs["currentZoning"] == "VERIFY"
    assert result.inputs["utilityStatus"] == "verify"
    assert result.inputs["environmentalStatus"] == "phase_i_required"
    zoning = next(item for item in result.assumptions if item.field == "currentZoning")
    assert zoning.source_kind == "verification_required"
