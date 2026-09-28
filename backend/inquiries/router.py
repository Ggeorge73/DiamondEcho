from uuid import UUID
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from .models import InquiryCreate, InquiryReceipt, StaffAcknowledgement, StaffInquiryList
from .service import (
    IdempotencyConflict, InquiryNotFound, QueueUnavailable, StaffUnauthorized, StaffForbidden,
    acknowledge_inquiry, list_staff_inquiries, submit_inquiry,
)
from .firebase import get_store, verify_staff

router = APIRouter(prefix="/v1/inquiries", tags=["Inquiries"])

def require_store():
    try:
        return get_store()
    except QueueUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

def require_staff(authorization: str | None = Header(default=None)) -> str:
    try:
        return verify_staff(authorization)
    except QueueUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except StaffUnauthorized as exc:
        raise HTTPException(status_code=401, detail="Staff authentication required.") from exc
    except StaffForbidden as exc:
        raise HTTPException(status_code=403, detail="Staff access denied.") from exc

# Sync routes are run in FastAPI's thread pool; SDK I/O never blocks the ASGI loop.
@router.post("", response_model=InquiryReceipt, status_code=201)
def create_inquiry(inquiry: InquiryCreate, response: Response,
                   x_idempotency_key: UUID = Header(), store=Depends(require_store)):
    response.headers["Cache-Control"] = "no-store"
    try:
        receipt, replay = submit_inquiry(store, inquiry, x_idempotency_key)
    except IdempotencyConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except QueueUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if replay:
        response.status_code = 200
    return receipt

@router.get("/staff", response_model=StaffInquiryList)
def get_staff_inquiries(response: Response, limit: int = Query(default=50, ge=1, le=100),
                        account: str = Depends(require_staff), store=Depends(require_store)):
    response.headers["Cache-Control"] = "no-store"
    try:
        return list_staff_inquiries(store, limit)
    except QueueUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

@router.patch("/staff/{request_id}/acknowledge", response_model=StaffAcknowledgement)
def acknowledge_staff_inquiry(request_id: UUID, response: Response,
                              account: str = Depends(require_staff), store=Depends(require_store)):
    response.headers["Cache-Control"] = "no-store"
    try:
        return acknowledge_inquiry(store, request_id, account)
    except InquiryNotFound as exc:
        raise HTTPException(status_code=404, detail="Inquiry not found.") from exc
    except QueueUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
