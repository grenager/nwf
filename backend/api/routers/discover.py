"""Discover: the most active stories on the platform right now.

The counterpart to the Conversations feed. Where the feed is scoped to the
viewer's friend graph and ordered by when a friend posted, Discover spans the
whole platform, is story-level rather than post-level, and is ordered by
engagement. It is what makes the app worth opening on a morning when none of
your own friends has posted yet.

Guests get the same payload (it is viewer-independent apart from the read
flag), which is what lets the landing page show real content.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Query, Response
from sqlalchemy import select

from api.deps import OptionalUser, SessionDep
from api.discover import (
    StoryAggregate,
    load_window_aggregates,
    rank_stories,
    score_story,
    seed_user_ids,
)
from api.schemas import DiscoverCardOut, DiscoverOut
from core.attribution import resolve_attribution
from core.config import get_settings
from core.models import Source, Story, StoryStatus

router = APIRouter(prefix="/discover", tags=["discover"])

#: Guests all get the same ranking, so it is worth caching at the edge. Short
#: enough that a freshly seeded morning list shows up promptly.
_GUEST_CACHE_CONTROL: str = "public, s-maxage=30, stale-while-revalidate=300"


@router.get("", response_model=DiscoverOut)
async def get_discover(
    session: SessionDep,
    user: OptionalUser,
    response: Response,
    limit: int = Query(default=0, ge=0, le=100),
) -> DiscoverOut:
    """Most active stories platform-wide, widening the window if quiet."""
    settings = get_settings()
    viewer_id: uuid.UUID | None = user.id if user is not None else None
    if viewer_id is None:
        response.headers["Cache-Control"] = _GUEST_CACHE_CONTROL

    card_limit: int = limit or settings.discover_limit
    excluded = await seed_user_ids(session)

    now = datetime.now(UTC)
    windows: list[int] = sorted(settings.discover_windows_hours) or [24]
    ranked: list[StoryAggregate] = []
    window_hours: int = windows[-1]
    for hours in windows:
        aggregates = await load_window_aggregates(
            session,
            since=now - timedelta(hours=hours),
            exclude_user_ids=excluded,
        )
        ranked = rank_stories(aggregates, card_limit)
        window_hours = hours
        # A quiet day widens the window rather than showing a near-empty
        # page; the widest window is used as-is however little it returns.
        if len(ranked) >= settings.discover_min_items:
            break

    if not ranked:
        return DiscoverOut(items=[], window_hours=window_hours)

    story_ids: list[uuid.UUID] = [agg.story_id for agg in ranked]
    story_rows = (
        await session.execute(
            select(Story, Source)
            .outerjoin(Source, Source.id == Story.source_id)
            .where(Story.id.in_(story_ids))
        )
    ).all()
    stories: dict[uuid.UUID, tuple[Story, Source | None]] = {
        story.id: (story, source) for story, source in story_rows
    }

    read_story_ids: set[uuid.UUID] = set()
    if viewer_id is not None:
        read_rows = await session.scalars(
            select(StoryStatus.story_id).where(
                StoryStatus.user_id == viewer_id,
                StoryStatus.story_id.in_(story_ids),
                StoryStatus.read.is_(True),
            )
        )
        read_story_ids = set(read_rows.all())

    items: list[DiscoverCardOut] = []
    for agg in ranked:
        found = stories.get(agg.story_id)
        if found is None:
            continue
        story, source = found
        source_name, source_image_url = resolve_attribution(
            article_url=story.article_url,
            source_name=source.name if source else None,
            source_homepage_url=source.homepage_url if source else None,
            source_image_url=source.image_url if source else None,
            publisher=story.publisher,
        )
        items.append(
            DiscoverCardOut(
                story_id=story.id,
                full_headline=story.full_headline,
                article_url=story.article_url,
                summary=story.summary,
                image_url=story.image_url,
                source_name=source_name,
                source_image_url=source_image_url,
                kind=story.kind,
                post_count=agg.post_count,
                reactor_count=len(agg.reactor_ids),
                commenter_count=len(agg.commenter_ids),
                reader_count=agg.reader_count,
                comment_count=agg.comment_count,
                latest_activity_at=agg.latest_activity_at,
                score=score_story(agg),
                read=story.id in read_story_ids,
            )
        )

    return DiscoverOut(items=items, window_hours=window_hours)
