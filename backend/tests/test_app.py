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
    assert "/stories/recommended" in paths
    assert "/me/starred" in paths
    assert "/connections" in paths


def test_protected_route_requires_auth() -> None:
    client = TestClient(create_app())
    resp = client.get("/me")
    assert resp.status_code == 401
