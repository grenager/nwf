"""Supabase Auth Admin helpers (service-role)."""

from __future__ import annotations

import uuid
from typing import Any

import httpx

from core.config import Settings, get_settings
from core.logging import get_logger

log = get_logger("supabase_admin")


class AuthUserCreateError(Exception):
    """Raised when Supabase Auth admin user creation fails."""

    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code: int | None = status_code


async def create_auth_user(
    email: str,
    *,
    first: str | None = None,
    last: str | None = None,
    settings: Settings | None = None,
) -> uuid.UUID:
    """Create a confirmed Auth user that can later sign in via magic link.

    Sets ``email_confirm=true`` so no confirmation email is sent; the profile
    row is created by the ``handle_new_user`` trigger from ``user_metadata``.
    """
    cfg: Settings = settings or get_settings()
    key: str | None = cfg.supabase_service_role_key
    if not key:
        raise AuthUserCreateError(
            "user create requires SUPABASE_SERVICE_ROLE_KEY",
            status_code=503,
        )

    email_norm: str = email.strip().lower()
    meta: dict[str, str] = {}
    if first and first.strip():
        meta["first"] = first.strip()
    if last and last.strip():
        meta["last"] = last.strip()

    url: str = f"{cfg.supabase_url.rstrip('/')}/auth/v1/admin/users"
    payload: dict[str, Any] = {
        "email": email_norm,
        "email_confirm": True,
        "user_metadata": meta,
    }
    headers: dict[str, str] = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code in (400, 409, 422):
                detail: str = "could not create user"
                try:
                    body: dict[str, Any] = resp.json()
                    msg = body.get("msg") or body.get("message") or body.get("error_description")
                    if isinstance(msg, str) and msg.strip():
                        detail = msg.strip()
                except ValueError:
                    pass
                raise AuthUserCreateError(detail, status_code=resp.status_code)
            resp.raise_for_status()
            data: dict[str, Any] = resp.json()
    except AuthUserCreateError:
        raise
    except (httpx.HTTPError, ValueError) as exc:
        log.warning(
            "supabase_admin.create_user.failed",
            error=str(exc),
            email=email_norm,
        )
        raise AuthUserCreateError(
            "failed to create auth user",
            status_code=502,
        ) from exc

    user_obj: Any = data.get("id")
    if user_obj is None and isinstance(data.get("user"), dict):
        user_obj = data["user"].get("id")
    if user_obj is None:
        raise AuthUserCreateError("auth create response missing user id", status_code=502)
    return uuid.UUID(str(user_obj))


async def delete_auth_user(
    user_id: uuid.UUID,
    *,
    settings: Settings | None = None,
) -> bool:
    """Delete a user from Supabase Auth (cascades to public.profiles).

    Returns True on success, False when the service-role key is unset or the
    admin call fails.
    """
    cfg: Settings = settings or get_settings()
    key: str | None = cfg.supabase_service_role_key
    if not key:
        log.info("supabase_admin.delete_user.skip", reason="no_service_role_key")
        return False

    url: str = f"{cfg.supabase_url.rstrip('/')}/auth/v1/admin/users/{user_id}"
    headers: dict[str, str] = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.delete(url, headers=headers)
            if resp.status_code == 404:
                log.info("supabase_admin.delete_user.not_found", user_id=str(user_id))
                return True
            resp.raise_for_status()
    except httpx.HTTPError as exc:
        log.warning(
            "supabase_admin.delete_user.failed",
            error=str(exc),
            user_id=str(user_id),
        )
        return False
    return True


async def generate_magic_link(
    email: str,
    redirect_to: str,
    *,
    settings: Settings | None = None,
) -> str | None:
    """Mint a one-time Supabase magic-link for ``email``.

    Returns the ``action_link`` URL, or ``None`` when the service-role key is
    unset or the admin call fails (caller should fall back to the durable
    invite landing URL).
    """
    cfg: Settings = settings or get_settings()
    key: str | None = cfg.supabase_service_role_key
    if not key:
        log.info("supabase_admin.generate_link.skip", reason="no_service_role_key")
        return None

    url: str = f"{cfg.supabase_url.rstrip('/')}/auth/v1/admin/generate_link"
    payload: dict[str, Any] = {
        "type": "magiclink",
        "email": email.strip().lower(),
        "options": {"redirect_to": redirect_to},
    }
    headers: dict[str, str] = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
            data: dict[str, Any] = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        log.warning(
            "supabase_admin.generate_link.failed",
            error=str(exc),
            email=email,
        )
        return None

    # Shape varies slightly across GoTrue versions; try common keys.
    action: str | None = None
    if isinstance(data.get("action_link"), str):
        action = data["action_link"]
    properties = data.get("properties")
    if action is None and isinstance(properties, dict):
        prop_link = properties.get("action_link")
        if isinstance(prop_link, str):
            action = prop_link

    if not action:
        log.warning(
            "supabase_admin.generate_link.no_action_link",
            keys=list(data.keys()),
        )
        return None
    return action
