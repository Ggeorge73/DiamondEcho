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
