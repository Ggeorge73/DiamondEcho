"""Deterministic, explainable underwriting for rental, flip and land development deals."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from math import isfinite
from typing import Callable, Dict, List, Optional, Sequence, Tuple
from uuid import uuid4

from .finance import LoanMonth, annualized_irr, loan_schedule, net_present_value, periodic_payment, ratio
from .models import (
    DealAnalysisRequest,
    DealAnalysisResponse,
    DealStrategy,
    DebtInputs,
    LoanBasis,
    MetricResult,
    PeriodCashFlow,
)


# 1.1.0 (2026-10-06): residual land value is the land price at which the deal
# earns exactly the target development margin, and the flood-zone warning reads
# the FEMA designation instead of treating any text as a zone.
# 1.2.0 (2026-10-22): in a fix-and-flip simulation the rehab contingency absorbs
# a rehab overrun instead of being applied on top of it. The base analysis is
# unchanged.
# 1.3.0 (2026-10-22): in a land-development simulation the contingency on site
# work and hard construction absorbs a development-cost draw instead of being
# applied on top of it. The base analysis is unchanged.
# 1.4.0 (2026-10-22): a flip loan can fund a share of the rehab budget on top of
# loan-to-value times the price (rehab_financed_rate, 0 by default, so earlier
# figures are unchanged), and the simulation can draw the hold period.
# 1.5.0 (2026-10-22): a loan can be sized on the purchase price (the default and
# the earlier behaviour), the total project cost, or a flip's after-repair value
# (loan_basis); the simulation and the stressed cases keep the loan at its base
# size, as a lender does.
# 1.6.0 (2026-10-26): a land development spends its budget over the development
# schedule, draws the facility as it spends and sells over the absorption
# months, so those two inputs now move the figures; the residual land value is
# solved against that timetable. A rental also reports its debt service
# coverage after replacement reserves and TI (dscr_after_reserves).
# 1.7.0 (2026-10-26, second pass): a loan whose term ends before the hold does
# is extended to the end of the hold at the same rate, with a warning, instead
# of its balance being paid from the investor's pocket at maturity while the
# property is still held; a land hold shorter than development plus absorption
# is refused instead of compressed.
FORMULA_VERSION = "diamond-underwriting-1.7.0"


# FEMA flood-zone designations. Mirrors ``classifyFloodZone`` in
# frontend/src/lib/floodZone.js; the two must read the same text the same way.
_FLOOD_MINIMAL = {"X", "C", "X UNSHADED", "X (UNSHADED)"}
_FLOOD_MODERATE = {"B", "X SHADED", "X (SHADED)", "X500", "0.2 PCT ANNUAL CHANCE FLOOD HAZARD"}
_FLOOD_SPECIAL = re.compile(r"^(A|AE|AH|AO|AR|A99|A([1-9]|[12][0-9]|30)|V|VE|V([1-9]|[12][0-9]|30)|AR/(A|AE|AH|AO|A([1-9]|[12][0-9]|30)))$")


def classify_flood_zone(text: Optional[str]) -> Tuple[str, str]:
    """Return ``(status, zone)`` for a typed flood-zone entry.

    ``status`` is ``not_entered``, ``unrecognized``, ``minimal``, ``moderate``,
    ``special`` or ``undetermined``. Text that is not a FEMA designation, such
    as "Not verified", is ``unrecognized``: nothing is known about the zone.
    """
    raw = " ".join(str(text or "").split())
    if not raw:
        return "not_entered", ""
    zone = re.sub(r"^(FEMA\s+)?(FLOOD\s+)?ZONES?\s+", "", raw.upper()).strip()
    if zone in _FLOOD_MINIMAL:
        return "minimal", zone
    if zone in _FLOOD_MODERATE:
        return "moderate", zone
    if zone == "D":
        return "undetermined", zone
    if _FLOOD_SPECIAL.match(zone):
        return "special", zone
    return "unrecognized", ""


def _clean(value: Optional[float], digits: int = 8) -> Optional[float]:
    return None if value is None else round(float(value), digits)


def _metric(
    value: Optional[float],
    unit: str,
    formula: str,
    components: Optional[Dict[str, float]] = None,
    warning: Optional[str] = None,
) -> MetricResult:
    return MetricResult(
        value=_clean(value),
        unit=unit,
        formula=formula,
        components={key: _clean(val) or 0 for key, val in (components or {}).items()},
        warning=warning,
    )


def total_project_cost(request: DealAnalysisRequest) -> float:
    """Every cost funded at acquisition, before loan fees: the loan basis for
    ``total_project_cost``. Matches the figure each strategy's analysis uses."""
    acquisition = request.acquisition
    cost = (
        acquisition.purchase_price + acquisition.closing_costs
        + acquisition.due_diligence_costs + acquisition.initial_capex
    )
    if request.flip:
        cost += request.flip.rehab_cost * (1 + request.flip.rehab_contingency_rate) + request.flip.other_project_costs
    if request.land:
        land = request.land
        cost += (
            land.site_work_cost + land.hard_construction_cost + land.soft_costs
            + land.permits_impact_fees + land.environmental_remediation + land.developer_fee
            + (land.site_work_cost + land.hard_construction_cost) * land.contingency_rate
        )
    return cost


