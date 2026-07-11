import asyncio
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query

from .models import PropertyLookupResponse, SuggestionResponse
from .service import lookup, suggest


router = APIRouter(prefix="/v1/properties", tags=["Property data"])


@router.get("/suggest", response_model=SuggestionResponse)
async def property_suggestions(
    q: str = Query(min_length=1, max_length=256),
    session_token: UUID = Query(),
) -> SuggestionResponse:
    try:
        return await asyncio.to_thread(suggest, q, str(session_token))
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Address provider is temporarily unavailable.") from exc


@router.get("/lookup", response_model=PropertyLookupResponse)
async def property_lookup(address: str = Query(min_length=5, max_length=240)) -> PropertyLookupResponse:
    try:
        details = await asyncio.to_thread(lookup, address)
        return PropertyLookupResponse(property=details)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Property-data provider is temporarily unavailable.") from exc
