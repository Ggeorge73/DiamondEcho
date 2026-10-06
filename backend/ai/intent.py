"""What a visitor's message is about, and the details it gives.

Everything here is plain word matching: no model, nothing remembered between
requests. The page sends the recent conversation with each question, so a
short reply such as "A primary home in Atlanta, Georgia" can be read against
the question it answers (DE-20).

Terms are matched as whole words. The earlier check looked for the letters
anywhere, so "current" counted as "rent" and "lawn" as "law", while
"Help me plan a home purchase" matched nothing at all.
"""
from __future__ import annotations

import re
from typing import Iterable, Optional, Sequence


def _compile(terms: Iterable[str]) -> re.Pattern[str]:
    parts = []
    for term in terms:
        words = [re.escape(word) for word in re.split(r"[\s-]+", term.strip()) if word]
        parts.append(r"[\s-]+".join(words))
    # A trailing "s" or "es" is allowed so "offers" and "taxes" still match.
    return re.compile(r"(?<![a-z0-9])(?:" + "|".join(parts) + r")(?:e?s)?(?![a-z0-9])", re.I)


# Checked in this order: the first topic with a matching term wins.
_TOPICS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("invest", _compile((
        "invest", "investing", "investor", "investment", "cap rate", "noi", "dscr", "cash flow",
        "cash on cash", "flip", "flipping", "brrrr", "commercial", "analyze", "analyse", "analysis",
        "underwrite", "underwriting", "rental property", "investment property", "income property",
        "land deal", "land development", "go no go",
    ))),
    ("closing", _compile((
        "closing cost", "closing fee", "transfer tax", "title insurance", "net proceed",
        "cash to close", "settlement cost", "settlement fee",
    ))),
    ("mortgage", _compile((
        "mortgage", "loan", "interest rate", "apr", "refinance", "refinancing", "afford",
        "affordable", "affordability", "down payment", "pre approval", "preapproval", "pre approved", "preapproved",
        "lender", "pmi", "monthly payment",
    ))),
    ("sell", _compile((
        "sell", "selling", "seller", "list price", "list my", "listing my", "listing agent",
        "capital gain", "home valuation", "what is my home worth",
    ))),
    ("rent", _compile((
        "rent", "renting", "rented", "renter", "rental", "tenant", "landlord", "lease", "leasing",
        "security deposit",
    ))),
    ("buy", _compile((
        "buy", "buying", "buyer", "purchase", "purchasing", "make an offer", "an offer", "my offer",
        "offer price", "inspection", "closing", "escrow", "first time", "house hunting", "home search",
    ))),
)

TOPICS: tuple[str, ...] = tuple(name for name, _ in _TOPICS)

_TAX = _compile(("tax", "1031", "deduct", "deduction", "deductible", "depreciation", "capital gain"))
_LEGAL = _compile(("law", "legal", "legally", "illegal", "contract", "evict", "eviction", "zoning", "statute", "ordinance"))

_HUMAN = _compile((
    "talk to an agent", "talk to a person", "talk to someone", "talk to a human", "speak to an agent",
    "speak to a person", "speak to someone", "speak with an agent", "speak with someone", "real person",
    "human", "call me", "contact me", "contact an agent", "contact a realtor", "reach an agent",
    "reach someone", "specialist", "talk to a realtor", "speak to a realtor", "get in touch",
    "someone to call", "have an agent", "have someone",
))
_TOUR = _compile(("tour", "showing", "see the house", "see the home", "see the property", "view the property", "visit the property", "walk through", "walkthrough"))

_THANKS = re.compile(r"^(?:ok(?:ay)?|thanks?(?: you)?(?: so much| very much)?|thank you|great|got it|perfect|cool|understood|that helps)[\s.!,]*(?:thanks?(?: you)?|thank you)?[\s.!]*$", re.I)

_STATES = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA",
    "colorado": "CO", "connecticut": "CT", "delaware": "DE", "florida": "FL", "georgia": "GA",
    "hawaii": "HI", "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD", "massachusetts": "MA",
    "michigan": "MI", "minnesota": "MN", "mississippi": "MS", "missouri": "MO", "montana": "MT",
    "nebraska": "NE", "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM",
    "new york": "NY", "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK",
    "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT",
    "virginia": "VA", "washington": "WA", "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
    "district of columbia": "DC", "washington dc": "DC", "washington d c": "DC",
}
_STATE_NAMES = {code: name.title() for name, code in _STATES.items() if not name.startswith("washington d")}
_STATE_NAMES["DC"] = "the District of Columbia"
# Longest names first, so "West Virginia" is not read as "Virginia".
_STATE_NAME_PATTERN = re.compile(
    r"(?<![a-z])(" + "|".join(re.escape(name).replace(r"\ ", r"\s+") for name in sorted(_STATES, key=len, reverse=True)) + r")(?![a-z])",
    re.I,
)
# A two-letter code counts only where people write one: "Atlanta, GA" or
# "in GA". Bare "IN", "OR", "ME", "OK" and "HI" are words far more often.
_STATE_CODE_PATTERN = re.compile(r"(?:,\s*|\b(?:[Ii]n|[Oo]f)\s+)([A-Z]{2})(?![A-Za-z])")

