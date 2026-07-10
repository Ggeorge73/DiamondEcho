import sys
from pathlib import Path

import pytest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ai.calculators import CalculationError, analyze  # noqa: E402


def test_mortgage_uses_amortized_payment():
    result = analyze("mortgage", {
        "purchase_price": 500000,
        "down_payment": 100000,
        "annual_interest_rate": 6,
        "term_years": 30,
        "annual_property_tax": 6000,
        "annual_insurance": 2400,
        "monthly_hoa": 100,
    })
    assert result["loan_amount"] == 400000
    assert result["monthly_principal_interest"] == pytest.approx(2398.20, abs=0.02)
    assert result["monthly_housing_cost"] == pytest.approx(3198.20, abs=0.02)


def test_rental_metrics_are_consistent():
    result = analyze("rental", {
        "purchase_price": 300000,
        "down_payment": 75000,
        "annual_interest_rate": 6.5,
        "term_years": 30,
        "monthly_rent": 3200,
        "vacancy_percent": 5,
        "monthly_operating_expenses": 450,
        "annual_property_tax": 4200,
        "annual_insurance": 1800,
        "annual_capex_reserve": 1800,
        "closing_costs": 9000,
    })
    assert result["net_operating_income"] > 0
    assert result["annual_debt_service"] > 0
    assert result["dscr"] == pytest.approx(result["net_operating_income"] / result["annual_debt_service"], abs=0.001)


def test_commercial_analysis_returns_irr_and_equity_multiple():
    result = analyze("commercial", {
        "purchase_price": 10000000,
        "equity_invested": 3500000,
        "annual_gross_potential_rent": 1100000,
        "annual_other_income": 50000,
        "vacancy_percent": 5,
        "annual_operating_expenses": 390000,
        "annual_debt_service": 470000,
        "holding_years": 5,
        "annual_noi_growth_percent": 3,
        "exit_cap_rate_percent": 6.5,
        "selling_cost_percent": 2,
        "estimated_loan_balance_at_sale": 5900000,
    })
    assert result["year_one_noi"] == pytest.approx(702500, abs=0.01)
    assert result["levered_irr_percent"] is not None
    assert result["equity_multiple"] > 1


def test_invalid_down_payment_is_rejected():
    with pytest.raises(CalculationError):
        analyze("mortgage", {
            "purchase_price": 100000,
            "down_payment": 120000,
            "annual_interest_rate": 6,
            "term_years": 30,
        })
