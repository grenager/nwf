"""Supabase Auth Admin helpers (service-role)."""

from __future__ import annotations

from typing import Any

import httpx

from core.config import Settings, get_settings
from core.logging import get_logger

log = get_logger("supabase_admin")


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
