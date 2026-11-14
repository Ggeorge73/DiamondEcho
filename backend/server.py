"""Cloud Run entry point: calculators work without a database at startup."""
import os
import re
from pathlib import Path
from uuid import uuid4
from datetime import datetime, timezone
from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware
from deal_intelligence.router import router as deal_router
from routes.assistant import router as assistant_router
from property_data.router import router as property_router
from market_brief.router import router as market_brief_router
from podcast.router import router as podcast_router
from inquiries.router import router as inquiries_router, require_staff, require_store
from inquiries.firebase import queue_settings

load_dotenv(Path(__file__).parent / ".env")

# DE-25 finding F4: FastAPI publishes an interactive page listing every route
# (/docs, /redoc) and the full route description (/openapi.json) unless told
# not to. A deployed service has no reason to hand that list to anyone who
# asks, so they are off unless API_DOCS_ENABLED is exactly "true" (for a local
# run). The routes themselves are unaffected.
def docs_settings(environ=os.environ):
    enabled = environ.get("API_DOCS_ENABLED", "").strip().lower() == "true"
    return {
        "docs_url": "/docs" if enabled else None,
        "redoc_url": "/redoc" if enabled else None,
        "openapi_url": "/openapi.json" if enabled else None,
    }

app = FastAPI(**docs_settings())
api = APIRouter(prefix="/api")

# Build identity: which deploy is answering. A monitor with no cloud sign-in
# reads this to tell a new revision from the old one (scripts/sre). Cloud Run
# sets K_REVISION in the container; scripts/sre/cloudrun/deploy.sh sets
# APP_COMMIT to the commit it deployed. Both are null when unset, as on a
# local run. Only these two facts are published, and only when they look like
# a revision name and a commit, so a mistyped setting cannot put anything else
# on this route. No library versions and no configuration.
REVISION_NAME = re.compile(r"[a-z][a-z0-9-]{0,62}")
COMMIT_HASH = re.compile(r"[0-9a-f]{7,40}")

def build_identity(environ=os.environ):
    revision = environ.get("K_REVISION", "").strip()
    commit = environ.get("APP_COMMIT", "").strip().lower()
    return {
        "service": "DiamondEcho API",
        "revision": revision if REVISION_NAME.fullmatch(revision) else None,
        "commit": commit if COMMIT_HASH.fullmatch(commit) else None,
    }

@api.get("/")
def root():
    return build_identity()

# Liveness only, not proof of Firebase configuration or queue delivery.
# Cloud Run's front end answers some paths ending in "z" itself, so /healthz
# never reaches this process there (found on the staging deploy, DE-33).
# /health is the path to check on a deployed service; /healthz stays for
# local runs and anything that already calls it.
@app.get("/health")
@app.get("/healthz")
def health():
    return {"status": "ok"}

class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    client_name: str = Field(min_length=1, max_length=120)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class StatusCheckCreate(BaseModel):
    client_name: str = Field(min_length=1, max_length=120)

@api.post("/status", response_model=StatusCheck)
def create_status_check(value: StatusCheckCreate, account=Depends(require_staff), store=Depends(require_store)):
    check = StatusCheck(client_name=value.client_name)
    try:
        store.db.collection("status_checks").document(check.id).create(check.model_dump(mode="json"), timeout=5)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Status storage unavailable.") from exc
    return check

@api.get("/status", response_model=list[StatusCheck])
def get_status_checks(account=Depends(require_staff), store=Depends(require_store)):
    try:
        return [StatusCheck(**row.to_dict()) for row in store.db.collection("status_checks").limit(100).stream(timeout=5)]
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Status storage unavailable.") from exc

for router in (deal_router, assistant_router, property_router, inquiries_router, market_brief_router, podcast_router):
    api.include_router(router)
app.include_router(api)

origins = [value.strip() for value in os.getenv(
    "CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
).split(",") if value.strip()]
if "*" in origins:
    raise RuntimeError("Wildcard API CORS is forbidden.")
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False,
                   allow_methods=["GET", "POST", "PATCH"], allow_headers=["Authorization", "Content-Type", "X-Idempotency-Key"])

@app.middleware("http")
async def protect_staff_surface(request, call_next):
    path = request.url.path
    protected = (path.startswith("/api/v1/inquiries/staff") or path.startswith("/api/v1/podcast/staff")
                 or path == "/api/status")
    if protected and request.headers.get("origin"):
        try:
            _, _, _, staff_origin = queue_settings()
            if request.headers["origin"] != staff_origin:
                from fastapi.responses import JSONResponse
                return JSONResponse({"detail": "Staff origin denied."}, status_code=403, headers={"Cache-Control": "no-store"})
        except Exception:
            from fastapi.responses import JSONResponse
            return JSONResponse({"detail": "Staff access unavailable."}, status_code=503, headers={"Cache-Control": "no-store"})
    response = await call_next(request)
    # The API returns data, never pages: browsers must not guess another type
    # from a body, and must not pass the API's address on to other sites.
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    if path.startswith("/api/v1/inquiries") or path == "/api/status":
        response.headers["Cache-Control"] = "no-store"
    return response

# Outermost, so it times the whole request and sees any error the layers above
# let through. It writes one log line only for a server error or a slow
# request, and never anything a visitor sent (backend/observability).
from observability import RequestTelemetry
app.add_middleware(RequestTelemetry)
