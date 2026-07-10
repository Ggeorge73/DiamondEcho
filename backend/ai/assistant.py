from __future__ import annotations

import uuid
from datetime import date
from typing import Iterable

from services.knowledge import KnowledgeSource, get_sources, retrieve_sources

from .models import ChatRequest, ChatResponse, Citation
from .safety import assess_message, has_any


LEGAL_TAX_TERMS = ("tax", "1031", "deduct", "depreciation", "capital gain", "law", "legal", "contract", "evict", "zoning")
MORTGAGE_TERMS = ("mortgage", "loan", "interest rate", "apr", "closing cost", "refinance", "afford")
BUY_TERMS = ("buy", "buyer", "offer", "inspection", "closing", "escrow")
SELL_TERMS = ("sell", "seller", "listing", "list price", "capital gain")
RENT_TERMS = ("rent", "rental", "tenant", "landlord", "lease")
INVEST_TERMS = ("invest", "cap rate", "noi", "dscr", "cash flow", "flip", "brrrr", "commercial")


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


class RealEstateAssistant:
    """Safe, deterministic MVP with a provider-neutral future LLM boundary."""

    def respond(self, request: ChatRequest) -> ChatResponse:
        today = date.today()
        decision = assess_message(request.message)
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

        text = request.message.casefold()
        is_regulated = has_any(text, LEGAL_TAX_TERMS)
        needs_locality = is_regulated and not request.jurisdiction.state
        disclaimers = ["Educational information only; not legal, tax, financial, appraisal, or lending advice."]
        questions: list[str] = []

        if has_any(text, INVEST_TERMS):
            source_ids = ["irs-527", "irs-1031"]
            answer = (
                "A sound deal review separates facts from assumptions. Start with purchase and closing costs, "
                "financing terms, rent or resale evidence, vacancy, operating expenses, reserves, capital work, "
                "holding period, and exit costs. Then compare base, downside, and upside cases using NOI, cap rate, "
                "DSCR, cash-on-cash return, and—on multi-year commercial deals—levered and unlevered IRR. "
                "Use DiamondEcho’s deterministic analysis endpoint for the arithmetic; a model should explain "
                "results but never invent the numbers. Rental-income tax treatment is summarized by the IRS [1], "
                "and a possible like-kind exchange has strict eligibility and timing rules [2]."
            )
            questions.append("Which model should we run: rental, fix-and-flip, commercial, or mortgage?")
        elif has_any(text, MORTGAGE_TERMS):
            source_ids = ["cfpb-home", "cfpb-loan-estimate"]
            answer = (
                "Compare loans using the same purchase price, down payment, term, and lock period. Review both "
                "interest rate and APR, lender credits, points, mortgage insurance, taxes, insurance, HOA dues, "
                "cash to close, and whether the rate can adjust. The CFPB’s official home-loan tools explain the "
                "process [1], and its Loan Estimate guidance is designed for offer-to-offer comparison [2]. "
                "DiamondEcho can calculate principal and interest plus user-supplied housing costs, but only a "
                "licensed lender can quote or approve a loan."
            )
            questions.append("What purchase price, down payment, rate, term, taxes, and insurance should I use?")
        elif has_any(text, SELL_TERMS):
            source_ids = ["irs-523"]
            answer = (
                "A seller plan should cover pricing evidence, property condition and disclosures, preparation "
                "budget, showing strategy, offer terms, title issues, estimated payoff, closing costs, and net "
                "proceeds—not just headline price. For a U.S. principal residence, IRS Publication 523 explains "
                "the federal gain-exclusion framework and reporting considerations [1]. State taxes, disclosure "
                "duties, and contract practice vary, so verify transaction-specific decisions locally."
            )
            questions.append("Is this a primary home, rental, or commercial property, and where is it located?")
        elif has_any(text, RENT_TERMS):
            source_ids = ["hud-fair-housing", "irs-527"]
            answer = (
                "For a rental decision, compare total monthly cost, deposit and fees, lease term, renewal rules, "
                "utilities, maintenance responsibilities, insurance, move-in condition, and exit provisions. "
                "Landlord-tenant rules are state and often city specific. Housing choices and advertising must "
                "also follow fair-housing requirements [1]. Owners evaluating rental economics should track "
                "income, ordinary expenses, capital improvements, and depreciation records; IRS Publication 527 "
                "is the federal starting point [2]."
            )
            questions.append("Which state and city govern the lease?")
        elif has_any(text, BUY_TERMS):
            source_ids = ["cfpb-home", "hud-counseling"]
            answer = (
                "A disciplined purchase flow is: set a total housing budget, obtain financing options, define "
                "objective property criteria, review disclosures and title, inspect and investigate the property, "
                "price repairs and reserves, compare the full offer terms, and verify the final cash-to-close. "
                "The CFPB provides an official step-by-step homebuying framework [1], and HUD can connect buyers "
                "with approved housing counselors [2]. Contract deadlines and remedies are jurisdiction specific."
            )
            questions.append("Where are you buying, and is it a home, rental, or commercial property?")
        elif is_regulated:
            if has_any(text, ("tax", "1031", "deduct", "depreciation", "capital gain")):
                source_ids = ["irs-523", "irs-1031"]
                answer = (
                    "I can explain the general framework and help prepare questions, but the answer depends on the "
                    "property use, ownership structure, dates, basis and improvements, debt, transaction documents, "
                    "and governing jurisdiction. IRS primary sources are the right starting point for U.S. federal "
                    "tax concepts [1][2]. Do not act on a chat summary for a filing, deadline, contract right, or "
                    "entity decision; have the facts reviewed by the appropriate licensed professional."
                )
            else:
                source_ids = []
                answer = (
                    "That question turns on state or local law and the transaction documents. I can organize the "
                    "facts and questions, but I won’t invent a legal rule without the governing jurisdiction and a "
                    "current authoritative source. Do not rely on chat for a deadline, notice, contract remedy, "
                    "zoning conclusion, or eviction step; consult an appropriately licensed local professional."
                )
        else:
            source_ids = ["cfpb-home"]
            answer = (
                "I can help you plan a purchase or sale, compare rental and mortgage scenarios, analyze a fix-and-"
                "flip or commercial deal, explain common transaction terms, and build a checklist for a licensed "
                "professional. I’ll distinguish facts from estimates, cite authoritative sources for regulated "
                "topics, and ask for jurisdiction when local rules matter. The CFPB’s homebuying resources are a "
                "useful U.S. starting point [1]."
            )
            questions.append("Are you buying, selling, renting, financing, or analyzing an investment?")

        sources = get_sources(source_ids)
        if needs_locality:
            answer += " I need the state (and sometimes city or county) before discussing local rules."
            questions.insert(0, "Which state and city or county applies?")
        if is_regulated:
            disclaimers.append("Confirm transaction-specific conclusions with a qualified local attorney, CPA/tax adviser, lender, or licensed real-estate professional.")

        return ChatResponse(
            response_id=str(uuid.uuid4()),
            answer=answer,
            citations=_citations(sources),
            disclaimers=disclaimers,
            follow_up_questions=questions[:2],
            as_of=today,
            jurisdiction=request.jurisdiction,
            risk_level="regulated" if is_regulated else "transaction_specific",
            requires_professional=is_regulated,
            handoff_recommended=is_regulated,
        )
