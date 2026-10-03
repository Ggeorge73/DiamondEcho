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


def land_request(**overrides):
    payload = {
        "strategy": "land",
        "property": {"property_type": "land", "unit_count": 12, "rentable_square_feet": 18_000},
        "acquisition": {
            "purchase_price": 3_000_000, "closing_costs": 75_000, "due_diligence_costs": 25_000,
            "initial_capex": 125_000, "hold_months": 60,
        },
        "debt": [{
            "name": "Construction / development facility", "principal": 3_643_250,
            "annual_interest_rate": 0.0675, "amortization_years": 30, "interest_only_months": 0,
            "term_months": 120, "origination_fee_rate": 0.01,
        }],
        "exit": {"selling_cost_rate": 0.06},
        "assumptions": {"annual_discount_rate": 0.1},
        "land": {
            "development_type": "single_family_subdivision", "disposition_strategy": "build_and_sell",
            "site_acres": 2.5, "parcel_count": 1, "entitlement_status": "unentitled",
            "utility_status": "verify", "access_status": "verify",
            "environmental_status": "phase_i_required", "geotechnical_status": "not_started",
            "planned_units": 12, "buildable_square_feet": 18_000, "development_months": 24,
            "absorption_months": 12, "site_work_cost": 300_000, "hard_construction_cost": 1_500_000,
            "soft_costs": 200_000, "permits_impact_fees": 100_000, "developer_fee": 100_000,
            "contingency_rate": 0.1, "annual_carrying_costs": 30_000,
            "expected_terminal_value": 4_500_000, "target_profit_margin": 0.2,
        },
    }
    payload.update(overrides)
    return DealAnalysisRequest(**payload)


def test_land_development_matches_the_browser_engine():
    # Reference values are the browser engine's output for the same request
    # (frontend/src/lib/dealAnalysis.js, analyzeLand). The two must agree, or the
    # site would show different figures depending on where it calculates.
    result = analyze_deal(land_request())
    expected = {
        "irr": -0.37373084, "npv": -2737498.34981048, "equity_multiple": 0.22140541,
        "ltv": 1.21441667, "ltc": 0.65, "development_profit": -2756112.29691015,
        "development_roi": -0.77859459, "development_margin": -0.6124694,
        "total_development_cost": 5_605_000, "residual_land_value": -565679.79691024,
        "break_even_terminal_value": 7432034.35841515, "cost_per_acre": 2_242_000,
        "cost_per_unit": 467083.33333333, "cost_per_buildable_sf": 311.38888889,
    }
    assert result.strategy.value == "land"
    assert set(result.metrics) == set(expected)
    for key, value in expected.items():
        assert result.metrics[key].value == pytest.approx(value, rel=1e-9), key
    assert len(result.cash_flows) == 61
    assert result.cash_flows[0].net_cash_flow == pytest.approx(-(5_605_000 + 36_432.5 - 3_643_250))
    assert any("entitlement risk" in warning for warning in result.warnings)
    assert any("residual land value is below" in warning for warning in result.warnings)


def test_land_terminal_value_can_come_from_stabilized_income():
    base = land_request()
    land = base.land.model_dump()
    land.update(expected_terminal_value=0, stabilized_noi=900_000, stabilized_exit_cap_rate=0.06)
    result = analyze_deal(land_request(land=land))
    assert result.metrics["development_profit"].components["terminal_value"] == pytest.approx(15_000_000)
    assert result.metrics["development_profit"].value > 0


def test_land_without_a_terminal_value_warns_and_reports_no_margin():
    land = land_request().land.model_dump()
    land.update(expected_terminal_value=0)
    result = analyze_deal(land_request(land=land))
    assert result.metrics["development_margin"].value is None
    assert result.metrics["irr"].value is None
    assert any("No terminal value can be calculated" in warning for warning in result.warnings)


def test_land_financing_must_leave_equity():
    debt = [{"principal": 6_000_000, "annual_interest_rate": 0.0675, "amortization_years": 30, "term_months": 120}]
    with pytest.raises(ValueError, match="positive equity contribution"):
        analyze_deal(land_request(debt=debt))


def test_land_strategy_validation():
    with pytest.raises(ValidationError, match="land inputs are required"):
        land_request(land=None)
    with pytest.raises(ValidationError, match="exit_cap_rate and explicit_sale_price are not valid"):
        land_request(exit={"selling_cost_rate": 0.06, "exit_cap_rate": 0.06})
    with pytest.raises(ValidationError, match="land inputs are not valid for a rental analysis"):
        rental_request(land=land_request().land.model_dump())
    with pytest.raises(ValidationError):
        land_request(land={**land_request().land.model_dump(), "unknown_field": 1})
