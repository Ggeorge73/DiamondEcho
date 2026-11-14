"""What every request must pass before a route sees it, and how the API says no.

Three parts, all wired in backend/server.py by ``install(app)``:

* ``RequestLimits`` (ASGI middleware). Refuses, before anything is parsed:
  an address longer than MAX_URL_BYTES (414), a body larger than the route's
  limit (413, from Content-Length when it is sent and from the bytes actually
  received when it is not), a Content-Length that is not a number (400) and a
  body that is not JSON (415). Every route of this API that takes a body takes
  JSON; uploads go straight from the staff browser to Cloud Storage.
* ``reject_unknown_query`` (a dependency of the whole app). A query parameter
  the route does not declare is refused with 422 instead of being ignored.
* The error answers. Every refusal is ``{"detail": ...}``: a sentence, or for
  a field problem a list of ``{"type", "loc", "msg"}``. FastAPI's own 422
  also carries ``input`` (what was sent), ``ctx`` and ``url``; those are
  dropped, because what was sent can be a visitor's name, email or message,
  and echoing a bare NaN made the answer itself fail (W3 in
  docs/sre/chaos-and-game-days.md). A name the API does not know is never
  repeated either. An error nothing else handled is a plain 500 with no
  detail of what went wrong.

Nothing here writes a log line. The request telemetry (backend/observability)
stays the outermost layer and still sees every status and unhandled error.
"""
from __future__ import annotations

import inspect
import json
import re
import typing
from enum import Enum

from fastapi import FastAPI, Request
from fastapi import params as fastapi_params
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel

__all__ = ["RequestLimits", "install", "reject_unknown_query", "validation_detail",
           "DEFAULT_BODY_BYTES", "BODY_BYTES", "MAX_URL_BYTES", "MAX_ERRORS"]

# The largest body any route accepts. The biggest request the site sends that
# is not the assistant is a land deal for /api/v1/deals/analyze (about 2 kB);
# a Monte Carlo request with every scenario and driver is under 8 kB and an
# inquiry with a 2,000 character message in a four-byte script is under 10 kB.
DEFAULT_BODY_BYTES = 64 * 1024
# The assistant takes a 6,000 character message and up to 12 earlier messages
# of 6,000 characters each (ai/models.py): 78,000 characters, four bytes each
# at most in UTF-8, plus the JSON around them.
BODY_BYTES = {"/api/assistant/chat": 320 * 1024}
# Path and query string together. The longest address the site asks for is a
# property lookup: a 240 character address, percent-encoded (nine bytes for a
# four-byte character at worst), stays under this.
MAX_URL_BYTES = 4096
# Field problems listed in one answer. A form has at most a dozen fields; a
# body of thousands of unknown names must not get an answer larger than itself.
MAX_ERRORS = 25
MAX_REASON_CHARS = 200
BODY_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
JSON_TYPE = re.compile(r"application/(?:[a-z0-9!#$&^_.+-]+\+)?json", re.IGNORECASE)
UNKNOWN_NAME = "(unknown field)"

TOO_LARGE = "The request is larger than this service accepts."
TOO_LONG = "The request address is longer than this service accepts."
NOT_JSON = "This service accepts JSON only. Send the body with Content-Type: application/json."
BAD_LENGTH = "The Content-Length header is not a number."
SERVER_ERROR = "The service could not complete the request."


def _refusal(status: int, detail: str) -> JSONResponse:
    return JSONResponse({"detail": detail}, status_code=status, headers={"Cache-Control": "no-store"})


