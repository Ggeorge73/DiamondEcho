"""Inquiry contracts independent of storage and identity providers."""
import hashlib
import json
import uuid
from datetime import datetime, timezone
from .models import InquiryCreate, InquiryReceipt, StaffAcknowledgement, StaffInquiry, StaffInquiryList

CONSENT_VERSION = "2026-09-26-v1"

class QueueUnavailable(Exception):
    pass

class IdempotencyConflict(Exception):
    pass

class StaffUnauthorized(Exception):
    pass

class StaffForbidden(Exception):
    pass

class InquiryNotFound(Exception):
    pass

def _fingerprint(inquiry: InquiryCreate) -> str:
    canonical = json.dumps(inquiry.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

def submit_inquiry(store, inquiry: InquiryCreate, key: uuid.UUID) -> tuple[InquiryReceipt, bool]:
    now = datetime.now(timezone.utc).isoformat()
    # Stable UUID document ID avoids an extra mapping/index and is not a staff credential.
    request_id = str(uuid.uuid5(uuid.NAMESPACE_URL, "diamondecho:inquiry:" + str(key)))
    document = {
        "request_id": request_id, "payload_hash": _fingerprint(inquiry),
        "payload": inquiry.model_dump(mode="json"), "status": "queued",
        "submitted_at": now, "consent_at": now, "consent_version": CONSENT_VERSION,
    }
    try:
        saved, replay = store.create_once(request_id, document)
    except Exception as exc:
        raise QueueUnavailable("Inquiry storage was not confirmed. Retry with the same submission key.") from exc
    if saved["payload_hash"] != document["payload_hash"]:
        raise IdempotencyConflict("This submission key was already used for a different request.")
    return InquiryReceipt(request_id=saved["request_id"], submitted_at=saved["submitted_at"]), replay

def list_staff_inquiries(store, limit: int) -> StaffInquiryList:
    try:
        documents = store.list_newest(limit)
        return StaffInquiryList(items=[
            StaffInquiry(request_id=d["request_id"], **d["payload"],
                         submitted_at=d["submitted_at"], status=d["status"],
                         consent_at=d["consent_at"], consent_version=d["consent_version"])
            for d in documents
        ])
    except Exception as exc:
        raise QueueUnavailable("Inquiry queue is temporarily unavailable.") from exc

def acknowledge_inquiry(store, request_id: uuid.UUID, account: str) -> StaffAcknowledgement:
    try:
        document = store.acknowledge(str(request_id), account, datetime.now(timezone.utc).isoformat())
    except Exception as exc:
        raise QueueUnavailable("Inquiry acknowledgement was not confirmed.") from exc
    if document is None:
        raise InquiryNotFound()
    if document["status"] != "acknowledged":
        raise QueueUnavailable("Inquiry acknowledgement was not confirmed.")
    return StaffAcknowledgement(request_id=document["request_id"], acknowledged_at=document["acknowledged_at"])
