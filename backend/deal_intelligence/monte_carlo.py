"""Reproducible Monte Carlo scenario analysis for underwriting decisions."""

from __future__ import annotations

import random
from statistics import fmean
from typing import Dict, Iterable, List

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


def _summary(values: List[float]) -> MonteCarloMetricSummary:
    return MonteCarloMetricSummary(
        mean=fmean(values), minimum=min(values), p10=_percentile(values, 0.10),
        p25=_percentile(values, 0.25), p50=_percentile(values, 0.50),
        p75=_percentile(values, 0.75), p90=_percentile(values, 0.90), maximum=max(values),
        probability_above_zero=sum(value > 0 for value in values) / len(values),
        probability_below_one=sum(value < 1 for value in values) / len(values),
    )


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
    return deal


def _run_scenario(base: DealAnalysisRequest, scenario: MonteCarloScenario) -> MonteCarloScenarioResult:
    rng = random.Random(scenario.seed)
    target_metrics = (
        ["irr", "npv", "cash_on_cash", "dscr", "equity_multiple"]
        if base.strategy == DealStrategy.RENTAL
        else ["irr", "npv", "flip_profit", "flip_roi", "equity_multiple"]
    )
    observations: Dict[str, List[float]] = {key: [] for key in target_metrics}
    failures = 0

    for _ in range(scenario.iterations):
        try:
            result = analyze_deal(_sample_deal(base, scenario, rng))
            for key in target_metrics:
                metric = result.metrics.get(key)
                if metric and metric.value is not None:
                    observations[key].append(metric.value)
        except (ValueError, ArithmeticError):
            failures += 1

    completed = scenario.iterations - failures
    if completed == 0:
        raise ValueError(f"Monte Carlo scenario '{scenario.name}' produced no valid iterations")
    summaries = {key: _summary(values) for key, values in observations.items() if values}
    warnings = [
        "Distributions are user assumptions, not forecasts; correlations and fat-tail events are not inferred.",
        "Review percentile outcomes alongside the deterministic downside case and source evidence.",
    ]
    if failures:
        warnings.append(f"{failures} iterations were excluded because sampled inputs produced invalid economics.")
    return MonteCarloScenarioResult(
        name=scenario.name, iterations_requested=scenario.iterations,
        iterations_completed=completed, failed_iterations=failures,
        seed=scenario.seed, summaries=summaries, warnings=warnings,
    )


def run_monte_carlo(request: MonteCarloRequest) -> MonteCarloResponse:
    return MonteCarloResponse(
        formula_version=FORMULA_VERSION,
        scenarios=[_run_scenario(request.deal, scenario) for scenario in request.scenarios],
    )
