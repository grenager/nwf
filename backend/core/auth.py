"""Supabase JWT verification.

Supports two verification modes:
  * Asymmetric (recommended): fetch the project JWKS and verify RS256/ES256
    tokens. Keys are cached with a TTL.
  * Symmetric (legacy): verify HS256 tokens using ``supabase_jwt_secret``.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from typing import Any

import httpx
import jwt
from jwt import PyJWKClient

from core.config import Settings, get_settings

_JWKS_TTL_SECONDS = 600


@dataclass(frozen=True, slots=True)
class AuthUser:
    """The authenticated principal derived from a verified Supabase JWT."""

    id: uuid.UUID
    email: str | None
    is_admin: bool
    claims: dict[str, Any]


class AuthError(Exception):
    """Raised when a token cannot be verified."""


class _JWKSCache:
    """Small TTL cache around PyJWKClient."""

    def __init__(self, url: str) -> None:
        self._url = url
        self._client: PyJWKClient | None = None
        self._fetched_at: float = 0.0

    def client(self) -> PyJWKClient:
        now = time.monotonic()
        if self._client is None or (now - self._fetched_at) > _JWKS_TTL_SECONDS:
            self._client = PyJWKClient(self._url, cache_keys=True)
            self._fetched_at = now
        return self._client


_jwks_cache: _JWKSCache | None = None


def _get_jwks_cache(settings: Settings) -> _JWKSCache:
    global _jwks_cache
    if _jwks_cache is None or _jwks_cache._url != settings.jwks_url:
        _jwks_cache = _JWKSCache(settings.jwks_url)
    return _jwks_cache


def _decode(token: str, settings: Settings) -> dict[str, Any]:
    """Decode and verify a JWT, returning its claims."""
    if settings.supabase_jwt_secret:
        return jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience=settings.supabase_jwt_audience,
            options={"require": ["exp", "sub"]},
        )

    try:
        signing_key = _get_jwks_cache(settings).client().get_signing_key_from_jwt(token)
    except (jwt.PyJWKClientError, httpx.HTTPError) as exc:  # pragma: no cover - network
        raise AuthError(f"unable to resolve signing key: {exc}") from exc

    return jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256", "ES256"],
        audience=settings.supabase_jwt_audience,
        options={"require": ["exp", "sub"]},
    )


def verify_token(token: str, settings: Settings | None = None) -> AuthUser:
    """Verify a Supabase-issued JWT and return the authenticated user.

    Raises ``AuthError`` on any verification failure.
    """
    settings = settings or get_settings()
    try:
        claims = _decode(token, settings)
    except jwt.PyJWTError as exc:
        raise AuthError(str(exc)) from exc

    sub = claims.get("sub")
    if not sub:
        raise AuthError("token missing subject")
    try:
        user_id = uuid.UUID(str(sub))
    except ValueError as exc:
        raise AuthError("token subject is not a valid uuid") from exc

    app_meta = claims.get("app_metadata") or {}
    is_admin = bool(app_meta.get("is_admin") or claims.get("is_admin"))

    return AuthUser(
        id=user_id,
        email=claims.get("email"),
        is_admin=is_admin,
        claims=claims,
    )
