from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from inquiries.firebase import queue_settings
from inquiries.router import require_staff
from .service import MAX_BYTES, EpisodeNotFound, PodcastUnavailable, UploadIncomplete, get_service

router = APIRouter(prefix="/v1/podcast", tags=["Podcast"])
NO_STORE = {"Cache-Control": "no-store"}


class EpisodeCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=600)
    content_type: Literal["audio/mpeg", "audio/mp4", "audio/x-m4a"]
    size_bytes: int = Field(gt=0, le=MAX_BYTES)


def service():
    try:
        return get_service()
    except PodcastUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Podcast storage is unavailable.") from exc


async def run(call, *args):
    try:
        return await run_in_threadpool(call, *args)
    except EpisodeNotFound as exc:
        raise HTTPException(status_code=404, detail="No such episode.", headers=NO_STORE) from exc
    except UploadIncomplete as exc:
        raise HTTPException(status_code=409, detail="The audio file has not finished uploading.", headers=NO_STORE) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Podcast storage is unavailable.", headers=NO_STORE) from exc


@router.get("/episodes")
async def public_episodes(podcast=Depends(service)):
    items = await run(podcast.public_list)
    return JSONResponse({"items": items}, headers={"Cache-Control": "public, max-age=300"})


@router.get("/staff/episodes")
async def staff_episodes(staff=Depends(require_staff), podcast=Depends(service)):
    return JSONResponse({"items": await run(podcast.staff_list)}, headers=NO_STORE)


@router.post("/staff/episodes", status_code=201)
async def start_episode(value: EpisodeCreate, staff=Depends(require_staff), podcast=Depends(service)):
    title = value.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="An episode needs a title.", headers=NO_STORE)
    _, _, _, staff_origin = queue_settings()
    body = await run(podcast.start_episode, title, value.description.strip(),
                     value.content_type, value.size_bytes, staff, staff_origin)
    return JSONResponse(body, status_code=201, headers=NO_STORE)


@router.post("/staff/episodes/{episode_id}/publish")
async def publish(episode_id: str, staff=Depends(require_staff), podcast=Depends(service)):
    return JSONResponse(await run(podcast.publish, episode_id), headers=NO_STORE)


@router.post("/staff/episodes/{episode_id}/unpublish")
async def unpublish(episode_id: str, staff=Depends(require_staff), podcast=Depends(service)):
    return JSONResponse(await run(podcast.unpublish, episode_id), headers=NO_STORE)
