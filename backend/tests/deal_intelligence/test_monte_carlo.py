import pytest
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


def _land_deal(contingency_rate=0.1):
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
            "permits_impact_fees": 100_000, "developer_fee": 100_000, "contingency_rate": contingency_rate,
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


_LAND_CONTINGENCY_BASIS = 300_000 + 1_500_000  # site work + hard construction
_LAND_OTHER_COSTS = 200_000 + 100_000 + 0 + 100_000  # soft, permits, remediation, fee


def _fixed_development_cost_change(change, contingency=0.1):
    # A distribution with one value draws that value every time, so the
    # simulation becomes a deterministic re-run with that cost change.
    request = MonteCarloRequest(
        deal=_land_deal(contingency),
        scenarios=[{
            "name": "Fixed", "iterations": 250, "seed": 7,
            "drivers": {"development_cost_change": {"minimum": change, "mode": change, "maximum": change}},
        }],
    )
    summary = run_monte_carlo(request).scenarios[0].summaries["development_profit"]
    assert summary.minimum == pytest.approx(summary.maximum)
    return summary.p50


def _profit_with_costs_scaled(factor, contingency):
    deal = _land_deal(contingency)
    for field in (
        "site_work_cost", "hard_construction_cost", "soft_costs",
        "permits_impact_fees", "environmental_remediation", "developer_fee",
    ):
        setattr(deal.land, field, getattr(deal.land, field) * factor)
    return analyze_deal(deal).metrics["development_profit"].value


def test_a_development_cost_rise_beyond_the_contingency_adds_only_the_excess():
    # Same shape of fault as item 6 of the 2026-10-22 flip review: a 30% rise
    # with a 10% contingency used to cost 1.3 x 1.1 = 43% over budget on site
    # work and hard construction.
    # Since 1.6.0 the budget is spent over the development months and the
    # facility drawn as it is spent, so a cost dollar also moves the draws and
    # the interest a little: the cases are compared deal for deal, not by
    # adding the cost dollars to the base profit.
    simulated = _fixed_development_cost_change(0.30)
    assert simulated == pytest.approx(_profit_with_costs_scaled(1.30, 0), abs=0.01)
    compounded = _profit_with_costs_scaled(1.30, 0.10)
    assert simulated > compounded + _LAND_CONTINGENCY_BASIS * 1.30 * 0.10 * 0.9
    assert simulated != pytest.approx(compounded, abs=1_000)


def test_a_draw_equal_to_the_land_contingency_is_the_base_case_on_the_contingency_basis():
    base = analyze_deal(_land_deal()).metrics["development_profit"].value
    # Site work and hard construction come out exactly as in the base case,
    # which spends the whole reserve. The four costs that carry no contingency
    # still rise by the draw, so the profit is below the base.
    assert _fixed_development_cost_change(0.10) == pytest.approx(_profit_with_costs_scaled(1.10, 0), abs=0.01)
    assert _fixed_development_cost_change(0.10) == pytest.approx(base - _LAND_OTHER_COSTS * 0.10, abs=_LAND_OTHER_COSTS * 0.10 * 0.1)
    # A smaller draw means the reserve was not all needed: better than the base
    # case by about the unspent share of the basis, less the rise in the other costs.
    assert _fixed_development_cost_change(0.05) == pytest.approx(_profit_with_costs_scaled(1.05, 0), abs=0.01)
    assert _fixed_development_cost_change(0.05) > _fixed_development_cost_change(0.10)
    assert _fixed_development_cost_change(0.0) == pytest.approx(_profit_with_costs_scaled(1.0, 0), abs=0.01)
    assert _fixed_development_cost_change(0.0) > base + _LAND_CONTINGENCY_BASIS * 0.10 * 0.9


def test_a_land_deal_without_a_contingency_takes_the_whole_cost_change():
    simulated = _fixed_development_cost_change(0.20, contingency=0)
    assert simulated == pytest.approx(_profit_with_costs_scaled(1.20, 0), abs=0.01)
    assert simulated < analyze_deal(_land_deal(0)).metrics["development_profit"].value


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


