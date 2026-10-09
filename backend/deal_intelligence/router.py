"""FastAPI routes for deal intelligence; persistence is intentionally separate."""

from fastapi import APIRouter, Depends, HTTPException

from inquiries.limits import SubmissionLimiter, throttle

from .engine import analyze_deal
from .monte_carlo import run_monte_carlo, time_budget_seconds
from .models import (
    DealAnalysisRequest,
    DealAnalysisResponse,
    ScenarioAnalysisRequest,
    ScenarioAnalysisResponse,
    SensitivityAnalysisRequest,
    SensitivityAnalysisResponse,
    MonteCarloRequest,
    MonteCarloResponse,
)
from .scenarios import analyze_scenarios, analyze_sensitivity


router = APIRouter(prefix="/v1/deals", tags=["Deal intelligence"])

# The scenario, sensitivity and Monte Carlo routes can each hold a Cloud Run
# instance for seconds, and the service runs one request per instance on a few
# instances. Without a limit a handful of scripted requests could take the
# whole API down, inquiry form and health check included. The website does
# not call these routes (its simulator runs in the browser), so the limits
# only bind scripted callers.
heavy_limiter = SubmissionLimiter()
HEAVY_PER_ADDRESS = 10  # per 10 minutes per connection
HEAVY_PER_HOUR = 200    # per instance
limit_heavy = throttle(heavy_limiter, HEAVY_PER_ADDRESS, HEAVY_PER_HOUR,
                       "Too many calculations were requested from this connection. Please wait a few minutes.")


@router.post("/analyze", response_model=DealAnalysisResponse)
async def analyze(request: DealAnalysisRequest) -> DealAnalysisResponse:
    try:
        return analyze_deal(request)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


# Plain functions, not coroutines, so the calculation runs in a worker thread
# and does not stop the event loop answering other requests.
@router.post("/scenarios", response_model=ScenarioAnalysisResponse, dependencies=[Depends(limit_heavy)])
def scenarios(request: ScenarioAnalysisRequest) -> ScenarioAnalysisResponse:
    try:
        return analyze_scenarios(request)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/sensitivity", response_model=SensitivityAnalysisResponse, dependencies=[Depends(limit_heavy)])
def sensitivity(request: SensitivityAnalysisRequest) -> SensitivityAnalysisResponse:
    try:
        return analyze_sensitivity(request)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


# A plain function, not a coroutine: FastAPI runs it in a worker thread, so a
# long simulation does not stop the service answering its other routes.
@router.post("/monte-carlo", response_model=MonteCarloResponse, dependencies=[Depends(limit_heavy)])
def monte_carlo(request: MonteCarloRequest) -> MonteCarloResponse:
    try:
        return run_monte_carlo(request, time_budget=time_budget_seconds())
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
