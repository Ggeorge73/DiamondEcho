"""DE-25 finding F4: the route list is not published by a deployed service."""
import subprocess
import sys
from pathlib import Path

BACKEND = str(Path(__file__).resolve().parents[1])


def run(script, **env_overrides):
    """A fresh interpreter, as in test_inquiries.py: backend/tests holds a
    package that is also called deal_intelligence and would shadow the
    service's own."""
    import os
    env = {key: value for key, value in os.environ.items() if key != "API_DOCS_ENABLED"}
    env.update(env_overrides)
    subprocess.run([sys.executable, "-c", script, BACKEND], check=True, env=env)


def test_docs_are_off_unless_asked_for():
    run("""
import sys
sys.path.insert(0, sys.argv[1])
import server
off = {'docs_url': None, 'redoc_url': None, 'openapi_url': None}
assert server.docs_settings({}) == off
assert server.docs_settings({'API_DOCS_ENABLED': 'false'}) == off
assert server.docs_settings({'API_DOCS_ENABLED': '1'}) == off
assert server.docs_settings({'API_DOCS_ENABLED': ' TRUE '}) == {
    'docs_url': '/docs', 'redoc_url': '/redoc', 'openapi_url': '/openapi.json'}
""")


def test_the_service_publishes_no_route_list_by_default():
    run("""
import sys
sys.path.insert(0, sys.argv[1])
import server
from fastapi.testclient import TestClient
with TestClient(server.app) as c:
    for path in ('/docs', '/redoc', '/openapi.json', '/docs/oauth2-redirect'):
        assert c.get(path).status_code == 404, path
    # The routes themselves still answer.
    assert c.get('/health').json() == {'status': 'ok'}
    assert c.get('/api/').json() == {'service': 'DiamondEcho API'}
""")


def test_docs_can_be_switched_on_for_a_local_run():
    run("""
import sys
sys.path.insert(0, sys.argv[1])
import server
from fastapi.testclient import TestClient
with TestClient(server.app) as c:
    assert c.get('/openapi.json').status_code == 200
    assert c.get('/docs').status_code == 200
    assert c.get('/health').json() == {'status': 'ok'}
""", API_DOCS_ENABLED="true")


def test_api_responses_carry_basic_security_headers():
    run("""
import sys
sys.path.insert(0, sys.argv[1])
from fastapi.testclient import TestClient
import server
response = TestClient(server.app).get('/health')
assert response.headers['x-content-type-options'] == 'nosniff'
assert response.headers['referrer-policy'] == 'no-referrer'
""")
