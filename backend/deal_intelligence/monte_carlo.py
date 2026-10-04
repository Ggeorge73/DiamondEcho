"""Reproducible Monte Carlo scenario analysis for underwriting decisions."""

from __future__ import annotations

import os
import random
import time
from statistics import fmean
from typing import Callable, Dict, List, Mapping, Optional

from .engine import FORMULA_VERSION, analyze_deal
from .models import (
    DealAnalysisRequest,
    DealStrategy,
    MonteCarloDriver,
    MonteCarloMetricSummary,
    MonteCarloRequest,
    MonteCarloResponse,
    MonteCarloScenario,
    MonteCarloScenarioResult,
)


def _percentile(values: List[float], percentile: float) -> float:
    if not values:
        raise ValueError("cannot calculate a percentile without observations")
    ordered = sorted(values)
    position = (len(ordered) - 1) * percentile
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def _summary(values: List[float], loss_without_irr_count: int = 0) -> MonteCarloMetricSummary:
    return MonteCarloMetricSummary(
        mean=fmean(values), minimum=min(values), p10=_percentile(values, 0.10),
        p25=_percentile(values, 0.25), p50=_percentile(values, 0.50),
        p75=_percentile(values, 0.75), p90=_percentile(values, 0.90), maximum=max(values),
        probability_above_zero=sum(value > 0 for value in values) / len(values),
        probability_below_one=sum(value < 1 for value in values) / len(values),
        sample_size=len(values),
        loss_without_irr_count=loss_without_irr_count,
    )


def loss_equivalent_return(equity_multiple: Optional[float], hold_months: int) -> Optional[float]:
    """Annual return implied by cash returned over cash invested, for a loss.

    A losing iteration can have no solvable IRR: nothing came back, or the sale
    ended under water after some income. It is one of the worst outcomes, not a
    missing one, so it is scored with this value instead of being left out.
    Nothing back gives -100%. Returns ``None`` when the iteration did not lose
    money, because an unsolvable IRR there has no certain sign.
    """
    if equity_multiple is None or hold_months <= 0 or not 0 <= equity_multiple < 1:
        return None
    return equity_multiple ** (12 / hold_months) - 1


# A simulation request stops calculating after this long and returns what it
# has. Measured on the staging service (1 CPU): three rental cases run about
# 190 iterations per case each second, so 20 seconds covers roughly 3,800 per
# case and leaves room inside a 30-second request timeout for a cold start.
TIME_BUDGET_ENV = "MONTE_CARLO_TIME_BUDGET_SECONDS"
DEFAULT_TIME_BUDGET_SECONDS = 20.0
# Iterations each case runs before the next case takes its turn and the clock
# is checked. Small enough that a run overshoots its budget by a fraction of a
# second at most.
_ITERATIONS_PER_TURN = 50

_DEVELOPMENT_COST_FIELDS = (
    "site_work_cost", "hard_construction_cost", "soft_costs",
    "permits_impact_fees", "environmental_remediation", "developer_fee",
)

_TARGET_METRICS = {
    DealStrategy.RENTAL: ["irr", "npv", "cash_on_cash", "dscr", "equity_multiple"],
    DealStrategy.FLIP: ["irr", "npv", "flip_profit", "flip_roi", "equity_multiple"],
    DealStrategy.LAND: ["irr", "npv", "development_profit", "development_roi", "equity_multiple"],
}


def _sample_deal(
    base: DealAnalysisRequest,
    scenario: MonteCarloScenario,
    rng: random.Random,
) -> DealAnalysisRequest:
    deal = base.model_copy(deep=True)
    for driver, distribution in scenario.drivers.items():
        value = rng.triangular(distribution.minimum, distribution.maximum, distribution.mode)
        if driver == MonteCarloDriver.RENT_CHANGE and deal.operating:
            deal.operating.gross_scheduled_rent *= 1 + value
        elif driver == MonteCarloDriver.VACANCY_RATE and deal.operating:
            deal.operating.vacancy_rate = max(0, min(value, 0.95))
        elif driver == MonteCarloDriver.OPERATING_EXPENSE_CHANGE and deal.operating:
            deal.operating.operating_expenses *= 1 + value
        elif driver == MonteCarloDriver.EXIT_CAP_RATE:
            deal.exit.exit_cap_rate = max(0.001, min(value, 0.50))
        elif driver == MonteCarloDriver.INTEREST_RATE:
            for debt in deal.debt:
                debt.annual_interest_rate = max(0, min(value, 1))
        elif driver == MonteCarloDriver.AFTER_REPAIR_VALUE_CHANGE and deal.flip:
            deal.flip.after_repair_value *= 1 + value
        elif driver == MonteCarloDriver.REHAB_COST_CHANGE and deal.flip:
            deal.flip.rehab_cost *= 1 + value
        elif driver == MonteCarloDriver.TERMINAL_VALUE_CHANGE and deal.land:
            # Shock whichever input sets the terminal value, as the browser engine does.
            if deal.land.expected_terminal_value > 0:
                deal.land.expected_terminal_value *= 1 + value
            else:
                deal.land.stabilized_noi *= 1 + value
        elif driver == MonteCarloDriver.DEVELOPMENT_COST_CHANGE and deal.land:
            for field in _DEVELOPMENT_COST_FIELDS:
                setattr(deal.land, field, getattr(deal.land, field) * (1 + value))
    return deal


