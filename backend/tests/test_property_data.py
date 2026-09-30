import pytest

from backend.property_data.service import lookup, suggest


def test_market_suggestions_start_with_first_character(monkeypatch):
    monkeypatch.delenv("MAPBOX_ACCESS_TOKEN", raising=False)
    result = suggest("a", "test-session")

    labels = [item.label for item in result.suggestions]
    assert "Atlanta, GA" in labels
    assert "Austin, TX" in labels
    assert result.provider == "curated"


def test_no_sample_addresses_are_suggested_without_mapbox(monkeypatch):
    monkeypatch.delenv("MAPBOX_ACCESS_TOKEN", raising=False)
    result = suggest("567 Design Way", "test-session")
    assert result.suggestions == []
    assert "enter an address manually" in result.warning


def test_lookup_without_provider_never_returns_a_fabricated_record(monkeypatch):
    monkeypatch.delenv("RENTCAST_API_KEY", raising=False)
    with pytest.raises(LookupError, match="requires RENTCAST_API_KEY"):
        lookup("567 Design Way, Austin, TX 78701")
