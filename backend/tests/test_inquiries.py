import asyncio
import copy
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from pymongo.errors import DuplicateKeyError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from inquiries.models import InquiryCreate  # noqa: E402
from inquiries.service import (  # noqa: E402
    DeliveryUnavailable, IdempotencyConflict, _send_smtp, submit_inquiry,
)


class FakeCollection:
    def __init__(self):
        self.documents = {}
        self.fail_insert = False
        self.fail_routed_update = False

    async def insert_one(self, document):
        if self.fail_insert:
            raise RuntimeError("database unavailable")
        if document["_id"] in self.documents:
            raise DuplicateKeyError("duplicate")
        self.documents[document["_id"]] = copy.deepcopy(document)

    async def find_one(self, query):
        return copy.deepcopy(self.documents.get(query["_id"]))

    async def find_one_and_update(self, query, update, return_document=None):
        document = self.documents.get(query["_id"])
        if document is None:
            return None
        eligible = document["status"] in query["status"]["$in"]
        if not eligible:
            return None
        document.update(update["$set"])
        document["attempts"] += update["$inc"]["attempts"]
        return copy.deepcopy(document)

    async def update_one(self, query, update):
        if self.fail_routed_update and update["$set"].get("status") == "routed":
            raise RuntimeError("database update unavailable")
        document = self.documents.get(query["_id"])
        if document is None or document["status"] != query["status"]:
            return type("Result", (), {"modified_count": 0})()
        document.update(update["$set"])
        for key in update.get("$unset", {}):
            document.pop(key, None)
        return type("Result", (), {"modified_count": 1})()


def buyer(**changes):
    fields = dict(kind="buyer", full_name="Test Buyer", email="buyer@example.com", message="Please contact me.", consent=True)
    fields.update(changes)
    return InquiryCreate(**fields)


@pytest.mark.parametrize("fields", [
    {"consent": False}, {"message": "  "}, {"email": "invalid"}, {"full_name": " "},
])
def test_buyer_rejects_invalid_required_fields(fields):
    with pytest.raises(ValidationError):
        buyer(**fields)


def test_seller_needs_address_and_details():
    with pytest.raises(ValidationError):
        buyer(kind="seller", property_address="", message="Please consult")
    with pytest.raises(ValidationError):
        buyer(kind="seller", property_address="1 Main St", message="")


def test_tour_needs_listing_and_timezone_aware_time():
    future = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
    past = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
    with pytest.raises(ValidationError):
        buyer(kind="tour", preferred_tour_time=future)
    with pytest.raises(ValidationError):
        buyer(kind="tour", property_id="listing-1", preferred_tour_time="2026-10-01T12:00:00")
    with pytest.raises(ValidationError):
        buyer(kind="tour", property_id="listing-1", preferred_tour_time=past)
    valid = buyer(kind="tour", property_id="listing-1", preferred_tour_time=future)
    assert valid.property_id == "listing-1"


def test_one_persisted_record_and_no_repeat_delivery_for_same_key():
    collection = FakeCollection()
    key = uuid.uuid4()
    sent = []
    deliver = lambda document: sent.append(document["request_id"])
    first, replay = asyncio.run(submit_inquiry(collection, buyer(), key, deliver))
    second, replay_again = asyncio.run(submit_inquiry(collection, buyer(), key, deliver))
    assert (replay, replay_again) == (False, True)
    assert first == second
    assert first.status == "routed"
    assert len(collection.documents) == len(sent) == 1
    saved = next(iter(collection.documents.values()))
    assert saved["consent_at"] and saved["consent_version"]
    assert saved["attempts"] == 1


def test_changed_payload_with_same_key_is_conflict():
    collection = FakeCollection()
    key = uuid.uuid4()
    asyncio.run(submit_inquiry(collection, buyer(), key, lambda _: None))
    with pytest.raises(IdempotencyConflict):
        asyncio.run(submit_inquiry(collection, buyer(message="A different request"), key, lambda _: None))
    assert len(collection.documents) == 1


def test_delivery_failure_is_not_success_and_same_key_retries():
    collection = FakeCollection()
    key = uuid.uuid4()
    def fail(_):
        raise DeliveryUnavailable("configuration unavailable before sending")
    with pytest.raises(DeliveryUnavailable):
        asyncio.run(submit_inquiry(collection, buyer(), key, fail))
    saved = next(iter(collection.documents.values()))
    assert saved["status"] == "failed"
    receipt, replay = asyncio.run(submit_inquiry(collection, buyer(), key, lambda _: None))
    assert receipt.request_id == saved["request_id"]
    assert replay is False
    assert len(collection.documents) == 1
    assert saved["attempts"] == 2


