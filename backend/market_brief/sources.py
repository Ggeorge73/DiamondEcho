"""Public market figures for the daily brief.

Every figure carries the publisher, the address it was read from and the date
it describes. Nothing is estimated: a source that cannot be read, or that has
no recent value, is left out and reported as a problem, never filled in.

Sources in use, all published for free reuse with attribution:

- Freddie Mac Primary Mortgage Market Survey (weekly, national averages).
- FRED, the Federal Reserve Bank of St. Louis data service, for series first
  published by Realtor.com (listings), FHFA (house prices), the Census Bureau
  (building permits) and the Bureau of Labor Statistics (unemployment).

Georgia Realtors and FMLS market reports are listed but switched off until
their terms of use are confirmed for republishing (see DISABLED_SOURCES).
"""
from __future__ import annotations

import csv
import io
import logging
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date, datetime

log = logging.getLogger(__name__)

USER_AGENT = "DiamondEcho-market-brief/1.0 (+https://diamondecho.com)"
TIMEOUT_SECONDS = 8
MAX_BYTES = 4_000_000

PMMS_URL = "https://www.freddiemac.com/pmms/docs/PMMS_history.csv"
PMMS_PAGE = "https://www.freddiemac.com/pmms"
FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={series}"
FRED_PAGE = "https://fred.stlouisfed.org/series/{series}"


@dataclass(frozen=True)
class Figure:
    id: str
    label: str
    value: float
    unit: str            # percent, usd, count, days
    as_of: date
    period: str          # week, month, quarter
    source: str
    source_url: str
    region: str
    change: float | None = None       # same unit, against the previous week
    change_pct: float | None = None   # percent change against a year earlier
    spoken_source: str = ""           # shorter name for the voice; the page shows `source`