def _flip_deal(rehab_contingency_rate=0.15):
    # A rural fixer underwritten on 2026-10-22: $93,000 price, hard-money loan
    # at 70% / 11% / interest only / 2 points, $85,000 rehab with a 15%
    # contingency, $250,000 after-repair value, seven-month hold.
    return DealAnalysisRequest(
        strategy="flip",
        property={"property_type": "single_family"},
        acquisition={
            "purchase_price": 93_000, "closing_costs": 3_000,
            "due_diligence_costs": 2_000, "hold_months": 7,
        },
        debt=[{
            "loan_to_value": 0.70, "annual_interest_rate": 0.11, "amortization_years": 30,
            "interest_only_months": 7, "term_months": 12, "origination_fee_rate": 0.02,
        }],
        flip={
            "after_repair_value": 250_000, "rehab_cost": 85_000,
            "rehab_contingency_rate": rehab_contingency_rate,
            "monthly_holding_costs": 450, "other_project_costs": 4_000,
        },
        exit={"selling_cost_rate": 0.07},
        assumptions={"annual_discount_rate": 0.10},
    )


def test_the_flip_reference_deal_matches_the_figures_checked_by_hand():
    result = analyze_deal(_flip_deal())
    assert result.metrics["flip_profit"].value == pytest.approx(24_121, abs=1)
    assert result.metrics["flip_roi"].value == pytest.approx(0.1683, abs=0.0001)
    assert result.metrics["irr"].value == pytest.approx(0.3156, abs=0.0001)
    assert result.metrics["npv"].value == pytest.approx(15_296, abs=1)
    assert result.metrics["equity_multiple"].value == pytest.approx(1.17, abs=0.005)
    assert result.metrics["ltc"].value == pytest.approx(0.326, abs=0.0005)
    assert result.metrics["max_offer_70_rule"].value == pytest.approx(77_250)


def _fixed_rehab_overrun(overrun, contingency=0.15):
    # A distribution with one value draws that value every time, so the
    # simulation becomes a deterministic re-run with that overrun.
    request = MonteCarloRequest(
        deal=_flip_deal(contingency),
        scenarios=[{
            "name": "Fixed", "iterations": 250, "seed": 7,
            "drivers": {"rehab_cost_change": {"minimum": overrun, "mode": overrun, "maximum": overrun}},
        }],
    )
    summary = run_monte_carlo(request).scenarios[0].summaries["flip_profit"]
    assert summary.minimum == pytest.approx(summary.maximum)
    return summary.p50


def _profit_with_rehab(rehab_cost, contingency):
    deal = _flip_deal(contingency)
    deal.flip.rehab_cost = rehab_cost
    return analyze_deal(deal).metrics["flip_profit"].value


def test_a_rehab_overrun_beyond_the_contingency_adds_only_the_excess():
    # Item 6 of the 2026-10-22 review: a 35% overrun on top of a 15%
    # contingency used to cost 1.35 x 1.15 = 55% over budget.
    simulated = _fixed_rehab_overrun(0.35)
    assert simulated == pytest.approx(_profit_with_rehab(85_000 * 1.35, 0), abs=0.01)
    compounded = _profit_with_rehab(85_000 * 1.35, 0.15)
    assert simulated > compounded + 10_000


def test_a_draw_equal_to_the_contingency_is_the_base_case_and_a_smaller_one_is_better():
    base = analyze_deal(_flip_deal()).metrics["flip_profit"].value
    assert _fixed_rehab_overrun(0.15) == pytest.approx(base, abs=0.01)
    # The reserve was only partly needed, so the simulation is better than the
    # base case, which spends all of it, by the unspent 5% of the budget.
    assert _fixed_rehab_overrun(0.10) == pytest.approx(base + 85_000 * 0.05, abs=0.01)
    assert _fixed_rehab_overrun(0.0) == pytest.approx(base + 85_000 * 0.15, abs=0.01)