def loan_basis_amount(request: DealAnalysisRequest, loan: DebtInputs) -> float:
    if loan.loan_basis == LoanBasis.TOTAL_PROJECT_COST:
        return total_project_cost(request)
    if loan.loan_basis == LoanBasis.AFTER_REPAIR_VALUE and request.flip:
        return request.flip.after_repair_value
    return request.acquisition.purchase_price


def loan_principal(request: DealAnalysisRequest, loan: DebtInputs) -> float:
    """The loan amount: as given, or loan-to-value times its basis, plus the
    financed share of a flip's rehab budget when the basis is the price (the
    other bases already carry the rehab). The contingency stays the investor's."""
    if loan.principal:
        return loan.principal
    financed_rehab = (
        request.flip.rehab_cost * loan.rehab_financed_rate
        if request.flip and loan.loan_basis == LoanBasis.PURCHASE_PRICE else 0
    )
    return loan_basis_amount(request, loan) * (loan.loan_to_value or 0) + financed_rehab


def _resolved_debt_and_schedules(
    request: DealAnalysisRequest,
) -> Tuple[List[float], List[List[LoanMonth]], float]:
    principals: List[float] = []
    schedules: List[List[LoanMonth]] = []
    fees = 0.0
    for loan in request.debt:
        principal = loan_principal(request, loan)
        principals.append(principal)
        fees += principal * loan.origination_fee_rate
        schedules.append(
            loan_schedule(
                principal=principal,
                annual_rate=loan.annual_interest_rate,
                amortization_years=loan.amortization_years,
                interest_only_months=loan.interest_only_months,
                # A term that ends inside the hold is extended to its end at
                # the same rate: the balance is repaid at the sale, not from
                # the investor's pocket at maturity while the property is
                # still held (the 2026-10-26 review's second pass).
                term_months=max(loan.term_months, request.acquisition.hold_months + 1),
                projection_months=request.acquisition.hold_months,
            )
        )
    return principals, schedules, fees


def _extended_loan_warning(request: DealAnalysisRequest) -> Optional[str]:
    """The note added when a loan's term ends before the hold does."""
    hold = request.acquisition.hold_months
    terms = [loan.term_months for loan in request.debt if loan.term_months < hold]
    if not terms:
        return None
    return (
        f"The {hold}-month hold is longer than the {min(terms)}-month loan term, so the loan is modeled as "
        "extended to the end of the hold at the same rate. Confirm the extension terms and fee with the "
        "lender, and add the fee to the costs."
    )


def _month_debt_service(schedules: Sequence[Sequence[LoanMonth]], month: int) -> float:
    return sum(schedule[month - 1].debt_service for schedule in schedules)


def _month_ending_balance(schedules: Sequence[Sequence[LoanMonth]], month: int) -> float:
    return sum(schedule[month - 1].closing_balance for schedule in schedules)


def _common_metrics(
    request: DealAnalysisRequest,
    cash_flows: Sequence[PeriodCashFlow],
    total_debt: float,
    total_project_cost: float,
) -> Dict[str, MetricResult]:
    values = [row.net_cash_flow for row in cash_flows]
    irr = annualized_irr(values)
    npv = net_present_value(values, request.assumptions.annual_discount_rate)
    equity_contributions = abs(sum(min(value, 0) for value in values))
    distributions = sum(max(value, 0) for value in values)
    equity_multiple = ratio(distributions, equity_contributions)
    return {
        "irr": _metric(
            irr,
            "decimal_rate",
            "annualized monthly IRR where NPV(cash flows) = 0",
            warning=None if irr is not None else "IRR is undefined for these cash flows",
        ),
        "npv": _metric(
            npv,
            request.property.currency,
            "sum(monthly cash flow / (1 + annual discount rate)^(month/12))",
            {"annual_discount_rate": request.assumptions.annual_discount_rate},
        ),
        "equity_multiple": _metric(
            equity_multiple,
            "multiple",
            "total positive equity distributions / total equity contributions",
            {"distributions": distributions, "equity_contributions": equity_contributions},
            None if equity_multiple is not None else "Equity multiple is undefined with no equity contribution",
        ),
        "ltv": _metric(
            ratio(total_debt, request.acquisition.purchase_price),
            "decimal_rate",
            "total initial debt / purchase price",
            {"total_debt": total_debt, "purchase_price": request.acquisition.purchase_price},
        ),
        "ltc": _metric(
            ratio(total_debt, total_project_cost),
            "decimal_rate",
            "total initial debt / total initial project cost",
            {"total_debt": total_debt, "total_project_cost": total_project_cost},
        ),
    }


