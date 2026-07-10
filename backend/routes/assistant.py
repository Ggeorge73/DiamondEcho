from fastapi import APIRouter, HTTPException

from ai.assistant import RealEstateAssistant
from ai.calculators import CalculationError, analyze
from ai.models import ChatRequest, ChatResponse, DealAnalysisRequest, DealAnalysisResponse


router = APIRouter(prefix="/assistant", tags=["assistant"])
assistant = RealEstateAssistant()


@router.get("/health")
async def assistant_health():
    return {"status": "ok", "mode": "grounded-mvp"}


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    return assistant.respond(request)


@router.post("/analyze", response_model=DealAnalysisResponse)
async def analyze_deal(request: DealAnalysisRequest) -> DealAnalysisResponse:
    try:
        metrics = analyze(request.model, request.inputs)
    except CalculationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    warnings = []
    if not request.jurisdiction.state:
        warnings.append("Property taxes, transfer taxes, insurance, legal rules, and closing costs must be supplied or verified for the property jurisdiction.")
    return DealAnalysisResponse(
        model=request.model,
        metrics=metrics,
        assumptions=[
            "Outputs use only the submitted inputs; DiamondEcho does not silently substitute live rates or market data.",
            "Run downside and upside scenarios and verify rent, expenses, repair scope, financing, and exit value independently.",
        ],
        warnings=warnings,
        disclaimer="Illustrative analysis only; not an appraisal, credit decision, offer, or investment recommendation.",
    )