def test_a_flip_without_a_contingency_takes_the_whole_overrun():
    simulated = _fixed_rehab_overrun(0.20, contingency=0)
    assert simulated == pytest.approx(_profit_with_rehab(85_000 * 1.20, 0), abs=0.01)
    assert simulated < analyze_deal(_flip_deal(0)).metrics["flip_profit"].value


def _fixed_hold_change(months):
    request = MonteCarloRequest(
        deal=_flip_deal(),
        scenarios=[{
            "name": "Fixed", "iterations": 250, "seed": 7,
            "drivers": {"hold_months_change": {"minimum": months, "mode": months, "maximum": months}},
        }],
    )
    summary = run_monte_carlo(request).scenarios[0].summaries["flip_profit"]
    assert summary.minimum == pytest.approx(summary.maximum)
    return summary.p50


def test_the_hold_period_is_a_simulation_driver_in_whole_months():
    # Item 5 of the 2026-10-22 review: timeline is what kills a slow flip, and
    # the simulation could not draw it.
    deal = _flip_deal()
    deal.acquisition.hold_months = 10
    three_months_longer = analyze_deal(deal).metrics["flip_profit"].value
    assert _fixed_hold_change(3) == pytest.approx(three_months_longer, abs=0.01)
    assert _fixed_hold_change(3) < analyze_deal(_flip_deal()).metrics["flip_profit"].value
    # A fractional draw is rounded to whole months, and the hold never drops below one.
    assert _fixed_hold_change(2.6) == pytest.approx(three_months_longer, abs=0.01)
    deal.acquisition.hold_months = 1
    assert _fixed_hold_change(-20) == pytest.approx(analyze_deal(deal).metrics["flip_profit"].value, abs=0.01)


def test_the_simulation_keeps_a_flip_loan_at_its_base_size():
    # A lender sizes the loan once, on the underwritten after-repair value; a
    # draw that lowers the value must not shrink the loan.
    deal = _flip_deal()
    deal.debt[0].loan_basis = "after_repair_value"
    request = MonteCarloRequest(
        deal=deal,
        scenarios=[{
            "name": "Fixed", "iterations": 250, "seed": 7,
            "drivers": {"after_repair_value_change": {"minimum": -0.1, "mode": -0.1, "maximum": -0.1}},
        }],
    )
    simulated = run_monte_carlo(request).scenarios[0].summaries["flip_profit"].p50
    kept = _flip_deal()
    kept.flip.after_repair_value = 225_000
    kept.debt[0].principal = 175_000
    kept.debt[0].loan_to_value = None
    assert simulated == pytest.approx(analyze_deal(kept).metrics["flip_profit"].value, abs=0.01)
    resized = _flip_deal()
    resized.flip.after_repair_value = 225_000
    resized.debt[0].loan_basis = "after_repair_value"
    assert abs(simulated - analyze_deal(resized).metrics["flip_profit"].value) > 100
    # The request itself is left as sent.
    assert deal.debt[0].principal is None


def test_a_pinned_loan_never_exceeds_the_project_cost_a_draw_leaves():
    deal = _flip_deal()
    deal.acquisition.purchase_price = 70_000
    deal.debt[0].loan_basis = "after_repair_value"
    request = MonteCarloRequest(
        deal=deal,
        scenarios=[{
            "name": "Fixed", "iterations": 250, "seed": 7,
            "drivers": {"rehab_cost_change": {"minimum": 0, "mode": 0, "maximum": 0}},
        }],
    )
    scenario = run_monte_carlo(request).scenarios[0]
    assert scenario.failed_iterations == 0
    cost = 70_000 + 3_000 + 2_000 + 85_000 + 4_000
    capped = _flip_deal()
    capped.acquisition.purchase_price = 70_000
    capped.flip.rehab_contingency_rate = 0
    capped.debt[0].principal = cost
    capped.debt[0].loan_to_value = None
    assert scenario.summaries["flip_profit"].p50 == pytest.approx(analyze_deal(capped).metrics["flip_profit"].value, abs=0.01)