class RequestLimits:
    """Size and content-type limits, applied before the body is parsed."""

    def __init__(self, app, default_bytes: int = DEFAULT_BODY_BYTES, per_path: dict | None = None,
                 max_url_bytes: int = MAX_URL_BYTES) -> None:
        self.app = app
        self.default_bytes = default_bytes
        self.per_path = dict(BODY_BYTES if per_path is None else per_path)
        self.max_url_bytes = max_url_bytes

    def limit_for(self, path: str) -> int:
        return self.per_path.get(path.rstrip("/") or "/", self.default_bytes)

    async def __call__(self, scope, receive, send) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        path = scope.get("path") or ""
        raw_path = scope.get("raw_path") or path.encode("utf-8", "replace")
        if len(raw_path) + len(scope.get("query_string") or b"") > self.max_url_bytes:
            await _refusal(414, TOO_LONG)(scope, receive, send)
            return

        headers = [(name.lower(), value) for name, value in scope.get("headers") or ()]
        lengths = [value.strip() for name, value in headers if name == b"content-length"]
        declared = None
        if lengths:
            if len(set(lengths)) != 1 or not lengths[0].isdigit() or len(lengths[0]) > 18:
                await _refusal(400, BAD_LENGTH)(scope, receive, send)
                return
            declared = int(lengths[0])
        limit = self.limit_for(path)
        if declared is not None and declared > limit:
            await _refusal(413, TOO_LARGE)(scope, receive, send)
            return
        if str(scope.get("method", "")).upper() not in BODY_METHODS:
            await self.app(scope, receive, send)
            return

        # Read the whole body here, counting it, so a body sent in pieces with
        # no Content-Length is held to the same limit. At most `limit` bytes
        # are ever kept.
        chunks, size = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            if message["type"] != "http.request":
                continue
            chunk = message.get("body") or b""
            size += len(chunk)
            if size > limit:
                await _refusal(413, TOO_LARGE)(scope, receive, send)
                return
            chunks.append(chunk)
            if not message.get("more_body"):
                break
        body = b"".join(chunks)
        if body:
            content_type = next((value for name, value in headers if name == b"content-type"), b"")
            media_type = content_type.decode("latin-1").split(";", 1)[0].strip()
            if not JSON_TYPE.fullmatch(media_type):
                await _refusal(415, NOT_JSON)(scope, receive, send)
                return

        delivered = False

        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, replay, send)


# ---------------------------------------------------------------------------
# Query parameters a route does not declare.
# ---------------------------------------------------------------------------

# The liveness routes read nothing, and a probe that adds a query string to
# them must still be told the process is up: a 422 there would read as an outage.
LIVENESS_PATHS = frozenset({"/health", "/healthz"})
_QUERY_NAMES: dict = {}


def _declared_query(endpoint) -> frozenset:
    """The query parameters a route function declares with ``Query(...)``."""
    if endpoint not in _QUERY_NAMES:
        names = set()
        for name, parameter in inspect.signature(endpoint).parameters.items():
            if isinstance(parameter.default, fastapi_params.Query):
                names.add(parameter.default.alias or name)
        _QUERY_NAMES[endpoint] = frozenset(names)
    return _QUERY_NAMES[endpoint]


def route_functions(app: FastAPI) -> list:
    """(path, methods, function) of every API route, included routers too."""
    try:
        from fastapi.routing import iter_route_contexts
        found = list(iter_route_contexts(app.routes))
    except ImportError:  # an older FastAPI keeps every route in app.routes
        found = [route for route in app.routes if isinstance(route, APIRoute)]
    return [(route.path, sorted(route.methods or ()), route.endpoint) for route in found
            if callable(getattr(route, "endpoint", None)) and getattr(route, "path", None)]


def reject_unknown_query(request: Request) -> None:
    """Refuse a query parameter the matched route does not declare.

    Every query parameter of this API is declared with ``Query(...)`` in its
    route's signature (tests/test_input_hardening.py checks that against the
    route description FastAPI builds), so the signature is the list.
    """
    if not request.query_params or request.url.path in LIVENESS_PATHS:
        return
    endpoint = request.scope.get("endpoint") or getattr(request.scope.get("route"), "endpoint", None)
    # Not knowing the route must refuse, not allow.
    allowed = _declared_query(endpoint) if callable(endpoint) else frozenset()
    if any(name not in allowed for name in request.query_params.keys()):
        raise RequestValidationError([{"type": "extra_forbidden", "loc": ("query",),
                                       "msg": "Extra inputs are not permitted", "input": None}])


# ---------------------------------------------------------------------------
# The 422 answer: which field and a short reason, never what was sent.
# ---------------------------------------------------------------------------

