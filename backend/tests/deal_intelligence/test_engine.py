import pytest
from pydantic import ValidationError

from backend.deal_intelligence.engine import FORMULA_VERSION, analyze_deal, classify_flood_zone
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
        "irr": -0.32278589, "npv": -2485468.16259679, "equity_multiple": 0.2879165,
        "ltv": 1.21441667, "ltc": 0.65, "development_profit": -2483459.11392855,
        "development_roi": -0.7120835, "development_margin": -0.5518798,
        "total_development_cost": 5_605_000, "residual_land_value": 188393.53109743,
        "break_even_terminal_value": 7141977.78077513, "cost_per_acre": 2_242_000,
        "cost_per_unit": 467083.33333333, "cost_per_buildable_sf": 311.38888889,
    }
    assert result.strategy.value == "land"
    assert set(result.metrics) == set(expected)
    for key, value in expected.items():
        assert result.metrics[key].value == pytest.approx(value, rel=1e-9), key
    assert len(result.cash_flows) == 61
    # At closing the sponsor funds 35% of the $3,225,000 acquisition plus the points on the whole facility.
    assert result.cash_flows[0].net_cash_flow == pytest.approx(-1_165_182.5)
    assert result.cash_flows[1].debt_service == pytest.approx(23630.05015322)
    assert result.cash_flows[60].sale_proceeds == pytest.approx(352_500)
    assert result.cash_flows[60].loan_payoff == 0
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


def _land_at(price, **land_overrides):
    """The reference land deal at another price, with the facility kept at 65% of cost."""
    base = land_request()
    land = base.land.model_dump()
    land.update(land_overrides)
    acquisition = base.acquisition.model_dump()
    acquisition["purchase_price"] = price
    development = 300_000 + 1_500_000 + 200_000 + 100_000 + 100_000 + 180_000
    total_cost = price + 75_000 + 25_000 + 125_000 + development
    debt = base.debt[0].model_dump()
    debt["principal"] = total_cost * 0.65
    return land_request(acquisition=acquisition, debt=[debt], land=land)


def test_residual_land_value_is_the_price_that_earns_exactly_the_target_margin():
    # DE-25: the residual used to take the target margin off net proceeds and
    # leave out loan fees, so it could sit above the price while the margin
    # (measured on gross terminal value) missed its target.
    first = analyze_deal(_land_at(1_200_000, expected_terminal_value=9_000_000))
    residual = first.metrics["residual_land_value"].value
    again = analyze_deal(_land_at(residual, expected_terminal_value=9_000_000))
    assert again.metrics["development_margin"].value == pytest.approx(0.20, abs=1e-7)
    assert again.metrics["residual_land_value"].value == pytest.approx(residual, rel=1e-9)


@pytest.mark.parametrize("price_factor, expect_pass", [(0.98, True), (1.02, False)])
def test_residual_land_value_and_the_margin_test_never_disagree(price_factor, expect_pass):
    residual = analyze_deal(_land_at(1_200_000, expected_terminal_value=9_000_000)).metrics["residual_land_value"].value
    price = residual * price_factor
    result = analyze_deal(_land_at(price, expected_terminal_value=9_000_000))
    meets_margin = result.metrics["development_margin"].value >= 0.20
    price_within_residual = result.metrics["residual_land_value"].value >= price
    assert meets_margin is expect_pass
    assert price_within_residual is expect_pass
    assert any("residual land value is below" in warning for warning in result.warnings) is (not expect_pass)


@pytest.mark.parametrize("text, status, zone", [
    ("", "not_entered", ""), ("   ", "not_entered", ""),
    ("Not verified", "unrecognized", ""), ("unknown", "unrecognized", ""), ("A31", "unrecognized", ""),
    ("x", "minimal", "X"), (" zone  x ", "minimal", "X"), ("C", "minimal", "C"),
    ("FEMA Flood Zone X (shaded)", "moderate", "X (SHADED)"), ("X500", "moderate", "X500"), ("B", "moderate", "B"),
    ("ae", "special", "AE"), ("Zone AE", "special", "AE"), ("A12", "special", "A12"), ("VE", "special", "VE"),
    ("AR/AE", "special", "AR/AE"), ("D", "undetermined", "D"),
])
def test_flood_zone_text_is_read_as_a_fema_designation_or_not_at_all(text, status, zone):
    assert classify_flood_zone(text) == (status, zone)