def _rental_analysis(
    request: DealAnalysisRequest,
    principals: Sequence[float],
    schedules: Sequence[Sequence[LoanMonth]],
    origination_fees: float,
) -> DealAnalysisResponse:
    assert request.operating is not None
    operating = request.operating
    acquisition = request.acquisition
    total_debt = sum(principals)
    total_project_cost = (
        acquisition.purchase_price
        + acquisition.closing_costs
        + acquisition.due_diligence_costs
        + acquisition.initial_capex
    )
    initial_equity = total_project_cost + origination_fees - total_debt
    if initial_equity <= 0:
        raise ValueError("Initial debt and loan proceeds must leave a positive equity contribution.")

    cash_flows: List[PeriodCashFlow] = [
        PeriodCashFlow(month=0, capital_costs=total_project_cost + origination_fees, net_cash_flow=-initial_equity)
    ]
    monthly_noi: List[float] = []
    monthly_egi: List[float] = []
    monthly_opex: List[float] = []
    monthly_capital: List[float] = []

    for month in range(1, acquisition.hold_months + 1):
        year_index = (month - 1) // 12
        income_factor = (1 + operating.annual_income_growth_rate) ** year_index
        expense_factor = (1 + operating.annual_expense_growth_rate) ** year_index
        annual_rent = operating.gross_scheduled_rent * income_factor
        annual_other_income = operating.other_income * income_factor
        annual_egi = (
            annual_rent * (1 - operating.vacancy_rate - operating.credit_loss_rate)
            + annual_other_income
        )
        annual_fixed_opex = operating.operating_expenses * expense_factor
        annual_management = annual_egi * operating.management_fee_rate
        annual_noi = annual_egi - annual_fixed_opex - annual_management
        annual_capital = (
            operating.replacement_reserves + operating.annual_below_noi_costs
        ) * expense_factor

        operating_cash = annual_noi / 12
        capital_costs = annual_capital / 12
        debt_service = _month_debt_service(schedules, month)
        net_cash = operating_cash - capital_costs - debt_service
        cash_flows.append(
            PeriodCashFlow(
                month=month,
                operating_cash_flow=_clean(operating_cash) or 0,
                debt_service=_clean(debt_service) or 0,
                capital_costs=_clean(capital_costs) or 0,
                net_cash_flow=_clean(net_cash) or 0,
            )
        )
        monthly_noi.append(annual_noi / 12)
        monthly_egi.append(annual_egi / 12)
        monthly_opex.append((annual_fixed_opex + annual_management) / 12)
        monthly_capital.append(capital_costs)

    hold = acquisition.hold_months
    terminal_year_index = hold // 12
    terminal_income_factor = (1 + operating.annual_income_growth_rate) ** terminal_year_index
    terminal_expense_factor = (1 + operating.annual_expense_growth_rate) ** terminal_year_index
    terminal_rent = operating.gross_scheduled_rent * terminal_income_factor
    terminal_egi = (
        terminal_rent * (1 - operating.vacancy_rate - operating.credit_loss_rate)
        + operating.other_income * terminal_income_factor
    )
    terminal_noi = terminal_egi - operating.operating_expenses * terminal_expense_factor
    terminal_noi -= terminal_egi * operating.management_fee_rate
    sale_price = request.exit.explicit_sale_price
    if sale_price is None:
        sale_price = terminal_noi / (request.exit.exit_cap_rate or 1)
    selling_costs = sale_price * request.exit.selling_cost_rate
    loan_payoff = _month_ending_balance(schedules, hold)
    cash_flows[-1].sale_proceeds = _clean(sale_price - selling_costs) or 0
    cash_flows[-1].loan_payoff = _clean(loan_payoff) or 0
    cash_flows[-1].net_cash_flow = _clean(
        cash_flows[-1].net_cash_flow + sale_price - selling_costs - loan_payoff
    ) or 0

    months_in_year_one = min(12, hold)
    year_one_noi = sum(monthly_noi[:months_in_year_one]) * (12 / months_in_year_one)
    year_one_egi = sum(monthly_egi[:months_in_year_one]) * (12 / months_in_year_one)
    year_one_opex = sum(monthly_opex[:months_in_year_one]) * (12 / months_in_year_one)
    year_one_capital = sum(monthly_capital[:months_in_year_one]) * (12 / months_in_year_one)
    year_one_debt_service = sum(
        _month_debt_service(schedules, month) for month in range(1, months_in_year_one + 1)
    ) * (12 / months_in_year_one)
    year_one_equity_cash = year_one_noi - year_one_capital - year_one_debt_service
    gross_potential_income = operating.gross_scheduled_rent + operating.other_income

    fixed_costs_and_debt = operating.operating_expenses + operating.replacement_reserves
    fixed_costs_and_debt += operating.annual_below_noi_costs + year_one_debt_service
    required_egi = fixed_costs_and_debt / max(1 - operating.management_fee_rate, 1e-12)
    required_rent_collection = max(required_egi - operating.other_income, 0)
    break_even_occupancy = ratio(
        required_rent_collection,
        operating.gross_scheduled_rent * (1 - operating.credit_loss_rate),
    )

    metrics = _common_metrics(request, cash_flows, total_debt, total_project_cost)
    metrics.update(
        {
            "gross_potential_income": _metric(
                gross_potential_income,
                request.property.currency + "/year",
                "gross scheduled rent + other income",
                {"gross_scheduled_rent": operating.gross_scheduled_rent, "other_income": operating.other_income},
            ),
            "effective_gross_income": _metric(
                year_one_egi,
                request.property.currency + "/year",
                "rent * (1 - vacancy - credit loss) + other income",
                {
                    "gross_scheduled_rent": operating.gross_scheduled_rent,
                    "vacancy_rate": operating.vacancy_rate,
                    "credit_loss_rate": operating.credit_loss_rate,
                    "other_income": operating.other_income,
                },
            ),
            "noi": _metric(
                year_one_noi,
                request.property.currency + "/year",
                "effective gross income - operating expenses - management fee",
                {"effective_gross_income": year_one_egi, "operating_expenses": year_one_opex},
            ),
            "cap_rate": _metric(
                ratio(year_one_noi, acquisition.purchase_price),
                "decimal_rate",
                "year-one NOI / purchase price",
                {"noi": year_one_noi, "purchase_price": acquisition.purchase_price},
            ),
            "cash_on_cash": _metric(
                ratio(year_one_equity_cash, initial_equity),
                "decimal_rate",
                "year-one pre-tax equity cash flow / initial equity",
                {"year_one_equity_cash_flow": year_one_equity_cash, "initial_equity": initial_equity},
            ),
            "dscr": _metric(
                ratio(year_one_noi, year_one_debt_service),
                "ratio",
                "year-one NOI / year-one debt service",
                {"noi": year_one_noi, "debt_service": year_one_debt_service},
                None if year_one_debt_service else "DSCR is undefined because the deal has no year-one debt service",
            ),
            # Lenders commonly size on income after the reserves and TI they
            # require, so both coverages are reported (item 4 of the 2026-10-26
            # review).
            "dscr_after_reserves": _metric(
                ratio(year_one_noi - year_one_capital, year_one_debt_service),
                "ratio",
                "(year-one NOI - replacement reserves - TI, leasing and capital costs) / year-one debt service",
                {"noi": year_one_noi, "reserves_and_capital": year_one_capital, "debt_service": year_one_debt_service},
                None if year_one_debt_service else "DSCR is undefined because the deal has no year-one debt service",
            ),
            "debt_yield": _metric(
                ratio(year_one_noi, total_debt),
                "decimal_rate",
                "year-one NOI / total initial debt",
                {"noi": year_one_noi, "total_debt": total_debt},
                None if total_debt else "Debt yield is undefined because the deal has no debt",
            ),
            "break_even_occupancy": _metric(
                break_even_occupancy,
                "decimal_rate",
                "required rent collection / (gross rent * (1 - credit loss))",
                {
                    "required_egi": required_egi,
                    "other_income": operating.other_income,
                    "gross_scheduled_rent": operating.gross_scheduled_rent,
                },
            ),
            "sale_price": _metric(
                sale_price,
                request.property.currency,
                "explicit sale price or terminal NOI / exit cap rate",
                {"terminal_noi": terminal_noi, "exit_cap_rate": request.exit.exit_cap_rate or 0},
            ),
        }
    )

    warnings: List[str] = []
    if metrics["dscr"].value is not None and metrics["dscr"].value < 1:
        warnings.append("Year-one NOI does not cover modeled debt service (DSCR below 1.00x).")
    if break_even_occupancy is not None and break_even_occupancy > 1:
        warnings.append("Break-even occupancy exceeds 100%; modeled operations cannot cover all obligations.")
    if metrics["ltv"].value is not None and metrics["ltv"].value > 1:
        warnings.append("Modeled initial debt exceeds purchase price (LTV above 100%).")
    if hold < 12:
        warnings.append("Year-one operating metrics are annualized from a holding period shorter than 12 months.")
    if request.exit.explicit_sale_price is not None:
        warnings.append("Exit value uses the user-provided sale price rather than a terminal capitalization calculation.")
    extended = _extended_loan_warning(request)
    if extended:
        warnings.append(extended)

    return DealAnalysisResponse(
        analysis_id=str(uuid4()),
        formula_version=FORMULA_VERSION,
        strategy=request.strategy,
        computed_at=datetime.now(timezone.utc),
        metrics=metrics,
        cash_flows=cash_flows,
        assumptions={
            "rate_convention": "All rates are decimal annual rates unless labeled otherwise.",
            "noi_treatment": "Replacement reserves, TI, leasing commissions, debt service, and taxes on income are below NOI.",
            "timing": "Operating cash flows occur monthly; sale occurs after the final modeled month's operations.",
            "taxes": "Income taxes, depreciation, and entity-level tax effects are not modeled.",
        },
        warnings=warnings,
    )


