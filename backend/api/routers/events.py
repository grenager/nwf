"""News event clusters: Today feed and coverage comparison."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import distinct, func, or_, select, union

from api.deps import CurrentUser, OptionalUser, SessionDep
from api.friends import (
    StoryActivity,
    accepted_friend_ids,
    aggregate_engagement,
    CURATED_SOURCE_LIMIT,
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


async def _source_ids(
    session: SessionDep, user_id: uuid.UUID | None
) -> list[uuid.UUID]:
    """Concrete followed/curated source ids (avoids slow scalar subqueries)."""
    if user_id is not None:
        rows = await session.scalars(
            select(UserSource.source_id).where(UserSource.user_id == user_id)
        )
        return list(rows.all())
    rows = await session.scalars(
        select(Source.id)
        .order_by(Source.prominence.desc().nulls_last(), Source.name)
        .limit(CURATED_SOURCE_LIMIT)
    )
    return list(rows.all())


async def _build_coverage_rows(
    session: SessionDep,
    user_id: uuid.UUID | None,
    event_id: uuid.UUID,
) -> list[EventCoverageOut]:
    by_event = await _build_coverage_by_events(session, user_id, [event_id])
    return by_event.get(event_id, [])


async def _build_coverage_by_events(
    session: SessionDep,
    user_id: uuid.UUID | None,
    event_ids: list[uuid.UUID],
) -> dict[uuid.UUID, list[EventCoverageOut]]:
    """Batch-load coverage for many events in a single query."""
    if not event_ids:
        return {}

    # Only the fields needed for inbox cards / event modal — never pull full_text.
    cols = [
        StoryEvent.event_id,
        Story.id,
        Story.source_id,
        Story.full_headline,
        Story.summary,
        Story.image_url,
        Story.article_url,
        Source,
    ]
    base = (
        select(*cols)
        .join(Story, Story.id == StoryEvent.story_id)
        .outerjoin(Source, Source.id == Story.source_id)
        .where(StoryEvent.event_id.in_(event_ids))
        .order_by(
            StoryEvent.event_id,
            Source.prominence.desc().nulls_last(),
            Source.name,
        )
    )

    result: dict[uuid.UUID, list[EventCoverageOut]] = {eid: [] for eid in event_ids}
    if user_id is not None:
        stmt = base.add_columns(StoryStatus.read, StoryStatus.starred).outerjoin(
            StoryStatus,
            (StoryStatus.story_id == Story.id) & (StoryStatus.user_id == user_id),
        )
        rows = (await session.execute(stmt)).all()
        for (
            event_id,
            story_id,
            source_id,
            headline,
            summary,
            story_image,
            article_url,
            source,
            read,
            starred,
        ) in rows:
            bias: float | None = (
                float(source.bias_score)
                if source and source.bias_score is not None
                else None
            )
            result[event_id].append(
                EventCoverageOut(
                    story_id=story_id,
                    source_id=source_id,
                    source_name=source.name if source else "Unknown",
                    bias_score=bias,
                    prominence=int(source.prominence) if source else 0,
                    image_url=source.image_url if source else story_image,
                    story_image_url=story_image,
                    full_headline=headline,
                    summary=summary,
                    article_url=article_url,
                    read=bool(read),
                    starred=bool(starred),
                )
            )
        return result

    rows = (await session.execute(base)).all()
    for (
        event_id,
        story_id,
        source_id,
        headline,
        summary,
        story_image,
        article_url,
        source,
    ) in rows:
        bias = (
            float(source.bias_score)
            if source and source.bias_score is not None
            else None
        )
        result[event_id].append(
            EventCoverageOut(
                story_id=story_id,
                source_id=source_id,
                source_name=source.name if source else "Unknown",
                bias_score=bias,
                prominence=int(source.prominence) if source else 0,
                image_url=source.image_url if source else story_image,
                story_image_url=story_image,
                full_headline=headline,
                summary=summary,
                article_url=article_url,
                read=False,
                starred=False,
            )
        )
    return result


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
    min_outlets: int | None = None,
    source_ids: list[uuid.UUID] | None = None,
) -> list[tuple[Event, bool, bool]]:
    """Recent inbox candidate events.

    Returns (event, read, dismissed) tuples. Dismissed rows are excluded for
    authenticated users; guests always get (event, False, False).
    """
    settings = get_settings()
    window_days: int = days if days is not None else settings.inbox_candidate_days
    outlet_floor: int = (
        min_outlets if min_outlets is not None else settings.event_min_outlets
    )
    since = datetime.now(UTC) - timedelta(days=window_days)
    ids: list[uuid.UUID] = (
        source_ids if source_ids is not None else await _source_ids(session, user_id)
    )
    if not ids:
        return []

    outlet_count = func.count(distinct(Story.source_id))
    # Prefer EXISTS over COUNT(CASE WHEN source IN subquery) — the latter tanks
    # over multi-day windows against remote Postgres.
    touches_sources = (
        select(StoryEvent.story_id)
        .join(Story, Story.id == StoryEvent.story_id)
        .where(
            StoryEvent.event_id == Event.id,
            Story.source_id.in_(ids),
            Story.kind == StoryKind.news,
        )
        .correlate(Event)
        .exists()
    )

    if user_id is None:
        stmt = (
            select(Event)
            .join(StoryEvent, StoryEvent.event_id == Event.id)
            .join(Story, Story.id == StoryEvent.story_id)
            .where(
                Event.first_seen_at >= since,
                Story.kind == StoryKind.news,
                touches_sources,
            )
            .group_by(Event.id)
            .having(outlet_count >= outlet_floor)
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
            touches_sources,
            or_(EventStatus.dismissed.is_(False), EventStatus.dismissed.is_(None)),
        )
        .group_by(Event.id, EventStatus.read, EventStatus.dismissed)
        .having(outlet_count >= outlet_floor)
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
    source_ids: list[uuid.UUID] | None = None,
) -> EventList:
    settings = get_settings()
    min_outlets: int = settings.event_min_outlets
    ids: list[uuid.UUID] = (
        source_ids if source_ids is not None else await _source_ids(session, user_id)
    )
    loaded = await _load_events_for_user(
        session,
        user_id,
        limit=limit,
        min_outlets=min_outlets,
        source_ids=ids,
    )
    event_ids: list[uuid.UUID] = [event.id for event, _r, _d in loaded]
    coverage_by_event = await _build_coverage_by_events(session, user_id, event_ids)
    all_story_ids: list[uuid.UUID] = [
        c.story_id for coverage in coverage_by_event.values() for c in coverage
    ]

    if user_id is None:
        # Guests skip global engagement aggregation — it dominates /today latency
        # against hosted Postgres and isn't meaningful without an account.
        friend_map: dict[uuid.UUID, list[FriendStarOut]] = {}
        activity: dict[uuid.UUID, StoryActivity] = {}
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
        coverage = coverage_by_event.get(event.id, [])
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

    source_ids = await _source_ids(session, user_id)
    events = await _events_list_for_user(
        session, user_id, limit=12, source_ids=source_ids
    )

    if user_id is None:
        if not source_ids:
            return TodayOut(
                events=events,
                analysis=StoryList(items=[], total=0, limit=20, offset=0),
                friend_pick_count=0,
                new_since=None,
            )
        stmt = (
            select(
                Story.id,
                Story.article_url,
                Story.source_id,
                Story.full_headline,
                Story.summary,
                Story.image_url,
                Story.author_names,
                Story.kind,
                Story.archived,
                Story.created_at,
                Story.updated_at,
                Story.last_scraped_at,
                Story.section,
                Story.type,
                Source,
            )
            .outerjoin(Source, Source.id == Story.source_id)
            .where(
                Story.source_id.in_(source_ids),
                Story.kind == StoryKind.analysis,
                Story.archived.is_(False),
                Story.created_at >= window_since,
            )
            .order_by(Story.created_at.desc())
            .limit(20)
        )
        guest_rows = (await session.execute(stmt)).all()
        analysis_items: list[StoryWithStatus] = []
        for row in guest_rows:
            (
                story_id,
                article_url,
                source_id,
                headline,
                summary,
                image_url,
                author_names,
                kind,
                archived,
                created_at,
                updated_at,
                last_scraped_at,
                section,
                story_type,
                source,
            ) = row
            trimmed_summary: str | None = summary
            if trimmed_summary and len(trimmed_summary) > 280:
                trimmed_summary = trimmed_summary[:280]
            model = StoryWithStatus(
                id=story_id,
                article_url=article_url,
                source_id=source_id,
                full_headline=headline,
                summary=trimmed_summary,
                full_text=None,
                section=section,
                type=story_type,
                image_url=image_url,
                author_names=list(author_names or []),
                kind=kind,
                archived=bool(archived),
                last_scraped_at=last_scraped_at,
                created_at=created_at,
                updated_at=updated_at,
                source_name=source.name if source else None,
                source_image_url=source.image_url if source else None,
                read=False,
                starred=False,
                dismissed=False,
                my_reaction=None,
                friend_stars=[],
                engagement=FriendEngagementOut(),
            )
            analysis_items.append(model)

        # Drop bulky coverage summaries on the list payload; modal still has headlines.
        for item in events.items:
            for cov in item.coverage:
                if cov.summary and len(cov.summary) > 160:
                    cov.summary = cov.summary[:160]

        return TodayOut(
            events=events,
            analysis=StoryList(
                items=analysis_items, total=len(analysis_items), limit=20, offset=0
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
                Story.source_id.in_(source_ids),
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
