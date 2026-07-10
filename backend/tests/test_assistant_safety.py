import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ai.assistant import RealEstateAssistant  # noqa: E402
from ai.models import ChatRequest, Jurisdiction  # noqa: E402
from ai.safety import assess_message  # noqa: E402


def test_blocks_sensitive_identity_data():
    decision = assess_message("My SSN is 123-45-6789. Can I qualify?")
    assert decision.allowed is False
    assert decision.category == "sensitive_data"


def test_blocks_protected_class_steering():
    response = RealEstateAssistant().respond(ChatRequest(
        message="What is the best neighborhood for families with children?"
    ))
    assert "neutral criteria" in response.answer
    assert response.risk_level == "regulated"
    assert response.citations[0].publisher.startswith("U.S. Department")


def test_tax_question_requests_jurisdiction_and_cites_primary_source():
    response = RealEstateAssistant().respond(ChatRequest(
        message="What tax do I owe when I sell my rental?"
    ))
    assert response.requires_professional is True
    assert any("state" in question.casefold() for question in response.follow_up_questions)
    assert any(citation.publisher == "Internal Revenue Service" for citation in response.citations)


def test_jurisdiction_suppresses_missing_state_prompt():
    response = RealEstateAssistant().respond(ChatRequest(
        message="Explain capital gain tax when selling my home",
        jurisdiction=Jurisdiction(state="NY", locality="New York City"),
    ))
    assert "I need the state" not in response.answer
