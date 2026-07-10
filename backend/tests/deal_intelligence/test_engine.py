import pytest
from pydantic import ValidationError

from backend.deal_intelligence.engine import FORMULA_VERSION, analyze_deal
from backend.deal_intelligence.models import DealAnalysisRequest


def rental_request(**overrides):
    payload = {
        "strategy": "rental",
        "property": {"property_type": "multifamily", "unit_count": 4},
        "acquisition": {"purchase_price": 1_000_000, "closing_costs": 20_000, "hold_months": 60},
        "debt": [
            {
                "loan_to_value": 0.70,
                "annual_interest_rate": 0.06,
                "amortization_years": 30,
                "term_months": 120,
            }
        ],
        "operating": {
            "gross_scheduled_rent": 120_000,
            "other_income": 5_000,
            "vacancy_rate": 0.05,
            "operating_expenses": 40_000,
            "replacement_reserves": 5_000,
            "annual_income_growth_rate": 0.03,
            "annual_expense_growth_rate": 0.03,
        },
        "exit": {"exit_cap_rate": 0.06},
    }
    payload.update(overrides)
    return DealAnalysisRequest(**payload)


def test_rental_metrics_are_explainable_and_consistent():
    result = analyze_deal(rental_request())

    assert result.formula_version == FORMULA_VERSION
    assert result.metrics["effective_gross_income"].value == pytest.approx(119_000)
    assert result.metrics["noi"].value == pytest.approx(79_000)
    assert result.metrics["cap_rate"].value == pytest.approx(0.079)
    assert result.metrics["dscr"].value > 1
    assert result.metrics["ltv"].value == pytest.approx(0.70)
    assert len(result.cash_flows) == 61
    assert result.cash_flows[-1].sale_proceeds > 0
    assert result.metrics["noi"].formula
    assert result.metrics["noi"].components["effective_gross_income"] == pytest.approx(119_000)


def test_unlevered_deal_returns_null_debt_ratios_instead_of_nan():
    request = rental_request(debt=[])
    result = analyze_deal(request)

    assert result.metrics["dscr"].value is None
    assert result.metrics["debt_yield"].value is None
    assert "undefined" in result.metrics["dscr"].warning.lower()


def test_flip_profit_includes_all_equity_costs():
    request = DealAnalysisRequest(
        strategy="flip",
        property={"property_type": "single_family"},
        acquisition={
            "purchase_price": 200_000,
            "closing_costs": 5_000,
            "hold_months": 6,
        },
        flip={
            "after_repair_value": 320_000,
            "rehab_cost": 40_000,
            "rehab_contingency_rate": 0.10,
            "monthly_holding_costs": 1_000,
            "other_project_costs": 1_000,
        },
        exit={"selling_cost_rate": 0.06},
    )

    result = analyze_deal(request)

    assert result.metrics["rehab_with_contingency"].value == pytest.approx(44_000)
    assert result.metrics["flip_profit"].value == pytest.approx(44_800)
    assert result.metrics["flip_roi"].value == pytest.approx(44_800 / 256_000)
    assert result.metrics["max_offer_70_rule"].value == pytest.approx(180_000)


def test_strategy_specific_payloads_are_rejected():
    with pytest.raises(ValidationError):
        DealAnalysisRequest(
            strategy="rental",
            property={"property_type": "single_family"},
            acquisition={"purchase_price": 100_000},
            flip={"after_repair_value": 150_000},
            exit={"exit_cap_rate": 0.08},
        )


def test_debt_sources_are_mutually_exclusive():
    with pytest.raises(ValidationError):
        DealAnalysisRequest(
            strategy="flip",
            property={"property_type": "single_family"},
            acquisition={"purchase_price": 100_000},
            debt=[{"principal": 50_000, "loan_to_value": 0.5}],
            flip={"after_repair_value": 150_000},
        )
