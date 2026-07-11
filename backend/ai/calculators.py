from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Callable, Dict, Iterable


MONEY = Decimal("0.01")
PERCENT = Decimal("0.0001")


class CalculationError(ValueError):
    pass


def _d(inputs: Dict[str, Any], key: str, default: Any = None, *, minimum: Decimal = Decimal("0")) -> Decimal:
    if key not in inputs and default is None:
        raise CalculationError(f"Missing required input: {key}")
    raw = inputs.get(key, default)
    try:
        value = Decimal(str(raw))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise CalculationError(f"{key} must be a number") from exc
    if not value.is_finite() or value < minimum:
        raise CalculationError(f"{key} must be at least {minimum}")
    if value > Decimal("1000000000000000"):
        raise CalculationError(f"{key} is outside the supported range")
    return value


def _pct(value: Decimal) -> Decimal:
    return value / Decimal("100")


def _money(value: Decimal) -> float:
    return float(value.quantize(MONEY, rounding=ROUND_HALF_UP))


def _ratio(value: Decimal) -> float:
    return float(value.quantize(PERCENT, rounding=ROUND_HALF_UP))


def mortgage_payment(principal: Decimal, annual_rate_percent: Decimal, term_years: Decimal) -> Decimal:
    months = int(term_years * 12)
    if months <= 0:
        raise CalculationError("term_years must be greater than zero")
    monthly_rate = _pct(annual_rate_percent) / 12
    if monthly_rate == 0:
        return principal / months
    factor = (Decimal("1") + monthly_rate) ** months
    return principal * monthly_rate * factor / (factor - Decimal("1"))


def analyze_mortgage(inputs: Dict[str, Any]) -> dict:
    price = _d(inputs, "purchase_price")
    down = _d(inputs, "down_payment", 0)
    rate = _d(inputs, "annual_interest_rate")
    term = _d(inputs, "term_years", minimum=Decimal("1"))
    if down > price:
        raise CalculationError("down_payment cannot exceed purchase_price")
    principal = price - down
    principal_interest = mortgage_payment(principal, rate, term)
    taxes = _d(inputs, "annual_property_tax", 0) / 12
    insurance = _d(inputs, "annual_insurance", 0) / 12
    hoa = _d(inputs, "monthly_hoa", 0)
    pmi = _d(inputs, "monthly_pmi", 0)
    housing = principal_interest + taxes + insurance + hoa + pmi
    return {
        "loan_amount": _money(principal),
        "monthly_principal_interest": _money(principal_interest),
        "monthly_housing_cost": _money(housing),
        "loan_to_value_percent": _ratio((principal / price * 100) if price else Decimal("0")),
    }


def analyze_rental(inputs: Dict[str, Any]) -> dict:
    price = _d(inputs, "purchase_price")
    down = _d(inputs, "down_payment", 0)
    rate = _d(inputs, "annual_interest_rate")
    term = _d(inputs, "term_years", minimum=Decimal("1"))
    rent = _d(inputs, "monthly_rent")
    other_income = _d(inputs, "other_monthly_income", 0)
    vacancy = _pct(_d(inputs, "vacancy_percent", 5))
    if vacancy > 1:
        raise CalculationError("vacancy_percent cannot exceed 100")
    operating = _d(inputs, "monthly_operating_expenses", 0)
    taxes = _d(inputs, "annual_property_tax", 0)
    insurance = _d(inputs, "annual_insurance", 0)
    capex = _d(inputs, "annual_capex_reserve", 0)
    closing = _d(inputs, "closing_costs", 0)
    rehab = _d(inputs, "rehab_cost", 0)
    if down > price:
        raise CalculationError("down_payment cannot exceed purchase_price")
    debt = mortgage_payment(price - down, rate, term) * 12
    effective_income = (rent + other_income) * 12 * (1 - vacancy)
    annual_opex = operating * 12 + taxes + insurance + capex
    noi = effective_income - annual_opex
    cash_flow = noi - debt
    cash_invested = down + closing + rehab
    return {
        "effective_gross_income": _money(effective_income),
        "net_operating_income": _money(noi),
        "annual_debt_service": _money(debt),
        "annual_cash_flow": _money(cash_flow),
        "cap_rate_percent": _ratio((noi / price * 100) if price else Decimal("0")),
        "cash_on_cash_return_percent": _ratio((cash_flow / cash_invested * 100) if cash_invested else Decimal("0")),
        "dscr": _ratio((noi / debt) if debt else Decimal("0")),
        "break_even_occupancy_percent": _ratio(((annual_opex + debt) / ((rent + other_income) * 12) * 100) if rent + other_income else Decimal("0")),
    }


