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


def _any(*parts: str) -> re.Pattern[str]:
    return re.compile(r"(?<![a-z0-9])(?:" + "|".join(parts) + r")(?![a-z0-9])", re.I)


# DE-20 / DE-25 finding F7. The first version of this check was two short word
# lists: "families with children" was caught and "families with kids" was not.
# A list can never be complete, so this one is built the other way round: any
# message that mentions a protected characteristic *and* is about choosing a
# place to live, or choosing who gets housing, is turned towards neutral
# criteria. That is deliberately broad. The reply does not accuse the visitor
# of anything; it says what the assistant can compare instead.

# People described by a protected characteristic. Colour and nationality words
# are everyday words too ("white kitchen", "black appliances", "Indian
# restaurant"), so they count only next to a word for people or a place.
_GROUP = (
    r"white|black|brown|asian|hispanic|latino|latina|latinx|indian|arab|arabic|mexican|chinese|"
    r"korean|vietnamese|african|african[\s-]american|haitian|jamaican|nigerian|european|"
    r"jewish|muslim|islamic|christian|catholic|hindu|sikh|buddhist|mormon|orthodox|"
    r"gay|lesbian|lgbt|lgbtq|queer|trans|transgender|straight|foreign|immigrant|minority"
)
_PEOPLE = (
    r"people|persons?|folks?|famil(?:y|ies)|couples?|residents?|neighbou?rs?|households?|tenants?|"
    r"renters?|buyers?|owners?|applicants?|communit(?:y|ies)|population|neighbou?rhoods?|areas?|"
    r"parts? of town|sides? of town|suburbs?|schools?|churches|kids|children|men|women|guys?"
)
_PROTECTED = (
    # Named characteristics.
    _any(
        r"race", r"races", r"racial", r"racially", r"skin colou?r", r"ethnic", r"ethnicity", r"ethnicities",
        r"religion", r"religions", r"religious", r"faith", r"nationalit(?:y|ies)", r"national origin",
        r"sexual orientation", r"gender identity", r"familial status", r"marital status",
        r"demographics?", r"diverse", r"diversity", r"immigrants?", r"foreigners?", r"minorit(?:y|ies)",
        r"whites", r"blacks", r"asians", r"hispanics", r"latinos", r"jews", r"muslims", r"christians",
        r"catholics", r"hindus", r"gays", r"lesbians",
        r"disabled", r"disabilit(?:y|ies)", r"handicapped", r"mental illness", r"mentally ill",
        r"service animals?", r"section 8", r"housing vouchers?", r"voucher holders?",
    ),
    # Families and children.
    _any(
        r"famil(?:y|ies) with (?:\w+ )?(?:kids?|child|children|babies|toddlers|teenagers?)",
        r"(?:with|have|having|no|without|any) (?:\w+ )?(?:kids?|children|babies|toddlers|teenagers?)",
        r"kids?", r"children", r"child free", r"childfree", r"childless", r"adults only", r"adult only",
        r"single (?:mom|mother|dad|father|parent|women|woman|men|man)s?", r"pregnant", r"pregnancy",
        r"unmarried", r"married couples?",
    ),
    # "white families", "Muslim community", "mostly Hispanic".
    re.compile(r"(?<![a-z])(?:" + _GROUP + r")s?[\s-]+(?:\w+[\s-]+){0,2}?(?:" + _PEOPLE + r")(?![a-z])", re.I),
    re.compile(r"(?<![a-z])(?:mostly|mainly|predominantly|majority|all|only|too many|more|fewer|few|no)[\s-]+(?:" + _GROUP + r")(?![a-z])", re.I),
    # Asking for sameness without naming a group.
    _any(
        r"people like (?:me|us)", r"(?:type|kind|sort|class) of people", r"(?:my|our) own (?:kind|people)",
        r"those people", r"certain people", r"wrong (?:kind of )?people", r"right (?:kind of )?people",
        r"people who look like", r"fit in with",
    ),
)

# Choosing where to live.
_PLACE_CHOICE = _any(
    r"neighbou?rhoods?", r"areas?", r"communit(?:y|ies)", r"parts? of town", r"sides? of town", r"suburbs?",
    r"subdivisions?", r"zip codes?", r"districts?", r"towns?", r"cit(?:y|ies)", r"count(?:y|ies)", r"streets?",
    r"blocks?", r"buildings?", r"complex(?:es)?", r"where (?:should|can|could|do|would|to)", r"lives? (?:in|there|here|near|around|among|with|by|next to)", r"living (?:in|there|here|near|around)",
    r"move (?:to|near|away|out)", r"nearby", r"near", r"around here", r"avoid", r"stay away", r"away from",
    r"keep out", r"best place", r"good place", r"right place", r"somewhere",
)
# Choosing who gets housing.
_PERSON_CHOICE = _any(
    r"tenants?", r"renters?", r"applicants?", r"applications?", r"buyers?", r"rent(?:ing)? (?:it |my \w+ |the \w+ |out )?to",
    r"sell(?:ing)? (?:it |my \w+ |the \w+ )?to", r"leas(?:e|ing) (?:it |my \w+ |the \w+ )?to", r"show(?:ing)? (?:it |my \w+ |the \w+ )?to",
    r"refuse", r"reject", r"turn (?:down|away)", r"deny", r"decline", r"screen", r"screening", r"prefer", r"preference",
    r"advertis(?:e|ing|ement)", r"my ad", r"the ad", r"listing say", r"only", r"not allow", r"don'?t allow", r"won'?t allow",
    r"don'?t want", r"do not want", r"evict",
)

