from backend.deal_intelligence.models import DealAnalysisRequest, MonteCarloRequest
from backend.deal_intelligence.monte_carlo import run_monte_carlo


def _rental_deal():
    return DealAnalysisRequest(
        strategy="rental",
        property={"property_type": "multifamily", "unit_count": 12},
        acquisition={"purchase_price": 3_000_000, "closing_costs": 75_000, "hold_months": 60},
        debt=[{"loan_to_value": 0.65, "annual_interest_rate": 0.0675, "amortization_years": 30}],
        operating={
            "gross_scheduled_rent": 360_000, "vacancy_rate": 0.05,
            "operating_expenses": 126_000, "management_fee_rate": 0.04,
            "replacement_reserves": 30_000,
        },
        exit={"exit_cap_rate": 0.065, "selling_cost_rate": 0.06},
    )


def test_monte_carlo_is_reproducible_and_ordered():
    request = MonteCarloRequest(
        deal=_rental_deal(),
        scenarios=[{
            "name": "Investment committee case", "iterations": 300, "seed": 73,
            "drivers": {
                "rent_change": {"minimum": -0.10, "mode": 0, "maximum": 0.08},
                "vacancy_rate": {"minimum": 0.03, "mode": 0.06, "maximum": 0.14},
                "exit_cap_rate": {"minimum": 0.06, "mode": 0.0675, "maximum": 0.08},
            },
        }],
    )
    first = run_monte_carlo(request)
    second = run_monte_carlo(request)
    summary = first.scenarios[0].summaries["irr"]
    assert first == second
    assert summary.minimum <= summary.p10 <= summary.p50 <= summary.p90 <= summary.maximum
    assert 0 <= summary.probability_above_zero <= 1


def test_iteration_cap_is_enforced():
    try:
        MonteCarloRequest(
            deal=_rental_deal(),
            scenarios=[{
                "name": f"Case {index}", "iterations": 10_000,
                "drivers": {"rent_change": {"minimum": -0.1, "mode": 0, "maximum": 0.1}},
            } for index in range(6)],
        )
        assert False, "validation should reject more than 50,000 total iterations"
    except ValueError:
        pass
