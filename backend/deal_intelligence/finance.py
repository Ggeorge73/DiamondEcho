"""Small dependency-free financial primitives used by underwriting."""

from __future__ import annotations

from dataclasses import dataclass
from math import isfinite, isnan
from typing import Iterable, List, Optional


@dataclass(frozen=True)
class LoanMonth:
    month: int
    opening_balance: float
    interest: float
    scheduled_principal: float
    balloon_principal: float
    debt_service: float
    closing_balance: float


def periodic_payment(principal: float, periodic_rate: float, periods: int) -> float:
    """Return the fully amortizing payment, with a stable zero-rate branch."""
    if principal <= 0 or periods <= 0:
        return 0.0
    if periodic_rate == 0:
        return principal / periods
    growth = (1 + periodic_rate) ** periods
    return principal * periodic_rate * growth / (growth - 1)


def loan_schedule(
    principal: float,
    annual_rate: float,
    amortization_years: int,
    interest_only_months: int,
    term_months: int,
    projection_months: int,
) -> List[LoanMonth]:
    """Build a monthly loan schedule and balloon the balance at maturity.

    After an interest-only period, the balance amortizes over the remaining
    original amortization period. If contractual maturity arrives first, the
    remaining balance is included as balloon principal in that month's debt
    service.
    """
    rate = annual_rate / 12
    balance = principal
    remaining_amortization = max(amortization_years * 12 - interest_only_months, 1)
    amortizing_payment = periodic_payment(balance, rate, remaining_amortization)
    rows: List[LoanMonth] = []

    for month in range(1, projection_months + 1):
        opening = balance
        if opening <= 1e-8:
            rows.append(LoanMonth(month, 0, 0, 0, 0, 0, 0))
            continue

        interest = opening * rate
        if month <= interest_only_months:
            scheduled_principal = 0.0
            payment = interest
        else:
            scheduled_principal = min(opening, max(amortizing_payment - interest, 0))
            payment = interest + scheduled_principal

        balance = max(opening - scheduled_principal, 0)
        balloon = 0.0
        if month == term_months and balance > 0:
            balloon = balance
            balance = 0.0

        rows.append(
            LoanMonth(
                month=month,
                opening_balance=opening,
                interest=interest,
                scheduled_principal=scheduled_principal,
                balloon_principal=balloon,
                debt_service=payment + balloon,
                closing_balance=balance,
            )
        )
    return rows


def net_present_value(cash_flows: Iterable[float], annual_rate: float) -> float:
    """Discount monthly cash flows using a nominal annual hurdle rate."""
    monthly_rate = (1 + annual_rate) ** (1 / 12) - 1
    return sum(value / ((1 + monthly_rate) ** month) for month, value in enumerate(cash_flows))


def annualized_irr(cash_flows: Iterable[float]) -> Optional[float]:
    """Return annualized monthly IRR for a conventional cash-flow series.

    A dependency-free bisection is deliberately used so the calculation is
    reproducible across environments. Undefined or unbracketed results return
    ``None`` instead of NaN/Infinity.
    """
    values = list(cash_flows)
    if not values or not any(v < 0 for v in values) or not any(v > 0 for v in values):
        return None

    def monthly_npv(rate: float) -> float:
        try:
            result = sum(value / ((1 + rate) ** month) for month, value in enumerate(values))
        except (OverflowError, ZeroDivisionError):
            return float("inf")
        return result

    low = -0.999999
    high = 1.0
    low_value = monthly_npv(low)
    high_value = monthly_npv(high)
    while low_value * high_value > 0 and high < 1_000_000:
        high *= 2
        high_value = monthly_npv(high)
    if isnan(low_value) or isnan(high_value) or low_value * high_value > 0:
        return None

    for _ in range(200):
        midpoint = (low + high) / 2
        midpoint_value = monthly_npv(midpoint)
        if abs(midpoint_value) < 1e-8:
            low = high = midpoint
            break
        if low_value * midpoint_value <= 0:
            high = midpoint
        else:
            low = midpoint
            low_value = midpoint_value

    monthly_rate = (low + high) / 2
    annual = (1 + monthly_rate) ** 12 - 1
    return annual if isfinite(annual) else None


def ratio(numerator: float, denominator: float) -> Optional[float]:
    if abs(denominator) < 1e-12:
        return None
    value = numerator / denominator
    return value if isfinite(value) else None