class _ScenarioRun:
    """One scenario's simulation, advanced in steps so a run can stop on time.

    Each scenario keeps its own random stream, so the first ``n`` iterations
    are the same whether the run stops at ``n`` or carries on. Stopping early
    therefore gives the same figures as asking for ``n`` iterations outright.
    """

    def __init__(self, base: DealAnalysisRequest, scenario: MonteCarloScenario) -> None:
        self.base = base
        self.scenario = scenario
        self.rng = random.Random(scenario.seed)
        self.target_metrics = _TARGET_METRICS[base.strategy]
        self.observations: Dict[str, List[float]] = {key: [] for key in self.target_metrics}
        self.attempted = 0
        self.failures = 0
        self.losses_without_irr = 0

    @property
    def remaining(self) -> int:
        return self.scenario.iterations - self.attempted

    def step(self, count: int) -> None:
        for _ in range(min(count, self.remaining)):
            self.attempted += 1
            try:
                result = analyze_deal(_sample_deal(self.base, self.scenario, self.rng))
                for key in self.target_metrics:
                    metric = result.metrics.get(key)
                    if metric and metric.value is not None:
                        self.observations[key].append(metric.value)
                    elif key == "irr":
                        multiple = result.metrics.get("equity_multiple")
                        substitute = loss_equivalent_return(
                            multiple.value if multiple else None, len(result.cash_flows) - 1
                        )
                        if substitute is not None:
                            self.observations[key].append(substitute)
                            self.losses_without_irr += 1
            except (ValueError, ArithmeticError):
                self.failures += 1

    def result(self) -> MonteCarloScenarioResult:
        scenario = self.scenario
        completed = self.attempted - self.failures
        if completed == 0:
            raise ValueError(f"Monte Carlo scenario '{scenario.name}' produced no valid iterations")
        summaries = {
            key: _summary(values, self.losses_without_irr if key == "irr" else 0)
            for key, values in self.observations.items() if values
        }
        warnings = [
            "Distributions are user assumptions, not forecasts; correlations and fat-tail events are not inferred.",
            "Review percentile outcomes alongside the deterministic downside case and source evidence.",
        ]
        if self.failures:
            warnings.append(f"{self.failures} iterations were excluded because sampled inputs produced invalid economics.")
        if self.attempted < scenario.iterations:
            # Same wording pattern as the browser engine's cap, so the results
            # panel treats both alike and states the counts beside the figures.
            warnings.append(
                f"Service simulation capped at {self.attempted:,} iterations for this case to answer in time; "
                f"{scenario.iterations:,} were requested."
            )
        return MonteCarloScenarioResult(
            name=scenario.name, iterations_requested=scenario.iterations,
            iterations_completed=completed, failed_iterations=self.failures,
            seed=scenario.seed, summaries=summaries, warnings=warnings,
        )


def time_budget_seconds(environ: Optional[Mapping[str, str]] = None) -> Optional[float]:
    """Seconds one simulation request may calculate for, or ``None`` for no limit.

    Read from ``MONTE_CARLO_TIME_BUDGET_SECONDS``. Keep it well below the
    hosting platform's request timeout: a request the platform cuts off returns
    nothing to the visitor, while the abandoned calculation carries on and
    delays the requests behind it. ``0`` switches the limit off; a value that
    is not a number falls back to the default rather than removing the limit.
    """
    raw = (os.environ if environ is None else environ).get(TIME_BUDGET_ENV)
    if raw is None or not raw.strip():
        return DEFAULT_TIME_BUDGET_SECONDS
    try:
        value = float(raw)
    except ValueError:
        return DEFAULT_TIME_BUDGET_SECONDS
    if value != value or value < 0:  # NaN or negative
        return DEFAULT_TIME_BUDGET_SECONDS
    return None if value == 0 else value


def run_monte_carlo(
    request: MonteCarloRequest,
    time_budget: Optional[float] = None,
    clock: Callable[[], float] = time.monotonic,
) -> MonteCarloResponse:
    """Run every scenario, stopping all of them together if the budget runs out.

    Scenarios advance in turn, a small block at a time, so that when time runs
    out each case has run the same number of iterations and the cases remain
    comparable. With no budget, or a budget that is not reached, the figures
    are identical to running each scenario to the end on its own.
    """
    runs = [_ScenarioRun(request.deal, scenario) for scenario in request.scenarios]
    deadline = None if time_budget is None else clock() + time_budget
    while any(run.remaining for run in runs):
        for run in runs:
            run.step(_ITERATIONS_PER_TURN)
        if deadline is not None and clock() >= deadline:
            break
    return MonteCarloResponse(
        formula_version=FORMULA_VERSION,
        scenarios=[run.result() for run in runs],
    )