def fetch_text(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return response.read(MAX_BYTES).decode("utf-8-sig")


def _number(text: str) -> float | None:
    text = (text or "").strip()
    if text in ("", "."):
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _day(text: str) -> date:
    text = text.strip()
    for pattern in ("%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(text, pattern).date()
        except ValueError:
            continue
    raise ValueError(f"Unrecognised date {text!r}")


def parse_fred_csv(text: str, series: str) -> list[tuple[date, float]]:
    """Rows of (date, value), oldest first. FRED marks a missing value '.'."""
    reader = csv.DictReader(io.StringIO(text))
    fields = reader.fieldnames or []
    date_field = next((f for f in fields if f.lower() in ("observation_date", "date")), None)
    if date_field is None or series not in fields:
        raise ValueError(f"FRED file for {series} has unexpected columns {fields}")
    rows = []
    for row in reader:
        value = _number(row.get(series, ""))
        if value is not None:
            rows.append((_day(row[date_field]), value))
    rows.sort(key=lambda item: item[0])
    if not rows:
        raise ValueError(f"FRED series {series} has no values")
    return rows


def parse_pmms_csv(text: str) -> list[tuple[date, float, float | None]]:
    """Rows of (week, 30-year rate, 15-year rate), oldest first."""
    reader = csv.DictReader(io.StringIO(text))
    fields = [f.strip().lower() for f in (reader.fieldnames or [])]
    if "date" not in fields or "pmms30" not in fields:
        raise ValueError(f"Freddie Mac file has unexpected columns {reader.fieldnames}")
    rows = []
    for raw in reader:
        row = {k.strip().lower(): v for k, v in raw.items() if k}
        rate30 = _number(row.get("pmms30", ""))
        if rate30 is None:
            continue
        rows.append((_day(row["date"]), rate30, _number(row.get("pmms15", ""))))
    rows.sort(key=lambda item: item[0])
    if not rows:
        raise ValueError("Freddie Mac file has no rates")
    return rows


def _mortgage_from_pmms(fetch) -> list[Figure]:
    rows = parse_pmms_csv(fetch(PMMS_URL))
    week, rate30, rate15 = rows[-1]
    previous = rows[-2] if len(rows) > 1 else None
    figures = [Figure(
        "mortgage_30", "30-year fixed mortgage rate", rate30, "percent", week, "week",
        "Freddie Mac's Primary Mortgage Market Survey", PMMS_PAGE, "United States",
        change=round(rate30 - previous[1], 2) if previous else None,
        spoken_source="Freddie Mac's weekly survey",
    )]
    if rate15 is not None:
        figures.append(Figure(
            "mortgage_15", "15-year fixed mortgage rate", rate15, "percent", week, "week",
            "Freddie Mac's Primary Mortgage Market Survey", PMMS_PAGE, "United States",
            change=round(rate15 - previous[2], 2) if previous and previous[2] is not None else None,
            spoken_source="Freddie Mac's weekly survey",
        ))
    return figures


def _mortgage_from_fred(fetch) -> list[Figure]:
    figures = []
    for series, figure_id, label in (("MORTGAGE30US", "mortgage_30", "30-year fixed mortgage rate"),
                                     ("MORTGAGE15US", "mortgage_15", "15-year fixed mortgage rate")):
        rows = parse_fred_csv(fetch(FRED_CSV.format(series=series)), series)
        week, value = rows[-1]
        change = round(value - rows[-2][1], 2) if len(rows) > 1 else None
        figures.append(Figure(figure_id, label, value, "percent", week, "week",
                              "Freddie Mac, via FRED (Federal Reserve Bank of St. Louis)",
                              FRED_PAGE.format(series=series), "United States", change=change,
                              spoken_source="Freddie Mac's weekly survey"))
    return figures


def mortgage_rates(fetch=fetch_text) -> list[Figure]:
    """Freddie Mac's own file first; the same survey through FRED if that fails."""
    try:
        return _mortgage_from_pmms(fetch)
    except Exception as exc:
        log.warning("Freddie Mac file not used (%s: %s); reading the survey from FRED",
                    type(exc).__name__, str(exc)[:200])
        return _mortgage_from_fred(fetch)


@dataclass(frozen=True)
class FredSeries:
    series: str
    id: str
    label: str
    unit: str
    period: str
    publisher: str
    region: str
    year_over_year: bool = False

    @property
    def spoken_publisher(self) -> str:
        return {"Federal Housing Finance Agency": "the Federal Housing Finance Agency",
                "U.S. Census Bureau": "the U.S. Census Bureau",
                "U.S. Bureau of Labor Statistics": "the U.S. Bureau of Labor Statistics"}.get(
                    self.publisher, self.publisher)


# Series identifiers as published on FRED. A series that FRED retires or
# renames is reported as a problem and left out of the brief.
FRED_SERIES = (
    FredSeries("MEDLISPRIGA", "ga_median_list_price", "median listing price", "usd", "month",
               "Realtor.com", "Georgia", year_over_year=True),
    FredSeries("ACTLISCOUGA", "ga_active_listings", "number of active listings", "count", "month",
               "Realtor.com", "Georgia", year_over_year=True),
    FredSeries("MEDDAYONMARGA", "ga_days_on_market", "median days on market", "days", "month",
               "Realtor.com", "Georgia"),
    FredSeries("MEDLISPRI12060", "atl_median_list_price", "median listing price", "usd", "month",
               "Realtor.com", "the Atlanta metro area", year_over_year=True),
    FredSeries("GASTHPI", "ga_house_price_index", "house price index", "index", "quarter",
               "Federal Housing Finance Agency", "Georgia", year_over_year=True),
    FredSeries("GABPPRIVSA", "ga_building_permits",
               "number of new private housing units authorized by building permits", "count",
               "month", "U.S. Census Bureau", "Georgia"),
    FredSeries("GAUR", "ga_unemployment", "unemployment rate", "percent", "month",
               "U.S. Bureau of Labor Statistics", "Georgia"),
)

PERIODS_PER_YEAR = {"week": 52, "month": 12, "quarter": 4}


def fred_figure(spec: FredSeries, fetch=fetch_text) -> Figure:
    rows = parse_fred_csv(fetch(FRED_CSV.format(series=spec.series)), spec.series)
    as_of, value = rows[-1]
    change_pct = None
    if spec.year_over_year:
        target = as_of.replace(year=as_of.year - 1)
        earlier = next((v for d, v in rows if d == target), None)
        if earlier:
            change_pct = round((value - earlier) / earlier * 100, 1)
    return Figure(spec.id, spec.label, value, spec.unit, as_of, spec.period,
                  f"{spec.publisher}, via FRED (Federal Reserve Bank of St. Louis)",
                  FRED_PAGE.format(series=spec.series), spec.region, change_pct=change_pct,
                  spoken_source=spec.spoken_publisher)


# Listed so the decision is visible. Turn one on only after its publisher's
# terms allow republishing its figures on this site, and add a reader for it.
DISABLED_SOURCES = (
    {"source": "Georgia Realtors monthly market reports", "url": "https://www.garealtor.com/",
     "reason": "Terms of use for republishing not yet confirmed."},
    {"source": "FMLS market statistics", "url": "https://www.fmls.com/",
     "reason": "Terms of use for republishing not yet confirmed; some reports need a member sign-in."},
)


def collect(fetch=fetch_text) -> tuple[list[Figure], list[dict]]:
    """Read every source at once. Returns the figures and what could not be read."""
    jobs = [("Freddie Mac mortgage rates", lambda: mortgage_rates(fetch))]
    jobs += [(f"{s.publisher} {s.label} ({s.series})", (lambda s=s: [fred_figure(s, fetch)]))
             for s in FRED_SERIES]
    figures, problems = [], []
    with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
        results = [(name, pool.submit(job)) for name, job in jobs]
        for name, future in results:
            try:
                figures.extend(future.result())
            except Exception as exc:  # one bad source never stops the rest
                problems.append({"source": name, "reason": type(exc).__name__})
    return figures, problems