def _flood_warnings(text):
    land = land_request().land.model_dump()
    land.update(flood_zone=text)
    return [w for w in analyze_deal(land_request(land=land)).warnings if "lood" in w]


def test_text_that_is_not_a_flood_zone_is_reported_as_not_verified():
    # "Not verified" used to raise the warning meant for an entered hazard zone.
    for text in ("Not verified", ""):
        warnings = _flood_warnings(text)
        assert warnings == [
            "The FEMA flood zone is not verified; confirm the designation, base flood elevation, and "
            "insurance requirement."
        ]


def test_flood_warnings_follow_the_designation():
    assert _flood_warnings("X") == []
    assert "Special Flood Hazard Area" in _flood_warnings("AE")[0] and "AE" in _flood_warnings("AE")[0]
    assert "moderate flood-hazard" in _flood_warnings("X (shaded)")[0]
    assert "has not determined" in _flood_warnings("D")[0]


def test_a_flip_loan_can_fund_a_share_of_the_rehab_budget():
    # Item 4 of the 2026-10-22 review: the loan was sized on the price alone,
    # so a hard-money flip showed a 32.6% loan-to-cost that no flipper has.
    def request(rehab_financed_rate):
        return DealAnalysisRequest(
            strategy="flip",
            property={"property_type": "single_family"},
            acquisition={"purchase_price": 93_000, "closing_costs": 3_000, "due_diligence_costs": 2_000, "hold_months": 7},
            debt=[{
                "loan_to_value": 0.70, "annual_interest_rate": 0.11, "amortization_years": 30,
                "interest_only_months": 7, "term_months": 12, "origination_fee_rate": 0.02,
                "rehab_financed_rate": rehab_financed_rate,
            }],
            flip={"after_repair_value": 250_000, "rehab_cost": 85_000, "rehab_contingency_rate": 0.15,
                  "monthly_holding_costs": 450, "other_project_costs": 4_000},
            exit={"selling_cost_rate": 0.07},
        )

    on_price_only = analyze_deal(request(0))
    with_rehab = analyze_deal(request(1.0))
    assert on_price_only.metrics["ltc"].value == pytest.approx(0.326, abs=0.0005)
    # 70% of $93,000 plus all of the $85,000 budget: $150,100 on $199,750 of cost.
    assert with_rehab.metrics["ltc"].value == pytest.approx(150_100 / 199_750, abs=1e-6)
    assert with_rehab.metrics["ltv"].value == pytest.approx(150_100 / 93_000, abs=1e-6)
    # The extra $85,000 costs 2 points and seven months of 11% interest, and
    # nothing else changes.
    extra_cost = 85_000 * (0.02 + 0.11 * 7 / 12)
    assert with_rehab.metrics["flip_profit"].value == pytest.approx(
        on_price_only.metrics["flip_profit"].value - extra_cost, abs=0.01
    )
    # Less cash in, so the return on cash rises even though the profit falls.
    assert with_rehab.metrics["flip_roi"].value > on_price_only.metrics["flip_roi"].value
    # An explicit principal is taken as given.
    explicit = request(1.0)
    explicit.debt[0].principal = 100_000
    explicit.debt[0].loan_to_value = None
    assert analyze_deal(explicit).metrics["ltv"].value == pytest.approx(100_000 / 93_000, abs=1e-6)


def _basis_request(**debt):
    return DealAnalysisRequest(
        strategy="flip",
        property={"property_type": "single_family"},
        acquisition={"purchase_price": 93_000, "closing_costs": 3_000, "due_diligence_costs": 2_000, "hold_months": 7},
        debt=[{
            "loan_to_value": 0.70, "annual_interest_rate": 0.11, "amortization_years": 30,
            "interest_only_months": 7, "term_months": 12, "origination_fee_rate": 0.02, **debt,
        }],
        flip={"after_repair_value": 250_000, "rehab_cost": 85_000, "rehab_contingency_rate": 0.15,
              "monthly_holding_costs": 450, "other_project_costs": 4_000},
        exit={"selling_cost_rate": 0.07},
    )


