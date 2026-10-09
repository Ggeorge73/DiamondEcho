"""What the voice says, and the same figures as text for the page.

The tour describes only what the site really has. The market part speaks a
figure only with its source and the period it describes, and only while it
is current (see MAX_AGE_DAYS). Every sentence stays general information: no
forecast, no advice, nothing about a particular property.
"""
from __future__ import annotations

from datetime import date

from .sources import Figure

BRAND = "DiamondEcho Realty"

TOUR_SCRIPT = (
    f"Welcome to {BRAND}. "
    "I'm your guide. In the next two minutes I'll show you how to use this site, "
    "and then share today's Georgia market brief. "
    "You can pause me at any time with the pause button at the bottom of your screen. "
    "To search for a home, choose Search Homes in the menu. "
    "It opens the Georgia MLS property search right here on our site. "
    "Pick a city or county, set your price, and choose the features you want. "
    "Looking to rent? Choose Rentals, and the search opens with rental homes already selected. "
    "If you're weighing an investment, open Deal Studio. "
    "Enter a property and your own figures, and it models rentals, fix and flips, and land development, "
    "including stress tests across a range of possible outcomes. "
    "You can download the analysis as an Excel workbook. "
    "Results are estimates from the figures you enter, not advice. "
    "Buying? The mortgage simulator estimates a monthly payment. "
    "Selling? The seller net sheet estimates what you could take home after costs. "
    "You can also ask our concierge general questions about buying, selling, renting and financing. "
    "When you're ready to talk with us, choose Buyer inquiry or Seller consultation, "
    "and tell us what you're looking for. "
    "We reply during business hours, Monday to Saturday, nine to five Eastern time. "
    "Now, here is today's Georgia market brief."
)

CLOSING = (
    "That's today's brief. "
    "These figures come from the public sources listed on screen, for the periods named. "
    "They describe the market as a whole, not any particular home, and they are information, not advice. "
    f"Thank you for visiting {BRAND}."
)

UNAVAILABLE = (
    "Today's market figures aren't available right now. Please check back later. "
    f"Thank you for visiting {BRAND}."
)

# A figure older than this is not current enough to read out. Monthly and
# quarterly series are published weeks after the period they describe.
MAX_AGE_DAYS = {"week": 21, "month": 120, "quarter": 270}

ORDER = ("mortgage_30", "mortgage_15", "ga_median_list_price", "atl_median_list_price",
         "ga_active_listings", "ga_days_on_market", "ga_house_price_index",
         "ga_building_permits", "ga_unemployment")

QUARTERS = ("first", "second", "third", "fourth")


def current(figures: list[Figure], today: date) -> list[Figure]:
    kept = [f for f in figures if 0 <= (today - f.as_of).days <= MAX_AGE_DAYS[f.period]]
    return sorted(kept, key=lambda f: ORDER.index(f.id) if f.id in ORDER else len(ORDER))


def spoken_date(day: date) -> str:
    return f"{day:%A}, {day:%B} {day.day}, {day.year}"


def period_text(figure: Figure) -> str:
    day = figure.as_of
    if figure.period == "week":
        return f"the week of {day:%B} {day.day}, {day.year}"
    if figure.period == "quarter":
        return f"the {QUARTERS[(day.month - 1) // 3]} quarter of {day.year}"
    return f"{day:%B} {day.year}"


def value_text(figure: Figure) -> str | None:
    if figure.unit == "percent":
        return f"{figure.value:.2f}".rstrip("0").rstrip(".") + "%"
    if figure.unit == "usd":
        return f"${figure.value:,.0f}"
    if figure.unit == "count":
        return f"{figure.value:,.0f}"
    if figure.unit == "days":
        return f"{figure.value:,.0f} days"
    return None  # an index level means nothing read aloud; only its change is used


def change_text(figure: Figure) -> str | None:
    if figure.change is not None:
        if figure.change == 0:
            return "unchanged from the week before"
        direction = "up" if figure.change > 0 else "down"
        return f"{direction} {abs(figure.change):.2f} percentage points from the week before"
    if figure.change_pct is not None:
        if figure.change_pct == 0:
            return "unchanged from a year earlier"
        direction = "up" if figure.change_pct > 0 else "down"
        return f"{direction} {abs(figure.change_pct):.1f}% from a year earlier"
    return None


def _speak(text: str) -> str:
    """Written forms the voice should read in words."""
    return text.replace("%", " percent")


def sentence(figure: Figure) -> str | None:
    value, change = value_text(figure), change_text(figure)
    where = "nationally" if figure.region == "United States" else f"in {figure.region}"
    source = figure.spoken_source or figure.source
    if value is None:
        if change is None:
            return None
        return _speak(f"According to {source}, the {figure.label} {where} for {period_text(figure)} "
                      f"was {change}.")
    if figure.period == "week" and figure.region == "United States":
        text = f"According to {source}, the national average {figure.label}"
    else:
        text = f"According to {source}, the {figure.label} {where}"
    text += f" for {period_text(figure)} was {value}"
    if change:
        text += f", {change}"
    return _speak(text + ".")


def market_script(figures: list[Figure], today: date) -> str:
    lines = [sentence(f) for f in current(figures, today)]
    lines = [line for line in lines if line]
    if not lines:
        return UNAVAILABLE
    return " ".join([f"Here is the Georgia market brief for {spoken_date(today)}."] + lines + [CLOSING])


def display_items(figures: list[Figure], today: date) -> list[dict]:
    """The same current figures, for the page beside the player."""
    items = []
    for f in current(figures, today):
        value = value_text(f)
        if value is None and change_text(f) is None:
            continue
        items.append({
            "id": f.id,
            "label": f"{f.label[0].upper()}{f.label[1:]}",
            "region": f.region,
            "value": value,
            "change": change_text(f),
            "period": period_text(f),
            "as_of": f.as_of.isoformat(),
            "source": f.source,
            "source_url": f.source_url,
        })
    return items
