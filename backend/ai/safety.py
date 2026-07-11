from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True)
class SafetyDecision:
    allowed: bool
    category: str
    message: str | None = None


_SENSITIVE_DATA = (
    re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    re.compile(r"\b(?:\d[ -]*?){13,19}\b"),
    re.compile(r"\b(?:password|routing number|bank login|security code|cvv)\b", re.I),
)

_PROTECTED_CLASS_TERMS = {
    "race", "racial", "religion", "christian", "jewish", "muslim", "nationality",
    "national origin", "families with children", "no children", "disabled people",
    "gay", "straight", "ethnicity", "ethnic", "immigrants",
}

_STEERING_TERMS = {
    "avoid", "best neighborhood for", "only neighborhood", "keep out", "live near",
    "good area for", "safe from", "type of people", "people like me",
}


def contains_sensitive_data(text: str) -> bool:
    return any(pattern.search(text) for pattern in _SENSITIVE_DATA)


def is_steering_request(text: str) -> bool:
    lowered = text.casefold()
    return any(term in lowered for term in _PROTECTED_CLASS_TERMS) and any(
        term in lowered for term in _STEERING_TERMS
    )


def assess_message(text: str) -> SafetyDecision:
    if contains_sensitive_data(text):
        return SafetyDecision(
            allowed=False,
            category="sensitive_data",
            message=(
                "For your security, I can’t process account credentials, full payment-card "
                "numbers, Social Security numbers, or similar secrets. Please remove that "
                "information and ask again."
            ),
        )
    if is_steering_request(text):
        return SafetyDecision(
            allowed=False,
            category="fair_housing",
            message=(
                "I can’t recommend or exclude housing based on protected characteristics. "
                "I can help compare properties using neutral criteria you choose—price, "
                "commute time, accessibility features, lot size, amenities, or property condition."
            ),
        )
    return SafetyDecision(allowed=True, category="allowed")


def has_any(text: str, terms: Iterable[str]) -> bool:
    lowered = text.casefold()
    return any(term in lowered for term in terms)
