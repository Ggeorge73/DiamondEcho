"""DE-20: intent, a conversation that continues, source dates, and the way to a person."""
import sys
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ai import intent  # noqa: E402
from ai.assistant import RealEstateAssistant  # noqa: E402
from ai.models import ChatRequest, ConversationMessage, Jurisdiction  # noqa: E402
from services.knowledge.catalog import SOURCES  # noqa: E402


def ask(message, earlier=(), state=None):
    """Ask as the page does: the history ends with the question being asked."""
    history = [ConversationMessage(role=role, content=content) for role, content in earlier]
    history.append(ConversationMessage(role="user", content=message))
    return RealEstateAssistant().respond(
        ChatRequest(message=message, history=history, jurisdiction=Jurisdiction(state=state))
    )


def after(question):
    first = ask(question)
    return [("user", question), ("assistant", first.answer)]


# --- The three buttons the panel offers ------------------------------------

def test_the_buyer_quick_prompt_gets_buyer_guidance():
    response = ask("Help me plan a home purchase")
    assert response.topic == "buy"
    assert "disciplined purchase flow" in response.answer
    assert response.citations[0].publisher == "Consumer Financial Protection Bureau"
    assert [link.path for link in response.links] == ["/investment-calculator?tool=mortgage", "/search"]


def test_the_rental_analysis_prompt_gets_deal_analysis_not_tenant_advice():
    response = ask("Analyze a rental property")
    assert response.topic == "invest"
    assert "Deal Studio on this site does the arithmetic" in response.answer
    assert [link.path for link in response.links] == ["/investment-calculator"]


def test_the_mortgage_prompt_gets_loan_comparison():
    response = ask("What should I compare in a mortgage?")
    assert response.topic == "mortgage"
    assert [link.path for link in response.links] == ["/investment-calculator?tool=mortgage"]


# --- Whole words, not letters anywhere --------------------------------------

@pytest.mark.parametrize("message", [
    "What is the current status of the market?",   # "rent" inside "current"
    "Who mows the lawn in an HOA?",                 # "law" inside "lawn"
    "Is a taxi stand nearby a nuisance?",           # "tax" inside "taxi"
    "Can I reload the page?",                       # "loan" inside "reload"
])
def test_a_word_inside_another_word_is_not_a_topic(message):
    assert intent.classify(message) is None
    assert intent.is_regulated(message) is False


@pytest.mark.parametrize("message,topic", [
    ("Help me plan a home purchase", "buy"),
    ("We are purchasing our first home", "buy"),
    ("How do I plan to sell my house?", "sell"),
    ("What should I check before I sign a lease as a tenant?", "rent"),
    ("What are closing costs for a seller in Georgia?", "closing"),
    ("How much are transfer taxes?", "closing"),
    ("Can I afford a 500k home?", "mortgage"),
    ("I want to buy a rental property", "invest"),
    ("What is a cap rate and how do I use it?", "invest"),
    ("Hello, what can you do?", None),
])
def test_topics(message, topic):
    assert intent.classify(message) == topic


# --- A reply continues the conversation -------------------------------------

def test_a_sellers_reply_with_a_location_continues_the_selling_conversation():
    # The first answer asks the question the reply answers.
    assert ask("How do I plan to sell my house?").follow_up_questions == [
        "Is this a primary home, rental, or commercial property, and where is it located?"
    ]
    earlier = after("How do I plan to sell my house?")
    response = ask("A primary home in Atlanta, Georgia", earlier)
    assert (response.topic, response.continued) == ("sell", True)
    assert response.jurisdiction.state == "GA"
    assert response.answer.startswith("Thanks. For a primary home in Georgia")
    assert "I can help you plan a purchase or sale" not in response.answer   # not the opening menu again
    assert "Seller Net Sheet" in response.answer
    assert [link.path for link in response.links] == ["/investment-calculator?tool=net-proceeds"]
    assert response.handoff.kind == "seller" and response.handoff_recommended is True
    assert response.follow_up_questions == []      # the state was given; it is not asked for again


def test_a_reply_made_of_answer_words_is_not_read_as_a_new_topic():
    # "rental" and "commercial" are topics on their own, and also the answers
    # to "is this a primary home, rental, or commercial property?".
    earlier = after("How do I plan to sell my house?")
    rental = ask("It is a rental in Tampa, FL", earlier)
    assert (rental.topic, rental.continued, rental.jurisdiction.state) == ("sell", True, "FL")
    assert "For a rental property in Florida" in rental.answer
    assert [citation.id for citation in rental.citations] == ["irs-527"]
    commercial = ask("commercial, Georgia", earlier)
    assert (commercial.topic, commercial.continued) == ("sell", True)
    assert "like-kind exchange" in commercial.answer


