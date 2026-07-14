"""Story retrieval: single, search (FTS), recommended feed, updates."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import Select, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.sql import ColumnElement

from api.deps import CurrentUser, OptionalUser, SessionDep
from api.friends import (
    aggregate_engagement,
    display_name,
    friend_activity_by_story,
    friend_profiles_map,
    friend_stars_by_story,
    global_activity_by_story,
    top_readers,
)
from api.schemas import (
    FriendEngagementOut,
    FriendMiniOut,
    FriendStarOut,
    StoryCreate,
    StoryList,
    StoryOut,
    StoryWithStatus,
)
from core.models import Source, Story, StoryStatus, UserSource

router = APIRouter(prefix="/stories", tags=["stories"])


def _headline_from_url(url: str) -> str:
    """Derive a human-ish headline from a URL slug (placeholder parsing)."""
    parsed = urlparse(url)
    path: str = parsed.path.rstrip("/")
    slug: str = path.rsplit("/", 1)[-1] if path else ""
    slug = slug.rsplit(".", 1)[0]
    words: list[str] = [w for w in slug.replace("_", "-").split("-") if w]
    if not words or all(w.isdigit() for w in words):
        return parsed.netloc or url
    return " ".join(w.capitalize() for w in words)


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
) -> list[StoryWithStatus]:
    items: list[StoryWithStatus] = []
    for story, read, starred in rows:
        model = StoryWithStatus.model_validate(story)
        model.read = bool(read)
        model.starred = bool(starred)
        if friend_map is not None:
            model.friend_stars = friend_map.get(story.id, [])
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
    return StoryList(
        items=_rows_to_stories(rows, friend_map),
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
    return StoryList(
        items=_rows_to_stories(rows, friend_map),
        total=int(total or 0),
        limit=limit,
        offset=offset,
    )


@router.get("/by-source", response_model=StoryList)
async def stories_by_source(
    session: SessionDep,
    user: CurrentUser,
    per_source: int = Query(default=6, le=20, ge=1),
) -> StoryList:
    """Latest stories grouped per followed source.

    Unlike ``/recommended`` (a single global top-N feed), this returns the most
    recent ``per_source`` stories for *each* followed source, so the Sources
    page reflects real per-source freshness instead of only whichever sources
    happen to dominate the global recency window.
    """
    followed = (
        select(UserSource.source_id).where(UserSource.user_id == user.id).scalar_subquery()
    )
    ranked = (
        select(
            Story.id.label("id"),
            func.row_number()
            .over(
                partition_by=Story.source_id,
                order_by=Story.created_at.desc(),
            )
            .label("rn"),
        )
        .where(Story.source_id.in_(followed), Story.archived.is_(False))
        .subquery()
    )
    base = (
        select(Story)
        .join(ranked, ranked.c.id == Story.id)
        .where(ranked.c.rn <= per_source)
    )
    stmt = _with_status_columns(base, user.id).order_by(
        Story.source_id, Story.created_at.desc()
    )
    rows = (await session.execute(stmt)).all()
    return StoryList(
        items=_rows_to_stories(rows),
        total=len(rows),
        limit=per_source,
        offset=0,
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


@router.get("/title-search", response_model=StoryList)
async def title_search(
    session: SessionDep,
    user: CurrentUser,
    q: str = Query(min_length=1),
    limit: int = Query(default=50, le=200, ge=1),
) -> StoryList:
    """Search recent article titles, ranked by a simple match-count heuristic."""
    terms: list[str] = [t for t in q.lower().split() if t]
    if not terms:
        return StoryList(items=[], total=0, limit=limit, offset=0)

    headline = func.lower(Story.full_headline)
    conds: list[ColumnElement[bool]] = [headline.like(f"%{t}%") for t in terms]
    base = select(Story).where(or_(*conds), Story.archived.is_(False))
    # Scan a recent candidate window, then rank in Python by match count.
    stmt = (
        _with_status_columns(base, user.id)
        .order_by(Story.created_at.desc())
        .limit(400)
    )
    rows = (await session.execute(stmt)).all()

    scored: list[tuple[int, int, datetime, Any]] = []
    for story, read, starred in rows:
        title: str = (story.full_headline or "").lower()
        occurrences: int = sum(title.count(t) for t in terms)
        if occurrences == 0:
            continue
        matched_terms: int = sum(1 for t in terms if t in title)
        scored.append((matched_terms, occurrences, story.created_at, (story, read, starred)))

    # Rank: most distinct terms matched, then total occurrences, then recency.
    scored.sort(key=lambda s: (s[0], s[1], s[2]), reverse=True)
    ranked_rows: list[Any] = [entry[3] for entry in scored[:limit]]

    story_ids = [story.id for story, _, _ in ranked_rows]
    friend_profiles = await friend_stars_by_story(session, user.id, story_ids)
    friend_map = {
        sid: [FriendStarOut(user_id=p.id, display_name=display_name(p)) for p in profiles]
        for sid, profiles in friend_profiles.items()
    }
    items = _rows_to_stories(ranked_rows, friend_map)

    source_ids = {story.source_id for story, _, _ in ranked_rows if story.source_id}
    if source_ids:
        sources = {
            s.id: s
            for s in (
                await session.scalars(select(Source).where(Source.id.in_(source_ids)))
            ).all()
        }
        for item in items:
            source = sources.get(item.source_id) if item.source_id else None
            if source is not None:
                item.source_name = source.name
                item.source_image_url = source.image_url

    return StoryList(items=items, total=len(scored), limit=limit, offset=0)


@router.post("", response_model=StoryWithStatus, status_code=status.HTTP_201_CREATED)
async def add_story(
    payload: StoryCreate, session: SessionDep, user: CurrentUser
) -> StoryWithStatus:
    """Add a story we may have missed by URL, and mark it read for the user.

    Parsing is faked for now: we derive a headline from the URL slug. Later this
    will fetch and parse the page. If the URL already exists we reuse it.
    """
    url: str = payload.url.strip()
    existing = await session.scalar(select(Story).where(Story.article_url == url))
    if existing is not None:
        story = existing
    else:
        story = Story(
            article_url=url,
            full_headline=(payload.title or "").strip() or _headline_from_url(url),
            kind=payload.kind,
        )
        session.add(story)
        await session.flush()

    read_stmt = (
        pg_insert(StoryStatus)
        .values(user_id=user.id, story_id=story.id, read=True)
        .on_conflict_do_update(
            index_elements=[StoryStatus.user_id, StoryStatus.story_id],
            set_={"read": True, "updated_at": func.now()},
        )
    )
    await session.execute(read_stmt)

    model = StoryWithStatus.model_validate(story)
    model.read = True
    if story.source_id:
        source = await session.get(Source, story.source_id)
        model.source_name = source.name if source else None
        model.source_image_url = source.image_url if source else None
    else:
        model.source_name = urlparse(url).netloc or None
    return model


@router.get("/{story_id}", response_model=StoryWithStatus)
async def get_story(
    story_id: uuid.UUID, session: SessionDep, user: OptionalUser
) -> StoryWithStatus:
    if user is None:
        stmt = (
            select(Story, Source)
            .outerjoin(Source, Source.id == Story.source_id)
            .where(Story.id == story_id)
        )
        row = (await session.execute(stmt)).first()
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "story not found")

        story, source = row
        model = StoryWithStatus.model_validate(story)
        model.read = False
        model.starred = False
        model.friend_stars = []
        model.source_name = source.name if source else None
        model.source_image_url = source.image_url if source else None

        activity = await global_activity_by_story(session, [story.id])
        read_ids, commented_n = aggregate_engagement(activity, [story.id])
        model.engagement = FriendEngagementOut(
            read=len(read_ids),
            commented=commented_n,
            readers=[],
        )
        return model

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

    friend_profiles = await friend_stars_by_story(session, user.id, [story.id])
    model.friend_stars = [
        FriendStarOut(user_id=p.id, display_name=display_name(p))
        for p in friend_profiles.get(story.id, [])
    ]
    activity = await friend_activity_by_story(session, user.id, [story.id])
    read_ids, commented_n = aggregate_engagement(activity, [story.id])
    profiles = await friend_profiles_map(session, user.id)
    model.engagement = FriendEngagementOut(
        read=len(read_ids),
        commented=commented_n,
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