_BASIS_WORDS = {
    LoanBasis.PURCHASE_PRICE: "purchase price",
    LoanBasis.TOTAL_PROJECT_COST: "total project cost",
    LoanBasis.AFTER_REPAIR_VALUE: "after-repair value",
}


def _loan_sizing_formula(request: DealAnalysisRequest) -> str:
    if not request.debt:
        return "no loan"
    parts = []
    for loan in request.debt:
        if loan.principal:
            parts.append("loan amount as entered")
        else:
            text = f"loan-to-value x {_BASIS_WORDS[loan.loan_basis]}"
            if request.flip and loan.loan_basis == LoanBasis.PURCHASE_PRICE and loan.rehab_financed_rate:
                text += " + financed share of the rehab budget"
            parts.append(text)
    return "; ".join(parts)


def _flip_analysis(
    request: DealAnalysisRequest,
    principals: Sequence[float],
    schedules: Sequence[Sequence[LoanMonth]],
    origination_fees: float,
) -> DealAnalysisResponse:
    assert request.flip is not None
    flip = request.flip
    acquisition = request.acquisition
    total_debt = sum(principals)
    rehab_with_contingency = flip.rehab_cost * (1 + flip.rehab_contingency_rate)
    total_project_cost = (
        acquisition.purchase_price
        + acquisition.closing_costs
        + acquisition.due_diligence_costs
        + acquisition.initial_capex
        + rehab_with_contingency
        + flip.other_project_costs
    )
    initial_equity = total_project_cost + origination_fees - total_debt
    if initial_equity <= 0:
        raise ValueError("Initial debt and loan proceeds must leave a positive equity contribution.")

    cash_flows: List[PeriodCashFlow] = [
        PeriodCashFlow(month=0, capital_costs=total_project_cost + origination_fees, net_cash_flow=-initial_equity)
    ]
    for month in range(1, acquisition.hold_months + 1):
        debt_service = _month_debt_service(schedules, month)
        net_cash = -flip.monthly_holding_costs - debt_service
        cash_flows.append(
            PeriodCashFlow(
                month=month,
                debt_service=_clean(debt_service) or 0,
                capital_costs=_clean(flip.monthly_holding_costs) or 0,
                net_cash_flow=_clean(net_cash) or 0,
            )
        )

    sale_price = request.exit.explicit_sale_price or flip.after_repair_value
    selling_costs = sale_price * request.exit.selling_cost_rate
    loan_payoff = _month_ending_balance(schedules, acquisition.hold_months)
    cash_flows[-1].sale_proceeds = _clean(sale_price - selling_costs) or 0
    cash_flows[-1].loan_payoff = _clean(loan_payoff) or 0
    cash_flows[-1].net_cash_flow = _clean(
        cash_flows[-1].net_cash_flow + sale_price - selling_costs - loan_payoff
    ) or 0

    values = [row.net_cash_flow for row in cash_flows]
    profit = sum(values)
    # Count every funded project outflow, including costs incurred in the sale
    # month. Netting those costs against sale proceeds would overstate flip ROI.
    equity_contributions = initial_equity + sum(
        flip.monthly_holding_costs + _month_debt_service(schedules, month)
        for month in range(1, acquisition.hold_months + 1)
    )
    roi = ratio(profit, equity_contributions)
    max_offer_70 = flip.after_repair_value * 0.70 - rehab_with_contingency
    metrics = _common_metrics(request, cash_flows, total_debt, total_project_cost)
    metrics.update(
        {
            "flip_profit": _metric(
                profit,
                request.property.currency,
                "sum of all project equity cash flows, including net sale proceeds",
                {"sale_price": sale_price, "selling_costs": selling_costs, "equity_contributions": equity_contributions},
            ),
            "flip_roi": _metric(
                roi,
                "decimal_rate",
                "flip profit / total equity contributions",
                {"profit": profit, "equity_contributions": equity_contributions},
            ),
            "rehab_with_contingency": _metric(
                rehab_with_contingency,
                request.property.currency,
                "rehab cost * (1 + contingency rate)",
                {"rehab_cost": flip.rehab_cost, "contingency_rate": flip.rehab_contingency_rate},
            ),
            "net_sale_proceeds_before_debt": _metric(
                sale_price - selling_costs,
                request.property.currency,
                "sale price * (1 - selling cost rate)",
                {"sale_price": sale_price, "selling_cost_rate": request.exit.selling_cost_rate},
            ),
            "max_offer_70_rule": _metric(
                max_offer_70,
                request.property.currency,
                "70% of after-repair value - rehab with contingency",
                {"after_repair_value": flip.after_repair_value, "rehab_with_contingency": rehab_with_contingency},
                "The 70% rule is a screening heuristic, not a valuation or investment recommendation.",
            ),
            "loan_amount": _metric(
                total_debt,
                request.property.currency,
                _loan_sizing_formula(request),
                {
                    "total_debt": total_debt,
                    "basis_amount": sum(loan_basis_amount(request, loan) for loan in request.debt if not loan.principal),
                    "financed_rehab": sum(
                        flip.rehab_cost * loan.rehab_financed_rate
                        for loan in request.debt if not loan.principal and loan.loan_basis == LoanBasis.PURCHASE_PRICE
                    ),
                },
            ),
        }
    )
    warnings: List[str] = [
        "After-repair value, rehab budget, and timeline are user assumptions and should be independently verified."
    ]
    if profit < 0:
        warnings.append("Modeled flip profit is negative.")
    if acquisition.purchase_price > max_offer_70:
        warnings.append("Purchase price exceeds the modeled 70% rule screening threshold.")
    if request.exit.explicit_sale_price is not None:
        warnings.append("The explicit sale price overrides after-repair value for sale proceeds.")
    extended = _extended_loan_warning(request)
    if extended:
        warnings.append(extended)

    return DealAnalysisResponse(
        analysis_id=str(uuid4()),
        formula_version=FORMULA_VERSION,
        strategy=request.strategy,
        computed_at=datetime.now(timezone.utc),
        metrics=metrics,
        cash_flows=cash_flows,
        assumptions={
            "rate_convention": "All rates are decimal annual rates unless labeled otherwise.",
            "rehab_timing": "Rehab and contingency are funded at acquisition in V1.",
            "timing": "Holding and debt costs occur monthly; sale occurs after the final modeled month.",
            "taxes": "Income taxes, depreciation, and entity-level tax effects are not modeled.",
        },
        warnings=warnings,
    )


