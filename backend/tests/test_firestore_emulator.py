"""Real SDK transactions; only a local demo emulator may be targeted."""
import os
import sys
import uuid
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import pytest
from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from inquiries.firebase import FirestoreInquiryStore
from inquiries.models import InquiryCreate
from inquiries.service import submit_inquiry, acknowledge_inquiry, QueueUnavailable, IdempotencyConflict
pytestmark = pytest.mark.skipif(not os.getenv("FIRESTORE_EMULATOR_HOST"),reason="Firestore emulator is not running")

def test_real_create_replay_conflict_and_transaction():
    host=os.environ["FIRESTORE_EMULATOR_HOST"]
    assert host.startswith(("127.0.0.1:","localhost:")), "Only local emulator permitted"
    db=firestore.Client(project="demo-diamondecho",credentials=AnonymousCredentials())
    store=FirestoreInquiryStore(db)
    key=uuid.uuid4()
    inquiry=InquiryCreate(kind="buyer",full_name="Synthetic QA",email="qa@example.com",message="Emulator only",consent=True)
    def retry_same_submission(_):
        # Contention may safely return 503. Model the documented client retry contract,
        # keeping the SAME UUID and payload, never suppressing a permanent failure.
        for attempt in range(8):
            try:
                return submit_inquiry(store,inquiry,key)
            except QueueUnavailable:
                if attempt == 7:
                    raise
                time.sleep(0.1 * (attempt + 1))
    with ThreadPoolExecutor(max_workers=8) as pool:
        results=list(pool.map(retry_same_submission, range(12)))
    assert sum(not replay for _,replay in results)==1
    request_id=uuid.UUID(results[0][0].request_id)
    with pytest.raises(IdempotencyConflict):
        submit_inquiry(store,inquiry.model_copy(update={"message":"Different request"}),key)
    def retry_acknowledgement(_):
        for attempt in range(8):
            try:
                return acknowledge_inquiry(store,request_id,"staff-1")
            except QueueUnavailable:
                if attempt == 7:
                    raise
                time.sleep(0.1 * (attempt + 1))
    with ThreadPoolExecutor(max_workers=6) as pool:
        acknowledgements=list(pool.map(retry_acknowledgement,range(6)))
    assert len({r.acknowledged_at for r in acknowledgements})==1
    assert db.collection("inquiries").document(str(request_id)).get().to_dict()["acknowledged_by"]=="staff-1"
    assert any(r.request_id==str(request_id) for r in __import__("inquiries.service",fromlist=["list_staff_inquiries"]).list_staff_inquiries(store,100).items)
    # Delete only this test's synthetic demo document, never live visitor data.
    db.collection("inquiries").document(str(request_id)).delete()
    db.close()