def test_a_loan_can_be_sized_on_the_price_the_total_cost_or_the_after_repair_value():
    on_price = analyze_deal(_basis_request())
    assert on_price.metrics["loan_amount"].value == pytest.approx(65_100)
    assert on_price.metrics["loan_amount"].formula == "loan-to-value x purchase price"
    on_cost = analyze_deal(_basis_request(loan_basis="total_project_cost"))
    assert on_cost.metrics["loan_amount"].value == pytest.approx(0.7 * 199_750)
    assert on_cost.metrics["loan_amount"].components["basis_amount"] == pytest.approx(199_750)
    on_arv = analyze_deal(_basis_request(loan_basis="after_repair_value"))
    assert on_arv.metrics["loan_amount"].value == pytest.approx(175_000)
    assert on_arv.metrics["ltv"].value == pytest.approx(175_000 / 93_000)
    assert on_arv.metrics["ltc"].value == pytest.approx(175_000 / 199_750)
    # The financed share of the rehab applies to the price basis only.
    assert analyze_deal(_basis_request(rehab_financed_rate=1.0)).metrics["loan_amount"].value == pytest.approx(150_100)
    assert analyze_deal(_basis_request(rehab_financed_rate=1.0)).metrics["loan_amount"].formula == (
        "loan-to-value x purchase price + financed share of the rehab budget"
    )
    assert analyze_deal(_basis_request(rehab_financed_rate=1.0, loan_basis="after_repair_value")).metrics["loan_amount"].value == pytest.approx(175_000)
    assert analyze_deal(_basis_request(rehab_financed_rate=1.0, loan_basis="total_project_cost")).metrics["loan_amount"].value == pytest.approx(0.7 * 199_750)


def test_an_after_repair_value_basis_is_a_flip_idea_only():
    with pytest.raises(ValidationError, match="after_repair_value loan basis"):
        DealAnalysisRequest(
            strategy="rental",
            property={"property_type": "multifamily", "unit_count": 12},
            acquisition={"purchase_price": 3_000_000, "hold_months": 60},
            debt=[{"loan_to_value": 0.65, "annual_interest_rate": 0.0675, "loan_basis": "after_repair_value"}],
            operating={"gross_scheduled_rent": 360_000, "vacancy_rate": 0.05, "operating_expenses": 126_000},
            exit={"exit_cap_rate": 0.065},
        )
    # Total project cost is fine for a rental: price, closing, diligence and capital work.
    rental = DealAnalysisRequest(
        strategy="rental",
        property={"property_type": "multifamily", "unit_count": 12},
        acquisition={"purchase_price": 3_000_000, "closing_costs": 75_000, "initial_capex": 125_000, "hold_months": 60},
        debt=[{"loan_to_value": 0.65, "annual_interest_rate": 0.0675, "loan_basis": "total_project_cost"}],
        operating={"gross_scheduled_rent": 360_000, "vacancy_rate": 0.05, "operating_expenses": 126_000},
        exit={"exit_cap_rate": 0.065},
    )
    assert analyze_deal(rental).metrics["ltv"].value == pytest.approx(0.65 * 3_200_000 / 3_000_000)


# Item 3 of the 2026-10-26 review: the development schedule and absorption
# inputs did nothing, and the facility was drawn in full on day one. The
# figures below are the browser engine's for the same deals.
def _timed_land(development_months, absorption_months, **overrides):
    land = land_request().land.model_dump()
    land.update(development_months=development_months, absorption_months=absorption_months, **overrides)
    return analyze_deal(land_request(land=land))


def test_the_schedule_and_absorption_inputs_move_the_figures():
    quick = _timed_land(6, 1).metrics["development_profit"].value
    even = _timed_land(24, 12).metrics["development_profit"].value
    assert quick != pytest.approx(even, abs=1)
    assert even == pytest.approx(-2483459.11392855, rel=1e-9)


def test_the_budget_is_spent_over_the_development_months_and_sales_fall_in_the_absorption_months():
    rows = _timed_land(24, 12).cash_flows
    budget = (300_000 + 1_500_000) * 1.1 + 200_000 + 100_000 + 100_000
    assert rows[1].capital_costs == pytest.approx(budget / 24 + 2_500)
    assert rows[24].capital_costs == pytest.approx(budget / 24 + 2_500)
    assert rows[25].capital_costs == pytest.approx(2_500)
    assert all(row.sale_proceeds == 0 for row in rows[1:49])
    assert all(row.sale_proceeds == pytest.approx(4_500_000 * 0.94 / 12) for row in rows[49:])