def test_ambiguous_smtp_exception_after_acceptance_never_resends():
    collection = FakeCollection()
    key = uuid.uuid4()
    accepted = []
    def accepted_then_disconnect(document):
        accepted.append(document["request_id"])
        raise RuntimeError("connection failed after SMTP acceptance")
    with pytest.raises(DeliveryUnavailable, match="operator review"):
        asyncio.run(submit_inquiry(collection, buyer(), key, accepted_then_disconnect))
    with pytest.raises(DeliveryUnavailable):
        asyncio.run(submit_inquiry(collection, buyer(), key, accepted_then_disconnect))
    saved = next(iter(collection.documents.values()))
    assert saved["status"] == "sending"
    assert saved["attempts"] == 1
    assert accepted == [saved["request_id"]]


def test_unconfigured_recipient_fails_closed_without_smtp(monkeypatch):
    for name in (
        "INQUIRY_APPROVED_RECIPIENT_EMAIL", "INQUIRY_SMTP_FROM_EMAIL", "INQUIRY_SMTP_HOST",
        "INQUIRY_SMTP_USERNAME", "INQUIRY_SMTP_PASSWORD",
    ):
        monkeypatch.delenv(name, raising=False)
    collection = FakeCollection()
    with pytest.raises(DeliveryUnavailable):
        asyncio.run(submit_inquiry(collection, buyer(), uuid.uuid4(), _send_smtp))
    assert next(iter(collection.documents.values()))["status"] == "failed"


def test_storage_failure_does_not_attempt_delivery():
    collection = FakeCollection()
    collection.fail_insert = True
    sent = []
    with pytest.raises(DeliveryUnavailable):
        asyncio.run(submit_inquiry(collection, buyer(), uuid.uuid4(), lambda _: sent.append(1)))
    assert not sent


def test_ambiguous_post_send_update_does_not_blindly_resend():
    collection = FakeCollection()
    collection.fail_routed_update = True
    key = uuid.uuid4()
    sent = []
    deliver = lambda document: sent.append(document["request_id"])
    with pytest.raises(DeliveryUnavailable):
        asyncio.run(submit_inquiry(collection, buyer(), key, deliver))
    collection.fail_routed_update = False
    with pytest.raises(DeliveryUnavailable):
        asyncio.run(submit_inquiry(collection, buyer(), key, deliver))
    assert len(sent) == 1
    assert next(iter(collection.documents.values()))["status"] == "sending"


def test_http_receipt_replay_conflict_and_validation(monkeypatch):
    from inquiries.router import router

    sent = []
    monkeypatch.setattr("inquiries.service._send_smtp", lambda document: sent.append(document["request_id"]))
    app = FastAPI()
    app.state.db = SimpleNamespace(inquiries=FakeCollection())
    app.include_router(router, prefix="/api")
    client = TestClient(app)
    key = str(uuid.uuid4())
    headers = {"X-Idempotency-Key": key}
    payload = buyer().model_dump(mode="json")
    first = client.post("/api/v1/inquiries", headers=headers, json=payload)
    replay = client.post("/api/v1/inquiries", headers=headers, json=payload)
    changed = client.post("/api/v1/inquiries", headers=headers, json={**payload, "message": "Changed"})
    invalid = client.post("/api/v1/inquiries", headers={"X-Idempotency-Key": str(uuid.uuid4())}, json={**payload, "consent": False})
    assert first.status_code == 201
    assert replay.status_code == 200
    assert first.json() == replay.json()
    assert first.json()["status"] == "routed"
    assert changed.status_code == 409
    assert invalid.status_code == 422
    assert len(sent) == 1


def test_http_delivery_failure_has_no_success_receipt(monkeypatch):
    from inquiries.router import router

    def fail(_):
        raise RuntimeError("outage")

    monkeypatch.setattr("inquiries.service._send_smtp", fail)
    app = FastAPI()
    app.state.db = SimpleNamespace(inquiries=FakeCollection())
    app.include_router(router, prefix="/api")
    client = TestClient(app)
    response = client.post(
        "/api/v1/inquiries", headers={"X-Idempotency-Key": str(uuid.uuid4())},
        json=buyer().model_dump(mode="json"),
    )
    assert response.status_code == 503
    assert "request_id" not in response.json()
