"""Versioned API models for the deterministic underwriting engine.

All rates are decimals, not display percentages. For example, 6.5% is sent as
``0.065``. Currency inputs are nominal dollars in ``currency``.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class DealStrategy(str, Enum):
    RENTAL = "rental"
    FLIP = "flip"


class PropertyType(str, Enum):
    SINGLE_FAMILY = "single_family"
    CONDO = "condo"
    MULTIFAMILY = "multifamily"
    OFFICE = "office"
    RETAIL = "retail"
    INDUSTRIAL = "industrial"
    MIXED_USE = "mixed_use"
    HOSPITALITY = "hospitality"
    LAND = "land"
    OTHER = "other"


class PropertyInputs(StrictModel):
    property_type: PropertyType
    unit_count: int = Field(default=1, ge=1, le=1_000_000)
    rentable_square_feet: Optional[float] = Field(default=None, gt=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    market: Optional[str] = Field(default=None, max_length=120)


class AcquisitionInputs(StrictModel):
    purchase_price: float = Field(gt=0)
    closing_costs: float = Field(default=0, ge=0)
    due_diligence_costs: float = Field(default=0, ge=0)
    initial_capex: float = Field(default=0, ge=0)
    hold_months: int = Field(default=60, ge=1, le=600)


class DebtInputs(StrictModel):
    name: str = Field(default="Senior loan", min_length=1, max_length=80)
    principal: Optional[float] = Field(default=None, gt=0)
    loan_to_value: Optional[float] = Field(default=None, gt=0, le=2)
    annual_interest_rate: float = Field(default=0, ge=0, le=1)
    amortization_years: int = Field(default=30, ge=1, le=50)
    interest_only_months: int = Field(default=0, ge=0, le=600)
    term_months: int = Field(default=360, ge=1, le=600)
    origination_fee_rate: float = Field(default=0, ge=0, le=0.25)

    @model_validator(mode="after")
    def exactly_one_principal_source(self) -> "DebtInputs":
        if (self.principal is None) == (self.loan_to_value is None):
            raise ValueError("provide exactly one of principal or loan_to_value")
        if self.interest_only_months > self.term_months:
            raise ValueError("interest_only_months cannot exceed term_months")
        return self


class OperatingInputs(StrictModel):
    gross_scheduled_rent: float = Field(gt=0, description="Year-one annual rent")
    other_income: float = Field(default=0, ge=0, description="Year-one annual other income")
    vacancy_rate: float = Field(default=0.05, ge=0, lt=1)
    credit_loss_rate: float = Field(default=0, ge=0, lt=1)
    operating_expenses: float = Field(default=0, ge=0, description="Annual OpEx before management")
    management_fee_rate: float = Field(default=0, ge=0, le=0.5)
    replacement_reserves: float = Field(default=0, ge=0, description="Annual below-NOI reserves")
    annual_below_noi_costs: float = Field(
        default=0,
        ge=0,
        description="Annual TI, leasing commissions, or recurring capital costs",
    )
    annual_income_growth_rate: float = Field(default=0, ge=-0.5, le=0.5)
    annual_expense_growth_rate: float = Field(default=0, ge=-0.5, le=0.5)

    @model_validator(mode="after")
    def loss_rates_leave_some_collection(self) -> "OperatingInputs":
        if self.vacancy_rate + self.credit_loss_rate >= 1:
            raise ValueError("vacancy_rate plus credit_loss_rate must be less than 1")
        return self


class FlipInputs(StrictModel):
    after_repair_value: float = Field(gt=0)
    rehab_cost: float = Field(default=0, ge=0)
    rehab_contingency_rate: float = Field(default=0.1, ge=0, le=1)
    monthly_holding_costs: float = Field(
        default=0,
        ge=0,
        description="Taxes, insurance, utilities, and non-debt holding costs",
    )
    other_project_costs: float = Field(default=0, ge=0)


class ExitInputs(StrictModel):
    explicit_sale_price: Optional[float] = Field(default=None, gt=0)
    exit_cap_rate: Optional[float] = Field(default=None, gt=0, le=0.5)
    selling_cost_rate: float = Field(default=0.06, ge=0, le=0.5)

    @model_validator(mode="after")
    def one_exit_method(self) -> "ExitInputs":
        if self.explicit_sale_price is not None and self.exit_cap_rate is not None:
            raise ValueError("provide explicit_sale_price or exit_cap_rate, not both")
        return self


class AnalysisAssumptions(StrictModel):
    annual_discount_rate: float = Field(default=0.1, gt=-0.99, le=5)


class DealAnalysisRequest(StrictModel):
    schema_version: str = Field(default="1.0", pattern=r"^1\.0$")
    strategy: DealStrategy
    property: PropertyInputs
    acquisition: AcquisitionInputs
    debt: List[DebtInputs] = Field(default_factory=list, max_length=20)
    operating: Optional[OperatingInputs] = None
    flip: Optional[FlipInputs] = None
    exit: ExitInputs = Field(default_factory=ExitInputs)
    assumptions: AnalysisAssumptions = Field(default_factory=AnalysisAssumptions)

    @model_validator(mode="after")
    def strategy_specific_inputs(self) -> "DealAnalysisRequest":
        if self.strategy == DealStrategy.RENTAL:
            if self.operating is None:
                raise ValueError("operating inputs are required for a rental analysis")
            if self.flip is not None:
                raise ValueError("flip inputs are not valid for a rental analysis")
            if self.exit.explicit_sale_price is None and self.exit.exit_cap_rate is None:
                raise ValueError("rental analysis requires explicit_sale_price or exit_cap_rate")
        else:
            if self.flip is None:
                raise ValueError("flip inputs are required for a flip analysis")
            if self.operating is not None:
                raise ValueError("operating inputs are not valid for a flip analysis")
            if self.exit.exit_cap_rate is not None:
                raise ValueError("exit_cap_rate is not valid for a flip analysis")
        return self


class MetricResult(StrictModel):
    value: Optional[float]
    unit: str
    formula: str
    components: Dict[str, float] = Field(default_factory=dict)
    warning: Optional[str] = None


class PeriodCashFlow(StrictModel):
    month: int
    operating_cash_flow: float = 0
    debt_service: float = 0
    capital_costs: float = 0
    sale_proceeds: float = 0
    loan_payoff: float = 0
    net_cash_flow: float


class DealAnalysisResponse(StrictModel):
    analysis_id: str
    schema_version: str = "1.0"
    formula_version: str
    strategy: DealStrategy
    computed_at: datetime
    metrics: Dict[str, MetricResult]
    cash_flows: List[PeriodCashFlow]
    assumptions: Dict[str, str]
    warnings: List[str]


class ScenarioShock(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    purchase_price_change: float = Field(default=0, ge=-0.9, le=5)
    rent_change: float = Field(default=0, ge=-0.9, le=5)
    vacancy_rate_delta: float = Field(default=0, ge=-0.9, le=0.9)
    expenses_change: float = Field(default=0, ge=-0.9, le=5)
    exit_cap_rate_delta: float = Field(default=0, ge=-0.4, le=0.4)
    after_repair_value_change: float = Field(default=0, ge=-0.9, le=5)
    rehab_cost_change: float = Field(default=0, ge=-0.9, le=5)
    interest_rate_delta: float = Field(default=0, ge=-1, le=1)


class ScenarioAnalysisRequest(StrictModel):
    deal: DealAnalysisRequest
    scenarios: List[ScenarioShock] = Field(default_factory=list, max_length=20)


class ScenarioResult(StrictModel):
    name: str
    analysis: DealAnalysisResponse


class ScenarioAnalysisResponse(StrictModel):
    scenarios: List[ScenarioResult]


class SensitivityField(str, Enum):
    PURCHASE_PRICE = "purchase_price"
    RENT = "rent"
    VACANCY_RATE = "vacancy_rate"
    OPERATING_EXPENSES = "operating_expenses"
    EXIT_CAP_RATE = "exit_cap_rate"
    AFTER_REPAIR_VALUE = "after_repair_value"
    REHAB_COST = "rehab_cost"
    INTEREST_RATE = "interest_rate"


class SensitivityMetric(str, Enum):
    IRR = "irr"
    NPV = "npv"
    CASH_ON_CASH = "cash_on_cash"
    DSCR = "dscr"
    FLIP_PROFIT = "flip_profit"
    FLIP_ROI = "flip_roi"


class SensitivityAxis(StrictModel):
    field: SensitivityField
    changes: List[float] = Field(min_length=1, max_length=11)


class SensitivityAnalysisRequest(StrictModel):
    deal: DealAnalysisRequest
    metric: SensitivityMetric
    x_axis: SensitivityAxis
    y_axis: Optional[SensitivityAxis] = None


class SensitivityCell(StrictModel):
    x_change: float
    y_change: Optional[float] = None
    value: Optional[float]
    warning: Optional[str] = None


class SensitivityAnalysisResponse(StrictModel):
    metric: SensitivityMetric
    x_field: SensitivityField
    y_field: Optional[SensitivityField] = None
    cells: List[SensitivityCell]
