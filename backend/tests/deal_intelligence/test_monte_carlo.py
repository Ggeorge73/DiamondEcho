from backend.deal_intelligence.models import DealAnalysisRequest, MonteCarloRequest
from backend.deal_intelligence.engine import analyze_deal
from backend.deal_intelligence.monte_carlo import loss_equivalent_return, run_monte_carlo


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
    scenario = first.scenarios[0]
    assert scenario.iterations_requested == 300
    assert scenario.iterations_completed + scenario.failed_iterations == 300
    # Each probability states the number of results it was measured on.
    for metric_summary in scenario.summaries.values():
        assert 0 < metric_summary.sample_size <= scenario.iterations_completed


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


def test_loss_equivalent_return_applies_only_to_losses():
    assert loss_equivalent_return(0, 60) == -1
    assert abs(loss_equivalent_return(0.15, 60) - (0.15 ** 0.2 - 1)) < 1e-12
    assert abs(loss_equivalent_return(0.5, 12) + 0.5) < 1e-12
    assert loss_equivalent_return(1, 60) is None
    assert loss_equivalent_return(1.4, 60) is None
    assert loss_equivalent_return(None, 60) is None
    assert loss_equivalent_return(0.5, 0) is None


def _underwater_deal():
    # Income arrives monthly, then the sale cannot repay the loan, so no IRR
    # solves the cash flows even though the investor clearly lost money.
    return DealAnalysisRequest(
        strategy="rental",
        property={"property_type": "multifamily", "unit_count": 12},
        acquisition={"purchase_price": 3_000_000, "hold_months": 60},
        debt=[{
            "loan_to_value": 0.65, "annual_interest_rate": 0.0675,
            "amortization_years": 30, "interest_only_months": 60, "term_months": 120,
        }],
        operating={
            "gross_scheduled_rent": 360_000, "vacancy_rate": 0.05,
            "operating_expenses": 126_000, "management_fee_rate": 0.04,
        },
        exit={"explicit_sale_price": 1_500_000, "selling_cost_rate": 0.06},
    )


def test_losses_without_a_solvable_irr_are_counted_not_dropped():
    deal = _underwater_deal()
    base = analyze_deal(deal)
    multiple = base.metrics["equity_multiple"].value
    assert base.metrics["irr"].value is None
    assert any(row.net_cash_flow > 0 for row in base.cash_flows)
    assert 0 < multiple < 1

    request = MonteCarloRequest(
        deal=deal,
        scenarios=[{
            "name": "Fixed", "iterations": 250, "seed": 73,
            "drivers": {"interest_rate": {"minimum": 0.0675, "mode": 0.0675, "maximum": 0.0675}},
        }],
    )
    scenario = run_monte_carlo(request).scenarios[0]
    summary = scenario.summaries["irr"]
    assert scenario.iterations_completed == 250
    assert summary.sample_size == 250
    assert summary.loss_without_irr_count == 250
    assert abs(summary.p50 - (multiple ** (12 / 60) - 1)) < 1e-9
    assert summary.probability_above_zero == 0
    assert scenario.summaries["npv"].loss_without_irr_count == 0


def _land_deal():
    return DealAnalysisRequest(
        strategy="land",
        property={"property_type": "land", "unit_count": 12},
        acquisition={"purchase_price": 3_000_000, "closing_costs": 75_000, "hold_months": 60},
        debt=[{
            "principal": 3_500_000, "annual_interest_rate": 0.0675,
            "amortization_years": 30, "term_months": 120, "origination_fee_rate": 0.01,
        }],
        exit={"selling_cost_rate": 0.06},
        land={
            "site_acres": 2.5, "planned_units": 12, "development_months": 24,
            "site_work_cost": 300_000, "hard_construction_cost": 1_500_000, "soft_costs": 200_000,
            "permits_impact_fees": 100_000, "developer_fee": 100_000, "contingency_rate": 0.1,
            "annual_carrying_costs": 30_000, "expected_terminal_value": 7_500_000,
            "target_profit_margin": 0.2,
        },
    )


def test_land_development_monte_carlo_uses_the_land_drivers():
    request = MonteCarloRequest(
        deal=_land_deal(),
        scenarios=[{
            "name": "Committee case", "iterations": 400, "seed": 2026,
            "drivers": {
                "terminal_value_change": {"minimum": -0.15, "mode": 0, "maximum": 0.10},
                "development_cost_change": {"minimum": 0, "mode": 0.10, "maximum": 0.30},
                "interest_rate": {"minimum": 0.0575, "mode": 0.0675, "maximum": 0.085},
            },
        }],
    )
    first = run_monte_carlo(request)
    scenario = first.scenarios[0]
    profit = scenario.summaries["development_profit"]
    base_profit = analyze_deal(_land_deal()).metrics["development_profit"].value

    assert first == run_monte_carlo(request)
    assert scenario.iterations_completed == 400
    assert profit.sample_size == 400
    assert profit.minimum < base_profit < profit.maximum
    assert profit.minimum <= profit.p10 <= profit.p50 <= profit.p90 <= profit.maximum
    assert {"irr", "npv", "development_roi", "equity_multiple"} <= set(scenario.summaries)
    # Costs only rise and the terminal value mostly falls in this case, so most
    # outcomes sit below the base profit; some must still be profitable.
    assert 0 < profit.probability_above_zero < 1


# --- Time budget (DE-33): a run that would overrun stops cleanly and says so ---

