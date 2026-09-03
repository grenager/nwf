"""Turning unhandled exceptions into something a person can act on.

Starlette renders an unhandled exception in ``ServerErrorMiddleware``, which
sits at the very outside of the stack -- outside ``CORSMiddleware``. So a 500
goes back to the browser with no ``Access-Control-Allow-Origin`` header, and
the browser reports a CORS violation instead of the error that actually
happened. The real failure is invisible from the client, and the console
points at the wrong thing entirely.

``UnhandledErrorMiddleware`` is mounted *inside* the CORS layer so the
response it produces gets the CORS headers on the way out. It also gives each
failure a short reference, logs that reference alongside the traceback, and
returns it to the caller -- so a screenshot of the browser console is enough
to find the exact request in the server log.

The body deliberately carries no exception detail. Messages routinely contain
SQL fragments, file paths and column names, and this API answers requests from
any browser; the reference is what crosses the boundary, and everything else
stays in the log.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from core.logging import get_logger

log = get_logger("api.error")

Sender = Callable[[Message], Awaitable[None]]


def _reference() -> str:
    """A short id that is easy to read off a screen and grep for in a log."""
    return uuid.uuid4().hex[:12]


class UnhandledErrorMiddleware:
    """Catch anything the routes let escape, log it, and answer with a 500.

    Mount this *before* ``CORSMiddleware`` in ``create_app`` -- Starlette
    prepends each ``add_middleware`` call, so adding this one first leaves it
    innermost, and the CORS layer wraps the error response it returns.

    Handled errors never reach here. ``HTTPException`` and request-validation
    failures are dealt with by the exception middleware further in, so this
    sees only genuine, unintended 500s.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(
        self, scope: Scope, receive: Receive, send: Send
    ) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        started = False

        async def _send(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, _send)
        except Exception as exc:
            reference: str = _reference()
            log.error(
                "api.unhandled",
                reference=reference,
                method=scope.get("method"),
                path=scope.get("path"),
                error_type=type(exc).__name__,
                error=str(exc),
                exc_info=exc,
            )
            if started:
                # The response is already on the wire, so it cannot be
                # replaced. Re-raise and let Starlette tear the connection
                # down -- but the log line above still carries the reference.
                raise
            payload: MutableMapping[str, Any] = {
                "detail": (
                    "Something went wrong on our end. If you report this, "
                    f"quote reference {reference}."
                ),
                "error_id": reference,
            }
            response = JSONResponse(payload, status_code=500)
            await response(scope, receive, send)
