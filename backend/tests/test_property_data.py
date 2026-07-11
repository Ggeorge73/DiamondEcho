from backend.property_data.service import lookup, suggest


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

