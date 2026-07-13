"""News event clusters: Today feed and coverage comparison."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import case, distinct, func, or_, select, union

from api.deps import CurrentUser, OptionalUser, SessionDep
from api.friends import (
    StoryActivity,
    accepted_friend_ids,
    aggregate_engagement,
    curated_source_subquery,
    display_name,
    friend_activity_by_story,
    friend_profiles_map,
    friend_stars_by_story,
    global_activity_by_story,
    my_reactions_by_story,
    top_readers,
)
from api.schemas import (
    EventCoverageOut,
    EventDetailOut,
    EventList,
    EventSummaryOut,
    FriendEngagementOut,
    FriendMiniOut,
    FriendStarOut,
    StoryList,
    StoryWithStatus,
    TodayOut,
)
from core.config import get_settings
from core.models import (
    Comment,
    Event,
    EventStatus,
    Profile,
    Source,
    Story,
    StoryEvent,
    StoryKind,
    StoryReaction,
    StoryStatus,
    UserSource,
)

router = APIRouter(prefix="/events", tags=["events"])


def _followed_subquery(user_id: uuid.UUID) -> Any:
    return select(UserSource.source_id).where(UserSource.user_id == user_id).scalar_subquery()


def _source_subquery(user_id: uuid.UUID | None) -> Any:
    """Followed sources for a user, or the curated global list for guests."""
    if user_id is not None:
        return _followed_subquery(user_id)
    return curated_source_subquery()


async def _build_coverage_rows(
    session: SessionDep,
    user_id: uuid.UUID | None,
    event_id: uuid.UUID,
) -> list[EventCoverageOut]:
    base = (
        select(Story, Source)
        .join(StoryEvent, StoryEvent.story_id == Story.id)
        .outerjoin(Source, Source.id == Story.source_id)
        .where(StoryEvent.event_id == event_id)
        .order_by(
            Source.prominence.desc().nulls_last(),
            Source.name,
        )
    )
    if user_id is not None:
        stmt = base.add_columns(StoryStatus.read, StoryStatus.starred).outerjoin(
            StoryStatus,
            (StoryStatus.story_id == Story.id) & (StoryStatus.user_id == user_id),
        )
        rows = (await session.execute(stmt)).all()
        coverage: list[EventCoverageOut] = []
        for story, source, read, starred in rows:
            bias: float | None = (
                float(source.bias_score)
                if source and source.bias_score is not None
                else None
            )
            coverage.append(
                EventCoverageOut(
                    story_id=story.id,
                    source_id=story.source_id,
                    source_name=source.name if source else "Unknown",
                    bias_score=bias,
                    prominence=int(source.prominence) if source else 0,
                    image_url=source.image_url if source else story.image_url,
                    story_image_url=story.image_url,
                    full_headline=story.full_headline,
                    summary=story.summary,
                    article_url=story.article_url,
                    read=bool(read),
                    starred=bool(starred),
                )
            )
        return coverage

    rows = (await session.execute(base)).all()
    coverage = []
    for story, source in rows:
        bias = (
            float(source.bias_score)
            if source and source.bias_score is not None
            else None
        )
        coverage.append(
            EventCoverageOut(
                story_id=story.id,
                source_id=story.source_id,
                source_name=source.name if source else "Unknown",
                bias_score=bias,
                prominence=int(source.prominence) if source else 0,
                image_url=source.image_url if source else story.image_url,
                story_image_url=story.image_url,
                full_headline=story.full_headline,
                summary=story.summary,
                article_url=story.article_url,
                read=False,
                starred=False,
            )
        )
    return coverage


async def _event_to_summary(
    session: SessionDep,
    user_id: uuid.UUID | None,
    event: Event,
    coverage: list[EventCoverageOut],
    friend_map: dict[uuid.UUID, list[FriendStarOut]],
    activity: dict[uuid.UUID, StoryActivity] | None = None,
    profiles: dict[uuid.UUID, Profile] | None = None,
    *,
    event_read: bool = False,
    event_dismissed: bool = False,
) -> EventSummaryOut:
    outlet_ids = {c.source_id for c in coverage if c.source_id is not None}
    story_ids = [c.story_id for c in coverage]
    friends: list[FriendStarOut] = []
    seen: set[uuid.UUID] = set()
    for sid in story_ids:
        for fs in friend_map.get(sid, []):
            if fs.user_id not in seen:
                friends.append(fs)
                seen.add(fs.user_id)

    read_ids, commented_n, reactions = aggregate_engagement(activity or {}, story_ids)
    readers = [
        FriendMiniOut(
            user_id=p.id, display_name=display_name(p), image_url=p.image_url
        )
        for p in top_readers(read_ids, profiles or {})
    ]

    return EventSummaryOut(
        id=event.id,
        title=event.title,
        first_seen_at=event.first_seen_at,
        outlet_count=len(outlet_ids),
        story_count=len(coverage),
        is_scoop=len(outlet_ids) <= 1,
        coverage=coverage,
        friend_stars=friends,
        engagement=FriendEngagementOut(
            read=len(read_ids),
            commented=commented_n,
            reactions=reactions,
            readers=readers,
        ),
        read=event_read,
        dismissed=event_dismissed,
    )


async def _load_events_for_user(
    session: SessionDep,
    user_id: uuid.UUID | None,
    *,
    days: int | None = None,
    limit: int = 50,
) -> list[tuple[Event, bool, bool]]:
    """Recent inbox candidate events.

    Returns (event, read, dismissed) tuples. Dismissed rows are excluded for
    authenticated users; guests always get (event, False, False).
    """
    settings = get_settings()
    window_days: int = days if days is not None else settings.inbox_candidate_days
    since = datetime.now(UTC) - timedelta(days=window_days)
    sources = _source_subquery(user_id)
    outlet_count = func.count(distinct(Story.source_id))
    source_hits = func.count(
        distinct(case((Story.source_id.in_(sources), Story.source_id)))
    )

    if user_id is None:
        stmt = (
            select(Event)
            .join(StoryEvent, StoryEvent.event_id == Event.id)
            .join(Story, Story.id == StoryEvent.story_id)
            .where(
                Event.first_seen_at >= since,
                Story.kind == StoryKind.news,
            )
            .group_by(Event.id)
            .having(source_hits > 0)
            .order_by(outlet_count.desc(), Event.first_seen_at.desc())
            .limit(limit)
        )
        events = list((await session.scalars(stmt)).unique().all())
        return [(e, False, False) for e in events]

    stmt = (
        select(Event, EventStatus.read, EventStatus.dismissed)
        .join(StoryEvent, StoryEvent.event_id == Event.id)
        .join(Story, Story.id == StoryEvent.story_id)
        .outerjoin(
            EventStatus,
            (EventStatus.event_id == Event.id) & (EventStatus.user_id == user_id),
        )
        .where(
            Event.first_seen_at >= since,
            Story.kind == StoryKind.news,
            or_(EventStatus.dismissed.is_(False), EventStatus.dismissed.is_(None)),
        )
        .group_by(Event.id, EventStatus.read, EventStatus.dismissed)
        .having(source_hits > 0)
        .order_by(outlet_count.desc(), Event.first_seen_at.desc())
        .limit(limit)
    )
    rows = (await session.execute(stmt)).all()
    return [(event, bool(read), bool(dismissed)) for event, read, dismissed in rows]


async def _events_list_for_user(
    session: SessionDep,
    user_id: uuid.UUID | None,
    *,
    limit: int = 15,
) -> EventList:
    settings = get_settings()
    min_outlets: int = settings.event_min_outlets
    # Fetch a wider candidate pool, then filter by outlet threshold.
    loaded = await _load_events_for_user(session, user_id, limit=max(limit * 3, 45))
    all_story_ids: list[uuid.UUID] = []

    coverage_by_event: dict[uuid.UUID, list[EventCoverageOut]] = {}
    for event, _read, _dismissed in loaded:
        coverage = await _build_coverage_rows(session, user_id, event.id)
        coverage_by_event[event.id] = coverage
        all_story_ids.extend(c.story_id for c in coverage)

    if user_id is None:
        friend_map: dict[uuid.UUID, list[FriendStarOut]] = {}
        activity = await global_activity_by_story(session, all_story_ids)
        profiles: dict[uuid.UUID, Profile] = {}
    else:
        friend_profiles = await friend_stars_by_story(session, user_id, all_story_ids)
        friend_map = {
            sid: [
                FriendStarOut(user_id=p.id, display_name=display_name(p)) for p in profiles
            ]
            for sid, profiles in friend_profiles.items()
        }
        activity = await friend_activity_by_story(session, user_id, all_story_ids)
        profiles = await friend_profiles_map(session, user_id)

    summaries: list[EventSummaryOut] = []
    for event, event_read, event_dismissed in loaded:
        coverage = coverage_by_event[event.id]
        summary = await _event_to_summary(
            session,
            user_id,
            event,
            coverage,
            friend_map,
            activity,
            profiles,
            event_read=event_read,
            event_dismissed=event_dismissed,
        )
        if summary.outlet_count >= min_outlets:
            summaries.append(summary)

    summaries.sort(key=lambda e: (e.read, -e.outlet_count, -e.first_seen_at.timestamp()))
    return EventList(items=summaries[:limit], total=len(summaries))


@router.get("/today", response_model=EventList)
async def events_today(
    session: SessionDep,
    user: CurrentUser,
    limit: int = Query(default=15, le=50, ge=1),
) -> EventList:
    """News event clusters from the user's followed sources (inbox candidates)."""
    return await _events_list_for_user(session, user.id, limit=limit)