_USES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("commercial", _compile(("commercial", "office", "retail", "warehouse", "industrial"))),
    ("rental", _compile(("rental", "rent it out", "rented out", "investment property", "tenant occupied", "tenant"))),
    ("primary", _compile(("primary home", "primary residence", "main home", "my home", "our home", "my house", "our house", "live in it", "i live there", "we live there", "primary"))),
    ("land", _compile(("land", "vacant lot", "building lot", "acreage", "parcel"))),
)
_USES_STRICT: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (name, _compile(("primary home", "primary residence", "main home", "primary")) if name == "primary" else pattern)
    for name, pattern in _USES
)
_DEALS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("land", _compile(("land", "vacant lot", "building lot", "acreage", "subdivision", "development", "develop"))),
    ("flip", _compile(("flip", "flipping", "fix and flip", "rehab", "renovate and sell"))),
    ("rental", _compile(("rental", "rent", "buy and hold", "tenant", "multifamily", "duplex"))),
)


# Words a visitor uses to answer "what kind of property?" or "what kind of
# deal?". On their own they also read as topics ("rental", "commercial"), so a
# reply made only of them belongs to the question it answers.
_ANSWER_WORDS = _compile((
    "primary home", "primary residence", "primary", "main home", "home", "house", "condo", "townhouse",
    "rental property", "rental", "investment property", "commercial property", "commercial",
    "land development", "land", "vacant lot", "fix and flip", "flip", "development", "property",
))


def classify_reply(text: str) -> Optional[str]:
    """The topic of a message once the words that merely answer a question are set aside."""
    return classify(_ANSWER_WORDS.sub(" ", text))


def matches(text: str, pattern: re.Pattern[str]) -> bool:
    return bool(pattern.search(text))


def classify(text: str) -> Optional[str]:
    """The topic of one message, or None when it names none."""
    for name, pattern in _TOPICS:
        if pattern.search(text):
            return name
    return None


def mentions(text: str, topic: str) -> bool:
    """Whether the text uses any word of the named topic, whatever else it says."""
    return any(name == topic and pattern.search(text) for name, pattern in _TOPICS)


def is_tax(text: str) -> bool:
    return matches(text, _TAX)


def is_regulated(text: str) -> bool:
    return matches(text, _TAX) or matches(text, _LEGAL)


def wants_human(text: str) -> bool:
    return matches(text, _HUMAN)


def wants_tour(text: str) -> bool:
    return matches(text, _TOUR)


def is_thanks(text: str) -> bool:
    return bool(_THANKS.match(text.strip()))


def find_state(text: str) -> Optional[str]:
    """Two-letter code of the first U.S. state named in the text."""
    found = _STATE_NAME_PATTERN.search(text)
    if found:
        return _STATES[" ".join(found.group(1).casefold().split())]
    if text.upper() != text:  # all capitals would make every short word a code
        for code in _STATE_CODE_PATTERN.findall(text):
            if code in _STATE_NAMES:
                return code
    return None


def normalize_state(value: Optional[str]) -> Optional[str]:
    """What the visitor typed in the state box, as a code where it is one."""
    if not value or not value.strip():
        return None
    clean = " ".join(value.strip().split())
    if clean.upper() in _STATE_NAMES and len(clean) == 2:
        return clean.upper()
    return _STATES.get(clean.casefold().replace(".", ""), clean)


def state_name(code: Optional[str]) -> Optional[str]:
    if not code:
        return None
    return _STATE_NAMES.get(code, code)


def _first(text: str, table: Sequence[tuple[str, re.Pattern[str]]]) -> Optional[str]:
    for name, pattern in table:
        if pattern.search(text):
            return name
    return None


def find_use(text: str, strict: bool = False) -> Optional[str]:
    """primary, rental, commercial or land, when the message says which.

    "Sell my house" suggests a main home without saying so. That reading is
    used for the message being answered, not for older ones (strict)."""
    return _first(text, _USES_STRICT if strict else _USES)


def find_deal(text: str) -> Optional[str]:
    """rental, flip or land, when the message says which."""
    return _first(text, _DEALS)
