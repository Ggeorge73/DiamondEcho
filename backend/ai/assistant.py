from __future__ import annotations

import uuid
from datetime import date
from typing import Iterable, Optional

from services.knowledge import KnowledgeSource, get_sources, retrieve_sources

from . import intent
from .models import ChatRequest, ChatResponse, Citation, Handoff, Jurisdiction, SiteLink
from .safety import assess_message


NET_SHEET = SiteLink(label="Open the Seller Net Sheet", path="/investment-calculator?tool=net-proceeds")
MORTGAGE_TOOL = SiteLink(label="Open the Mortgage Simulator", path="/investment-calculator?tool=mortgage")
DEAL_STUDIO = SiteLink(label="Open Deal Studio", path="/investment-calculator")
MLS_SEARCH = SiteLink(label="Search Georgia MLS", path="/search")
MLS_RENTALS = SiteLink(label="Search Georgia MLS rentals", path="/search?status=rent")

# The request forms a visitor can be pointed to. Each opens /inquire, the one
# approved way to reach a person; nothing typed in the chat is passed along.
_HANDOFFS = {
    "buyer": Handoff(kind="buyer", label="Send a request to a DiamondEcho agent"),
    "seller": Handoff(kind="seller", label="Send a seller request to a DiamondEcho agent"),
    "tour": Handoff(kind="tour", label="Request a property tour"),
    "pre-approval": Handoff(kind="buyer", label="Ask about getting pre-approved", topic="pre-approval"),
}

_USE_PHRASE = {
    "primary": "a primary home",
    "rental": "a rental property",
    "commercial": "a commercial property",
    "land": "land",
}

_GENERAL_DISCLAIMER = "Educational information only; not legal, tax, financial, appraisal, or lending advice."
_LOCAL_DISCLAIMER = (
    "Confirm transaction-specific conclusions with a qualified local attorney, CPA/tax adviser, lender, "
    "or licensed real-estate professional."
)


def _citations(sources: Iterable[KnowledgeSource]) -> list[Citation]:
    return [
        Citation(
            id=source.id,
            title=source.title,
            publisher=source.publisher,
            url=source.url,
            jurisdiction=source.jurisdiction,
            reviewed_at=source.reviewed_at,
        )
        for source in sources
    ]


class _Cites:
    """Numbers sources in the order an answer first mentions them."""

    def __init__(self) -> None:
        self.ids: list[str] = []

    def ref(self, source_id: str) -> str:
        if source_id not in self.ids:
            self.ids.append(source_id)
        return f"[{self.ids.index(source_id) + 1}]"


def _handoff_for(topic: Optional[str], selling: bool = False) -> Handoff:
    if topic == "sell" or (topic in (None, "closing") and selling):
        return _HANDOFFS["seller"]
    if topic == "mortgage":
        return _HANDOFFS["pre-approval"]
    return _HANDOFFS["buyer"]


def _where(state: Optional[str]) -> str:
    return f" in {intent.state_name(state)}" if state else ""


def _office_line(state: Optional[str], kind: str) -> str:
    """How to reach a person, said only where DiamondEcho can help."""
    if state == "GA":
        return f" When you are ready to talk it through, send a {kind} request and DiamondEcho’s Georgia office will follow up."
    if state:
        return (
            f" DiamondEcho’s office is in Georgia, so for a property in {intent.state_name(state)} "
            "the right person is an agent licensed there."
        )
    return ""


