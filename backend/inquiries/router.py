from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response

from .models import InquiryCreate, InquiryReceipt, StaffAcknowledgement, StaffInquiryList
from .service import (
    IdempotencyConflict, InquiryNotFound, QueueUnavailable, StaffUnauthorized,
    acknowledge_inquiry, authorize_staff, list_staff_inquiries, submit_inquiry,
)


router = APIRouter(prefix="/v1/inquiries", tags=["Inquiries"])


@router.post("", response_model=InquiryReceipt, status_code=201)
async def create_inquiry(
    inquiry: InquiryCreate,
    request: Request,
    response: Response,
    x_idempotency_key: UUID = Header(),
) -> InquiryReceipt:
    try:
        receipt, replay = await submit_inquiry(request.app.state.db.inquiries, inquiry, x_idempotency_key)
    except IdempotencyConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except QueueUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if replay:
        response.status_code = 200
    return receipt


def require_staff(authorization: str | None = Header(default=None)) -> str:
    try:
        return authorize_staff(authorization)
    except QueueUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except StaffUnauthorized as exc:
        raise HTTPException(status_code=401, detail="Staff authentication required.") from exc


@router.get("/staff", response_model=StaffInquiryList)
async def get_staff_inquiries(
    request: Request,
    response: Response,
    limit: int = Query(default=50, ge=1, le=100),
    account: str = Depends(require_staff),
) -> StaffInquiryList:
    del account
    response.headers["Cache-Control"] = "no-store"
    try:
        return await list_staff_inquiries(request.app.state.db.inquiries, limit)
    except QueueUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.patch("/staff/{request_id}/acknowledge", response_model=StaffAcknowledgement)
async def acknowledge_staff_inquiry(
    request_id: UUID,
    request: Request,
    response: Response,
    account: str = Depends(require_staff),
) -> StaffAcknowledgement:
    response.headers["Cache-Control"] = "no-store"
    try:
        return await acknowledge_inquiry(request.app.state.db.inquiries, request_id, account)
    except InquiryNotFound as exc:
        raise HTTPException(status_code=404, detail="Inquiry not found.") from exc
    except QueueUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
