from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response

from .service import BriefUnavailable, get_service

router = APIRouter(prefix="/v1/market-brief", tags=["Market brief"])


@router.get("")
async def market_brief():
    try:
        service = get_service()
        body = await run_in_threadpool(service.brief)
    except BriefUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="The market brief is unavailable right now.") from exc
    return JSONResponse(body, headers={"Cache-Control": "public, max-age=600"})


@router.get("/audio/{key}.mp3")
async def market_brief_audio(key: str):
    try:
        service = get_service()
        audio = await run_in_threadpool(service.audio, key)
    except BriefUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="No audio for that brief.") from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="The market brief is unavailable right now.") from exc
    # Tour audio is named by its content, so it can be kept for a day; a dated
    # brief can be rebuilt once in a day if its first build was incomplete.
    max_age = 86400 if key.startswith("tour-") else 3600
    return Response(audio, media_type="audio/mpeg", headers={"Cache-Control": f"public, max-age={max_age}"})
