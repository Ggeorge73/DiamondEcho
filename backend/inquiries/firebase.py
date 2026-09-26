"""Firebase Admin uses Cloud Run ADC, never client-supplied credentials."""
import os
import re
from functools import lru_cache
from threading import Lock
from urllib.parse import urlparse
import firebase_admin
from firebase_admin import auth, firestore
from google.api_core.exceptions import AlreadyExists
from .service import QueueUnavailable, StaffUnauthorized, StaffForbidden

def queue_settings():
    project = os.getenv("FIREBASE_PROJECT_ID", "").strip()
    uids = frozenset(v.strip() for v in os.getenv("INQUIRY_STAFF_UIDS", "").split(",") if v.strip())
    public = os.getenv("PUBLIC_ORIGIN", "").strip()
    staff = os.getenv("STAFF_ORIGIN", "").strip()
    def valid_origin(value):
        url = urlparse(value)
        return url.scheme == "https" and bool(url.hostname) and not (
            url.username or url.password or url.query or url.fragment or url.path not in ("", "/")
        ) and not value.endswith("/") and not url.hostname.endswith(".invalid")
    if (os.getenv("INQUIRY_STAFF_QUEUE_ENABLED", "").lower() != "true"
        or not re.fullmatch(r"[a-z][a-z0-9-]{4,62}", project) or not uids
        or not valid_origin(public) or not valid_origin(staff) or public == staff):
        raise QueueUnavailable("Inquiry queue is not configured.")
    # Emulator tokens are unsigned. Never accept emulator configuration in Cloud Run.
    if os.getenv("K_SERVICE") and any(os.getenv(k) for k in ("FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST")):
        raise QueueUnavailable("Emulator configuration is forbidden in Cloud Run.")
    return project, uids, public, staff

_app_lock = Lock()

@lru_cache(maxsize=4)
def firebase_app(project):
    # Named app avoids interference with other modules; ADC comes from attached service identity.
    with _app_lock:
        try:
            return firebase_admin.get_app("diamondecho-" + project)
        except ValueError:
            return firebase_admin.initialize_app(options={"projectId": project}, name="diamondecho-" + project)

def verify_staff(authorization, verifier=None):
    project, allowed, _, _ = queue_settings()
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token or len(token) > 16384:
        raise StaffUnauthorized()
    try:
        decoded = (verifier or (lambda value: auth.verify_id_token(
            value, app=firebase_app(project), check_revoked=True
        )))(token)
    except (auth.InvalidIdTokenError, auth.ExpiredIdTokenError, auth.RevokedIdTokenError, auth.UserDisabledError, ValueError) as exc:
        raise StaffUnauthorized() from exc
    except Exception as exc:
        raise QueueUnavailable("Staff identity verification is temporarily unavailable.") from exc
    if (decoded.get("uid") not in allowed or decoded.get("email_verified") is not True
        or decoded.get("firebase", {}).get("sign_in_second_factor") != "totp"):
        raise StaffForbidden()
    return decoded["uid"]

class FirestoreInquiryStore:
    def __init__(self, db):
        self.db = db
        self.collection = db.collection("inquiries")

    def create_once(self, request_id, document):
        reference = self.collection.document(request_id)
        try:
            result = reference.create(document, timeout=5)
            if result is None or result.update_time is None:
                raise RuntimeError("No confirmed Firestore write")
            return document, False
        except AlreadyExists:
            snapshot = reference.get(timeout=5)
            if not snapshot.exists:
                raise RuntimeError("Replay record unavailable")
            return snapshot.to_dict(), True

    def list_newest(self, limit):
        query = self.collection.order_by("submitted_at", direction=firestore.Query.DESCENDING).limit(limit)
        return [snapshot.to_dict() for snapshot in query.stream(timeout=5)]

    def acknowledge(self, request_id, account, timestamp):
        reference = self.collection.document(request_id)
        @firestore.transactional
        def update(transaction):
            snapshot = reference.get(transaction=transaction, timeout=5)
            if not snapshot.exists:
                return None
            document = snapshot.to_dict()
            if document["status"] == "queued":
                changes = {"status": "acknowledged", "acknowledged_at": timestamp, "acknowledged_by": account}
                transaction.update(reference, changes)
                document.update(changes)
            return document
        return update(self.db.transaction(max_attempts=5))

@lru_cache(maxsize=4)
def _store(project):
    return FirestoreInquiryStore(firestore.client(app=firebase_app(project)))

def get_store():
    project, _, _, _ = queue_settings()
    try:
        return _store(project)
    except Exception as exc:
        raise QueueUnavailable("Inquiry queue is temporarily unavailable.") from exc
