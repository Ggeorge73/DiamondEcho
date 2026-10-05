import sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from inquiries.limits import PER_ADDRESS_ENV, PER_HOUR_ENV, limiter


@pytest.fixture(autouse=True)
def roomy_submission_limits(monkeypatch):
    """Every test starts with empty counters and limits far above what the
    other suites send. test_inquiry_limits.py sets its own figures."""
    limiter.reset()
    monkeypatch.setenv(PER_ADDRESS_ENV, "1000")
    monkeypatch.setenv(PER_HOUR_ENV, "1000")
    yield
    limiter.reset()