@router.get("/{event_id}", response_model=EventDetailOut)
async def get_event(
    event_id: uuid.UUID,
    session: SessionDep,
    user: CurrentUser,
) -> EventDetailOut:
    event = await session.get(Event, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "event not found")

    coverage = await _build_coverage_rows(session, user.id, event_id)
    story_ids = [c.story_id for c in coverage]
    friend_profiles = await friend_stars_by_story(session, user.id, story_ids)
    friend_map = {
        sid: [FriendStarOut(user_id=p.id, display_name=display_name(p)) for p in profiles]
        for sid, profiles in friend_profiles.items()
    }
    activity = await friend_activity_by_story(session, user.id, story_ids)
    profiles = await friend_profiles_map(session, user.id)

    status_row = await session.get(
        EventStatus, {"user_id": user.id, "event_id": event_id}
    )
    event_read = bool(status_row.read) if status_row is not None else False
    event_dismissed = bool(status_row.dismissed) if status_row is not None else False

    summary = await _event_to_summary(
        session,
        user.id,
        event,
        coverage,
        friend_map,
        activity,
        profiles,
        event_read=event_read,
        event_dismissed=event_dismissed,
    )
    return EventDetailOut.model_validate(summary)


async def today_payload(session: SessionDep, user: OptionalUser) -> TodayOut:
    """Build the combined inbox Today screen payload."""
    settings = get_settings()
    user_id: uuid.UUID | None = user.id if user is not None else None
    window_since = datetime.now(UTC) - timedelta(days=settings.inbox_candidate_days)

    new_since: datetime | None = None
    if user_id is not None:
        profile = await session.get(Profile, user_id)
        if profile is not None:
            new_since = profile.last_opened_at
            profile.last_opened_at = datetime.now(UTC)

    events = await _events_list_for_user(session, user_id, limit=30)
    sources = _source_subquery(user_id)

    if user_id is None:
        stmt = (
            select(Story, Source)
            .outerjoin(Source, Source.id == Story.source_id)
            .where(
                Story.source_id.in_(sources),
                Story.kind == StoryKind.analysis,
                Story.archived.is_(False),
                Story.created_at >= window_since,
            )
            .order_by(Story.created_at.desc())
            .limit(30)
        )
        guest_rows = (await session.execute(stmt)).all()
        story_ids = [story.id for story, _ in guest_rows]
        activity = await global_activity_by_story(session, story_ids)
        analysis_items: list[StoryWithStatus] = []
        for story, source in guest_rows:
            model = StoryWithStatus.model_validate(story)
            model.source_name = source.name if source else None
            model.source_image_url = source.image_url if source else None
            model.read = False
            model.starred = False
            model.dismissed = False
            model.my_reaction = None
            model.friend_stars = []
            read_ids, commented_n, reactions = aggregate_engagement(activity, [story.id])
            model.engagement = FriendEngagementOut(
                read=len(read_ids),
                commented=commented_n,
                reactions=reactions,
                readers=[],
            )
            analysis_items.append(model)

        return TodayOut(
            events=events,
            analysis=StoryList(
                items=analysis_items, total=len(analysis_items), limit=30, offset=0
            ),
            friend_pick_count=0,
            new_since=None,
        )

    # Analysis inbox = followed sources UNION friend reacted/commented.
    friends = await accepted_friend_ids(session, user_id)
    friend_signal = union(
        select(StoryReaction.story_id).where(StoryReaction.user_id.in_(friends)),
        select(Comment.story_id).where(Comment.user_id.in_(friends)),
    ).subquery()

    likes_col = func.count(StoryReaction.story_id)
    likes_sq = (
        select(
            StoryReaction.story_id.label("sid"),
            likes_col.label("likes"),
        )
        .where(StoryReaction.user_id.in_(friends))
        .group_by(StoryReaction.story_id)
        .subquery()
    )
    friend_likes = func.coalesce(likes_sq.c.likes, 0)
    auth_stmt = (
        select(Story, Source, StoryStatus.read, StoryStatus.starred, StoryStatus.dismissed)
        .outerjoin(Source, Source.id == Story.source_id)
        .outerjoin(
            StoryStatus,
            (StoryStatus.story_id == Story.id) & (StoryStatus.user_id == user_id),
        )
        .outerjoin(likes_sq, likes_sq.c.sid == Story.id)
        .where(
            or_(
                Story.source_id.in_(sources),
                Story.id.in_(select(friend_signal.c.story_id)),
            ),
            Story.kind == StoryKind.analysis,
            Story.archived.is_(False),
            Story.created_at >= window_since,
            or_(StoryStatus.dismissed.is_(False), StoryStatus.dismissed.is_(None)),
        )
        .order_by(friend_likes.desc(), Story.created_at.desc())
        .limit(40)
    )
    auth_rows = (await session.execute(auth_stmt)).all()
    story_ids = [story.id for story, _, _, _, _ in auth_rows]
    friend_profiles = await friend_stars_by_story(session, user_id, story_ids)
    activity = await friend_activity_by_story(session, user_id, story_ids)
    my_reactions = await my_reactions_by_story(session, user_id, story_ids)
    profiles = await friend_profiles_map(session, user_id)
    auth_analysis_items: list[StoryWithStatus] = []
    friend_pick_count = 0
    for story, source, read, starred, dismissed in auth_rows:
        fs = [
            FriendStarOut(user_id=p.id, display_name=display_name(p))
            for p in friend_profiles.get(story.id, [])
        ]
        if fs:
            friend_pick_count += 1
        model = StoryWithStatus.model_validate(story)
        model.source_name = source.name if source else None
        model.source_image_url = source.image_url if source else None
        model.read = bool(read)
        model.starred = bool(starred)
        model.dismissed = bool(dismissed)
        model.my_reaction = my_reactions.get(story.id)
        model.friend_stars = fs
        read_ids, commented_n, reactions = aggregate_engagement(activity, [story.id])
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
        auth_analysis_items.append(model)

    # Unread first (stable within each group via prior friend_likes/recency order).
    auth_analysis_items.sort(key=lambda s: s.read)

    return TodayOut(
        events=events,
        analysis=StoryList(
            items=auth_analysis_items,
            total=len(auth_analysis_items),
            limit=40,
            offset=0,
        ),
        friend_pick_count=friend_pick_count,
        new_since=new_since,
    )
