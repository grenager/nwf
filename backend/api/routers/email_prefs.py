"""Public unsubscribe endpoint for digest emails."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from api.deps import SessionDep
from core.models import Profile

router = APIRouter(prefix="/email", tags=["email"])


class UnsubscribeOut(BaseModel):
    ok: bool
    message: str


@router.get("/unsubscribe/{token}", response_model=UnsubscribeOut)
@router.post("/unsubscribe/{token}", response_model=UnsubscribeOut)
async def unsubscribe_digest(token: uuid.UUID, session: SessionDep) -> UnsubscribeOut:
    """Opt the profile out of daily digests via their unsubscribe token."""
    profile: Profile | None = await session.scalar(
        select(Profile).where(Profile.unsubscribe_token == token)
    )
    if profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "unsubscribe link not found")
    if not profile.digest_opt_out:
        profile.digest_opt_out = True
        await session.flush()
    return UnsubscribeOut(
        ok=True,
        message="You have been unsubscribed from daily digest emails.",
    )