def land_timetable(land, hold_months: int) -> Tuple[int, int]:
    """The development months and the absorption months, both kept inside the
    hold: the budget is spent evenly over the first, the sales are taken evenly
    over the last. A zero absorption means one sale in the final month.
    Mirrors ``landTimetable`` in the browser engine."""
    development = max(1, min(land.development_months or 1, hold_months))
    absorption = max(1, min(land.absorption_months or 0, hold_months))
    return development, absorption


@dataclass
class _LandFigures:
    cash_flows: List[PeriodCashFlow]
    profit: float
    equity_contributions: float
    total_interest: float
    total_carrying: float
    origination_fees: float
    total_debt: float
    total_project_cost: float
    acquisition_cost: float
    development_costs: float
    contingency: float
    terminal_value: float
    selling_costs: float
    economic_cost: float
    development: int
    absorption: int


def _land_figures(request: DealAnalysisRequest, purchase_price: float, principals: Sequence[float]) -> _LandFigures:
    """The cash flows of a land development at a given price, with the
    facility's amounts given. Called once for the deal and again by the
    residual solver at other prices. Mirrors ``landFigures`` in the browser
    engine (frontend/src/lib/dealAnalysis.js) operation for operation."""
    land = request.land
    acquisition = request.acquisition
    hold = acquisition.hold_months
    development, absorption = land_timetable(land, hold)
    acquisition_cost = purchase_price + acquisition.closing_costs + acquisition.due_diligence_costs + acquisition.initial_capex
    contingency = (land.site_work_cost + land.hard_construction_cost) * land.contingency_rate
    development_costs = (
        land.site_work_cost + land.hard_construction_cost + land.soft_costs + land.permits_impact_fees
        + land.environmental_remediation + land.developer_fee + contingency
    )
    total_project_cost = acquisition_cost + development_costs
    # The share of the whole cost spent by the end of each month, from closing.
    spent = [
        (acquisition_cost + development_costs * min(month, development) / development) / total_project_cost
        if total_project_cost > 0 else 1.0
        for month in range(hold + 1)
    ]
    total_debt = sum(principals)
    origination_fees = sum(principal * loan.origination_fee_rate for principal, loan in zip(principals, request.debt))
    monthly_carrying = land.annual_carrying_costs / 12
    derived_terminal_value = (
        land.stabilized_noi / land.stabilized_exit_cap_rate
        if land.stabilized_noi > 0 and land.stabilized_exit_cap_rate > 0 else 0
    )
    terminal_value = max(0, land.expected_terminal_value or derived_terminal_value)
    selling_costs = terminal_value * request.exit.selling_cost_rate
    monthly_proceeds = (terminal_value - selling_costs) / absorption
    # The facility is drawn as the money is spent, so interest runs on the drawn
    # balance, not on the whole commitment from day one. A draw lands at the end
    # of its month and bears interest from the next. Sale proceeds pay the
    # facility down first, as a lender's release terms do; what is left at the
    # end of the hold is repaid then. The amortizing payment, where there is
    # one, is set on the whole commitment, as the lender writes it.
    loans = []
    for principal, loan in zip(principals, request.debt):
        rate = loan.annual_interest_rate / 12
        loans.append({
            "rate": rate, "io_months": loan.interest_only_months, "principal": principal, "balance": principal * spent[0],
            "payment": periodic_payment(principal, rate, max(loan.amortization_years * 12 - loan.interest_only_months, 1)),
        })
    cash_flows: List[PeriodCashFlow] = [
        PeriodCashFlow(
            month=0, capital_costs=acquisition_cost + origination_fees,
            net_cash_flow=-(acquisition_cost + origination_fees - total_debt * spent[0]),
        )
    ]
    total_interest = 0.0
    for month in range(1, hold + 1):
        delta = spent[month] - spent[month - 1]
        spend = total_project_cost * delta
        draw = total_debt * delta
        proceeds = monthly_proceeds if month > hold - absorption else 0
        debt_service = 0.0
        payoff = 0.0
        available = proceeds
        for loan in loans:
            interest = loan["balance"] * loan["rate"]
            scheduled_principal = 0 if month <= loan["io_months"] else min(loan["balance"], max(loan["payment"] - interest, 0))
            loan["balance"] = loan["balance"] - scheduled_principal + loan["principal"] * delta
            release = min(loan["balance"], available)
            loan["balance"] -= release
            available -= release
            at_end = loan["balance"] if month == hold else 0
            if at_end:
                loan["balance"] = 0
            total_interest += interest
            debt_service += interest + scheduled_principal
            payoff += release + at_end
        cash_flows.append(
            PeriodCashFlow(
                month=month,
                debt_service=_clean(debt_service) or 0,
                capital_costs=_clean(spend + monthly_carrying) or 0,
                sale_proceeds=_clean(proceeds) or 0,
                loan_payoff=_clean(payoff) or 0,
                net_cash_flow=_clean(-(spend - draw) - monthly_carrying - debt_service + proceeds - payoff) or 0,
            )
        )
    values = [row.net_cash_flow for row in cash_flows]
    profit = sum(values)
    equity_contributions = abs(sum(min(value, 0) for value in values))
    total_carrying = monthly_carrying * hold
    return _LandFigures(
        cash_flows=cash_flows, profit=profit, equity_contributions=equity_contributions,
        total_interest=total_interest, total_carrying=total_carrying, origination_fees=origination_fees,
        total_debt=total_debt, total_project_cost=total_project_cost, acquisition_cost=acquisition_cost,
        development_costs=development_costs, contingency=contingency, terminal_value=terminal_value,
        selling_costs=selling_costs,
        economic_cost=total_project_cost + origination_fees + total_interest + total_carrying,
        development=development, absorption=absorption,
    )