# Words that rate a place without naming anyone. Agents are trained not to
# answer these with an opinion, because "safe" and "good" so often stand in
# for who lives there. The reply points to published figures instead.
_PLACE_RATING = _any(
    r"safe(?:st|r)? (?:neighbou?rhoods?|areas?|part|side|place|community|communit(?:ies)|streets?|town|city|suburbs?)",
    r"(?:safe|unsafe|dangerous|rough) (?:to live|there|here|at night|around (?:there|here))",
    r"(?:is|are|how (?:safe|dangerous) (?:is|are)) (?:it|this|that|there|here|(?:the|this|that) (?:area|neighbou?rhood|street|block|town|city|suburb|county|community|complex|building|place|part of town|side of town))(?: (?:really |very |pretty |generally )?(?:safe|unsafe|dangerous))?\s*\??$",
    r"sketchy", r"ghetto", r"rough (?:area|neighbou?rhood|part|side)",
    r"(?:good|bad|nice|best|worst|decent|better|desirable|undesirable|up and coming) (?:neighbou?rhoods?|areas?|part of town|side of town|suburbs?|communit(?:y|ies))",
    r"crime", r"crime rates?", r"high crime", r"low crime",
    r"(?:good|best|bad|worst|top|better|great) (?:public |private )?schools?", r"school (?:ratings?|rankings?|quality)",
    r"family[\s-]friendly",
)

_REFRAME = (
    "I can’t recommend, rank or rule out places to live, or people to rent or sell to, by who lives "
    "there or who they are. Federal fair-housing law protects race, color, religion, sex, disability, "
    "familial status and national origin, and DiamondEcho does not sort housing that way. "
    "I can help compare properties using neutral criteria you choose: price, size, commute time to an "
    "address you name, lot size, accessibility features, amenities or property condition."
)
_REFRAME_LANDLORD = (
    " If you are choosing a tenant or a buyer, use the same written, neutral criteria for every "
    "applicant, such as income, credit, rental history and references, and apply them the same way "
    "each time."
)
_RATING = (
    "I don’t rate places as safe, good or bad, and neither does a DiamondEcho agent: those labels too "
    "easily stand in for who lives there, which fair-housing rules are meant to prevent. You can judge "
    "for yourself from published figures: the local police department’s crime reports, your state "
    "education department’s school report cards, and the school district’s attendance-zone map. "
    "Visiting at different times of day helps too. I can help compare properties using neutral "
    "criteria you choose: price, size, commute time to an address you name, lot size, accessibility "
    "features, amenities or property condition."
)


def contains_sensitive_data(text: str) -> bool:
    return any(pattern.search(text) for pattern in _SENSITIVE_DATA)


def mentions_protected_class(text: str) -> bool:
    return any(pattern.search(text) for pattern in _PROTECTED)


def is_steering_request(text: str) -> bool:
    """A protected characteristic, in a message about choosing a place or a person."""
    return mentions_protected_class(text) and bool(_PLACE_CHOICE.search(text) or _PERSON_CHOICE.search(text))


# "Is Norcross safe?" A place name is the only thing that tells this apart from
# "Is asbestos dangerous?", and a place name is written with a capital.
_NAMED_PLACE_RATING = re.compile(
    r"(?i:is|are|how (?:safe|dangerous) (?:is|are)) [A-Z][a-z]+(?: [A-Z][a-z]+)?"
    r"(?i:(?: (?:really |very |pretty |generally )?(?:safe|unsafe|dangerous))?)\s*\??$"
)
_SAFETY_WORD = re.compile(r"(?<![a-z])(?:safe|unsafe|dangerous)(?![a-z])", re.I)


def is_place_rating_request(text: str) -> bool:
    if _PLACE_RATING.search(text):
        return True
    return bool(_SAFETY_WORD.search(text) and _NAMED_PLACE_RATING.search(text))


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
        landlord = bool(_PERSON_CHOICE.search(text))
        return SafetyDecision(
            allowed=False,
            category="fair_housing",
            message=_REFRAME + (_REFRAME_LANDLORD if landlord else ""),
        )
    if is_place_rating_request(text):
        return SafetyDecision(allowed=False, category="fair_housing", message=_RATING)
    return SafetyDecision(allowed=True, category="allowed")


def has_any(text: str, terms: Iterable[str]) -> bool:
    lowered = text.casefold()
    return any(term in lowered for term in terms)