def analyze_fix_flip(inputs: Dict[str, Any]) -> dict:
    price = _d(inputs, "purchase_price")
    rehab = _d(inputs, "rehab_cost")
    arv = _d(inputs, "after_repair_value")
    down = _d(inputs, "down_payment", 0)
    rate = _d(inputs, "annual_interest_rate", 0)
    hold_months = _d(inputs, "holding_months", minimum=Decimal("1"))
    loan_points = _pct(_d(inputs, "loan_points_percent", 0))
    acquisition = _d(inputs, "acquisition_closing_costs", 0)
    monthly_holding = _d(inputs, "monthly_holding_costs", 0)
    selling_pct = _pct(_d(inputs, "selling_cost_percent", 0))
    contingency_pct = _pct(_d(inputs, "rehab_contingency_percent", 10))
    if down > price:
        raise CalculationError("down_payment cannot exceed purchase_price")
    loan = price - down
    financing = loan * _pct(rate) * (hold_months / 12) + loan * loan_points
    contingency = rehab * contingency_pct
    holding = monthly_holding * hold_months
    selling = arv * selling_pct
    all_in = price + rehab + contingency + acquisition + financing + holding + selling
    profit = arv - all_in
    cash_invested = down + rehab + contingency + acquisition + financing + holding
    return {
        "loan_amount": _money(loan),
        "rehab_contingency": _money(contingency),
        "financing_cost": _money(financing),
        "holding_cost": _money(holding),
        "selling_cost": _money(selling),
        "all_in_cost": _money(all_in),
        "projected_profit": _money(profit),
        "return_on_cash_percent": _ratio((profit / cash_invested * 100) if cash_invested else Decimal("0")),
        "seventy_percent_rule_max_offer": _money(arv * Decimal("0.70") - rehab),
    }


def _npv(rate: Decimal, cash_flows: Iterable[Decimal]) -> Decimal:
    return sum(flow / ((Decimal("1") + rate) ** year) for year, flow in enumerate(cash_flows))


def _irr(cash_flows: list[Decimal]) -> Decimal | None:
    low, high = Decimal("-0.9999"), Decimal("10")
    low_value, high_value = _npv(low, cash_flows), _npv(high, cash_flows)
    if low_value == 0:
        return low
    if high_value == 0:
        return high
    if low_value * high_value > 0:
        return None
    for _ in range(160):
        mid = (low + high) / 2
        value = _npv(mid, cash_flows)
        if abs(value) < Decimal("0.000001"):
            return mid
        if low_value * value <= 0:
            high = mid
        else:
            low, low_value = mid, value
    return (low + high) / 2


def analyze_commercial(inputs: Dict[str, Any]) -> dict:
    price = _d(inputs, "purchase_price")
    equity = _d(inputs, "equity_invested", minimum=Decimal("0.01"))
    gross_rent = _d(inputs, "annual_gross_potential_rent")
    other_income = _d(inputs, "annual_other_income", 0)
    vacancy = _pct(_d(inputs, "vacancy_percent", 5))
    operating = _d(inputs, "annual_operating_expenses")
    debt_service = _d(inputs, "annual_debt_service", 0)
    hold_years = int(_d(inputs, "holding_years", 5, minimum=Decimal("1")))
    growth = _pct(_d(inputs, "annual_noi_growth_percent", 2))
    exit_cap = _pct(_d(inputs, "exit_cap_rate_percent", minimum=Decimal("0.01")))
    sale_cost = _pct(_d(inputs, "selling_cost_percent", 2))
    if vacancy > 1:
        raise CalculationError("vacancy_percent cannot exceed 100")
    noi = (gross_rent + other_income) * (1 - vacancy) - operating
    cash_flows = [-equity]
    year_noi = noi
    for _ in range(1, hold_years + 1):
        cash_flows.append(year_noi - debt_service)
        year_noi *= 1 + growth
    terminal_value = year_noi / exit_cap
    net_sale = terminal_value * (1 - sale_cost)
    remaining_loan = _d(inputs, "estimated_loan_balance_at_sale", 0)
    cash_flows[-1] += net_sale - remaining_loan
    irr = _irr(cash_flows)
    total_distributions = sum(cash_flows[1:])
    return {
        "year_one_noi": _money(noi),
        "going_in_cap_rate_percent": _ratio((noi / price * 100) if price else Decimal("0")),
        "year_one_dscr": _ratio((noi / debt_service) if debt_service else Decimal("0")),
        "terminal_value": _money(terminal_value),
        "net_sale_proceeds_before_tax": _money(net_sale - remaining_loan),
        "levered_irr_percent": _ratio(irr * 100) if irr is not None else None,
        "equity_multiple": _ratio(total_distributions / equity),
    }


ANALYZERS: Dict[str, Callable[[Dict[str, Any]], dict]] = {
    "mortgage": analyze_mortgage,
    "rental": analyze_rental,
    "fix_flip": analyze_fix_flip,
    "commercial": analyze_commercial,
}


def analyze(model: str, inputs: Dict[str, Any]) -> dict:
    try:
        analyzer = ANALYZERS[model]
    except KeyError as exc:
        raise CalculationError(f"Unsupported analysis model: {model}") from exc
    return analyzer(inputs)
