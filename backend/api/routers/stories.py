"""Story retrieval: a single story, and title search over posted articles."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import Select, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.sql import ColumnElement

from api.deps import CurrentUser, OptionalUser, SessionDep
from api.friends import (
    accepted_friend_ids,
    aggregate_engagement,
    display_name,
    friend_activity_by_story,
    friend_profiles_map,
    friend_reactors_by_story,
    global_activity_by_story,
    primary_post_ids_by_story,
    top_readers,
)
from api.schemas import (
    FriendEngagementOut,
    FriendReactorOut,
    StoryCreate,
    StoryList,
    StoryReaderOut,
    StoryWithStatus,
)
from core.attribution import resolve_attribution
from core.models import Comment, Post, PostParticipant, Profile, Source, Story, StoryStatus

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
    friend_map: dict[uuid.UUID, list[FriendReactorOut]] | None = None,
) -> list[StoryWithStatus]:
    items: list[StoryWithStatus] = []
    for story, read, starred in rows:
        model = StoryWithStatus.model_validate(story)
        model.read = bool(read)
        model.starred = bool(starred)
        if friend_map is not None:
            model.friend_reactors = friend_map.get(story.id, [])
        items.append(model)
    return items


@dataclass(frozen=True)
class _PostSummary:
    """The parts of a post a search result needs to read as a conversation."""

    author_name: str
    author_image_url: str | None
    take: str | None
    reply_count: int


async def _post_summaries(
    session: SessionDep, post_ids: list[uuid.UUID]
) -> dict[uuid.UUID, _PostSummary]:
    if not post_ids:
        return {}

    rows = (
        await session.execute(
            select(Post.id, Post.take, Profile)
            .join(Profile, Profile.id == Post.author_id)
            .where(Post.id.in_(post_ids))
        )
    ).all()
    count_rows = (
        await session.execute(
            select(Comment.post_id, func.count(Comment.id))
            .where(Comment.post_id.in_(post_ids))
            .group_by(Comment.post_id)
        )
    ).all()
    counts: dict[uuid.UUID, int] = {
        post_id: total for post_id, total in count_rows if post_id is not None
    }
    return {
        post_id: _PostSummary(
            author_name=display_name(author),
            author_image_url=author.image_url,
            take=take,
            reply_count=counts.get(post_id, 0),
        )
        for post_id, take, author in rows
    }


@router.get("/title-search", response_model=StoryList)
async def title_search(
    session: SessionDep,
    user: CurrentUser,
    q: str = Query(min_length=1),
    limit: int = Query(default=50, le=200, ge=1),
) -> StoryList:
    """Search titles of posts the viewer can see, by a match-count heuristic.

    Restricted to stories someone actually posted to the viewer. The stories
    table still holds articles ingested by the retired discovery scraper, and
    those have no post to open and no conversation to read — surfacing them
    makes search look like it is searching the wrong corpus.
    """
    terms: list[str] = [t for t in q.lower().split() if t]
    if not terms:
        return StoryList(items=[], total=0, limit=limit, offset=0)

    friends: list[uuid.UUID] = await accepted_friend_ids(session, user.id)
    participant_filter: list[uuid.UUID] = [user.id, *friends]
    # Mirrors the feed's visibility rule: the viewer's own posts, plus posts
    # they or a friend participate in.
    has_visible_post = (
        select(Post.id)
        .outerjoin(PostParticipant, PostParticipant.post_id == Post.id)
        .where(
            Post.story_id == Story.id,
            or_(
                Post.author_id == user.id,
                PostParticipant.user_id.in_(participant_filter),
            ),
        )
        .exists()
    )

    headline = func.lower(Story.full_headline)
    conds: list[ColumnElement[bool]] = [headline.like(f"%{t}%") for t in terms]
    base = select(Story).where(
        or_(*conds), Story.archived.is_(False), has_visible_post
    )
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
    friend_profiles = await friend_reactors_by_story(session, user.id, story_ids)
    friend_map = {
        sid: [FriendReactorOut(user_id=p.id, display_name=display_name(p)) for p in profiles]
        for sid, profiles in friend_profiles.items()
    }
    items = _rows_to_stories(ranked_rows, friend_map)

    if story_ids:
        post_by_story = await primary_post_ids_by_story(
            session, user.id, story_ids, friend_ids=friends
        )
        summaries = await _post_summaries(session, list(post_by_story.values()))
        for item in items:
            post_id = post_by_story.get(item.id)
            item.post_id = post_id
            summary = summaries.get(post_id) if post_id else None
            if summary is not None:
                item.post_author_name = summary.author_name
                item.post_author_image_url = summary.author_image_url
                item.post_take = summary.take
                item.post_reply_count = summary.reply_count

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
        model.friend_reactors = []
        model.source_name, model.source_image_url = resolve_attribution(
            article_url=story.article_url,
            source_name=source.name if source else None,
            source_homepage_url=source.homepage_url if source else None,
            source_image_url=source.image_url if source else None,
            publisher=story.publisher,
        )

        activity = await global_activity_by_story(session, [story.id])
        read_map, commented_n = aggregate_engagement(activity, [story.id])
        model.engagement = FriendEngagementOut(
            read=len(read_map),
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
    model.source_name, model.source_image_url = resolve_attribution(
        article_url=story.article_url,
        source_name=source.name if source else None,
        source_homepage_url=source.homepage_url if source else None,
        source_image_url=source.image_url if source else None,
        publisher=story.publisher,
    )

    friend_profiles = await friend_reactors_by_story(session, user.id, [story.id])
    model.friend_reactors = [
        FriendReactorOut(user_id=p.id, display_name=display_name(p))
        for p in friend_profiles.get(story.id, [])
    ]
    activity = await friend_activity_by_story(session, user.id, [story.id])
    read_map, commented_n = aggregate_engagement(activity, [story.id])
    profiles = await friend_profiles_map(session, user.id)
    model.engagement = FriendEngagementOut(
        read=len(read_map),
        commented=commented_n,
        readers=[
            StoryReaderOut(
                user_id=p.id,
                display_name=display_name(p),
                image_url=p.image_url,
                last_read_at=read_at,
            )
            for p, read_at in top_readers(read_map, profiles)
        ],
    )
    return model


@router.get("/{story_id}/readers", response_model=list[StoryReaderOut])
async def get_story_readers(
    story_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> list[StoryReaderOut]:
    """Self + friend readers of a story, most recent first.

    Used as a Realtime-triggered refetch target for the live "reading now"
    indicator - not for initial load, which already rides on the feed/post
    response.
    """
    friends = await accepted_friend_ids(session, user.id)
    friend_ids = [*friends, user.id]
    activity = await friend_activity_by_story(
        session, user.id, [story_id], friend_ids=friend_ids
    )
    read_map, _commented_n = aggregate_engagement(activity, [story_id])
    profiles = await friend_profiles_map(
        session, user.id, friend_ids=friends, include_self=True
    )
    return [
        StoryReaderOut(
            user_id=p.id,
            display_name=display_name(p),
            image_url=p.image_url,
            last_read_at=read_at,
        )
        for p, read_at in top_readers(read_map, profiles, limit=len(read_map))
    ]


__all__ = ["router"]