def test_the_facility_is_drawn_as_the_money_is_spent_and_repaid_from_the_sales():
    rows = _timed_land(24, 12).cash_flows
    # The reference facility amortizes from month one, so its payment is level;
    # on an interest-only facility the interest grows with the drawn balance.
    base = land_request()
    debt = base.debt[0].model_dump()
    debt["interest_only_months"] = 60
    land = base.land.model_dump()
    land.update(development_months=24, absorption_months=12)
    interest_only = analyze_deal(land_request(debt=[debt], land=land)).cash_flows
    assert interest_only[1].debt_service < interest_only[2].debt_service < interest_only[24].debt_service
    assert interest_only[25].debt_service == pytest.approx(3_643_250 * 0.0675 / 12)
    # The acquisition is 57.5% of this deal's cost, so that much is drawn at closing.
    assert interest_only[1].debt_service == pytest.approx(interest_only[25].debt_service * 3_225_000 / 5_605_000)
    # Every sale dollar goes to the lender until the facility is repaid.
    assert rows[49].loan_payoff == pytest.approx(rows[49].sale_proceeds)
    assert rows[60].loan_payoff == 0 and rows[60].net_cash_flow > 0
    # The amortizing reference loan has repaid some principal on schedule, so
    # the releases cover the rest; on the interest-only facility they cover it all.
    assert 0.85 * 3_643_250 < sum(row.loan_payoff for row in rows) < 3_643_250
    assert sum(row.loan_payoff for row in interest_only) == pytest.approx(3_643_250, rel=1e-6)


def test_the_timetable_is_kept_inside_the_hold_and_says_so():
    overlap = _timed_land(48, 24)
    assert any("longer than the 60-month hold, so the model overlaps them" in w for w in overlap.warnings)
    idle = _timed_land(12, 12)
    assert "The hold is 36 months longer than development plus absorption; carrying costs and interest on the drawn facility run for those months too." in idle.warnings
    # Zero absorption is one sale in the final month.
    rows = _timed_land(24, 0).cash_flows
    assert rows[59].sale_proceeds == 0 and rows[60].sale_proceeds == pytest.approx(4_500_000 * 0.94)


def test_the_residual_is_solved_on_the_timetable_and_left_out_of_a_simulation_pass():
    for development, absorption in [(24, 12), (6, 1), (60, 60)]:
        residual = _timed_land(development, absorption, expected_terminal_value=9_000_000).metrics["residual_land_value"].value
        base = land_request()
        land = base.land.model_dump()
        land.update(development_months=development, absorption_months=absorption, expected_terminal_value=9_000_000)
        acquisition = base.acquisition.model_dump()
        acquisition["purchase_price"] = residual
        debt = base.debt[0].model_dump()
        debt["principal"] = (residual + 225_000 + 2_380_000) * 0.65
        again = analyze_deal(land_request(acquisition=acquisition, debt=[debt], land=land))
        assert again.metrics["development_margin"].value == pytest.approx(0.20, abs=1e-7)
    without = analyze_deal(land_request(), include_residual=False)
    assert "residual_land_value" not in without.metrics
    assert without.metrics["development_profit"].value == analyze_deal(land_request()).metrics["development_profit"].value


# Item 4 of the 2026-10-26 review: DSCR before the reserves and TI lenders deduct.
def test_a_rental_reports_coverage_before_and_after_reserves_and_ti():
    result = analyze_deal(rental_request())
    noi = result.metrics["noi"].value
    debt_service = result.metrics["dscr"].components["debt_service"]
    operating = rental_request().operating
    after = (noi - operating.replacement_reserves - operating.annual_below_noi_costs) / debt_service
    assert result.metrics["dscr_after_reserves"].value == pytest.approx(after, abs=1e-7)
    assert result.metrics["dscr_after_reserves"].value < result.metrics["dscr"].value
    assert result.metrics["dscr_after_reserves"].formula == (
        "(year-one NOI - replacement reserves - TI, leasing and capital costs) / year-one debt service"
    )
