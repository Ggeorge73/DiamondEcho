"""The deployed app carries the request telemetry (docs/sre/observability.md)."""
from test_api_docs import run


def test_request_telemetry_is_wired_in():
    run("""
import sys
sys.path.insert(0, sys.argv[1])
from fastapi.testclient import TestClient
import server
from observability import RequestTelemetry
assert any(m.cls is RequestTelemetry for m in server.app.user_middleware)
response = TestClient(server.app).get('/health')
assert response.status_code == 200
assert 'server-timing' in response.headers
""")