def test_a_new_question_starts_a_new_topic():
    earlier = after("How do I plan to sell my house?")
    response = ask("What should I compare in a mortgage?", earlier)
    assert (response.topic, response.continued) == ("mortgage", False)
    regulated = ask("Is this zoning rule legal?", earlier)
    assert regulated.continued is False and regulated.requires_professional is True


def test_a_reply_without_a_state_is_asked_for_it_once():
    response = ask("Primary home", after("How do I plan to sell my house?"))
    assert response.continued is True
    assert response.follow_up_questions == ["Which state is the property in?"]


def test_the_state_is_remembered_from_an_earlier_reply():
    earlier = after("How do I plan to sell my house?")
    second = ask("It is in Georgia", earlier)
    third = ask("A rental", [*earlier, ("user", "It is in Georgia"), ("assistant", second.answer)])
    assert third.jurisdiction.state == "GA"
    assert "For a rental property in Georgia" in third.answer


def test_details_in_the_first_message_are_used_without_a_thanks():
    response = ask("I want to sell my home in Georgia")
    assert response.continued is False
    assert response.answer.startswith("For a primary home in Georgia")


def test_outside_georgia_the_visitor_is_sent_to_an_agent_licensed_there():
    response = ask("It is a rental in Tampa, FL", after("How do I plan to sell my house?"))
    assert "DiamondEcho’s office is in Georgia" in response.answer
    assert "an agent licensed there" in response.answer
    assert response.handoff is None and response.handoff_recommended is False


def test_buyer_mortgage_rent_and_deal_replies_continue_too():
    buy = ask("Georgia", after("Help me plan a home purchase"))
    assert buy.continued and buy.answer.startswith("Thanks. For a purchase in Georgia")
    assert buy.handoff.kind == "buyer"
    loan = ask("450000 price, 20% down, 6.5% for 30 years", after("What should I compare in a mortgage?"))
    assert loan.continued and "Mortgage Simulator on this site" in loan.answer
    assert (loan.handoff.kind, loan.handoff.topic) == ("buyer", "pre-approval")
    lease = ask("Decatur, GA", after("What should I check before I sign a lease as a tenant?"))
    assert lease.continued and "I have no reviewed source for them" in lease.answer
    assert [link.path for link in lease.links] == ["/search?status=rent"]
    land = ask("Land development", after("What is a cap rate and how do I use it?"))
    assert land.continued and "choose Land development" in land.answer and "Go / No-Go" in land.answer
    flip = ask("a fix and flip", after("Analyze a rental property"))
    assert flip.continued and "choose Fix & flip" in flip.answer


def test_the_assistant_does_not_do_sums_or_quote_rates_in_a_reply():
    response = ask("450000 price, 20% down, 6.5% for 30 years", after("What should I compare in a mortgage?"))
    assert "I can’t quote a rate or approve a loan" in response.answer
    assert "$" not in response.answer


# --- State detection ---------------------------------------------------------

@pytest.mark.parametrize("text,code", [
    ("A primary home in Atlanta, Georgia", "GA"),
    ("Decatur, GA", "GA"),
    ("we live in GA", "GA"),
    ("West Virginia", "WV"),
    ("New York City", "NY"),
    ("Washington DC", "DC"),
    ("I want to move in or near the city", None),     # "in", "or" are not Indiana and Oregon
    ("OK, tell ME more", None),
    ("IS IT OK TO BUY IN A HURRY", None),
    ("Can you help me?", None),
])
def test_find_state(text, code):
    assert intent.find_state(text) == code


def test_the_state_box_is_read_as_a_code_or_a_name():
    assert intent.normalize_state("ga") == "GA"
    assert intent.normalize_state(" Georgia ") == "GA"
    assert intent.normalize_state("") is None
    assert ask("Explain capital gain tax when selling my home", state="georgia").jurisdiction.state == "GA"


# --- Closing costs (the weak answer found in DE-25, F7) ----------------------

def test_a_georgia_closing_cost_question_gets_a_closing_cost_answer_with_its_source():
    response = ask("What are closing costs for a seller in Georgia?")
    assert response.topic == "closing"
    assert response.answer.startswith("Closing costs are the fees paid to finish a sale or a loan")
    assert "$1 for the first $1,000 of the price and 10 cents for each additional $100" in response.answer
    assert [citation.publisher for citation in response.citations] == [
        "Consumer Financial Protection Bureau", "Georgia Department of Revenue",
    ]
    assert "[1]" in response.answer and "[2]" in response.answer


