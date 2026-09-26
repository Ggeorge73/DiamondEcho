import copy
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock
from types import SimpleNamespace
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from google.api_core.exceptions import AlreadyExists
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import inquiries.router as routes
from inquiries.firebase import verify_staff, queue_settings, FirestoreInquiryStore
from inquiries.models import InquiryCreate
from inquiries.service import submit_inquiry, QueueUnavailable, StaffUnauthorized, StaffForbidden
from firebase_admin import auth

@pytest.fixture(autouse=True)
def configured(monkeypatch):
    for name, value in {
        "INQUIRY_STAFF_QUEUE_ENABLED": "true", "FIREBASE_PROJECT_ID": "demo-diamondecho",
        "INQUIRY_STAFF_UIDS": "staff-1", "PUBLIC_ORIGIN": "https://public.example.com",
        "STAFF_ORIGIN": "https://staff.example.com"
    }.items():
        monkeypatch.setenv(name, value)
    monkeypatch.delenv("K_SERVICE", raising=False)

def claims(**changes):
    return dict(uid="staff-1", email_verified=True, firebase={"sign_in_second_factor": "totp"}, **changes) if not changes else {
        **claims(), **changes}

class Store:
    def __init__(self):
        self.documents = {}
        self.lock = Lock()
        self.fail = False
    def create_once(self, key, document):
        if self.fail: raise RuntimeError("private provider detail")
        with self.lock:
            replay = key in self.documents
            if not replay: self.documents[key] = copy.deepcopy(document)
            return copy.deepcopy(self.documents[key]), replay
    def list_newest(self, limit):
        if self.fail: raise RuntimeError("unavailable")
        return sorted(copy.deepcopy(list(self.documents.values())), key=lambda d:d["submitted_at"], reverse=True)[:limit]
    def acknowledge(self, key, account, timestamp):
        if self.fail: raise RuntimeError("unavailable")
        with self.lock:
            d = self.documents.get(key)
            if d is None: return None
            if d["status"] == "queued":
                d.update(status="acknowledged", acknowledged_at=timestamp, acknowledged_by=account)
            return copy.deepcopy(d)

@pytest.fixture
def client(monkeypatch):
    app = FastAPI()
    app.include_router(routes.router, prefix="/api")
    store = Store()
    monkeypatch.setattr(routes, "get_store", lambda: store)
    monkeypatch.setattr(routes, "verify_staff", lambda header: verify_staff(header, verifier=lambda token: claims() if token == "approved" else claims(uid="stranger")))
    with TestClient(app) as c:
        yield c, store

def payload(kind="buyer"):
    result = dict(kind=kind, full_name="Test Visitor", email="visitor@example.com", message="Please contact me", consent=True)
    if kind == "seller": result["property_address"] = "123 Test Road"
    if kind == "tour":
        result.update(property_id="test-listing", preferred_tour_time=(datetime.now(timezone.utc)+timedelta(days=2)).isoformat())
    return result

def post(client, body=None, key=None):
    return client.post("/api/v1/inquiries", json=body or payload(), headers={"X-Idempotency-Key": str(key or uuid.uuid4())})

@pytest.mark.parametrize("kind", ["buyer", "seller", "tour"])
def test_store_before_success(client, kind):
    c, store = client
    r = post(c, payload(kind))
    assert r.status_code == 201
    assert r.json()["status"] == "queued"
    assert len(store.documents) == 1
    assert r.headers["cache-control"] == "no-store"
    assert "email" not in r.json()
    assert next(iter(store.documents.values()))["consent_version"]

def test_replay_and_conflict(client):
    c, store = client
    key = uuid.uuid4()
    a, b = post(c, key=key), post(c, key=key)
    assert a.status_code == 201 and b.status_code == 200
    assert a.json() == b.json()
    changed = payload(); changed["message"] = "Changed"
    assert post(c, changed, key).status_code == 409
    assert len(store.documents) == 1

def test_failed_storage_is_not_success(client):
    c, store = client
    store.fail = True
    r = post(c)
    assert r.status_code == 503
    assert "private provider detail" not in r.text
    assert not store.documents

@pytest.mark.parametrize("change", [{"consent":False}, {"email":"invalid"}, {"message":""}, {"full_name":" "}, {"message":"x"*2001}])
def test_validation(client, change):
    c, _ = client
    assert post(c, {**payload(), **change}).status_code == 422

def test_invalid_submission_key(client):
    c, _ = client
    assert c.post("/api/v1/inquiries", json=payload()).status_code == 422