def solve_land_residual(profit_at: Callable[[float], float], price: float, target: float) -> Optional[float]:
    """The land price at which the development profit is exactly ``target``,
    by the secant method on the deal's own cash flows. The profit is linear in
    the price on a normal schedule, so the first step lands on the answer and
    the second confirms it; a clamp that binds takes a few more. Mirrors
    ``solveLandResidual`` in the browser engine."""
    def f(candidate: float) -> float:
        return profit_at(candidate) - target

    a = price
    fa = f(a)
    b = price * 1.1 + 10000
    fb = f(b)
    for _ in range(12):
        if fb == fa or not isfinite(fa) or not isfinite(fb):
            break
        nxt = b - fb * (b - a) / (fb - fa)
        if not isfinite(nxt):
            break
        a, fa = b, fb
        b = nxt
        fb = f(b)
        if abs(fb) < 1e-6:
            break
    return b if isfinite(fb) else None


def land_hold_too_short(land, hold_months: int) -> Optional[str]:
    """A land hold shorter than development plus absorption cannot be
    modeled: a three-month hold on a twelve-month build read as a Go at a
    seven-figure IRR (the 2026-10-26 review's second pass). It is refused,
    not compressed. Mirrors ``landHoldTooShort`` in the browser engine."""
    schedule = (land.development_months or 1) + (land.absorption_months or 0)
    if schedule <= hold_months:
        return None
    return (
        f"The {hold_months}-month hold is shorter than the development schedule plus the absorption "
        f"({land.development_months or 1} + {land.absorption_months or 0} months). Lengthen the hold or shorten the schedule."
    )