def test_no_figure_is_given_for_a_state_with_no_reviewed_source():
    response = ask("What are closing costs in Florida?")
    assert "I have no reviewed source for Florida" in response.answer
    assert "$" not in response.answer
    assert [citation.id for citation in response.citations] == ["cfpb-loan-estimate"]
    assert "set by each state and county" in ask("What are closing costs?").answer


# --- Sources: every number has a source, every source its own review date ----

_PROMPTS = (
    ("Help me plan a home purchase", ()),
    ("Analyze a rental property", ()),
    ("What should I compare in a mortgage?", ()),
    ("How do I plan to sell my house?", ()),
    ("What should I check before I sign a lease as a tenant?", ()),
    ("What are closing costs for a seller in Georgia?", ()),
    ("What tax do I owe when I sell my rental?", ()),
    ("Hello, what can you do?", ()),
    ("A primary home in Atlanta, Georgia", (("user", "How do I plan to sell my house?"),)),
    ("commercial, Georgia", (("user", "How do I plan to sell my house?"),)),
    ("Georgia", (("user", "Help me plan a home purchase"),)),
    ("A rental", (("user", "Analyze a rental property"),)),
)


@pytest.mark.parametrize("message,earlier", _PROMPTS)
def test_citation_numbers_in_the_text_match_the_list_and_dates_come_from_the_source(message, earlier):
    response = ask(message, earlier)
    by_id = {source.id: source for source in SOURCES}
    for number, citation in enumerate(response.citations, start=1):
        assert f"[{number}]" in response.answer, (message, number)
        assert citation.reviewed_at == by_id[citation.id].reviewed_at
        assert citation.reviewed_at <= date.today()
    assert f"[{len(response.citations) + 1}]" not in response.answer


def test_the_georgia_source_carries_the_day_it_was_read_not_the_catalogue_default():
    by_id = {source.id: source for source in SOURCES}
    assert by_id["ga-dor-transfer-tax"].reviewed_at == date(2026, 10, 6)
    assert by_id["irs-523"].reviewed_at == date(2026, 7, 9)
    assert by_id["ga-dor-transfer-tax"].url == "https://dor.georgia.gov/real-estate-transfer-tax"


# --- The way to a person ------------------------------------------------------

@pytest.mark.parametrize("message,earlier,kind,topic", [
    ("Can I talk to an agent?", (), "buyer", None),
    ("I would like to speak to someone about this", (("user", "How do I plan to sell my house?"),), "seller", None),
    ("Can a human call me about a loan?", (("user", "What should I compare in a mortgage?"),), "buyer", "pre-approval"),
    ("I want to tour a house, can someone call me", (), "tour", None),
])
def test_asking_for_a_person_points_to_the_request_form(message, earlier, kind, topic):
    response = ask(message, earlier)
    assert response.handoff_recommended is True
    assert (response.handoff.kind, response.handoff.topic) == (kind, topic)
    assert "request form on this site" in response.answer
    assert "Nothing from this chat is sent with it" in response.answer
    assert response.citations == [] and response.links == []


def test_a_tour_request_is_described_as_a_request_not_a_booking():
    assert ask("I want to tour a house, can someone call me").answer.endswith("A tour request is a request, not a booking.")


def test_a_regulated_question_offers_the_form_and_a_plain_one_does_not():
    assert ask("What tax do I owe when I sell my rental?").handoff.kind == "seller"
    plain = ask("Help me plan a home purchase")
    assert plain.handoff is None and plain.handoff_recommended is False


def test_thanks_is_answered_as_thanks():
    response = ask("thanks!", after("Help me plan a home purchase"))
    assert response.answer.startswith("You’re welcome.")
    assert response.handoff.kind == "buyer"
    assert ask("Thank you").handoff is None


def test_links_only_ever_point_inside_this_site():
    for message, earlier in _PROMPTS:
        for link in ask(message, earlier).links:
            assert link.path.startswith("/") and not link.path.startswith("//")
            assert link.path.split("?")[0] in ("/investment-calculator", "/search")


def test_a_blocked_earlier_message_is_not_used_as_the_topic():
    earlier = [("user", "Which areas have good schools for my kids, I want to buy"), ("assistant", "…")]
    response = ask("Georgia", earlier)
    assert response.continued is False and response.topic is None


def test_a_seller_asking_for_a_person_after_a_closing_cost_question_gets_the_seller_form():
    earlier = [("user", "What are closing costs for a seller in Georgia?"), ("assistant", "…")]
    assert ask("Can I talk to an agent?", earlier).handoff.kind == "seller"
    assert ask("Can I talk to an agent?", [("user", "What are closing costs?"), ("assistant", "…")]).handoff.kind == "buyer"
