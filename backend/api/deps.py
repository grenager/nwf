"""Shared FastAPI dependencies: DB session, auth, admin guard."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import AuthError, AuthUser, verify_token
from core.config import Settings, get_settings
from core.db import get_session
from core.models import Profile

SessionDep = Annotated[AsyncSession, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]

_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    settings: SettingsDep,
) -> AuthUser:
    """Verify the Supabase bearer token and return the authenticated user."""
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        return verify_token(credentials.credentials, settings)
    except AuthError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"invalid token: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


CurrentUser = Annotated[AuthUser, Depends(get_current_user)]


async def require_admin(
    user: CurrentUser,
    settings: SettingsDep,
    session: SessionDep,
    x_admin_secret: Annotated[str | None, Header(alias="X-Admin-Secret")] = None,
) -> AuthUser:
    """Allow admins (JWT claim or profiles.is_admin), or a shared secret header."""
    if user.is_admin:
        return user
    if (
        settings.admin_api_secret
        and x_admin_secret
        and x_admin_secret == settings.admin_api_secret
    ):
        return user
    # Fall back to the DB profile flag so admin can be granted without
    # re-issuing tokens (app_metadata claims require a fresh session).
    profile = await session.get(Profile, user.id)
    if profile is not None and profile.is_admin:
        return user
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="admin privileges required",
    )


AdminUser = Annotated[AuthUser, Depends(require_admin)]
