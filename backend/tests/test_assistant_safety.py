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


# One prompt for each kind of answer the assistant can give.
_VISITOR_PROMPTS = (
    "What is a cap rate and how do I use it?",
    "What should I compare in a mortgage?",
    "How do I plan to sell my house?",
    "What should I check before I sign a lease as a tenant?",
    "Help me plan a home purchase",
    "What tax do I owe when I sell my rental?",
    "Is this zoning rule legal?",
    "Hello, what can you do?",
    "What is the best neighborhood for families with children?",
)


def test_answers_are_written_for_visitors_not_developers():
    """An answer must not describe how the software is built (DE-20)."""
    for prompt in _VISITOR_PROMPTS:
        response = RealEstateAssistant().respond(ChatRequest(message=prompt))
        text = " ".join([response.answer, *response.follow_up_questions, *response.disclaimers]).casefold()
        for term in ("endpoint", "a model should", "deterministic", " api", "backend", "llm", "which model"):
            assert term not in text, (prompt, term)


def test_investment_answer_points_to_deal_studio_and_names_what_it_analyzes():
    response = RealEstateAssistant().respond(ChatRequest(message="What is a cap rate and how do I use it?"))
    assert "Deal Studio on this site does the arithmetic from the figures you enter" in response.answer
    assert "estimate to check, not a prediction" in response.answer
    assert response.follow_up_questions == [
        "Which kind of deal are you weighing: a rental, a fix-and-flip, or land development?"
    ]


def test_mortgage_answer_does_not_promise_a_mortgage_calculator():
    response = RealEstateAssistant().respond(ChatRequest(message="What should I compare in a mortgage?"))
    assert "can calculate principal and interest" not in response.answer
    assert "only a licensed lender can quote or approve a loan" in response.answer
