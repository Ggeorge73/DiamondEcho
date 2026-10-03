import pytest

from backend.deal_intelligence.finance import annualized_irr, loan_schedule, net_present_value


def test_zero_rate_loan_amortizes_and_balloons_at_term():
    schedule = loan_schedule(
        principal=120_000,
        annual_rate=0,
        amortization_years=30,
        interest_only_months=0,
        term_months=12,
        projection_months=24,
    )

    assert schedule[0].debt_service == pytest.approx(120_000 / 360)
    assert schedule[11].balloon_principal == pytest.approx(116_000)
    assert schedule[11].closing_balance == 0
    assert schedule[12].debt_service == 0


def test_interest_only_schedule_does_not_reduce_balance_before_amortization():
    schedule = loan_schedule(600_000, 0.06, 30, 12, 120, 13)

    assert schedule[0].interest == pytest.approx(3_000)
    assert schedule[0].scheduled_principal == 0
    assert schedule[11].closing_balance == pytest.approx(600_000)
    assert schedule[12].scheduled_principal > 0


def test_irr_and_npv_known_one_year_return():
    cash_flows = [-100] + [0] * 11 + [110]

    assert annualized_irr(cash_flows) == pytest.approx(0.10, abs=1e-7)
    assert net_present_value(cash_flows, 0.10) == pytest.approx(0, abs=1e-7)


def test_irr_is_none_without_a_sign_change():
    assert annualized_irr([-100, -10, -1]) is None


def test_irr_is_undefined_when_income_is_followed_by_an_underwater_sale():
    # Sixty months of small income, then a sale that cannot repay the loan. The
    # investor lost money and no rate solves these cash flows. This used to be
    # reported as a solvable -100% because an overflow lost the cash flow's sign.
    cash_flows = [-1_000_000] + [1_000] * 59 + [-50_000]
    assert annualized_irr(cash_flows) is None


def test_irr_still_solves_a_long_hold_with_late_shortfalls_before_a_sale():
    # Negative months late in the hold, then a positive sale: a normal deal.
    cash_flows = [-1_000_000] + [5_000] * 50 + [-2_000] * 9 + [1_400_000]
    irr = annualized_irr(cash_flows)
    assert irr is not None
    assert 0.05 < irr < 0.20
    assert net_present_value(cash_flows, irr) == pytest.approx(0, abs=1e-2)


def test_irr_of_a_near_total_loss_is_close_to_minus_one_hundred_percent():
    assert annualized_irr([-1_000_000] + [0] * 59 + [1]) == pytest.approx(-0.9369, abs=1e-4)
