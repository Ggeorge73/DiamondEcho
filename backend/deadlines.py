"""How long the API waits for Google's services, retries included.

Cloud Run ends a request after 30 seconds (docs/de13-production-setup.md) and
each instance runs one worker, so every call to a Google service must give up
well inside that and let the route answer its documented 503.

A per-attempt `timeout=` does not do that on its own. The client libraries
retry a failed call with their own policy, and google-api-core gives a retry
the full timeout again once less than a second of it is left. By default
Firestore retries reads for up to 300 s and writes for up to 60 s, and Cloud
Storage retries for up to 120 s. Every call therefore passes a `timeout=` for
one attempt and a `retry=` whose deadline covers all of them
(docs/sre/chaos-and-game-days.md, W1, W2 and W8).
"""
from google.api_core.retry import Retry

# Firestore. One attempt is bounded by the call's own timeout= (5 s, or 10 s
# for a list). Transient errors (UNAVAILABLE, INTERNAL, RESOURCE_EXHAUSTED)
# are retried until RETRY_SECONDS have passed; an attempt that timed out is
# not retried. A database that refuses is therefore reported after about
# RETRY_SECONDS, one that hangs after one attempt, and the very worst case is
# RETRY_SECONDS plus one attempt.
RETRY_SECONDS = 10
FIRESTORE_RETRY = Retry(timeout=RETRY_SECONDS)

# Cloud Storage (podcast uploads): one try, and all tries together.
STORAGE_SECONDS = 10

# The Firebase staff sign-in check (verify_id_token with check_revoked=True).
# The Firebase SDK retries a timed-out request once and may first fetch
# Google's public keys, so the worst case is about three times this.
IDENTITY_HTTP_SECONDS = 5
