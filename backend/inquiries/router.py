from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Request, Response

from .models import InquiryCreate, InquiryReceipt
from .service import DeliveryUnavailable, IdempotencyConflict, submit_inquiry


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
    except DeliveryUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if replay:
        response.status_code = 200
    return receipt
