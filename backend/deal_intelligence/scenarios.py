"""Scenario and sensitivity orchestration around the pure analysis engine."""

from __future__ import annotations

from typing import List, Optional

from pydantic import ValidationError

from .engine import analyze_deal
from .models import (
    DealAnalysisRequest,
    ScenarioAnalysisRequest,
    ScenarioAnalysisResponse,
    ScenarioResult,
    ScenarioShock,
    SensitivityAnalysisRequest,
    SensitivityAnalysisResponse,
    SensitivityCell,
    SensitivityField,
)


DEFAULT_SCENARIOS = [
    ScenarioShock(name="Base"),
    ScenarioShock(
        name="Upside",
        rent_change=0.05,
        vacancy_rate_delta=-0.02,
        expenses_change=-0.03,
        exit_cap_rate_delta=-0.005,
        after_repair_value_change=0.05,
        rehab_cost_change=-0.03,
    ),
    ScenarioShock(
        name="Downside",
        rent_change=-0.08,
        vacancy_rate_delta=0.05,
        expenses_change=0.10,
        exit_cap_rate_delta=0.01,
        after_repair_value_change=-0.10,
        rehab_cost_change=0.15,
        interest_rate_delta=0.01,
    ),
]


def _validated_copy(deal: DealAnalysisRequest) -> DealAnalysisRequest:
    return DealAnalysisRequest.model_validate(deal.model_dump(mode="python"))


def apply_scenario(deal: DealAnalysisRequest, shock: ScenarioShock) -> DealAnalysisRequest:
    changed = deal.model_copy(deep=True)
    changed.acquisition.purchase_price *= 1 + shock.purchase_price_change
    for debt in changed.debt:
        debt.annual_interest_rate += shock.interest_rate_delta

    if changed.operating is not None:
        changed.operating.gross_scheduled_rent *= 1 + shock.rent_change
        changed.operating.vacancy_rate += shock.vacancy_rate_delta
        changed.operating.operating_expenses *= 1 + shock.expenses_change
        if changed.exit.exit_cap_rate is not None:
            changed.exit.exit_cap_rate += shock.exit_cap_rate_delta

    if changed.flip is not None:
        changed.flip.after_repair_value *= 1 + shock.after_repair_value_change
        changed.flip.rehab_cost *= 1 + shock.rehab_cost_change
        if changed.exit.explicit_sale_price is not None:
            changed.exit.explicit_sale_price *= 1 + shock.after_repair_value_change

    try:
        return _validated_copy(changed)
    except ValidationError as exc:
        raise ValueError(f"scenario '{shock.name}' creates invalid assumptions: {exc}") from exc


def analyze_scenarios(request: ScenarioAnalysisRequest) -> ScenarioAnalysisResponse:
    scenarios = request.scenarios or DEFAULT_SCENARIOS
    return ScenarioAnalysisResponse(
        scenarios=[
            ScenarioResult(name=scenario.name, analysis=analyze_deal(apply_scenario(request.deal, scenario)))
            for scenario in scenarios
        ]
    )


def _field_shock(field: SensitivityField, change: float, name: str = "Sensitivity") -> ScenarioShock:
    kwargs = {"name": name}
    mapping = {
        SensitivityField.PURCHASE_PRICE: "purchase_price_change",
        SensitivityField.RENT: "rent_change",
        SensitivityField.VACANCY_RATE: "vacancy_rate_delta",
        SensitivityField.OPERATING_EXPENSES: "expenses_change",
        SensitivityField.EXIT_CAP_RATE: "exit_cap_rate_delta",
        SensitivityField.AFTER_REPAIR_VALUE: "after_repair_value_change",
        SensitivityField.REHAB_COST: "rehab_cost_change",
        SensitivityField.INTEREST_RATE: "interest_rate_delta",
    }
    kwargs[mapping[field]] = change
    return ScenarioShock(**kwargs)


def _merge_shocks(first: ScenarioShock, second: Optional[ScenarioShock]) -> ScenarioShock:
    if second is None:
        return first
    data = first.model_dump()
    for key, value in second.model_dump().items():
        if key != "name":
            data[key] += value
    data["name"] = "Sensitivity cell"
    return ScenarioShock(**data)


def _validate_compatible_field(deal: DealAnalysisRequest, field: SensitivityField) -> None:
    rental_only = {
        SensitivityField.RENT,
        SensitivityField.VACANCY_RATE,
        SensitivityField.OPERATING_EXPENSES,
        SensitivityField.EXIT_CAP_RATE,
    }
    flip_only = {SensitivityField.AFTER_REPAIR_VALUE, SensitivityField.REHAB_COST}
    if field in rental_only and deal.operating is None:
        raise ValueError(f"{field.value} sensitivity requires a rental deal")
    if field in flip_only and deal.flip is None:
        raise ValueError(f"{field.value} sensitivity requires a flip deal")
    if field == SensitivityField.EXIT_CAP_RATE and deal.exit.exit_cap_rate is None:
        raise ValueError("exit_cap_rate sensitivity requires an exit-cap valuation")
    if field == SensitivityField.INTEREST_RATE and not deal.debt:
        raise ValueError("interest_rate sensitivity requires at least one debt tranche")


def analyze_sensitivity(request: SensitivityAnalysisRequest) -> SensitivityAnalysisResponse:
    _validate_compatible_field(request.deal, request.x_axis.field)
    if request.y_axis is not None:
        _validate_compatible_field(request.deal, request.y_axis.field)

    cells: List[SensitivityCell] = []
    y_changes = request.y_axis.changes if request.y_axis is not None else [None]
    for y_change in y_changes:
        for x_change in request.x_axis.changes:
            x_shock = _field_shock(request.x_axis.field, x_change)
            y_shock = None
            if request.y_axis is not None and y_change is not None:
                y_shock = _field_shock(request.y_axis.field, y_change)
            try:
                changed = apply_scenario(request.deal, _merge_shocks(x_shock, y_shock))
                result = analyze_deal(changed)
                metric = result.metrics.get(request.metric.value)
                if metric is None:
                    cells.append(
                        SensitivityCell(
                            x_change=x_change,
                            y_change=y_change,
                            value=None,
                            warning=f"metric {request.metric.value} is not available for this strategy",
                        )
                    )
                else:
                    cells.append(
                        SensitivityCell(
                            x_change=x_change,
                            y_change=y_change,
                            value=metric.value,
                            warning=metric.warning,
                        )
                    )
            except ValueError as exc:
                cells.append(
                    SensitivityCell(
                        x_change=x_change,
                        y_change=y_change,
                        value=None,
                        warning=str(exc),
                    )
                )

    return SensitivityAnalysisResponse(
        metric=request.metric,
        x_field=request.x_axis.field,
        y_field=request.y_axis.field if request.y_axis is not None else None,
        cells=cells,
    )