def _collect_names(app: FastAPI, extra=()) -> frozenset:
    """Every name the API itself uses in a field location: parameters, model
    fields and the values of its closed sets. Anything else in a location was
    typed by the sender."""
    names = {"body", "query", "path", "header", "cookie", "[key]", "authorization", "x-idempotency-key"}
    names.update(extra)
    seen = set()

    def walk(annotation) -> None:
        if id(annotation) in seen:
            return
        seen.add(id(annotation))
        for inner in typing.get_args(annotation):
            walk(inner)
        if not isinstance(annotation, type):
            return
        if issubclass(annotation, BaseModel):
            for name, field in annotation.model_fields.items():
                names.add(name)
                if field.alias:
                    names.add(field.alias)
                walk(field.annotation)
        elif issubclass(annotation, Enum):
            names.update(str(member.value) for member in annotation)

    for _, _, endpoint in route_functions(app):
        try:
            hints = typing.get_type_hints(endpoint)
        except Exception:  # pragma: no cover - an annotation that cannot be resolved names nothing
            hints = {}
        for name, parameter in inspect.signature(endpoint).parameters.items():
            names.update({name, name.replace("_", "-")})
            alias = getattr(parameter.default, "alias", None)
            if isinstance(alias, str):
                names.add(alias)
            walk(hints.get(name, parameter.annotation))
    return frozenset(names)


def _reason(error: dict) -> str:
    kind = str(error.get("type", ""))
    message = str(error.get("msg", "")) or "Invalid value."
    context = error.get("ctx") if isinstance(error.get("ctx"), dict) else {}
    if kind == "value_error":
        # Either one of this service's own fixed sentences, or the email
        # checker's, which goes on to quote characters of the address.
        if "valid email address" in message:
            message = "value is not a valid email address"
    elif kind == "string_pattern_mismatch":
        # Pydantic's sentence prints the whole pattern.
        message = "The value has characters or a form this field does not accept."
    elif kind != "json_invalid" and "error" in context:
        # "Input should be a valid UUID, invalid character: ... found `k` at 1":
        # the part after the comma describes what was sent.
        message = message.split(",", 1)[0]
    sent = error.get("input")
    if isinstance(sent, (str, bytes)) and len(sent) >= 3:
        text = sent.decode("utf-8", "replace") if isinstance(sent, bytes) else sent
        if text in message:
            message = "Invalid value."
    return message[:MAX_REASON_CHARS]


def validation_detail(errors, known: frozenset) -> list:
    """The list for ``detail``: type, location and reason of each problem."""
    detail = []
    for error in list(errors)[:MAX_ERRORS]:
        location = []
        for part in tuple(error.get("loc") or ())[:12]:
            if isinstance(part, bool) or not isinstance(part, (int, str)):
                location.append(UNKNOWN_NAME)
            elif isinstance(part, int) or part in known:
                location.append(part)
            else:
                location.append(UNKNOWN_NAME)
        detail.append({"type": str(error.get("type", "invalid"))[:64], "loc": location, "msg": _reason(error)})
    return detail


def install(app: FastAPI, field_names=()) -> None:
    """Register the error answers on `app`.

    The middleware and the query check are added separately in server.py: the
    middleware because its place among the other layers matters there, the
    query check as a dependency of the whole app (`FastAPI(dependencies=...)`).
    `field_names` are names that appear in field locations but in no model
    (the keys of the assistant calculator's `inputs`).
    """
    known: dict = {}

    def names() -> frozenset:
        if "names" not in known:
            known["names"] = _collect_names(app, field_names)
        return known["names"]

    async def invalid_request(request: Request, exc: RequestValidationError) -> JSONResponse:
        try:
            detail = validation_detail(exc.errors(), names())
            json.dumps(detail, allow_nan=False)
        except Exception:
            detail = [{"type": "invalid", "loc": ["body"], "msg": "Invalid request."}]
        return JSONResponse({"detail": detail}, status_code=422, headers={"Cache-Control": "no-store"})

    async def unhandled(request: Request, exc: Exception) -> JSONResponse:
        # Starlette passes the error on after this answer is sent, so the
        # request telemetry still records it (its type only).
        return JSONResponse({"detail": SERVER_ERROR}, status_code=500, headers={"Cache-Control": "no-store"})

    app.add_exception_handler(RequestValidationError, invalid_request)
    app.add_exception_handler(Exception, unhandled)