def _land_analysis(request: DealAnalysisRequest, include_residual: bool = True) -> DealAnalysisResponse:
    """Ground-up development. Mirrors ``analyzeLand`` in the browser engine
    (frontend/src/lib/dealAnalysis.js); the two must give the same figures."""
    assert request.land is not None
    land = request.land
    acquisition = request.acquisition
    too_short = land_hold_too_short(land, acquisition.hold_months)
    if too_short:
        raise ValueError(too_short)
    currency = request.property.currency
    selling_cost_rate = request.exit.selling_cost_rate
    principals = [loan_principal(request, loan) for loan in request.debt]
    base = _land_figures(request, acquisition.purchase_price, principals)
    total_project_cost = base.total_project_cost
    total_debt = base.total_debt
    terminal_value = base.terminal_value
    if total_project_cost + base.origination_fees - total_debt <= 0:
        raise ValueError("Construction financing must leave a positive equity contribution.")

    break_even_terminal_value = base.economic_cost / (1 - selling_cost_rate) if selling_cost_rate < 1 else None
    non_land_costs = total_project_cost - acquisition.purchase_price
    facility_share = total_debt / total_project_cost if total_project_cost > 0 else 0
    # The land price at which development profit is exactly the target margin
    # on gross terminal value, which is how development margin is measured
    # below. Other costs stay as entered, the facility keeps its modeled share
    # of project cost (so fees and interest move with the price) and the
    # timetable is the same. Running the deal again at this price returns the
    # target margin.
    residual_land_value = None
    if include_residual:
        def profit_at(price: float) -> float:
            scale = (total_project_cost - acquisition.purchase_price + price) / total_project_cost if total_project_cost > 0 else 1
            return _land_figures(request, price, [principal * scale for principal in principals]).profit
        residual_land_value = solve_land_residual(profit_at, acquisition.purchase_price, terminal_value * land.target_profit_margin)

    metrics = _common_metrics(request, base.cash_flows, total_debt, total_project_cost)
    metrics.update(
        {
            "development_profit": _metric(
                base.profit,
                currency,
                "net disposition proceeds - equity contributions - carrying and financing costs",
                {"terminal_value": terminal_value, "selling_costs": base.selling_costs, "economic_cost": base.economic_cost},
            ),
            "development_roi": _metric(
                ratio(base.profit, base.equity_contributions),
                "decimal_rate",
                "development profit / total equity contributions",
                {"profit": base.profit, "equity_contributions": base.equity_contributions},
            ),
            "development_margin": _metric(
                ratio(base.profit, terminal_value),
                "decimal_rate",
                "development profit / gross terminal value",
                {"profit": base.profit, "terminal_value": terminal_value},
                None if terminal_value else "Development margin is undefined without a terminal value.",
            ),
            "total_development_cost": _metric(
                total_project_cost,
                currency,
                "land acquisition + transaction + site + hard + soft + entitlement + environmental + developer fee + contingency",
                {"acquisition_cost": base.acquisition_cost, "development_costs": base.development_costs, "contingency": base.contingency},
            ),
            "break_even_terminal_value": _metric(
                break_even_terminal_value,
                currency,
                "total economic cost / (1 - selling cost rate)",
                {"economic_cost": base.economic_cost, "selling_cost_rate": selling_cost_rate},
            ),
            "cost_per_acre": _metric(
                ratio(total_project_cost, land.site_acres),
                f"{currency}/acre",
                "total development cost / site acres",
                {"total_project_cost": total_project_cost, "site_acres": land.site_acres},
            ),
            "cost_per_unit": _metric(
                ratio(total_project_cost, land.planned_units),
                f"{currency}/unit",
                "total development cost / planned units",
                {"total_project_cost": total_project_cost, "planned_units": land.planned_units},
            ),
            "cost_per_buildable_sf": _metric(
                ratio(total_project_cost, land.buildable_square_feet),
                f"{currency}/sf",
                "total development cost / buildable square feet",
                {"total_project_cost": total_project_cost, "buildable_square_feet": land.buildable_square_feet},
            ),
        }
    )
    if include_residual:
        metrics["residual_land_value"] = _metric(
            residual_land_value,
            currency,
            "land price at which development profit equals the target margin on gross terminal value, "
            "with other costs as entered, the facility at its modeled share of project cost and the same timetable",
            {
                "terminal_value": terminal_value,
                "target_profit_margin": land.target_profit_margin,
                "non_land_costs": non_land_costs,
                "carrying_costs": base.total_carrying,
                "facility_share_of_cost": facility_share,
            },
        )

    warnings: List[str] = [
        "Land-development results depend on zoning, entitlement, utility, environmental, geotechnical, civil, "
        "market, and construction assumptions that require professional verification."
    ]
    if not terminal_value:
        warnings.append(
            "No terminal value can be calculated. Enter an expected gross exit value or stabilized NOI with a "
            "capitalization rate."
        )
    schedule = land.development_months + land.absorption_months
    if schedule < acquisition.hold_months:
        warnings.append(
            f"The hold is {acquisition.hold_months - schedule} months longer than development plus absorption; "
            "carrying costs and interest on the drawn facility run for those months too."
        )
    extended = _extended_loan_warning(request)
    if extended:
        warnings.append(extended)
    if land.entitlement_status in ("unentitled", "rezoning_required"):
        warnings.append(
            "The project carries material entitlement risk; probability, timing, and denial costs are not "
            "independently estimated."
        )
    if land.utility_status != "available":
        warnings.append(
            "Water, sewer, power, stormwater, and other utility capacity are not confirmed at the site; "
            "extensions and off-site upgrades may materially change cost and timing."
        )
    if land.access_status != "legal_confirmed":
        warnings.append(
            "Legal and physical access is not confirmed; verify frontage, curb cuts, easements, and emergency access."
        )
    if land.environmental_status != "clear":
        warnings.append(
            "Environmental diligence is incomplete or indicates a recognized condition; complete Phase I/II "
            "review and quantify remediation."
        )
    if land.geotechnical_status != "complete_suitable":
        warnings.append(
            "Geotechnical suitability is not confirmed; soils, rock, groundwater, slope, and foundation "
            "conditions may affect feasibility."
        )
    flood_status, flood_zone = classify_flood_zone(land.flood_zone)
    if flood_status == "special":
        warnings.append(
            f"Flood zone {flood_zone} is a FEMA Special Flood Hazard Area; floodplain, stormwater, elevation, "
            "insurance, and buildable-area review is required."
        )
    elif flood_status == "moderate":
        warnings.append(
            f"Flood zone {flood_zone} is a moderate flood-hazard area; confirm stormwater, elevation, and "
            "insurance requirements."
        )
    elif flood_status == "undetermined":
        warnings.append(
            "Flood zone D means FEMA has not determined the flood hazard; obtain a flood study before relying "
            "on the buildable area."
        )
    elif flood_status in ("not_entered", "unrecognized"):
        warnings.append(
            "The FEMA flood zone is not verified; confirm the designation, base flood elevation, and "
            "insurance requirement."
        )
    if land.wetlands_acres > 0:
        warnings.append(
            "Wetlands were entered; verify delineation, buffers, mitigation, permitting, and the resulting net "
            "buildable area."
        )
    if include_residual and residual_land_value is not None and residual_land_value < acquisition.purchase_price:
        warnings.append(
            "The modeled residual land value is below the proposed purchase price, so the deal misses the "
            "selected target margin at this price."
        )
    if land.planned_units < 1 and land.buildable_square_feet < 1:
        warnings.append("Enter planned units or buildable square feet to evaluate density and unit economics.")

    return DealAnalysisResponse(
        analysis_id=str(uuid4()),
        formula_version=FORMULA_VERSION,
        strategy=request.strategy,
        computed_at=datetime.now(timezone.utc),
        metrics=metrics,
        cash_flows=base.cash_flows,
        assumptions={
            "rate_convention": "All rates are decimal annual rates unless labeled otherwise.",
            "cost_timing": (
                "Acquisition costs fall at closing; the development budget is spent evenly over the development "
                "schedule; the facility is drawn as the money is spent, bears interest on the drawn balance and is "
                "repaid from sale proceeds first and otherwise at the end of the hold; sales are taken evenly over "
                "the absorption months at the end of the hold; carrying costs run monthly for the whole hold. "
                "Contingency applies to site work and hard construction only."
            ),
            "terminal_value": "Uses explicit exit value first, otherwise stabilized NOI divided by exit cap rate.",
            "taxes": "Income taxes, depreciation, tax credits, and entity-level tax effects are not modeled.",
        },
        warnings=warnings,
    )


def analyze_deal(request: DealAnalysisRequest, include_residual: bool = True) -> DealAnalysisResponse:
    """Analyze one validated deal without database or network side effects.

    ``include_residual=False`` leaves out the land residual, which costs two
    more passes over the cash flows; the simulation, which does not read it,
    says so.
    """
    if request.strategy == DealStrategy.LAND:
        return _land_analysis(request, include_residual)
    principals, schedules, origination_fees = _resolved_debt_and_schedules(request)
    if request.strategy == DealStrategy.RENTAL:
        return _rental_analysis(request, principals, schedules, origination_fees)
    return _flip_analysis(request, principals, schedules, origination_fees)
