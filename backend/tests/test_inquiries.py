import asyncio
import copy
import hashlib
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
from inquiries.router import router  # noqa: E402
from inquiries.service import (  # noqa: E402
    IdempotencyConflict, QueueUnavailable, StaffUnauthorized, authorize_staff,
    submit_inquiry,
)


STAFF_KEY = "queue-test-key-" + "a" * 48


@pytest.fixture(autouse=True)
def configured_queue(monkeypatch):
    monkeypatch.setenv("INQUIRY_STAFF_QUEUE_ENABLED", "true")
    monkeypatch.setenv("INQUIRY_STAFF_ACCOUNT_NAME", "Gbenga")
    monkeypatch.setenv("INQUIRY_STAFF_ACCESS_KEY_SHA256", hashlib.sha256(STAFF_KEY.encode()).hexdigest())


class FakeCursor:
    def __init__(self, documents):
        self.documents = documents

    def sort(self, field, order):
        self.documents.sort(key=lambda document: document[field], reverse=order == -1)
        return self

    def limit(self, count):
        self.documents = self.documents[:count]
        return self

    async def to_list(self, length):
        return copy.deepcopy(self.documents[:length])


class FakeCollection:
    def __init__(self):
        self.documents = {}
        self.fail_insert = False
        self.fail_ack = False
        self.unacknowledged = False
        self.write_concern = None

    def with_options(self, write_concern):
        self.write_concern = write_concern
        return self

    async def insert_one(self, document):
        if self.fail_insert:
            raise RuntimeError("database unavailable")
        if document["_id"] in self.documents:
            raise DuplicateKeyError("duplicate")
        self.documents[document["_id"]] = copy.deepcopy(document)
        return SimpleNamespace(acknowledged=not self.unacknowledged)

    async def find_one(self, query):
        for document in self.documents.values():
            if all(document.get(key) == value for key, value in query.items()):
                return copy.deepcopy(document)
        return None

    def find(self, query):
        allowed = query["status"]["$in"]
        return FakeCursor([copy.deepcopy(d) for d in self.documents.values() if d["status"] in allowed])

    async def find_one_and_update(self, query, update, return_document=None):
        if self.fail_ack:
            raise RuntimeError("database unavailable")
        for document in self.documents.values():
            if all(document.get(key) == value for key, value in query.items()):
                document.update(update["$set"])
                return copy.deepcopy(document)
        return None


def buyer(**changes):
    fields = dict(kind="buyer", full_name="Test Buyer", email="buyer@example.com", message="Please contact me.", consent=True)
    fields.update(changes)
    return InquiryCreate(**fields)


def client_for(collection):
    app = FastAPI()
    app.state.db = SimpleNamespace(inquiries=collection)
    app.include_router(router, prefix="/api")
    return TestClient(app)


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
    assert buyer(kind="tour", property_id="listing-1", preferred_tour_time=future).property_id == "listing-1"


def test_majority_persistence_replay_and_conflict():
    collection = FakeCollection()
    key = uuid.uuid4()
    first, replay = asyncio.run(submit_inquiry(collection, buyer(), key))
    second, replay_again = asyncio.run(submit_inquiry(collection, buyer(), key))
    assert (replay, replay_again) == (False, True)
    assert first == second
    assert first.status == "queued"
    assert len(collection.documents) == 1
    assert collection.write_concern.document == {"w": "majority", "j": True, "wtimeout": 5000}
    saved = next(iter(collection.documents.values()))
    assert saved["consent_at"] and saved["consent_version"]
    with pytest.raises(IdempotencyConflict):
        asyncio.run(submit_inquiry(collection, buyer(message="Changed"), key))


def test_unconfigured_staff_access_fails_closed_before_storage(monkeypatch):
    monkeypatch.delenv("INQUIRY_STAFF_ACCESS_KEY_SHA256")
    collection = FakeCollection()
    with pytest.raises(QueueUnavailable):
        asyncio.run(submit_inquiry(collection, buyer(), uuid.uuid4()))
    assert not collection.documents


