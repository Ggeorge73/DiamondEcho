"""Build identity on GET /api/: which revision and commit is answering.

The SRE monitors have no cloud sign-in. They read this route to tell a new
deploy from the old one (scripts/sre/README.md, "observed"). It must name the
service, the Cloud Run revision and the commit, and nothing else.
"""
import os
import subprocess
import sys
from pathlib import Path

BACKEND = str(Path(__file__).resolve().parents[1])
IDENTITY_SETTINGS = ("K_REVISION", "APP_COMMIT")


def run(script, **env_overrides):
    """A fresh interpreter, as in test_api_docs.py: backend/tests holds a
    package that is also called deal_intelligence and would shadow the
    service's own."""
    env = {key: value for key, value in os.environ.items() if key not in IDENTITY_SETTINGS}
    env.update(env_overrides)
    subprocess.run([sys.executable, "-c", script, BACKEND], check=True, env=env)


def test_identity_is_null_when_nothing_is_set():
    # A local run, or a revision deployed before this route named the build.
    run("""
import sys
sys.path.insert(0, sys.argv[1])
import server
from fastapi.testclient import TestClient
assert TestClient(server.app).get('/api/').json() == {
    'service': 'DiamondEcho API', 'revision': None, 'commit': None}
""")


def test_identity_names_the_revision_and_the_commit():
    run("""
import sys
sys.path.insert(0, sys.argv[1])
import server
from fastapi.testclient import TestClient
response = TestClient(server.app).get('/api/')
assert response.status_code == 200
assert response.json() == {
    'service': 'DiamondEcho API',
    'revision': 'diamondecho-api-00031-abc',
    'commit': '59f8d46b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f'}
""", K_REVISION="diamondecho-api-00031-abc", APP_COMMIT="59F8D46B0C1D2E3F4A5B6C7D8E9F0A1B2C3D4E5F")


def test_identity_publishes_only_three_facts():
    # No library version, no setting, no address: the route list is off
    # (DE-25 finding F4) and this route must not become a way around that.
    run("""
import sys
sys.path.insert(0, sys.argv[1])
import server
assert sorted(server.build_identity({
    'K_REVISION': 'diamondecho-api-00031-abc', 'APP_COMMIT': 'abcdef1',
    'K_SERVICE': 'diamondecho-api', 'K_CONFIGURATION': 'diamondecho-api',
    'CORS_ORIGINS': 'https://diamondecho.com', 'INQUIRY_STAFF_UIDS': 'not-for-publication',
})) == ['commit', 'revision', 'service']
""")


def test_a_value_that_is_not_a_revision_or_a_commit_is_not_published():
    # A mistyped setting must not put free text on a public route.
    run("""
import sys
sys.path.insert(0, sys.argv[1])
import server
blank = {'service': 'DiamondEcho API', 'revision': None, 'commit': None}
assert server.build_identity({}) == blank
assert server.build_identity({'K_REVISION': '', 'APP_COMMIT': '  '}) == blank
assert server.build_identity({'K_REVISION': 'Not A Revision!', 'APP_COMMIT': 'main'}) == blank
assert server.build_identity({'K_REVISION': 'x' * 64, 'APP_COMMIT': 'abc123'}) == blank
assert server.build_identity({'K_REVISION': 'rev-1', 'APP_COMMIT': 'g' * 40}) == {
    'service': 'DiamondEcho API', 'revision': 'rev-1', 'commit': None}
assert server.build_identity({'APP_COMMIT': ' ABCDEF1 '})['commit'] == 'abcdef1'
""")
