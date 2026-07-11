"""Story retrieval: single, search (FTS), recommended feed, updates."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import Select, func, select
from sqlalchemy.sql import ColumnElement

from api.deps import CurrentUser, SessionDep
from api.friends import (
    aggregate_engagement,
    display_name,
    friend_activity_by_story,
    friend_profiles_map,
    friend_stars_by_story,
    my_reactions_by_story,
    top_readers,
)
from api.schemas import (
    FriendEngagementOut,
    FriendMiniOut,
    FriendStarOut,
    StoryList,
    StoryOut,
    StoryWithStatus,
)
from core.models import Source, Story, StoryStatus, UserSource

router = APIRouter(prefix="/stories", tags=["stories"])


def _with_status_columns(
    stmt: Select[tuple[Story]], user_id: uuid.UUID
) -> Select[tuple[Any, ...]]:
    """Left-join the current user's read/star status onto a story query."""
    return stmt.add_columns(
        func.coalesce(StoryStatus.read, False).label("read"),
        func.coalesce(StoryStatus.starred, False).label("starred"),
    ).outerjoin(
        StoryStatus,
        (StoryStatus.story_id == Story.id) & (StoryStatus.user_id == user_id),
    )


def _rows_to_stories(
    rows: list[Any],
    friend_map: dict[uuid.UUID, list[FriendStarOut]] | None = None,
    my_reactions: dict[uuid.UUID, str] | None = None,
) -> list[StoryWithStatus]:
    items: list[StoryWithStatus] = []
    for story, read, starred in rows:
        model = StoryWithStatus.model_validate(story)
        model.read = bool(read)
        model.starred = bool(starred)
        if friend_map is not None:
            model.friend_stars = friend_map.get(story.id, [])
        if my_reactions is not None:
            model.my_reaction = my_reactions.get(story.id)
        items.append(model)
    return items


@router.get("/search", response_model=StoryList)
async def search_stories(
    session: SessionDep,
    user: CurrentUser,
    q: str = Query(min_length=1),
    limit: int = Query(default=50, le=200, ge=1),
    offset: int = Query(default=0, ge=0),
) -> StoryList:
    """Full-text search over the generated tsvector column."""
    ts_query = func.websearch_to_tsquery("english", q)
    match: ColumnElement[bool] = Story.__table__.c.search_tsv.op("@@")(ts_query)
    rank = func.ts_rank(Story.__table__.c.search_tsv, ts_query)

    base = select(Story).where(match, Story.archived.is_(False))
    total = await session.scalar(
        select(func.count()).select_from(base.subquery())
    )
    stmt = (
        _with_status_columns(base, user.id)
        .order_by(rank.desc(), Story.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = (await session.execute(stmt)).all()
    story_ids = [story.id for story, _, _ in rows]
    friend_profiles = await friend_stars_by_story(session, user.id, story_ids)
    friend_map = {
        sid: [FriendStarOut(user_id=p.id, display_name=display_name(p)) for p in profiles]
        for sid, profiles in friend_profiles.items()
    }
    my_reactions = await my_reactions_by_story(session, user.id, story_ids)
    return StoryList(
        items=_rows_to_stories(rows, friend_map, my_reactions),
        total=int(total or 0),
        limit=limit,
        offset=offset,
    )


@router.get("/recommended", response_model=StoryList)
async def recommended_feed(
    session: SessionDep,
    user: CurrentUser,
    limit: int = Query(default=50, le=200, ge=1),
    offset: int = Query(default=0, ge=0),
) -> StoryList:
    """Aggregate feed of recent stories from the user's followed sources."""
    followed = (
        select(UserSource.source_id).where(UserSource.user_id == user.id).scalar_subquery()
    )
    base = select(Story).where(
        Story.source_id.in_(followed),
        Story.archived.is_(False),
    )
    total = await session.scalar(select(func.count()).select_from(base.subquery()))
    stmt = (
        _with_status_columns(base, user.id)
        .order_by(Story.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = (await session.execute(stmt)).all()
    story_ids = [story.id for story, _, _ in rows]
    friend_profiles = await friend_stars_by_story(session, user.id, story_ids)
    friend_map = {
        sid: [FriendStarOut(user_id=p.id, display_name=display_name(p)) for p in profiles]
        for sid, profiles in friend_profiles.items()
    }
    my_reactions = await my_reactions_by_story(session, user.id, story_ids)
    return StoryList(
        items=_rows_to_stories(rows, friend_map, my_reactions),
        total=int(total or 0),
        limit=limit,
        offset=offset,
    )


@router.get("/updates", response_model=StoryList)
async def story_updates(
    session: SessionDep,
    user: CurrentUser,
    since: datetime = Query(description="ISO timestamp; return stories created after this"),
    limit: int = Query(default=100, le=500, ge=1),
) -> StoryList:
    """Stories from followed sources created since a timestamp (polling)."""
    followed = (
        select(UserSource.source_id).where(UserSource.user_id == user.id).scalar_subquery()
    )
    base = select(Story).where(
        Story.source_id.in_(followed),
        Story.created_at > since,
        Story.archived.is_(False),
    )
    total = await session.scalar(select(func.count()).select_from(base.subquery()))
    stmt = (
        _with_status_columns(base, user.id)
        .order_by(Story.created_at.desc())
        .limit(limit)
    )
    rows = (await session.execute(stmt)).all()
    return StoryList(
        items=_rows_to_stories(rows),
        total=int(total or 0),
        limit=limit,
        offset=0,
    )


@router.get("/{story_id}", response_model=StoryWithStatus)
async def get_story(
    story_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> StoryWithStatus:
    stmt = (
        _with_status_columns(select(Story).where(Story.id == story_id), user.id)
        .add_columns(Source)
        .outerjoin(Source, Source.id == Story.source_id)
    )
    row = (await session.execute(stmt)).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "story not found")

    story, read, starred, source = row
    model = StoryWithStatus.model_validate(story)
    model.read = bool(read)
    model.starred = bool(starred)
    model.source_name = source.name if source else None
    model.source_image_url = source.image_url if source else None

    my_reactions = await my_reactions_by_story(session, user.id, [story.id])
    model.my_reaction = my_reactions.get(story.id)
    friend_profiles = await friend_stars_by_story(session, user.id, [story.id])
    model.friend_stars = [
        FriendStarOut(user_id=p.id, display_name=display_name(p))
        for p in friend_profiles.get(story.id, [])
    ]
    activity = await friend_activity_by_story(session, user.id, [story.id])
    read_ids, commented_n, reactions = aggregate_engagement(activity, [story.id])
    profiles = await friend_profiles_map(session, user.id)
    model.engagement = FriendEngagementOut(
        read=len(read_ids),
        commented=commented_n,
        reactions=reactions,
        readers=[
            FriendMiniOut(
                user_id=p.id, display_name=display_name(p), image_url=p.image_url
            )
            for p in top_readers(read_ids, profiles)
        ],
    )
    return model


# Re-export for callers importing StoryOut alongside the router.
__all__ = ["StoryOut", "router"]