def test_storage_failure_or_unconfirmed_write_has_no_success_receipt():
    collection = FakeCollection()
    collection.fail_insert = True
    with pytest.raises(QueueUnavailable):
        asyncio.run(submit_inquiry(collection, buyer(), uuid.uuid4()))
    collection.fail_insert = False
    collection.unacknowledged = True
    key = uuid.uuid4()
    with pytest.raises(QueueUnavailable):
        asyncio.run(submit_inquiry(collection, buyer(), key))
    collection.unacknowledged = False
    receipt, replay = asyncio.run(submit_inquiry(collection, buyer(), key))
    assert replay is True and receipt.status == "queued"
    assert len(collection.documents) == 1


def test_staff_authentication_rejects_missing_short_and_wrong_key(monkeypatch):
    for token in (None, "", "Bearer short", "Bearer " + "z" * 64, "Basic " + STAFF_KEY):
        with pytest.raises(StaffUnauthorized):
            authorize_staff(token)
    assert authorize_staff("Bearer " + STAFF_KEY) == "Gbenga"
    monkeypatch.setenv("INQUIRY_STAFF_QUEUE_ENABLED", "false")
    with pytest.raises(QueueUnavailable):
        authorize_staff("Bearer " + STAFF_KEY)


def test_http_public_staff_list_and_acknowledge():
    collection = FakeCollection()
    client = client_for(collection)
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
    assert first.json()["status"] == "queued"
    assert changed.status_code == 409
    assert invalid.status_code == 422
    assert len(collection.documents) == 1

    staff_url = "/api/v1/inquiries/staff"
    assert client.get(staff_url).status_code == 401
    assert client.get(staff_url, headers={"Authorization": "Bearer " + "z" * 64}).status_code == 401
    staff_headers = {"Authorization": "Bearer " + STAFF_KEY}
    listed = client.get(staff_url, headers=staff_headers)
    assert listed.status_code == 200
    assert listed.headers["cache-control"] == "no-store"
    item = listed.json()["items"][0]
    assert item["request_id"] == first.json()["request_id"]
    assert item["email"] == payload["email"]
    assert item["status"] == "queued"
    assert "payload_hash" not in item and "_id" not in item
    ack_url = f"{staff_url}/{item['request_id']}/acknowledge"
    assert client.patch(ack_url).status_code == 401
    ack = client.patch(ack_url, headers=staff_headers)
    repeat_ack = client.patch(ack_url, headers=staff_headers)
    assert ack.status_code == repeat_ack.status_code == 200
    assert ack.headers["cache-control"] == "no-store"
    assert ack.json() == repeat_ack.json()
    assert ack.json()["status"] == "acknowledged"
    assert client.get(staff_url, headers=staff_headers).json()["items"][0]["status"] == "acknowledged"
    assert client.post("/api/v1/inquiries", headers=headers, json=payload).json()["status"] == "queued"


def test_staff_route_disabled_and_missing_record(monkeypatch):
    client = client_for(FakeCollection())
    headers = {"Authorization": "Bearer " + STAFF_KEY}
    missing = client.patch(f"/api/v1/inquiries/staff/{uuid.uuid4()}/acknowledge", headers=headers)
    assert missing.status_code == 404
    monkeypatch.delenv("INQUIRY_STAFF_ACCOUNT_NAME")
    assert client.get("/api/v1/inquiries/staff", headers=headers).status_code == 503
    response = client.post(
        "/api/v1/inquiries", headers={"X-Idempotency-Key": str(uuid.uuid4())},
        json=buyer().model_dump(mode="json"),
    )
    assert response.status_code == 503
    assert "request_id" not in response.json()


def test_acknowledgement_database_failure_is_not_success():
    collection = FakeCollection()
    client = client_for(collection)
    public = client.post(
        "/api/v1/inquiries", headers={"X-Idempotency-Key": str(uuid.uuid4())},
        json=buyer().model_dump(mode="json"),
    )
    collection.fail_ack = True
    response = client.patch(
        f"/api/v1/inquiries/staff/{public.json()['request_id']}/acknowledge",
        headers={"Authorization": "Bearer " + STAFF_KEY},
    )
    assert response.status_code == 503
    assert next(iter(collection.documents.values()))["status"] == "queued"
