"""Public routes that cost CPU time or paid quota are rate limited per sender."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.deal_intelligence import router as deals
from backend.property_data import router as properties


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("K_SERVICE", raising=False)
    deals.heavy_limiter.reset()
    properties.lookup_limiter.reset()
    app = FastAPI()
    app.include_router(deals.router, prefix="/api")
    app.include_router(properties.router, prefix="/api")
    with TestClient(app) as c:
        yield c
    deals.heavy_limiter.reset()
    properties.lookup_limiter.reset()


def test_heavy_deal_routes_share_one_limit_per_sender(client):
    # An empty body fails validation, so no calculation runs, but the attempt
    # is counted first: a script cannot dodge the limit with bad input.
    statuses = [client.post("/api/v1/deals/monte-carlo", json={}).status_code
                for _ in range(deals.HEAVY_PER_ADDRESS)]
    assert statuses == [422] * deals.HEAVY_PER_ADDRESS
    for route in ("monte-carlo", "scenarios", "sensitivity"):
        refused = client.post(f"/api/v1/deals/{route}", json={})
        assert refused.status_code == 429, route
        assert int(refused.headers["Retry-After"]) > 0


def test_the_everyday_analysis_route_is_not_limited(client):
    statuses = {client.post("/api/v1/deals/analyze", json={}).status_code
                for _ in range(deals.HEAVY_PER_ADDRESS + 5)}
    assert statuses == {422}


def test_property_lookups_are_limited_but_suggestions_are_not(client, monkeypatch):
    def no_match(address):
        raise LookupError("No property found.")

    monkeypatch.setattr(properties, "lookup", no_match)
    lookups = [client.get("/api/v1/properties/lookup", params={"address": "1 Main St"}).status_code
               for _ in range(properties.LOOKUP_PER_ADDRESS)]
    assert lookups == [404] * properties.LOOKUP_PER_ADDRESS
    assert client.get("/api/v1/properties/lookup", params={"address": "1 Main St"}).status_code == 429
    # Without a session token a suggestion fails validation, but it is never throttled.
    suggestions = {client.get("/api/v1/properties/suggest", params={"q": "1"}).status_code
                   for _ in range(properties.LOOKUP_PER_ADDRESS + 5)}
    assert suggestions == {422}