def test_staff_access_and_acknowledgement(client):
    c, store = client
    receipt = post(c).json()
    endpoint = "/api/v1/inquiries/staff"
    assert c.get(endpoint).status_code == 401
    assert c.get(endpoint, headers={"Authorization":"Bearer stranger"}).status_code == 403
    headers = {"Authorization":"Bearer approved"}
    r = c.get(endpoint, headers=headers)
    assert r.status_code == 200 and r.json()["items"][0]["email"] == "visitor@example.com"
    assert c.get(endpoint+"?limit=101", headers=headers).status_code == 422
    path = endpoint+"/"+receipt["request_id"]+"/acknowledge"
    a, b = c.patch(path, headers=headers), c.patch(path, headers=headers)
    assert a.status_code == 200 and a.json() == b.json()
    assert store.documents[receipt["request_id"]]["acknowledged_by"] == "staff-1"
    assert c.patch(endpoint+"/"+str(uuid.uuid4())+"/acknowledge", headers=headers).status_code == 404

@pytest.mark.parametrize("decoded", [claims(uid="other"), claims(email_verified=False), claims(firebase={}), claims(firebase={"sign_in_second_factor":"phone"})])
def test_identity_requires_named_verified_totp(decoded):
    with pytest.raises(StaffForbidden):
        verify_staff("Bearer token", verifier=lambda _: decoded)

@pytest.mark.parametrize("error", [auth.InvalidIdTokenError("bad"), auth.ExpiredIdTokenError("expired", None), auth.RevokedIdTokenError("revoked"), auth.UserDisabledError("disabled")])
def test_invalid_revoked_disabled_tokens(error):
    def fail(_): raise error
    with pytest.raises(StaffUnauthorized): verify_staff("Bearer token", verifier=fail)

def test_identity_outage_is_unavailable():
    def fail(_): raise RuntimeError("provider unavailable")
    with pytest.raises(QueueUnavailable): verify_staff("Bearer token", verifier=fail)

def test_sdk_verifies_token_and_revocation(monkeypatch):
    import inquiries.firebase as identity
    app = object()
    monkeypatch.setattr(identity, "firebase_app", lambda project: app)
    calls = []
    def verify(token, **kwargs):
        calls.append((token, kwargs))
        return claims()
    monkeypatch.setattr(auth, "verify_id_token", verify)
    assert verify_staff("Bearer signed-token") == "staff-1"
    assert calls == [("signed-token", {"app":app, "check_revoked":True})]

@pytest.mark.parametrize("name,value", [
    ("INQUIRY_STAFF_QUEUE_ENABLED","false"), ("FIREBASE_PROJECT_ID",""),
    ("INQUIRY_STAFF_UIDS",""), ("STAFF_ORIGIN","https://public.example.com"),
    ("PUBLIC_ORIGIN","http://public.example.com"), ("STAFF_ORIGIN","https://staff.example.com/path")
])
def test_configuration_fails_closed(monkeypatch,name,value):
    monkeypatch.setenv(name,value)
    with pytest.raises(QueueUnavailable): queue_settings()

def test_cloud_run_forbids_emulator(monkeypatch):
    monkeypatch.setenv("K_SERVICE","diamondecho-api")
    monkeypatch.setenv("FIREBASE_AUTH_EMULATOR_HOST","localhost:9099")
    with pytest.raises(QueueUnavailable): queue_settings()

def test_concurrent_submission_is_single_record():
    store, key, inquiry = Store(), uuid.uuid4(), InquiryCreate(**payload())
    with ThreadPoolExecutor(max_workers=8) as pool:
        receipts = list(pool.map(lambda _:submit_inquiry(store,inquiry,key), range(24)))
    assert len(store.documents) == 1
    assert sum(not replay for _,replay in receipts) == 1
    assert len({r.request_id for r,_ in receipts}) == 1

def test_firestore_create_requires_write_confirmation():
    ref = SimpleNamespace(create=lambda *a,**k:SimpleNamespace(update_time=None))
    store = FirestoreInquiryStore(SimpleNamespace(collection=lambda _:SimpleNamespace(document=lambda _:ref)))
    with pytest.raises(RuntimeError): store.create_once("key", {})

def test_firestore_already_exists_reads_original():
    def duplicate(*a,**k): raise AlreadyExists("exists")
    ref = SimpleNamespace(create=duplicate, get=lambda **k:SimpleNamespace(exists=True,to_dict=lambda:{"original":True}))
    store = FirestoreInquiryStore(SimpleNamespace(collection=lambda _:SimpleNamespace(document=lambda _:ref)))
    assert store.create_once("key", {}) == ({"original":True}, True)

def test_server_boot_and_origin_guard(monkeypatch):
    monkeypatch.delenv("MONGO_URL",raising=False)
    # A fresh interpreter avoids the tests/deal_intelligence package shadowing the runtime package.
    import subprocess
    script = """
import sys
sys.path.insert(0, sys.argv[1])
import server
from fastapi.testclient import TestClient
with TestClient(server.app) as c:
    assert c.get('/healthz').status_code == 200
    r = c.get('/api/v1/inquiries/staff', headers={'Origin':'https://public.example.com','Authorization':'Bearer token'})
    assert r.status_code == 403 and r.headers['cache-control'] == 'no-store'
    assert c.get('/api/status').status_code == 401
"""
    subprocess.run([sys.executable, "-c", script, str(Path(__file__).resolve().parents[1])], check=True)
