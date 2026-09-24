"""Durable inquiry intake; SMTP handoff is not proof of inbox receipt."""

import asyncio
import hashlib
import json
import os
import smtplib
import ssl
import uuid
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

from pydantic import EmailStr, TypeAdapter, ValidationError
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from .models import InquiryCreate, InquiryReceipt


CONSENT_VERSION = "2026-09-24-v1"
RETRY_MESSAGE = "Inquiry was saved but delivery is unavailable. Please retry with the same submission key."
LEASE_DURATION = timedelta(minutes=5)


class DeliveryUnavailable(Exception):
    pass


class IdempotencyConflict(Exception):
    pass


def _fingerprint(inquiry: InquiryCreate) -> str:
    canonical = json.dumps(inquiry.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _smtp_settings() -> tuple[str, str, str, str, str, str, int]:
    recipient = os.environ.get("INQUIRY_APPROVED_RECIPIENT_EMAIL", "").strip()
    sender = os.environ.get("INQUIRY_SMTP_FROM_EMAIL", "").strip()
    host = os.environ.get("INQUIRY_SMTP_HOST", "").strip()
    username = os.environ.get("INQUIRY_SMTP_USERNAME", "").strip()
    password = os.environ.get("INQUIRY_SMTP_PASSWORD", "")
    security = os.environ.get("INQUIRY_SMTP_SECURITY", "starttls").strip().lower()
    try:
        port = int(os.environ.get("INQUIRY_SMTP_PORT", "587"))
        email_type = TypeAdapter(EmailStr)
        email_type.validate_python(recipient)
        email_type.validate_python(sender)
    except (ValueError, ValidationError) as exc:
        raise DeliveryUnavailable("Inquiry mail configuration is incomplete.") from exc
    if not all((recipient, sender, host, username, password)) or security not in ("starttls", "ssl") or not 1 <= port <= 65535:
        raise DeliveryUnavailable("Inquiry mail configuration is incomplete.")
    return recipient, sender, host, username, password, security, port


def _send_smtp(document: dict) -> None:
    recipient, sender, host, username, password, security, port = _smtp_settings()
    payload = document["payload"]
    message = EmailMessage()
    message["From"] = sender
    message["To"] = recipient
    message["Subject"] = f"DiamondEcho {payload['kind']} inquiry [{document['request_id']}]"
    message["Message-ID"] = f"<{document['request_id']}@diamond-echo-inquiries.invalid>"
    message.set_content(
        "DiamondEcho inquiry; a tour request is not a booking.\n"
        f"Request ID: {document['request_id']}\n"
        f"Type: {payload['kind']}\nName: {payload['full_name']}\n"
        f"Email: {payload['email']}\nPhone: {payload.get('phone') or 'Not provided'}\n"
        f"Listing ID: {payload.get('property_id') or 'Not provided'}\n"
        f"Property address: {payload.get('property_address') or 'Not provided'}\n"
        f"Preferred tour time: {payload.get('preferred_tour_time') or 'Not provided'}\n"
        f"Message: {payload.get('message') or 'Not provided'}\n"
        f"Consent version: {document['consent_version']}\n"
        f"Consent time (UTC): {document['consent_at']}\n"
    )
    context = ssl.create_default_context()
    if security == "ssl":
        connection = smtplib.SMTP_SSL(host, port, timeout=10, context=context)
    else:
        connection = smtplib.SMTP(host, port, timeout=10)
    with connection as smtp:
        if security == "starttls":
            smtp.starttls(context=context)
        smtp.login(username, password)
        smtp.send_message(message)


async def submit_inquiry(collection, inquiry: InquiryCreate, key: uuid.UUID, deliver=None) -> tuple[InquiryReceipt, bool]:
    """Persist once; return routed only after SMTP acceptance.

    SMTP lacks exactly-once semantics. An interrupted send remains `sending`;
    retries do not automatically resend it because acceptance may be ambiguous.
    Operations must reconcile stale claims using the stable request ID.
    """
    now = datetime.now(timezone.utc)
    document_id = hashlib.sha256(str(key).encode("ascii")).hexdigest()
    fingerprint = _fingerprint(inquiry)
    document = {
        "_id": document_id, "request_id": str(uuid.uuid4()),
        "payload_hash": fingerprint, "payload": inquiry.model_dump(mode="json"),
        "status": "pending", "submitted_at": now.isoformat(), "consent_at": now.isoformat(),
        "consent_version": CONSENT_VERSION, "attempts": 0,
    }
    try:
        await collection.insert_one(document)
    except DuplicateKeyError:
        document = await collection.find_one({"_id": document_id})
        if document is None:
            raise DeliveryUnavailable(RETRY_MESSAGE)
    except Exception as exc:
        raise DeliveryUnavailable("Inquiry could not be saved. Please retry with the same submission key.") from exc

    if document["payload_hash"] != fingerprint:
        raise IdempotencyConflict("This submission key was already used for a different request.")
    if document["status"] == "routed":
        return InquiryReceipt(request_id=document["request_id"], submitted_at=document["submitted_at"]), True

    try:
        claim = await collection.find_one_and_update(
            {"_id": document_id, "status": {"$in": ["pending", "failed"]}},
            {"$set": {"status": "sending", "lease_until": now + LEASE_DURATION}, "$inc": {"attempts": 1}},
            return_document=ReturnDocument.AFTER,
        )
    except Exception as exc:
        raise DeliveryUnavailable(RETRY_MESSAGE) from exc
    if claim is None:
        raise DeliveryUnavailable("Inquiry is being processed or needs operator review. Please quote the request time to support; do not start a new request.")

    try:
        await asyncio.to_thread(deliver or _send_smtp, claim)
    except DeliveryUnavailable as exc:
        try:
            await collection.update_one({"_id": document_id, "status": "sending"}, {"$set": {"status": "failed", "last_attempt_at": datetime.now(timezone.utc)}})
        except Exception:
            pass  # A missing status update keeps the claim non-retryable pending review.
        raise DeliveryUnavailable(RETRY_MESSAGE) from exc
    except Exception as exc:
        # A transport error can occur after SMTP accepted the message (for
        # example, while closing the connection). Do not authorize a resend.
        raise DeliveryUnavailable(
            f"Inquiry delivery needs operator review. Reference: {claim['request_id']}. Do not submit a new request."
        ) from exc

    try:
        result = await collection.update_one(
            {"_id": document_id, "status": "sending"},
            {"$set": {"status": "routed", "routed_at": datetime.now(timezone.utc)}, "$unset": {"lease_until": ""}},
        )
        if result.modified_count != 1:
            raise RuntimeError("Inquiry routing status was not saved.")
    except Exception as exc:
        raise DeliveryUnavailable(RETRY_MESSAGE) from exc
    return InquiryReceipt(request_id=claim["request_id"], submitted_at=claim["submitted_at"]), False