class RealEstateAssistant:
    """Safe, deterministic MVP with a provider-neutral future LLM boundary."""

    def respond(self, request: ChatRequest) -> ChatResponse:
        today = date.today()
        message = request.message
        decision = assess_message(message)
        if not decision.allowed:
            source = retrieve_sources(["fair housing"], 1) if decision.category == "fair_housing" else []
            return ChatResponse(
                response_id=str(uuid.uuid4()),
                answer=decision.message or "I can’t help with that request.",
                citations=_citations(source),
                disclaimers=["Do not share sensitive identity, account, or payment information in chat."],
                follow_up_questions=["Which neutral property or transaction criteria should we use instead?"],
                as_of=today,
                jurisdiction=request.jurisdiction,
                risk_level="regulated" if decision.category == "fair_housing" else "general",
                requires_professional=False,
                handoff_recommended=False,
            )

        # What the visitor said earlier, newest first. The page sends the
        # question being asked as the last item of the history as well.
        earlier = [item.content for item in request.history if item.role == "user"]
        if earlier and " ".join(earlier[-1].split()) == message:
            earlier = earlier[:-1]
        earlier = [text for text in reversed(earlier) if assess_message(text).allowed]

        state = intent.normalize_state(request.jurisdiction.state) or intent.find_state(message)
        if not state:
            state = next((found for found in map(intent.find_state, earlier) if found), None)
        jurisdiction = Jurisdiction(country=request.jurisdiction.country, state=state, locality=request.jurisdiction.locality)

        topic = intent.classify(message)
        prior_topic = next((found for found in map(intent.classify, earlier) if found), None)
        # Whose side the visitor is on, for the request form: a question about
        # closing costs does not say, so the conversation is asked instead.
        selling = any(intent.mentions(text, "sell") for text in [message, *earlier])
        is_regulated = intent.is_regulated(message)
        needs_locality = is_regulated and not state
        disclaimers = [_GENERAL_DISCLAIMER]
        questions: list[str] = []
        links: list[SiteLink] = []
        handoff: Optional[Handoff] = None
        cites = _Cites()
        continued = False
        risk_level = "regulated" if is_regulated else "transaction_specific"

        if intent.wants_human(message):
            subject = topic or prior_topic
            handoff = _HANDOFFS["tour"] if intent.wants_tour(message) else _handoff_for(subject, selling)
            topic = subject
            answer = (
                "You can reach a DiamondEcho agent with the request form on this site. It goes to the staff "
                "queue, and a team member can follow up using the contact details you give; the form shows when "
                "replies are sent. Nothing from this chat is sent with it, so say in the form what you need."
            )
            if handoff.kind == "tour":
                answer += " A tour request is a request, not a booking."
            risk_level = "general"
        elif topic is None and intent.asks_for_tour(message):
            # "I would like to tour a property" names no topic and asks for no
            # person, yet a tour is arranged by a person. It used to get the
            # opening menu; it now gets the tour request form.
            handoff = _HANDOFFS["tour"]
            topic = prior_topic
            answer = (
                "To see a property in person, send a tour request with the form on this site. It goes to the staff "
                "queue, and a team member can follow up using the contact details you give; the form shows when "
                "replies are sent. Nothing from this chat is sent with it, so name the property in the form. "
                "A tour request is a request, not a booking."
            )
            risk_level = "general"
        elif intent.is_thanks(message):
            topic = prior_topic
            answer = "You’re welcome. Ask another question whenever you like."
            if prior_topic:
                handoff = _handoff_for(prior_topic, selling)
                answer += " If you would rather talk it through with a person, the request form reaches a DiamondEcho agent."
            risk_level = "general"
        else:
            if prior_topic and not is_regulated and intent.classify_reply(message) is None:
                # A reply that names no topic of its own answers the last
                # question: "A rental in Tampa, FL" after a question about
                # selling is still about selling.
                topic, continued = prior_topic, True
            opening = "Thanks. " if continued else ""
            # Details come from this message first, then from earlier replies.
            past = earlier if continued else []
            use = intent.find_use(message) or next((found for found in (intent.find_use(text, strict=True) for text in past) if found), None)
            deal = intent.find_deal(message) or next((found for found in map(intent.find_deal, past) if found), None)
            use_followup = continued or (topic in ("sell", "buy", "rent") and bool(intent.find_state(message)))

            if topic == "closing":
                answer = self._closing(cites, state)
                links = [NET_SHEET, MORTGAGE_TOOL]
            elif topic == "invest" and continued:
                answer = self._invest_followup(cites, deal)
                links = [DEAL_STUDIO]
                handoff = _handoff_for(topic)
            elif topic == "invest":
                answer = (
                    "A sound deal review separates facts from assumptions. Start with purchase and closing costs, "
                    "financing terms, rent or resale evidence, vacancy, operating expenses, reserves, capital work, "
                    "holding period, and exit costs. Then compare base, downside, and upside cases using NOI, cap rate, "
                    "DSCR, cash-on-cash return, and—on multi-year commercial deals—levered and unlevered IRR. "
                    "Deal Studio on this site does the arithmetic from the figures you enter; treat each result as an "
                    f"estimate to check, not a prediction. Rental-income tax treatment is summarized by the IRS {cites.ref('irs-527')}, "
                    f"and a possible like-kind exchange has strict eligibility and timing rules {cites.ref('irs-1031')}."
                )
                questions.append("Which kind of deal are you weighing: a rental, a fix-and-flip, or land development?")
                links = [DEAL_STUDIO]
            elif topic == "mortgage" and continued:
                answer = (
                    "Thanks. I can’t quote a rate or approve a loan, and I don’t run the numbers inside this chat. "
                    "Put those figures into the Mortgage Simulator on this site: it shows the monthly payment split "
                    "into principal and interest, property tax, insurance, HOA dues and mortgage insurance, with the "
                    "full repayment schedule. Then ask two or three lenders for a Loan Estimate on the same day and "
                    f"compare them line by line {cites.ref('cfpb-loan-estimate')}. DiamondEcho is not a lender; send a "
                    "pre-approval request and an agent can introduce you to one."
                )
                links = [MORTGAGE_TOOL]
                handoff = _handoff_for(topic)
            elif topic == "mortgage":
                answer = (
                    "Compare loans using the same purchase price, down payment, term, and lock period. Review both "
                    "interest rate and APR, lender credits, points, mortgage insurance, taxes, insurance, HOA dues, "
                    "cash to close, and whether the rate can adjust. The CFPB’s official home-loan tools explain the "
                    f"process {cites.ref('cfpb-home')}, and its Loan Estimate guidance is designed for offer-to-offer comparison {cites.ref('cfpb-loan-estimate')}. "
                    "Deal Studio includes loan payments when it analyzes a rental, flip, or land deal, but only a "
                    "licensed lender can quote or approve a loan."
                )
                questions.append("What purchase price, down payment, rate, term, taxes, and insurance should I use?")
                links = [MORTGAGE_TOOL]
            elif topic == "sell" and use_followup:
                answer = self._sell_followup(cites, state, use, opening)
                links = [NET_SHEET]
                if state in (None, "GA"):
                    handoff = _handoff_for(topic)
                if not state and not needs_locality:
                    questions.append("Which state is the property in?")
            elif topic == "sell":
                answer = (
                    "A seller plan should cover pricing evidence, property condition and disclosures, preparation "
                    "budget, showing strategy, offer terms, title issues, estimated payoff, closing costs, and net "
                    "proceeds—not just headline price. For a U.S. principal residence, IRS Publication 523 explains "
                    f"the federal gain-exclusion framework and reporting considerations {cites.ref('irs-523')}. State taxes, disclosure "
                    "duties, and contract practice vary, so verify transaction-specific decisions locally."
                )
                questions.append("Is this a primary home, rental, or commercial property, and where is it located?")
                links = [NET_SHEET]
            elif topic == "rent" and use_followup:
                answer = self._rent_followup(cites, state, opening)
                if state in (None, "GA"):
                    links = [MLS_RENTALS]
                if not state and not needs_locality:
                    questions.append("Which state and city govern the lease?")
            elif topic == "rent":
                answer = (
                    "For a rental decision, compare total monthly cost, deposit and fees, lease term, renewal rules, "
                    "utilities, maintenance responsibilities, insurance, move-in condition, and exit provisions. "
                    "Landlord-tenant rules are state and often city specific. Housing choices and advertising must "
                    f"also follow fair-housing requirements {cites.ref('hud-fair-housing')}. Owners evaluating rental economics should track "
                    "income, ordinary expenses, capital improvements, and depreciation records; IRS Publication 527 "
                    f"is the federal starting point {cites.ref('irs-527')}."
                )
                questions.append("Which state and city govern the lease?")
            elif topic == "buy" and use_followup:
                answer = self._buy_followup(cites, state, opening)
                links = [MORTGAGE_TOOL] + ([MLS_SEARCH] if state in (None, "GA") else [])
                if state in (None, "GA"):
                    handoff = _handoff_for(topic)
                if not state and not needs_locality:
                    questions.append("Which state are you buying in?")
            elif topic == "buy":
                answer = (
                    "A disciplined purchase flow is: set a total housing budget, obtain financing options, define "
                    "objective property criteria, review disclosures and title, inspect and investigate the property, "
                    "price repairs and reserves, compare the full offer terms, and verify the final cash-to-close. "
                    f"The CFPB provides an official step-by-step homebuying framework {cites.ref('cfpb-home')}, and HUD can connect buyers "
                    f"with approved housing counselors {cites.ref('hud-counseling')}. Contract deadlines and remedies are jurisdiction specific."
                )
                questions.append("Where are you buying, and is it a home, rental, or commercial property?")
                links = [MORTGAGE_TOOL, MLS_SEARCH]
            elif is_regulated:
                if intent.is_tax(message):
                    answer = (
                        "I can explain the general framework and help prepare questions, but the answer depends on the "
                        "property use, ownership structure, dates, basis and improvements, debt, transaction documents, "
                        "and governing jurisdiction. IRS primary sources are the right starting point for U.S. federal "
                        f"tax concepts {cites.ref('irs-523')}{cites.ref('irs-1031')}. Do not act on a chat summary for a filing, deadline, contract right, or "
                        "entity decision; have the facts reviewed by the appropriate licensed professional."
                    )
                else:
                    answer = (
                        "That question turns on state or local law and the transaction documents. I can organize the "
                        "facts and questions, but I won’t invent a legal rule without the governing jurisdiction and a "
                        "current authoritative source. Do not rely on chat for a deadline, notice, contract remedy, "
                        "zoning conclusion, or eviction step; consult an appropriately licensed local professional."
                    )
            else:
                answer = (
                    "I can help you plan a purchase or sale, compare rental and mortgage scenarios, analyze a fix-and-"
                    "flip or commercial deal, explain common transaction terms, and build a checklist for a licensed "
                    "professional. I’ll distinguish facts from estimates, cite authoritative sources for regulated "
                    "topics, and ask for jurisdiction when local rules matter. The CFPB’s homebuying resources are a "
                    f"useful U.S. starting point {cites.ref('cfpb-home')}."
                )
                questions.append("Are you buying, selling, renting, financing, or analyzing an investment?")

        if needs_locality:
            answer += " I need the state (and sometimes city or county) before discussing local rules."
            questions.insert(0, "Which state and city or county applies?")
        if is_regulated:
            disclaimers.append(_LOCAL_DISCLAIMER)
            if handoff is None and state in (None, "GA"):
                handoff = _handoff_for(topic or prior_topic, selling)

        return ChatResponse(
            response_id=str(uuid.uuid4()),
            answer=answer,
            citations=_citations(get_sources(cites.ids)),
            disclaimers=disclaimers,
            follow_up_questions=questions[:2],
            as_of=today,
            jurisdiction=jurisdiction,
            risk_level=risk_level,
            requires_professional=is_regulated,
            handoff_recommended=handoff is not None,
            topic=topic,
            continued=continued,
            links=links,
            handoff=handoff,
        )

    @staticmethod
    def _closing(cites: _Cites, state: Optional[str]) -> str:
        answer = (
            "Closing costs are the fees paid to finish a sale or a loan, and both sides have them. A buyer’s "
            "are listed on the lender’s Loan Estimate and, shortly before closing, on the Closing Disclosure "
            f"{cites.ref('cfpb-loan-estimate')}: lender fees, title and settlement charges, recording fees, and prepaid taxes and insurance. "
            "A seller’s usually include brokerage compensation, title and attorney fees, any credits agreed with "
            "the buyer, and property tax up to the closing date."
        )
        if state == "GA":
            answer += (
                " In Georgia the state transfer tax is $1 for the first $1,000 of the price and 10 cents for each "
                "additional $100; the seller is liable unless the contract says the buyer pays "
                f"{cites.ref('ga-dor-transfer-tax')}."
            )
        elif state:
            answer += (
                f" Transfer taxes and recording fees are set by each state and county, and I have no reviewed "
                f"source for {intent.state_name(state)}, so I won’t quote a figure for it."
            )
        else:
            answer += " Transfer taxes and recording fees are set by each state and county."
        answer += (
            " Amounts differ by lender, county and contract, so treat any figure as an estimate until you have "
            "the settlement statement. On this site, the Seller Net Sheet and the Mortgage Simulator do the "
            "arithmetic from figures you enter."
        )
        return answer

    @staticmethod
    def _sell_followup(cites: _Cites, state: Optional[str], use: Optional[str], opening: str = "") -> str:
        answer = (
            f"{opening}For {_USE_PHRASE.get(use, 'your property')}{_where(state)}, a sensible order of work is this. "
            "First, price from recent comparable sales rather than an online estimate; a licensed agent can pull "
            "them from the MLS. Second, work out what you would keep: the Seller Net Sheet on this site subtracts "
            "the mortgage payoff, brokerage compensation, closing costs and prorated property tax from a sale "
            "price you enter"
        )
        if state == "GA":
            answer += (
                ", and adds Georgia’s transfer tax, which the Department of Revenue gives as $1 for the first "
                f"$1,000 of the price and 10 cents for each additional $100 {cites.ref('ga-dor-transfer-tax')}."
            )
        else:
            answer += "."
        answer += (
            " Third, gather what a buyer will ask for: disclosures, repair and permit records, HOA documents and "
            "your loan payoff statement."
        )
        if use == "rental":
            answer += (
                " A rental is taxed differently from a main home when it is sold, including the depreciation "
                f"taken over the years; IRS Publication 527 is the federal starting point {cites.ref('irs-527')}, and a tax "
                "adviser should run the numbers."
            )
        elif use == "commercial":
            answer += (
                " For business or investment property a like-kind exchange may be possible, with strict "
                f"eligibility and timing rules {cites.ref('irs-1031')}; a tax adviser should confirm it before you list."
            )
        elif use == "land":
            answer += " How a gain on land is taxed depends on how it was held, so ask a tax adviser before you list."
        else:
            answer += f" For a main home, IRS Publication 523 explains when gain can be left out of federal tax {cites.ref('irs-523')}."
        return answer + _office_line(state, "seller")

    @staticmethod
    def _buy_followup(cites: _Cites, state: Optional[str], opening: str = "") -> str:
        answer = (
            f"{opening}For a purchase{_where(state)}, the next steps are these. First, talk to a lender about "
            "pre-approval before you tour, so an offer can be taken seriously; DiamondEcho is not a lender. "
            "Second, estimate the full monthly cost with the Mortgage Simulator on this site, which shows "
            "principal and interest, property tax, insurance, HOA dues and mortgage insurance separately."
        )
        if state in (None, "GA"):
            answer += " Third, look at current listings through the Georgia MLS search on this site."
        else:
            answer += (
                f" Third, look at current listings through an agent or MLS that covers {intent.state_name(state)}; "
                "the search on this site covers Georgia."
            )
        answer += (
            " Before any offer, read the seller’s disclosures, book an inspection and confirm the cash needed to "
            f"close; the CFPB’s homebuying guide walks through each stage {cites.ref('cfpb-home')}."
        )
        return answer + _office_line(state, "buyer")

    @staticmethod
    def _rent_followup(cites: _Cites, state: Optional[str], opening: str = "") -> str:
        if state:
            rules = (
                f"{opening}Lease rules come from {intent.state_name(state)} law and sometimes from the city or county, "
                "and I have no reviewed source for them, so I won’t state them."
            )
        else:
            rules = f"{opening}Lease rules come from state law and sometimes from the city or county."
        answer = (
            f"{rules} Before you sign, check the total monthly cost, the deposit and fees, the lease length and "
            "renewal terms, who pays for utilities and repairs, the move-in condition report, and the notice "
            f"needed to leave. Housing providers must follow fair-housing rules {cites.ref('hud-fair-housing')}."
        )
        if state in (None, "GA"):
            answer += " Current rentals can be searched through the Georgia MLS rental search on this site."
        return answer

    @staticmethod
    def _invest_followup(cites: _Cites, deal: Optional[str]) -> str:
        if deal == "land":
            body = (
                "For land, open Deal Studio and choose Land development. Enter the price, site and construction "
                "costs, the timeline, the financing and the value when finished. It works out the development "
                "profit and margin and the residual land value, which is the most you could pay and still reach "
                "your target margin, and gives a Go / No-Go call with the reasons."
            )
        elif deal == "flip":
            body = (
                "For a fix-and-flip, open Deal Studio and choose Fix & flip. Enter the purchase price, the repair "
                "budget, the months you expect to hold, the financing and the resale value, and it works out the "
                "profit and return from those figures."
            )
        elif deal == "rental":
            body = (
                "For a rental, open Deal Studio and choose Rental & commercial. Enter the price, closing costs, "
                "loan terms, rent, vacancy and operating expenses, and it works out the returns from those "
                f"figures. Rental income has its own federal tax rules {cites.ref('irs-527')}."
            )
        else:
            body = (
                "Open Deal Studio and pick the tab that matches the deal: Rental & commercial, Fix & flip or "
                "Land development. Each asks for the figures that kind of deal turns on and works out the returns "
                "from them."
            )
        return (
            f"Thanks. {body} Every result is an estimate to check against real quotes and comparable sales."
        )
