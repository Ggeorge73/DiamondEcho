"""Submission limits for the public inquiry route (DE-9, DE-33).

The inquiry API must be reachable by any visitor's browser, so anyone who
finds its address can post to it. CORS does not stop that. These limits bound
how much one connection, and all connections together, can put in the staff
queue. They are a seatbelt, not a bouncer:

* Counts live in this process's memory. Cloud Run may run several instances,
  so the true ceiling is the per-instance figure times the number of
  instances. Keep ``--max-instances`` small.
* A sender who rotates addresses is held only by the per-instance cap, and can
  use that cap up so real visitors are told to call instead. Nothing is lost
  silently, but if that happens a challenge at the form is the next step.

Nothing here is logged, and addresses are kept only as a salted hash that
dies with the process.
"""
import hashlib
import ipaddress
import math
import os
import time
from collections import OrderedDict, deque
from threading import Lock

PER_ADDRESS_ENV = "INQUIRY_LIMIT_PER_ADDRESS"
PER_HOUR_ENV = "INQUIRY_LIMIT_PER_HOUR"
DEFAULT_PER_ADDRESS = 5
DEFAULT_PER_HOUR = 30
ADDRESS_WINDOW_SECONDS = 600
INSTANCE_WINDOW_SECONDS = 3600
MAX_SETTING = 1000
MAX_TRACKED_ADDRESSES = 2000


def _setting(name, default, environ=None):
    """A whole number from 1 to MAX_SETTING. Anything else falls back to the
    default, so a typing mistake can never switch the limit off."""
    raw = (os.environ if environ is None else environ).get(name, "")
    try:
        value = int(str(raw).strip())
    except ValueError:
        return default
    return value if 1 <= value <= MAX_SETTING else default


def limits(environ=None):
    return (_setting(PER_ADDRESS_ENV, DEFAULT_PER_ADDRESS, environ),
            _setting(PER_HOUR_ENV, DEFAULT_PER_HOUR, environ))


def client_address(request, environ=None):
    """The sender's address as the platform saw it.

    On Cloud Run the request arrives through Google's front end, which appends
    the address it received the connection from to ``X-Forwarded-For``. Entries
    to the left of that one are whatever the sender typed, so only the last
    entry is used. Off Cloud Run the header is ignored altogether.
    """
    if (os.environ if environ is None else environ).get("K_SERVICE"):
        entries = [part.strip() for part in request.headers.get("x-forwarded-for", "").split(",") if part.strip()]
        if entries:
            return entries[-1]
    return request.client.host if request.client else "unknown"


def _bucket(address):
    """One home network counts once: an IPv6 household holds a whole /64."""
    try:
        parsed = ipaddress.ip_address(address)
    except ValueError:
        return "other:" + address[:64]
    if parsed.version == 6:
        if parsed.ipv4_mapped is not None:
            return str(parsed.ipv4_mapped)
        return str(ipaddress.ip_network((parsed, 64), strict=False).network_address) + "/64"
    return str(parsed)


class SubmissionLimiter:
    """Sliding windows of admitted attempts. Refused attempts are not recorded,
    so a visitor who waits is let back in and memory stays bounded."""

    def __init__(self, clock=time.monotonic, max_tracked=MAX_TRACKED_ADDRESSES):
        self._clock = clock
        self._max_tracked = max_tracked
        self._salt = os.urandom(16)
        self._lock = Lock()
        self._addresses = OrderedDict()
        self._instance = deque()

    def _key(self, address):
        return hashlib.sha256(self._salt + _bucket(address).encode("utf-8", "replace")).digest()[:16]

    def check(self, address, per_address, per_hour):
        """Return ``(None, 0)`` and record the attempt, or ``(reason, seconds)``
        where reason is ``"address"`` or ``"instance"`` and seconds is how long
        until the oldest counted attempt leaves its window."""
        key = self._key(address)
        with self._lock:
            now = self._clock()
            while self._instance and now - self._instance[0] >= INSTANCE_WINDOW_SECONDS:
                self._instance.popleft()
            for stale in [k for k, seen in self._addresses.items() if not seen or now - seen[-1] >= ADDRESS_WINDOW_SECONDS]:
                del self._addresses[stale]
            seen = self._addresses.get(key)
            if seen is not None:
                while seen and now - seen[0] >= ADDRESS_WINDOW_SECONDS:
                    seen.popleft()
                if len(seen) >= per_address:
                    return "address", max(1, math.ceil(seen[0] + ADDRESS_WINDOW_SECONDS - now))
            if len(self._instance) >= per_hour:
                return "instance", max(1, math.ceil(self._instance[0] + INSTANCE_WINDOW_SECONDS - now))
            if seen is None:
                seen = self._addresses[key] = deque()
            seen.append(now)
            self._addresses.move_to_end(key)
            self._instance.append(now)
            while len(self._addresses) > self._max_tracked:
                self._addresses.popitem(last=False)
            return None, 0

    def reset(self):
        with self._lock:
            self._addresses.clear()
            self._instance.clear()


limiter = SubmissionLimiter()


def throttle(limiter, per_address, per_hour, message):
    """A route dependency that refuses a sender over these limits with a 429.

    For public routes that cost CPU time or paid provider quota rather than
    queue space. Each route family passes its own limiter so one cannot use up
    another's allowance.
    """
    from fastapi import HTTPException, Request

    def dependency(request: Request):
        reason, wait = limiter.check(client_address(request), per_address, per_hour)
        if reason:
            raise HTTPException(status_code=429, detail=message, headers={"Retry-After": str(wait)})

    return dependency