from backend.deal_intelligence.monte_carlo import (  # noqa: E402
    DEFAULT_TIME_BUDGET_SECONDS, time_budget_seconds,
)

_RENTAL_DRIVERS = {
    "rent_change": {"minimum": -0.10, "mode": 0.02, "maximum": 0.10},
    "vacancy_rate": {"minimum": 0.03, "mode": 0.06, "maximum": 0.14},
    "exit_cap_rate": {"minimum": 0.0575, "mode": 0.0675, "maximum": 0.08},
}


def _three_cases(iterations):
    return [
        {"name": name, "iterations": count, "seed": seed, "drivers": _RENTAL_DRIVERS}
        for name, seed, count in (
            ("Committee case", 2026, iterations),
            ("Downside case", 2123, iterations),
            ("Severe stress", 2220, iterations),
        )
    ]


class _SteppingClock:
    """Each reading is one second later than the last."""

    def __init__(self):
        self.now = 0.0

    def __call__(self):
        self.now += 1.0
        return self.now


def test_running_cases_in_turn_gives_the_same_figures_as_running_each_alone():
    deal = _rental_deal()
    together = run_monte_carlo(MonteCarloRequest(deal=deal, scenarios=_three_cases(300)))
    for index, scenario in enumerate(_three_cases(300)):
        alone = run_monte_carlo(MonteCarloRequest(deal=deal, scenarios=[scenario]))
        assert together.scenarios[index] == alone.scenarios[0]


def test_a_budget_that_is_not_reached_changes_nothing():
    request = MonteCarloRequest(deal=_rental_deal(), scenarios=_three_cases(300))
    assert run_monte_carlo(request, time_budget=3600) == run_monte_carlo(request)


def test_a_run_that_overruns_its_budget_stops_every_case_together_and_says_so():
    request = MonteCarloRequest(deal=_rental_deal(), scenarios=_three_cases(1000))
    # The clock reads 1 at the start, then 2, 3, ... after each turn of 50
    # iterations per case. A budget of 6 is used up after the sixth turn.
    stopped = run_monte_carlo(request, time_budget=6, clock=_SteppingClock())

    for scenario in stopped.scenarios:
        assert scenario.iterations_requested == 1000
        assert scenario.iterations_completed + scenario.failed_iterations == 300
        capped = [w for w in scenario.warnings if "simulation capped at" in w]
        assert capped == [
            "Service simulation capped at 300 iterations for this case to answer in time; 1,000 were requested."
        ]
        for summary in scenario.summaries.values():
            assert 0 < summary.sample_size <= scenario.iterations_completed

    # Stopping at 300 gives exactly the figures of asking for 300.
    asked = run_monte_carlo(MonteCarloRequest(deal=_rental_deal(), scenarios=_three_cases(300)))
    for early, full in zip(stopped.scenarios, asked.scenarios):
        assert early.summaries == full.summaries
        assert not [w for w in full.warnings if "simulation capped at" in w]


def test_a_spent_budget_still_returns_one_turn_per_case():
    request = MonteCarloRequest(deal=_rental_deal(), scenarios=_three_cases(1000))
    stopped = run_monte_carlo(request, time_budget=0.0, clock=_SteppingClock())
    assert [s.iterations_completed + s.failed_iterations for s in stopped.scenarios] == [50, 50, 50]


def test_cases_of_different_lengths_each_stop_at_their_own_request():
    scenarios = _three_cases(300)
    scenarios[1]["iterations"] = 250
    result = run_monte_carlo(MonteCarloRequest(deal=_rental_deal(), scenarios=scenarios))
    assert [s.iterations_completed + s.failed_iterations for s in result.scenarios] == [300, 250, 300]
    assert not [w for s in result.scenarios for w in s.warnings if "simulation capped at" in w]


def test_time_budget_setting():
    assert time_budget_seconds({}) == DEFAULT_TIME_BUDGET_SECONDS == 20.0
    assert time_budget_seconds({"MONTE_CARLO_TIME_BUDGET_SECONDS": " 45 "}) == 45.0
    assert time_budget_seconds({"MONTE_CARLO_TIME_BUDGET_SECONDS": "7.5"}) == 7.5
    # Zero switches the limit off on purpose.
    assert time_budget_seconds({"MONTE_CARLO_TIME_BUDGET_SECONDS": "0"}) is None
    # A mistyped value must not silently remove the limit.
    for bad in ("", "  ", "fast", "-5", "nan"):
        assert time_budget_seconds({"MONTE_CARLO_TIME_BUDGET_SECONDS": bad}) == DEFAULT_TIME_BUDGET_SECONDS


def test_the_route_applies_the_budget(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.deal_intelligence.router import router

    app = FastAPI()
    app.include_router(router, prefix="/api")
    body = {
        "deal": _rental_deal().model_dump(mode="json"),
        "scenarios": _three_cases(1000),
    }
    monkeypatch.setenv("MONTE_CARLO_TIME_BUDGET_SECONDS", "0.000001")
    with TestClient(app) as client:
        response = client.post("/api/v1/deals/monte-carlo", json=body)
    assert response.status_code == 200
    for scenario in response.json()["scenarios"]:
        assert scenario["iterations_requested"] == 1000
        assert scenario["iterations_completed"] + scenario["failed_iterations"] == 50
        assert any("simulation capped at 50 iterations" in w for w in scenario["warnings"])
