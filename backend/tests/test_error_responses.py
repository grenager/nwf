"""What the browser is told when a request blows up.

These run against the real application from ``create_app`` rather than a
synthetic one, because the behaviour being guarded *is* the middleware
ordering: ``UnhandledErrorMiddleware`` has to sit inside ``CORSMiddleware``
for a 500 to carry the CORS headers. A test that builds its own stack would
pass while production kept lying to the browser.
"""

from __future__ import annotations

import re

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from api.main import create_app

ORIGIN = "http://localhost:3000"  # matches the default cors_origins


@pytest.fixture(name="client")
def _client() -> TestClient:
    """The real app, plus two routes that fail in the two ways that matter."""
    app = create_app()

    @app.get("/_test/boom")
    async def _boom() -> None:
        raise RuntimeError("kaboom: a secret table name")

    @app.get("/_test/teapot")
    async def _teapot() -> None:
        raise HTTPException(418, "deliberate")

    # raise_server_exceptions=False makes TestClient return the 500 the way a
    # browser would receive it, instead of re-raising it into the test.
    return TestClient(app, raise_server_exceptions=False)


def test_a_500_carries_the_cors_header(client: TestClient) -> None:
    """The regression: without this, the browser reports a CORS error.

    Starlette renders unhandled exceptions outside the CORS layer, so a 500
    used to come back with no Access-Control-Allow-Origin and the real failure
    was unreadable from the client.
    """
    resp = client.get("/_test/boom", headers={"Origin": ORIGIN})
    assert resp.status_code == 500
    assert resp.headers["access-control-allow-origin"] == ORIGIN


def test_a_500_returns_a_reference_the_caller_can_quote(
    client: TestClient,
) -> None:
    resp = client.get("/_test/boom", headers={"Origin": ORIGIN})
    body = resp.json()
    assert re.fullmatch(r"[0-9a-f]{12}", body["error_id"])
    # The reference is in the human-readable detail too, so the existing
    # client error path surfaces it with no change on that side.
    assert body["error_id"] in body["detail"]


def test_each_failure_gets_its_own_reference(client: TestClient) -> None:
    """Two failures must be distinguishable in the log."""
    first = client.get("/_test/boom", headers={"Origin": ORIGIN}).json()
    second = client.get("/_test/boom", headers={"Origin": ORIGIN}).json()
    assert first["error_id"] != second["error_id"]


def test_the_body_leaks_nothing_about_the_exception(client: TestClient) -> None:
    """Messages carry SQL, paths and column names; those stay in the log."""
    resp = client.get("/_test/boom", headers={"Origin": ORIGIN})
    text = resp.text.lower()
    for leaked in ("kaboom", "secret table name", "runtimeerror", "traceback"):
        assert leaked not in text, f"{leaked!r} leaked in {resp.text!r}"


def test_deliberate_http_errors_are_left_alone(client: TestClient) -> None:
    """Only genuine 500s are wrapped; HTTPException keeps its shape."""
    resp = client.get("/_test/teapot", headers={"Origin": ORIGIN})
    assert resp.status_code == 418
    assert resp.json() == {"detail": "deliberate"}


def test_healthy_responses_are_untouched(client: TestClient) -> None:
    resp = client.get("/health", headers={"Origin": ORIGIN})
    assert resp.status_code == 200
    assert "error_id" not in resp.text
