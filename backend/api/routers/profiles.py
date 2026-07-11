"""Profile edits: owner or global admin may update a user's profile."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, status

from api.deps import CurrentUser, SessionDep
from api.schemas import ProfileEdit, ProfileOut
from core.models import Profile

router = APIRouter(prefix="/profiles", tags=["profiles"])


async def _is_admin(session: SessionDep, user: CurrentUser) -> bool:
    if user.is_admin:
        return True
    viewer = await session.get(Profile, user.id)
    return bool(viewer and viewer.is_admin)


@router.put("/{user_id}", response_model=ProfileOut)
async def update_profile(
    user_id: uuid.UUID,
    payload: ProfileEdit,
    session: SessionDep,
    user: CurrentUser,
) -> Profile:
    """Update a profile. Allowed for the owner or a global admin."""
    if user_id != user.id and not await _is_admin(session, user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "cannot edit this profile")
    profile = await session.get(Profile, user_id)
    if profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "profile not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(profile, key, value)
    await session.flush()
    await session.refresh(profile)
    return profile
