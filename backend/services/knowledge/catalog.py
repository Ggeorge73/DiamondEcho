from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Iterable, List


@dataclass(frozen=True)
class KnowledgeSource:
    id: str
    title: str
    publisher: str
    url: str
    jurisdiction: str
    reviewed_at: date
    topics: tuple[str, ...]


REVIEW_DATE = date(2026, 7, 9)

SOURCES: tuple[KnowledgeSource, ...] = (
    KnowledgeSource("cfpb-home", "Buying a House", "Consumer Financial Protection Bureau", "https://www.consumerfinance.gov/owning-a-home/", "US", REVIEW_DATE, ("buy", "mortgage", "closing", "affordability")),
    KnowledgeSource("cfpb-loan-estimate", "Loan Estimate and Closing Disclosure", "Consumer Financial Protection Bureau", "https://www.consumerfinance.gov/owning-a-home/loan-estimate/", "US", REVIEW_DATE, ("mortgage", "closing", "loan", "fees")),
    KnowledgeSource("hud-counseling", "About Housing Counseling", "U.S. Department of Housing and Urban Development", "https://www.hud.gov/hud-partners/single-family-about-housing-counseling", "US", REVIEW_DATE, ("buy", "mortgage", "foreclosure", "counselor")),
    KnowledgeSource("hud-fair-housing", "Fair Housing Act Overview", "U.S. Department of Housing and Urban Development", "https://www.hud.gov/helping-americans/fair-housing-act-overview", "US", REVIEW_DATE, ("fair housing", "discrimination", "rent", "buy", "sell")),
    KnowledgeSource("irs-523", "Publication 523: Selling Your Home", "Internal Revenue Service", "https://www.irs.gov/publications/p523", "US federal", REVIEW_DATE, ("sell", "tax", "capital gain", "primary residence")),
    KnowledgeSource("irs-527", "Publication 527: Residential Rental Property", "Internal Revenue Service", "https://www.irs.gov/publications/p527", "US federal", REVIEW_DATE, ("rental", "rent", "tax", "depreciation", "expenses")),
    KnowledgeSource("irs-1031", "Like-Kind Exchanges — Real Estate Tax Tips", "Internal Revenue Service", "https://www.irs.gov/businesses/small-businesses-self-employed/like-kind-exchanges-real-estate-tax-tips", "US federal", REVIEW_DATE, ("1031", "exchange", "commercial", "investment", "tax")),
    KnowledgeSource("irs-business", "Small Business and Self-Employed Tax Center", "Internal Revenue Service", "https://www.irs.gov/businesses/small-businesses-self-employed", "US federal", REVIEW_DATE, ("commercial", "business", "tax", "investment")),
)


def retrieve_sources(topics: Iterable[str], limit: int = 3) -> List[KnowledgeSource]:
    normalized = {topic.casefold() for topic in topics}
    scored = []
    for source in SOURCES:
        score = sum(1 for topic in source.topics if topic.casefold() in normalized)
        if score:
            scored.append((score, source))
    scored.sort(key=lambda item: (-item[0], item[1].id))
    return [source for _, source in scored[:limit]]


def get_sources(source_ids: Iterable[str]) -> List[KnowledgeSource]:
    by_id = {source.id: source for source in SOURCES}
    return [by_id[source_id] for source_id in source_ids if source_id in by_id]
