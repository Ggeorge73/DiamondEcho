import asyncio
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from inquiries.limits import SubmissionLimiter, throttle

from .models import PropertyLookupResponse, SuggestionResponse
from .service import lookup, suggest


router = APIRouter(prefix="/v1/properties", tags=["Property data"])

# Each lookup spends paid RentCast quota. A visitor looks up a handful of
# addresses; a script looping this route would run up the bill. Suggestions
# are left alone: they fire as a visitor types and Mapbox bills per session.
lookup_limiter = SubmissionLimiter()
LOOKUP_PER_ADDRESS = 20  # per 10 minutes per connection
LOOKUP_PER_HOUR = 300    # per instance
limit_lookups = throttle(lookup_limiter, LOOKUP_PER_ADDRESS, LOOKUP_PER_HOUR,
                         "Too many property lookups were requested from this connection. Please wait a few minutes.")


@router.get("/suggest", response_model=SuggestionResponse)
async def property_suggestions(
    q: str = Query(min_length=1, max_length=256),
    session_token: UUID = Query(),
) -> SuggestionResponse:
    try:
        return await asyncio.to_thread(suggest, q, str(session_token))
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Address provider is temporarily unavailable.") from exc


@router.get("/lookup", response_model=PropertyLookupResponse, dependencies=[Depends(limit_lookups)])
async def property_lookup(address: str = Query(min_length=5, max_length=240)) -> PropertyLookupResponse:
    try:
        details = await asyncio.to_thread(lookup, address)
        return PropertyLookupResponse(property=details)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Property-data provider is temporarily unavailable.") from exc
