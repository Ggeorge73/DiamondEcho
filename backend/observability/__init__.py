"""Request telemetry for the API: one structured log line per problem request.

The container runs with uvicorn's access log off on purpose (backend/Dockerfile):
Cloud Run already records every request in its own request log, and the API
must not keep a second copy of what visitors send. This middleware adds only
what that request log cannot show:

* one JSON line, in the format Cloud Logging reads (severity, message, trace),
  for each server error (status 5xx or an unhandled exception) and for each
  request slower than a threshold, naming the route TEMPLATE
  ("/api/v1/inquiries/staff/{inquiry_id}"), never the address that was asked
  for;
* a Server-Timing header on every answer, so a browser or a monitor can see
  how long the API itself took, apart from the network.

What it never writes: the path as sent, query strings, request or response
bodies, headers, cookies, addresses, user agents, exception messages or
tracebacks. Any of those can hold something a visitor typed. Normal fast
requests write nothing.

It is plain ASGI with no dependency beyond the standard library. Wiring, in
backend/server.py, after the other middleware:

    from observability import RequestTelemetry
    app.add_middleware(RequestTelemetry)

Settings (environment):
    OBSERVABILITY_SLOW_MS   a request slower than this is logged (default 1000,
                            the API latency threshold in scripts/sre/slo.config.mjs)
    GOOGLE_CLOUD_PROJECT    the project id; when set, log lines carry the
                            request's trace so Cloud Logging groups them with
                            Cloud Run's own request log entry

docs/sre/observability.md explains how these lines are used.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from typing import Any, Awaitable, Callable

__all__ = ["RequestTelemetry", "trace_fields", "route_template", "DEFAULT_SLOW_MS"]

DEFAULT_SLOW_MS = 1000.0
SLOW_ENV = "OBSERVABILITY_SLOW_MS"
PROJECT_ENVS = ("GOOGLE_CLOUD_PROJECT", "GCP_PROJECT")
UNMATCHED = "(no matching route)"

# X-Cloud-Trace-Context: TRACE_ID/SPAN_ID;o=1 (trace 32 hex, span decimal).
CLOUD_TRACE = re.compile(r"^([0-9a-f]{32})(?:/([0-9]{1,20}))?(?:;o=([01]))?$")
# traceparent (W3C): 00-TRACE_ID-SPAN_ID-FLAGS.
TRACEPARENT = re.compile(r"^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$")
PROJECT_ID = re.compile(r"^[a-z][a-z0-9-]{4,28}[a-z0-9]$")
METHODS = {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}


def _header(scope: dict, name: bytes) -> str:
    for key, value in scope.get("headers") or ():
        if key.lower() == name:
            try:
                return value.decode("latin-1").strip()
            except Exception:  # pragma: no cover - bytes always decode as latin-1
                return ""
    return ""


def trace_fields(scope: dict, project_id: str | None) -> dict[str, Any]:
    """The Cloud Logging trace fields for this request, or {}.

    Only well-formed ids are used: the header comes from Google's front end,
    but anyone can send one, so nothing free-form ever reaches the log.
    """
    if not project_id or not PROJECT_ID.match(project_id):
        return {}
    trace = span = None
    sampled = None
    match = CLOUD_TRACE.match(_header(scope, b"x-cloud-trace-context").lower())
    if match:
        trace = match.group(1)
        if match.group(2):
            number = int(match.group(2))
            if 0 < number < 2**64:
                span = f"{number:016x}"
        if match.group(3):
            sampled = match.group(3) == "1"
    else:
        match = TRACEPARENT.match(_header(scope, b"traceparent").lower())
        if match:
            trace, span = match.group(1), match.group(2)
            sampled = bool(int(match.group(3), 16) & 1)
    if not trace or trace == "0" * 32:
        return {}
    fields: dict[str, Any] = {"logging.googleapis.com/trace": f"projects/{project_id}/traces/{trace}"}
    if span and span != "0" * 16:
        fields["logging.googleapis.com/spanId"] = span
    if sampled is not None:
        fields["logging.googleapis.com/trace_sampled"] = sampled
    return fields


def route_template(scope: dict) -> str:
    """The matched route's template, never the path as sent."""
    route = scope.get("route")
    path = getattr(route, "path", None)
    if isinstance(path, str) and path.startswith("/") and len(path) <= 200:
        return path
    return UNMATCHED


def _write_stdout(entry: dict) -> None:
    # Cloud Run sends each stdout line to Cloud Logging; a JSON line becomes a
    # structured entry with its severity and trace understood.
    sys.stdout.write(json.dumps(entry, separators=(",", ":"), sort_keys=True) + "\n")
    sys.stdout.flush()


def _slow_ms_from_env() -> float:
    raw = os.environ.get(SLOW_ENV, "").strip()
    try:
        value = float(raw) if raw else DEFAULT_SLOW_MS
    except ValueError:
        return DEFAULT_SLOW_MS
    return value if value > 0 else DEFAULT_SLOW_MS


def _project_from_env() -> str | None:
    for name in PROJECT_ENVS:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return None


class RequestTelemetry:
    """ASGI middleware. See the module text for what it writes and why."""

    def __init__(
        self,
        app: Callable[..., Awaitable[None]],
        *,
        slow_ms: float | None = None,
        project_id: str | None = None,
        write: Callable[[dict], None] = _write_stdout,
        clock: Callable[[], float] = time.perf_counter,
    ) -> None:
        self.app = app
        self.slow_ms = float(slow_ms) if slow_ms is not None else _slow_ms_from_env()
        self.project_id = project_id if project_id is not None else _project_from_env()
        self.write = write
        self.clock = clock

    async def __call__(self, scope: dict, receive: Callable, send: Callable) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        started = self.clock()
        status: int | None = None

        async def send_with_timing(message: dict) -> None:
            nonlocal status
            if message.get("type") == "http.response.start":
                status = int(message.get("status", 0))
                elapsed = (self.clock() - started) * 1000.0
                headers = [pair for pair in message.get("headers") or [] if pair[0].lower() != b"server-timing"]
                headers.append((b"server-timing", f"app;dur={elapsed:.1f}".encode("latin-1")))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_with_timing)
        except BaseException as error:
            # Recorded, then passed on unchanged: the server's own error
            # handling still answers 500. Only the error's type is written;
            # its message can quote what a visitor sent.
            if isinstance(error, Exception):
                self._record(scope, status or 500, started, error=type(error).__name__)
            raise
        else:
            self._record(scope, status, started)

    def _record(self, scope: dict, status: int | None, started: float, error: str | None = None) -> None:
        duration = (self.clock() - started) * 1000.0
        server_error = error is not None or (status is not None and status >= 500)
        slow = duration >= self.slow_ms
        if not server_error and not slow:
            return
        method = str(scope.get("method", "")).upper()
        method = method if method in METHODS else "OTHER"
        route = route_template(scope)
        if server_error:
            event, severity = "request.error", "ERROR"
            what = f"unhandled {error}" if error else f"status {status}"
            message = f"API server error ({what}) on {method} {route}"
        else:
            event, severity = "request.slow", "WARNING"
            message = f"Slow API request ({duration:.0f} ms) on {method} {route}"
        entry: dict[str, Any] = {
            "severity": severity,
            "message": message,
            "event": event,
            "method": method,
            "route": route,
            "status": status if status is not None else 500,
            "duration_ms": round(duration, 1),
            "slow_threshold_ms": self.slow_ms,
        }
        if error:
            entry["error"] = error
        entry.update(trace_fields(scope, self.project_id))
        try:
            self.write(entry)
        except Exception:  # pragma: no cover - logging must never break a request
            pass
