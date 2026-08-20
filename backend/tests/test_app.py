"""Smoke tests for the FastAPI app wiring."""

from __future__ import annotations

from fastapi.testclient import TestClient

from api.main import create_app


def test_health_ok() -> None:
    client = TestClient(create_app())
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_openapi_schema_exposed() -> None:
    client = TestClient(create_app())
    resp = client.get("/openapi.json")
    assert resp.status_code == 200
    paths = resp.json()["paths"]
    assert "/stories/title-search" in paths
    assert "/me/starred" in paths
    assert "/connections" in paths
    assert "/connections/requests" in paths
    assert "/invitations" in paths
    assert "/feed" in paths
    assert "/posts" in paths


def test_retired_discovery_routes_absent() -> None:
    """Article discovery and followed-sources endpoints are gone for good."""
    client = TestClient(create_app())
    paths = client.get("/openapi.json").json()["paths"]
    for path in (
        "/stories/discover",
        "/stories/recommended",
        "/stories/by-source",
        "/stories/updates",
        "/stories/search",
        "/me/sources",
        "/sources",
    ):
        assert path not in paths, path


def test_protected_route_requires_auth() -> None:
    client = TestClient(create_app())
    resp = client.get("/me")
    assert resp.status_code == 401
