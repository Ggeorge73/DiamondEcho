import pytest

from backend.deal_intelligence.models import (
    DealAnalysisRequest,
    ScenarioAnalysisRequest,
    SensitivityAnalysisRequest,
)
from backend.deal_intelligence.scenarios import analyze_scenarios, analyze_sensitivity


@pytest.fixture
def rental_deal():
    return DealAnalysisRequest(
        strategy="rental",
        property={"property_type": "office", "rentable_square_feet": 25_000},
        acquisition={"purchase_price": 3_000_000, "hold_months": 60},
        debt=[
            {
                "loan_to_value": 0.65,
                "annual_interest_rate": 0.065,
                "amortization_years": 25,
                "term_months": 120,
            }
        ],
        operating={
            "gross_scheduled_rent": 360_000,
            "other_income": 15_000,
            "vacancy_rate": 0.07,
            "operating_expenses": 125_000,
            "management_fee_rate": 0.03,
            "replacement_reserves": 20_000,
            "annual_below_noi_costs": 10_000,
        },
        exit={"exit_cap_rate": 0.07},
    )


def test_default_scenarios_are_base_upside_downside(rental_deal):
    response = analyze_scenarios(ScenarioAnalysisRequest(deal=rental_deal))

    assert [item.name for item in response.scenarios] == ["Base", "Upside", "Downside"]
    values = {item.name: item.analysis.metrics["irr"].value for item in response.scenarios}
    assert values["Upside"] > values["Base"] > values["Downside"]


def test_higher_vacancy_cannot_increase_noi(rental_deal):
    response = analyze_sensitivity(
        SensitivityAnalysisRequest(
            deal=rental_deal,
            metric="cash_on_cash",
            x_axis={"field": "vacancy_rate", "changes": [0, 0.05, 0.10]},
        )
    )

    values = [cell.value for cell in response.cells]
    assert values[0] > values[1] > values[2]


def test_two_dimensional_sensitivity_is_deterministic(rental_deal):
    request = SensitivityAnalysisRequest(
        deal=rental_deal,
        metric="irr",
        x_axis={"field": "rent", "changes": [-0.05, 0, 0.05]},
        y_axis={"field": "exit_cap_rate", "changes": [-0.005, 0, 0.005]},
    )

    first = analyze_sensitivity(request)
    second = analyze_sensitivity(request)

    assert len(first.cells) == 9
    assert [cell.value for cell in first.cells] == [cell.value for cell in second.cells]
