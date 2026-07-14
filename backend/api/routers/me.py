"""Current-user endpoints: profile, preferences, sources, read/star/take state."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from api.deps import CurrentUser, SessionDep
from api.schemas import (
    DismissMark,
    PreferencesUpdate,
    ProfileOut,
    RatingSet,
    ReactionSet,
    ReadMark,
    SourceOut,
    StarMark,
    StoryList,
    StoryWithStatus,
    TakeMark,
    UserSourcesUpdate,
)
from core.models import (
    Profile,
    Source,
    Story,
    StoryRating,
    StoryReaction,
    StoryStatus,
    UserSource,
)
from core.reactions import REACTION_SET

router = APIRouter(prefix="/me", tags=["me"])


async def _ensure_profile(session: SessionDep, user: CurrentUser) -> Profile:
    profile = await session.get(Profile, user.id)
    if profile is None:
        profile = Profile(id=user.id)
        session.add(profile)
        await session.flush()
        await session.refresh(profile)
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


@router.get("/sources", response_model=list[SourceOut])
async def list_my_sources(session: SessionDep, user: CurrentUser) -> list[Source]:
    result = await session.scalars(
        select(Source)
        .join(UserSource, UserSource.source_id == Source.id)
        .where(UserSource.user_id == user.id)
        .order_by(UserSource.position)
    )
    return list(result.all())


@router.put("/sources", response_model=list[SourceOut])
async def set_my_sources(
    payload: UserSourcesUpdate, session: SessionDep, user: CurrentUser
) -> list[Source]:
    """Replace the user's followed sources, preserving list order via position."""
    await session.execute(delete(UserSource).where(UserSource.user_id == user.id))
    for position, source_id in enumerate(payload.source_ids):
        session.add(
            UserSource(user_id=user.id, source_id=source_id, position=position)
        )
    await session.flush()
    return await list_my_sources(session, user)


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


@router.put("/reactions", status_code=status.HTTP_204_NO_CONTENT)
async def set_reaction(
    payload: ReactionSet, session: SessionDep, user: CurrentUser
) -> None:
    """Set (or change) the current user's single reaction on a story."""
    if payload.reaction not in REACTION_SET:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid reaction")
    stmt = (
        pg_insert(StoryReaction)
        .values(
            user_id=user.id,
            story_id=payload.story_id,
            reaction=payload.reaction,
        )
        .on_conflict_do_update(
            index_elements=[StoryReaction.user_id, StoryReaction.story_id],
            set_={"reaction": payload.reaction, "updated_at": func.now()},
        )
    )
    await session.execute(stmt)


@router.delete("/reactions/{story_id}", status_code=status.HTTP_204_NO_CONTENT)
async def clear_reaction(
    story_id: str, session: SessionDep, user: CurrentUser
) -> None:
    await session.execute(
        delete(StoryReaction).where(
            StoryReaction.user_id == user.id,
            StoryReaction.story_id == story_id,
        )
    )


@router.put("/ratings", status_code=status.HTTP_204_NO_CONTENT)
async def set_rating(
    payload: RatingSet, session: SessionDep, user: CurrentUser
) -> None:
    """Set (or change) the current user's 1-5 star rating on a story."""
    stmt = (
        pg_insert(StoryRating)
        .values(
            user_id=user.id,
            story_id=payload.story_id,
            rating=payload.rating,
        )
        .on_conflict_do_update(
            index_elements=[StoryRating.user_id, StoryRating.story_id],
            set_={"rating": payload.rating, "updated_at": func.now()},
        )
    )
    await session.execute(stmt)


@router.delete("/ratings/{story_id}", status_code=status.HTTP_204_NO_CONTENT)
async def clear_rating(
    story_id: str, session: SessionDep, user: CurrentUser
) -> None:
    await session.execute(
        delete(StoryRating).where(
            StoryRating.user_id == user.id,
            StoryRating.story_id == story_id,
        )
    )


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
