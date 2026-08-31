"""Current-user endpoints: profile, preferences, read/star/take state."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from api.deps import CurrentUser, SessionDep
from api.routers.invitations import redeem_pending_invitations_for_email
from api.schemas import (
    DismissMark,
    PreferencesUpdate,
    ProfileOut,
    ReadingPing,
    ReadMark,
    StarMark,
    StoryList,
    StoryWithStatus,
    TakeMark,
)
from core.models import (
    Profile,
    Story,
    StoryStatus,
)

router = APIRouter(prefix="/me", tags=["me"])


async def _ensure_profile(session: SessionDep, user: CurrentUser) -> Profile:
    profile = await session.get(Profile, user.id)
    if profile is None:
        profile = Profile(id=user.id)
        session.add(profile)
        await session.flush()
        await session.refresh(profile)
    # Safety net: redeem any pending email invitations for this account.
    await redeem_pending_invitations_for_email(session, user.id, user.email)
    return profile


@router.get("", response_model=ProfileOut)
async def get_me(session: SessionDep, user: CurrentUser) -> Profile:
    return await _ensure_profile(session, user)


@router.put("/preferences", response_model=ProfileOut)
async def update_preferences(
    payload: PreferencesUpdate, session: SessionDep, user: CurrentUser
) -> Profile:
    profile = await _ensure_profile(session, user)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(profile, key, value)
    await session.flush()
    await session.refresh(profile)
    return profile


@router.post("/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_read(
    payload: ReadMark, session: SessionDep, user: CurrentUser
) -> None:
    read_at = func.now() if payload.read else None
    stmt = (
        pg_insert(StoryStatus)
        .values(
            user_id=user.id,
            story_id=payload.story_id,
            read=payload.read,
            read_at=read_at,
        )
        .on_conflict_do_update(
            index_elements=[StoryStatus.user_id, StoryStatus.story_id],
            set_={
                "read": payload.read,
                "read_at": read_at,
                "updated_at": func.now(),
            },
        )
    )
    await session.execute(stmt)


@router.post("/reading-ping", status_code=status.HTTP_204_NO_CONTENT)
async def ping_reading(
    payload: ReadingPing, session: SessionDep, user: CurrentUser
) -> None:
    """Refresh the live 'reading now' timestamp, unconditionally, every open."""
    stmt = (
        pg_insert(StoryStatus)
        .values(
            user_id=user.id,
            story_id=payload.story_id,
            last_read_at=func.now(),
        )
        .on_conflict_do_update(
            index_elements=[StoryStatus.user_id, StoryStatus.story_id],
            set_={"last_read_at": func.now()},
        )
    )
    await session.execute(stmt)


@router.post("/take", status_code=status.HTTP_204_NO_CONTENT)
async def set_take(
    payload: TakeMark, session: SessionDep, user: CurrentUser
) -> None:
    """Set (or clear) the one-line Log take on a story; marks read."""
    take: str | None = (payload.take or "").strip() or None
    stmt = (
        pg_insert(StoryStatus)
        .values(
            user_id=user.id,
            story_id=payload.story_id,
            take=take,
            read=True,
            read_at=func.now(),
        )
        .on_conflict_do_update(
            index_elements=[StoryStatus.user_id, StoryStatus.story_id],
            set_={
                "take": take,
                "read": True,
                "read_at": func.now(),
                "updated_at": func.now(),
            },
        )
    )
    await session.execute(stmt)


@router.post("/dismiss", status_code=status.HTTP_204_NO_CONTENT)
async def dismiss_story(
    payload: DismissMark, session: SessionDep, user: CurrentUser
) -> None:
    """Dismiss a story from the feed."""
    stmt = (
        pg_insert(StoryStatus)
        .values(
            user_id=user.id,
            story_id=payload.story_id,
            dismissed=True,
            dismissed_at=func.now(),
        )
        .on_conflict_do_update(
            index_elements=[StoryStatus.user_id, StoryStatus.story_id],
            set_={
                "dismissed": True,
                "dismissed_at": func.now(),
                "updated_at": func.now(),
            },
        )
    )
    await session.execute(stmt)


@router.delete("/dismiss/{story_id}", status_code=status.HTTP_204_NO_CONTENT)
async def undismiss_story(
    story_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> None:
    status_row = await session.get(
        StoryStatus, {"user_id": user.id, "story_id": story_id}
    )
    if status_row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not dismissed")
    status_row.dismissed = False
    status_row.dismissed_at = None


@router.post("/stars", status_code=status.HTTP_204_NO_CONTENT)
async def add_star(
    payload: StarMark, session: SessionDep, user: CurrentUser
) -> None:
    stmt = (
        pg_insert(StoryStatus)
        .values(user_id=user.id, story_id=payload.story_id, starred=True)
        .on_conflict_do_update(
            index_elements=[StoryStatus.user_id, StoryStatus.story_id],
            set_={"starred": True, "updated_at": func.now()},
        )
    )
    await session.execute(stmt)


@router.delete("/stars/{story_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_star(
    story_id: str, session: SessionDep, user: CurrentUser
) -> None:
    status_row = await session.get(
        StoryStatus, {"user_id": user.id, "story_id": story_id}
    )
    if status_row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not starred")
    status_row.starred = False


@router.get("/starred", response_model=StoryList)
async def list_starred(
    session: SessionDep,
    user: CurrentUser,
    limit: int = Query(default=100, le=500, ge=1),
    offset: int = Query(default=0, ge=0),
) -> StoryList:
    base = (
        select(Story, StoryStatus.read, StoryStatus.starred, StoryStatus.dismissed)
        .join(StoryStatus, StoryStatus.story_id == Story.id)
        .where(StoryStatus.user_id == user.id, StoryStatus.starred.is_(True))
    )
    total = await session.scalar(
        select(func.count())
        .select_from(StoryStatus)
        .where(StoryStatus.user_id == user.id, StoryStatus.starred.is_(True))
    )
    rows = (
        await session.execute(
            base.order_by(Story.created_at.desc()).limit(limit).offset(offset)
        )
    ).all()
    items: list[StoryWithStatus] = []
    for story, read, starred, dismissed in rows:
        model = StoryWithStatus.model_validate(story)
        model.read = bool(read)
        model.starred = bool(starred)
        model.dismissed = bool(dismissed)
        items.append(model)
    return StoryList(items=items, total=int(total or 0), limit=limit, offset=offset)
