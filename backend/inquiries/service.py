"""Durable inquiry queue. A receipt confirms storage, not staff acknowledgement."""

import hashlib
import hmac
import json
import os
import re
import uuid
from datetime import datetime, timezone

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from pymongo.write_concern import WriteConcern

from .models import InquiryCreate, InquiryReceipt, StaffAcknowledgement, StaffInquiry, StaffInquiryList


CONSENT_VERSION = "2026-09-24-v1"
MAJORITY_WRITE = WriteConcern(w="majority", j=True, wtimeout=5000)
HEX_SHA256 = re.compile(r"^[0-9a-fA-F]{64}$")


class QueueUnavailable(Exception):
    pass


class IdempotencyConflict(Exception):
    pass


class StaffUnauthorized(Exception):
    pass


class InquiryNotFound(Exception):
    pass


def _fingerprint(inquiry: InquiryCreate) -> str:
    canonical = json.dumps(inquiry.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _staff_settings() -> tuple[str, str]:
    """No route is enabled without an explicit staff account and valid key hash."""
    enabled = os.environ.get("INQUIRY_STAFF_QUEUE_ENABLED", "").strip().lower() == "true"
    account = os.environ.get("INQUIRY_STAFF_ACCOUNT_NAME", "").strip()
    digest = os.environ.get("INQUIRY_STAFF_ACCESS_KEY_SHA256", "").strip().lower()
    if not enabled or not account or not HEX_SHA256.fullmatch(digest):
        raise QueueUnavailable("Inquiry queue is not configured.")
    return account, digest


def authorize_staff(authorization: str | None) -> str:
    account, expected_digest = _staff_settings()
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token or len(token) < 32:
        raise StaffUnauthorized()
    actual_digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    if not hmac.compare_digest(actual_digest, expected_digest):
        raise StaffUnauthorized()
    return account


def _majority(collection):
    return collection.with_options(write_concern=MAJORITY_WRITE)


async def submit_inquiry(collection, inquiry: InquiryCreate, key: uuid.UUID) -> tuple[InquiryReceipt, bool]:
    """Store once using a majority+journaled write; fail closed without staff access."""
    _staff_settings()
    now = datetime.now(timezone.utc)
    document_id = hashlib.sha256(str(key).encode("ascii")).hexdigest()
    fingerprint = _fingerprint(inquiry)
    document = {
        "_id": document_id,
        "request_id": str(uuid.uuid4()),
        "payload_hash": fingerprint,
        "payload": inquiry.model_dump(mode="json"),
        "status": "queued",
        "submitted_at": now.isoformat(),
        "consent_at": now.isoformat(),
        "consent_version": CONSENT_VERSION,
    }
    try:
        durable = _majority(collection)
        result = await durable.insert_one(document)
        if not result.acknowledged:
            raise QueueUnavailable("Inquiry storage was not confirmed. Retry with the same submission key.")
        replay = False
    except DuplicateKeyError:
        try:
            document = await collection.find_one({"_id": document_id})
        except Exception as exc:
            raise QueueUnavailable("Inquiry status is unavailable. Retry with the same submission key.") from exc
        if document is None:
            raise QueueUnavailable("Inquiry status is unavailable. Retry with the same submission key.")
        replay = True
    except QueueUnavailable:
        raise
    except Exception as exc:
        raise QueueUnavailable("Inquiry storage was not confirmed. Retry with the same submission key.") from exc

    if document["payload_hash"] != fingerprint:
        raise IdempotencyConflict("This submission key was already used for a different request.")
    return InquiryReceipt(request_id=document["request_id"], submitted_at=document["submitted_at"]), replay


def _staff_item(document: dict) -> StaffInquiry:
    return StaffInquiry(
        request_id=document["request_id"],
        **document["payload"],
        submitted_at=document["submitted_at"],
        status=document["status"],
        consent_at=document["consent_at"],
        consent_version=document["consent_version"],
    )


async def list_staff_inquiries(collection, limit: int) -> StaffInquiryList:
    try:
        documents = await collection.find(
            {"status": {"$in": ["queued", "acknowledged"]}}
        ).sort("submitted_at", -1).limit(limit).to_list(length=limit)
        return StaffInquiryList(items=[_staff_item(document) for document in documents])
    except Exception as exc:
        raise QueueUnavailable("Inquiry queue is temporarily unavailable.") from exc


async def acknowledge_inquiry(collection, request_id: uuid.UUID, account: str) -> StaffAcknowledgement:
    timestamp = datetime.now(timezone.utc).isoformat()
    try:
        document = await _majority(collection).find_one_and_update(
            {"request_id": str(request_id), "status": "queued"},
            {"$set": {"status": "acknowledged", "acknowledged_at": timestamp, "acknowledged_by": account}},
            return_document=ReturnDocument.AFTER,
        )
        if document is None:
            document = await collection.find_one({"request_id": str(request_id)})
    except Exception as exc:
        raise QueueUnavailable("Inquiry acknowledgement was not confirmed.") from exc
    if document is None:
        raise InquiryNotFound()
    if document["status"] != "acknowledged":
        raise QueueUnavailable("Inquiry acknowledgement was not confirmed.")
    return StaffAcknowledgement(request_id=document["request_id"], acknowledged_at=document["acknowledged_at"])
