"""FastAPI routes for deal intelligence; persistence is intentionally separate."""

from fastapi import APIRouter, HTTPException

from .engine import analyze_deal
from .models import (
    DealAnalysisRequest,
    DealAnalysisResponse,
    ScenarioAnalysisRequest,
    ScenarioAnalysisResponse,
    SensitivityAnalysisRequest,
    SensitivityAnalysisResponse,
)
from .scenarios import analyze_scenarios, analyze_sensitivity


router = APIRouter(prefix="/v1/deals", tags=["Deal intelligence"])


@router.post("/analyze", response_model=DealAnalysisResponse)
async def analyze(request: DealAnalysisRequest) -> DealAnalysisResponse:
    try:
        return analyze_deal(request)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/scenarios", response_model=ScenarioAnalysisResponse)
async def scenarios(request: ScenarioAnalysisRequest) -> ScenarioAnalysisResponse:
    try:
        return analyze_scenarios(request)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/sensitivity", response_model=SensitivityAnalysisResponse)
async def sensitivity(request: SensitivityAnalysisRequest) -> SensitivityAnalysisResponse:
    try:
        return analyze_sensitivity(request)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/assumption-profiles")
async def assumption_profiles() -> dict:
    """Return transparent starter profiles; clients must opt into each value."""
    return {
        "schema_version": "1.0",
        "profiles": [
            {
                "id": "rental-neutral",
                "label": "Rental — neutral starter",
                "values": {
                    "vacancy_rate": 0.05,
                    "credit_loss_rate": 0.01,
                    "annual_income_growth_rate": 0.03,
                    "annual_expense_growth_rate": 0.03,
                    "annual_discount_rate": 0.10,
                },
                "warning": "Illustrative defaults only; replace with property- and market-specific evidence.",
            },
            {
                "id": "flip-neutral",
                "label": "Flip — neutral starter",
                "values": {"rehab_contingency_rate": 0.10, "selling_cost_rate": 0.06},
                "warning": "Illustrative defaults only; obtain contractor, title, tax, and brokerage estimates.",
            },
        ],
    }
