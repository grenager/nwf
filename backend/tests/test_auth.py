"""Tests for Supabase JWT verification (HS256 path)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest

from core.auth import AuthError, verify_token
from core.config import Settings

SECRET = "super-secret-test-key-that-is-at-least-32-bytes-long"


def _settings() -> Settings:
    return Settings(
        supabase_jwt_secret=SECRET,
        supabase_jwt_audience="authenticated",
    )


def _make_token(**overrides: object) -> str:
    now = datetime.now(UTC)
    payload: dict[str, object] = {
        "sub": str(uuid.uuid4()),
        "aud": "authenticated",
        "exp": now + timedelta(hours=1),
        "iat": now,
        "email": "user@example.com",
    }
    payload.update(overrides)
    return jwt.encode(payload, SECRET, algorithm="HS256")


def test_verify_valid_token() -> None:
    user_id = uuid.uuid4()
    token = _make_token(sub=str(user_id))
    user = verify_token(token, _settings())
    assert user.id == user_id
    assert user.email == "user@example.com"
    assert user.is_admin is False


def test_admin_claim_from_app_metadata() -> None:
    token = _make_token(app_metadata={"is_admin": True})
    user = verify_token(token, _settings())
    assert user.is_admin is True


def test_expired_token_rejected() -> None:
    token = _make_token(exp=datetime.now(UTC) - timedelta(hours=1))
    with pytest.raises(AuthError):
        verify_token(token, _settings())


def test_bad_audience_rejected() -> None:
    token = _make_token(aud="someone-else")
    with pytest.raises(AuthError):
        verify_token(token, _settings())


def test_wrong_secret_rejected() -> None:
    now = datetime.now(UTC)
    token = jwt.encode(
        {"sub": str(uuid.uuid4()), "aud": "authenticated", "exp": now + timedelta(hours=1)},
        "wrong-secret",
        algorithm="HS256",
    )
    with pytest.raises(AuthError):
        verify_token(token, _settings())
