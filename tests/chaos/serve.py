"""Start the real DiamondEcho API on this machine for a chaos experiment.

    python -I tests/chaos/serve.py --port 18080 [--memory-queue] [--clock-file F]

It runs `backend/server.py`'s app the way the Dockerfile does (uvicorn, one
worker, no access log), on 127.0.0.1 only, with three changes a chaos
experiment needs and production never has:

* Outbound connections are refused. Every socket connect to an address that
  is not this machine raises ConnectionRefusedError and prints one line,
  `chaos-guard: blocked outbound connection to HOST:PORT`, on stderr. An
  experiment can therefore never reach Firestore, Google sign-in, RentCast,
  Mapbox, FRED or the text-to-speech voice, and "every dependency is
  unreachable" is the honest truth, not a mock.
* `--memory-queue`: inquiries go to a list in memory, so the submission
  limits can be pushed without a database. Nothing leaves the process. The
  number stored so far is printed on stderr after each new inquiry
  (`chaos-memory-queue: stored N`); uvicorn ends on the signal it was sent,
  so nothing printed at exit could be relied on.
* `--clock-file F`: the submission limiters read their clock as the real
  monotonic clock plus the number of seconds written in F. The runner writes
  a number there to step the limiters forward in time (to check that waiting
  as long as Retry-After says really lets a sender back in) without waiting
  ten minutes. Only the limiters' clock moves; nothing else does.
* `--anonymous-credentials`: Firebase is given anonymous credentials instead
  of looking for a Google sign-in. Used with FIRESTORE_EMULATOR_HOST and
  FIREBASE_AUTH_EMULATOR_HOST pointing at a local port that accepts
  connections and never answers, so the database and sign-in calls really
  start and then hang, as they would on a slow day, without any account.

Run with `python -I` so nothing in this folder or the environment can shadow
the service's own modules.
"""
import argparse
import ipaddress
import os
import socket
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2] / "backend"


def loopback(address):
    host = address[0] if isinstance(address, tuple) else address
    if not isinstance(host, str):
        return False
    if host in ("localhost",):
        return True
    try:
        return ipaddress.ip_address(host.split("%")[0]).is_loopback
    except ValueError:
        return False  # a name: resolving it would already be a lookup outside


def install_guard():
    real_connect = socket.socket.connect
    real_connect_ex = socket.socket.connect_ex

    def refuse(address):
        where = f"{address[0]}:{address[1]}" if isinstance(address, tuple) and len(address) > 1 else str(address)
        print(f"chaos-guard: blocked outbound connection to {where}", file=sys.stderr, flush=True)
        raise ConnectionRefusedError(111, "chaos experiment: outbound connections are refused")

    def connect(self, address):
        if self.family in (socket.AF_INET, socket.AF_INET6) and not loopback(address):
            refuse(address)
        return real_connect(self, address)

    def connect_ex(self, address):
        if self.family in (socket.AF_INET, socket.AF_INET6) and not loopback(address):
            refuse(address)
        return real_connect_ex(self, address)

    def no_lookup(host, *args, **kwargs):
        if loopback((host,)):
            return real_getaddrinfo(host, *args, **kwargs)
        print(f"chaos-guard: blocked outbound connection to {host}:{args[0] if args else ''}", file=sys.stderr, flush=True)
        raise socket.gaierror(socket.EAI_NONAME, "chaos experiment: name lookups are refused")

    real_getaddrinfo = socket.getaddrinfo
    socket.socket.connect = connect
    socket.socket.connect_ex = connect_ex
    socket.getaddrinfo = no_lookup


def shifted_clock(path):
    def clock():
        try:
            offset = float(Path(path).read_text().strip() or 0)
        except (OSError, ValueError):
            offset = 0.0
        return time.monotonic() + offset
    return clock


class MemoryQueue:
    """The two calls a submission makes on the inquiry store, kept in memory."""

    def __init__(self):
        self.documents = {}

    def create_once(self, request_id, document):
        replay = request_id in self.documents
        self.documents.setdefault(request_id, document)
        if not replay:
            print(f"chaos-memory-queue: stored {len(self.documents)}", file=sys.stderr, flush=True)
        return self.documents[request_id], replay


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--memory-queue", action="store_true")
    parser.add_argument("--clock-file")
    parser.add_argument("--anonymous-credentials", action="store_true")
    args = parser.parse_args(argv)

    install_guard()
    sys.path.insert(0, str(BACKEND))
    os.chdir(BACKEND)
    import uvicorn
    import server
    import inquiries.router as inquiry_routes
    from inquiries import limits
    from deal_intelligence import router as deal_routes
    from property_data import router as property_routes

    if args.anonymous_credentials:
        from firebase_admin import credentials
        from google.auth.credentials import AnonymousCredentials
        credentials.ApplicationDefault.get_credential = lambda self: AnonymousCredentials()
    if args.memory_queue:
        queue = MemoryQueue()
        inquiry_routes.get_store = lambda: queue
    if args.clock_file:
        clock = shifted_clock(args.clock_file)
        for limiter in (limits.limiter, deal_routes.heavy_limiter, property_routes.lookup_limiter):
            limiter._clock = clock

    print(f"chaos-serve: pid {os.getpid()} on 127.0.0.1:{args.port}", file=sys.stderr, flush=True)
    # As the Dockerfile: one worker, no access log. Only this machine can reach it.
    uvicorn.run(server.app, host="127.0.0.1", port=args.port, workers=1, access_log=False, log_level="warning")


if __name__ == "__main__":
    main()
