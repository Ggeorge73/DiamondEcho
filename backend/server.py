"""Cloud Run entry point: calculators work without a database at startup."""
import os
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
from inquiries.router import router as inquiries_router, require_staff, require_store
from inquiries.firebase import queue_settings

load_dotenv(Path(__file__).parent / ".env")
app = FastAPI()
api = APIRouter(prefix="/api")

@api.get("/")
def root():
    return {"service": "DiamondEcho API"}

@app.get("/healthz")
def health():
    # Liveness only, not proof of Firebase configuration or queue delivery.
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

for router in (deal_router, assistant_router, property_router, inquiries_router):
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
    protected = path.startswith("/api/v1/inquiries/staff") or path == "/api/status"
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
    if path.startswith("/api/v1/inquiries") or path == "/api/status":
        response.headers["Cache-Control"] = "no-store"
    return response
