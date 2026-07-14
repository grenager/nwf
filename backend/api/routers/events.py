"""News event clusters: Today feed and coverage comparison."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import TypeVar

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, or_, select, union
from sqlalchemy.ext.asyncio import AsyncSession

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
from core.db import get_sessionmaker
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

_T = TypeVar("_T")


async def _run_read(fn: Callable[[AsyncSession], Awaitable[_T]]) -> _T:
    """Run a read-only coroutine on a fresh session (safe to parallelize)."""
    factory = get_sessionmaker()
    async with factory() as session:
        return await fn(session)

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
    source_names: list[str] | None = None,
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
        outlet_count=event.outlet_count if event.outlet_count else len(outlet_ids),
        story_count=len(coverage) if coverage else max(len(outlet_ids), 1),
        is_scoop=(event.outlet_count if event.outlet_count else len(outlet_ids)) <= 1,
        source_names=source_names
        if source_names
        else list(
            dict.fromkeys(
                c.source_name for c in coverage if c.source_name
            )
        ),
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


async def _build_source_names_and_leads(
    session: SessionDep,
    user_id: uuid.UUID | None,
    event_ids: list[uuid.UUID],
) -> tuple[dict[uuid.UUID, list[str]], dict[uuid.UUID, EventCoverageOut | None]]:
    """Light Today payload: ordered source names + one lead coverage row per event."""
    if not event_ids:
        return {}, {}

    stmt = (
        select(
            StoryEvent.event_id,
            Story.id,
            Story.source_id,
            Story.full_headline,
            Story.summary,
            Story.image_url,
            Story.article_url,
            Source.name,
            Source.image_url,
            Source.bias_score,
            Source.prominence,
        )
        .join(Story, Story.id == StoryEvent.story_id)
        .outerjoin(Source, Source.id == Story.source_id)
        .where(StoryEvent.event_id.in_(event_ids))
        .order_by(
            StoryEvent.event_id,
            Source.prominence.desc().nulls_last(),
            Source.name,
        )
    )
    if user_id is not None:
        stmt = stmt.add_columns(StoryStatus.read, StoryStatus.starred).outerjoin(
            StoryStatus,
            (StoryStatus.story_id == Story.id) & (StoryStatus.user_id == user_id),
        )

    names_by_event: dict[uuid.UUID, list[str]] = {eid: [] for eid in event_ids}
    seen_names: dict[uuid.UUID, set[str]] = {eid: set() for eid in event_ids}
    lead_by_event: dict[uuid.UUID, EventCoverageOut | None] = {
        eid: None for eid in event_ids
    }

    rows = (await session.execute(stmt)).all()
    for row in rows:
        if user_id is not None:
            (
                event_id,
                story_id,
                source_id,
                headline,
                summary,
                story_image,
                article_url,
                source_name,
                source_image,
                bias_score,
                prominence,
                read,
                starred,
            ) = row
        else:
            (
                event_id,
                story_id,
                source_id,
                headline,
                summary,
                story_image,
                article_url,
                source_name,
                source_image,
                bias_score,
                prominence,
            ) = row
            read, starred = False, False

        name: str = source_name or "Unknown"
        if name not in seen_names[event_id]:
            seen_names[event_id].add(name)
            names_by_event[event_id].append(name)

        if lead_by_event[event_id] is None:
            trimmed: str | None = summary
            if trimmed and len(trimmed) > 160:
                trimmed = trimmed[:160]
            lead_by_event[event_id] = EventCoverageOut(
                story_id=story_id,
                source_id=source_id,
                source_name=name,
                bias_score=float(bias_score) if bias_score is not None else None,
                prominence=int(prominence) if prominence is not None else 0,
                image_url=source_image or story_image,
                story_image_url=story_image,
                full_headline=headline,
                summary=trimmed,
                article_url=article_url,
                read=bool(read),
                starred=bool(starred),
            )

    return names_by_event, lead_by_event


async def _load_events_for_user(
    session: SessionDep,
    user_id: uuid.UUID | None,
    *,
    days: int | None = None,
    limit: int = 50,
    min_outlets: int | None = None,
    source_ids: list[uuid.UUID] | None = None,
) -> list[tuple[Event, bool, bool]]:
    """Recent inbox candidate events using denormalized outlet_count.

    Guests: world events with breadth (no join). Authenticated users: must also
    touch a followed source via EXISTS.
    """
    settings = get_settings()
    window_days: int = days if days is not None else settings.inbox_candidate_days
    outlet_floor: int = (
        min_outlets if min_outlets is not None else settings.event_min_outlets
    )
    since = datetime.now(UTC) - timedelta(days=window_days)

    if user_id is None:
        stmt = (
            select(Event)
            .where(
                Event.first_seen_at >= since,
                Event.outlet_count >= outlet_floor,
            )
            .order_by(Event.outlet_count.desc(), Event.first_seen_at.desc())
            .limit(limit)
        )
        events = list((await session.scalars(stmt)).all())
        return [(e, False, False) for e in events]

    ids: list[uuid.UUID] = (
        source_ids if source_ids is not None else await _source_ids(session, user_id)
    )
    if not ids:
        return []

    # Invert the lookup: start from followed news stories (indexed), then
    # restrict to broad recent events. Avoids a correlated EXISTS over all events.
    candidate_ids = (
        select(StoryEvent.event_id)
        .join(Story, Story.id == StoryEvent.story_id)
        .join(Event, Event.id == StoryEvent.event_id)
        .where(
            Story.source_id.in_(ids),
            Story.kind == StoryKind.news,
            Event.first_seen_at >= since,
            Event.outlet_count >= outlet_floor,
        )
        .distinct()
        .subquery()
    )
    stmt = (
        select(Event, EventStatus.read, EventStatus.dismissed)
        .join(candidate_ids, candidate_ids.c.event_id == Event.id)
        .outerjoin(
            EventStatus,
            (EventStatus.event_id == Event.id) & (EventStatus.user_id == user_id),
        )
        .where(
            or_(EventStatus.dismissed.is_(False), EventStatus.dismissed.is_(None)),
            or_(EventStatus.read.is_(False), EventStatus.read.is_(None)),
        )
        .order_by(Event.outlet_count.desc(), Event.first_seen_at.desc())
        .limit(limit)
    )
    rows = (await session.execute(stmt)).all()
    return [(event, bool(read), bool(dismissed)) for event, read, dismissed in rows]


async def _member_story_ids_by_event(
    session: SessionDep, event_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[uuid.UUID]]:
    """Map event_id -> ids of every member story in the cluster."""
    if not event_ids:
        return {}
    rows = (
        await session.execute(
            select(StoryEvent.event_id, StoryEvent.story_id).where(
                StoryEvent.event_id.in_(event_ids)
            )
        )
    ).all()
    out: dict[uuid.UUID, list[uuid.UUID]] = {eid: [] for eid in event_ids}
    for event_id, story_id in rows:
        out.setdefault(event_id, []).append(story_id)
    return out


async def _events_list_for_user(
    session: SessionDep,
    user_id: uuid.UUID | None,
    *,
    limit: int = 15,
    source_ids: list[uuid.UUID] | None = None,
    full_coverage: bool = False,
) -> EventList:
    """Build event list for Today (teaser) or detail-ready (full_coverage)."""
    settings = get_settings()
    min_outlets: int = settings.event_min_outlets
    loaded = await _load_events_for_user(
        session,
        user_id,
        limit=limit,
        min_outlets=min_outlets,
        source_ids=source_ids,
    )
    event_ids: list[uuid.UUID] = [event.id for event, _r, _d in loaded]

    if full_coverage:
        coverage_by_event = await _build_coverage_by_events(session, user_id, event_ids)
        names_by_event: dict[uuid.UUID, list[str]] = {
            eid: list(
                dict.fromkeys(c.source_name for c in cov if c.source_name)
            )
            for eid, cov in coverage_by_event.items()
        }
    else:
        names_by_event, leads = await _build_source_names_and_leads(
            session, user_id, event_ids
        )
        coverage_by_event = {
            eid: ([lead] if lead is not None else [])
            for eid, lead in leads.items()
        }

    # Friend engagement is aggregated over every member story of an event. The
    # inbox list only loads a lead coverage row, so fetch full membership here.
    if full_coverage:
        member_ids_by_event: dict[uuid.UUID, list[uuid.UUID]] = {
            eid: [c.story_id for c in cov] for eid, cov in coverage_by_event.items()
        }
    elif user_id is not None:
        member_ids_by_event = await _member_story_ids_by_event(session, event_ids)
    else:
        member_ids_by_event = {}

    all_story_ids: list[uuid.UUID] = [
        c.story_id for coverage in coverage_by_event.values() for c in coverage
    ]

    friend_map: dict[uuid.UUID, list[FriendStarOut]] = {}
    activity: dict[uuid.UUID, StoryActivity] = {}
    profiles: dict[uuid.UUID, Profile] = {}
    if user_id is not None:
        friends = await accepted_friend_ids(session, user_id)
        if friends:
            member_story_ids: list[uuid.UUID] = [
                sid for ids in member_ids_by_event.values() for sid in ids
            ]
            activity = await friend_activity_by_story(
                session, user_id, member_story_ids, friend_ids=friends
            )
            profiles = await friend_profiles_map(
                session, user_id, friend_ids=friends
            )
            if full_coverage and all_story_ids:
                friend_profiles = await friend_stars_by_story(
                    session, user_id, all_story_ids, friend_ids=friends
                )
                friend_map = {
                    sid: [
                        FriendStarOut(user_id=p.id, display_name=display_name(p))
                        for p in profs
                    ]
                    for sid, profs in friend_profiles.items()
                }

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
            source_names=names_by_event.get(event.id, []),
        )
        # Recompute engagement across all member stories (not just the lead).
        if user_id is not None:
            member_ids = member_ids_by_event.get(event.id, [])
            read_ids, commented_n, reactions = aggregate_engagement(
                activity, member_ids
            )
            summary.engagement = FriendEngagementOut(
                read=len(read_ids),
                commented=commented_n,
                reactions=reactions,
                readers=[
                    FriendMiniOut(
                        user_id=p.id,
                        display_name=display_name(p),
                        image_url=p.image_url,
                    )
                    for p in top_readers(read_ids, profiles)
                ],
            )
        if not full_coverage:
            summary.story_count = max(event.outlet_count, len(summary.source_names), 1)
            summary.outlet_count = event.outlet_count
            summary.is_scoop = event.outlet_count <= 1
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
    user: OptionalUser,
) -> EventDetailOut:
    event = await session.get(Event, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "event not found")

    user_id: uuid.UUID | None = user.id if user is not None else None
    coverage = await _build_coverage_rows(session, user_id, event_id)
    story_ids = [c.story_id for c in coverage]

    if user_id is None:
        friend_map: dict[uuid.UUID, list[FriendStarOut]] = {}
        activity: dict[uuid.UUID, StoryActivity] = {}
        profiles: dict[uuid.UUID, Profile] = {}
        event_read = False
        event_dismissed = False
    else:
        friend_profiles = await friend_stars_by_story(session, user_id, story_ids)
        friend_map = {
            sid: [
                FriendStarOut(user_id=p.id, display_name=display_name(p)) for p in profiles
            ]
            for sid, profiles in friend_profiles.items()
        }
        activity = await friend_activity_by_story(session, user_id, story_ids)
        profiles = await friend_profiles_map(session, user_id)
        status_row = await session.get(
            EventStatus, {"user_id": user_id, "event_id": event_id}
        )
        event_read = bool(status_row.read) if status_row is not None else False
        event_dismissed = bool(status_row.dismissed) if status_row is not None else False

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
    return EventDetailOut.model_validate(summary.model_dump())


def _analysis_row_to_story(row: tuple[object, ...]) -> StoryWithStatus:
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
        read,
        starred,
        dismissed,
    ) = row  # type: ignore[misc]
    trimmed_summary: str | None = summary if isinstance(summary, str) else None
    if trimmed_summary and len(trimmed_summary) > 280:
        trimmed_summary = trimmed_summary[:280]
    src = source  # Source | None
    return StoryWithStatus(
        id=story_id,  # type: ignore[arg-type]
        article_url=str(article_url),
        source_id=source_id,  # type: ignore[arg-type]
        full_headline=str(headline),
        summary=trimmed_summary,
        full_text=None,
        section=section if isinstance(section, str) else None,
        type=story_type if isinstance(story_type, str) else None,
        image_url=image_url if isinstance(image_url, str) else None,
        author_names=list(author_names or []),  # type: ignore[arg-type]
        kind=kind,  # type: ignore[arg-type]
        archived=bool(archived),
        last_scraped_at=last_scraped_at,  # type: ignore[arg-type]
        created_at=created_at,  # type: ignore[arg-type]
        updated_at=updated_at,  # type: ignore[arg-type]
        source_name=src.name if src is not None else None,
        source_image_url=src.image_url if src is not None else None,
        read=bool(read),
        starred=bool(starred),
        dismissed=bool(dismissed),
        engagement=FriendEngagementOut(),
    )


_ANALYSIS_COLS = (
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
    StoryStatus.read,
    StoryStatus.starred,
    StoryStatus.dismissed,
)


async def _touch_last_opened(
    session: AsyncSession, user_id: uuid.UUID
) -> datetime | None:
    profile = await session.get(Profile, user_id)
    if profile is None:
        return None
    previous = profile.last_opened_at
    profile.last_opened_at = datetime.now(UTC)
    await session.commit()
    return previous


async def _auth_followed_analysis(
    session: AsyncSession,
    user_id: uuid.UUID,
    source_ids: list[uuid.UUID],
    window_since: datetime,
) -> list[tuple[object, ...]]:
    if not source_ids:
        return []
    stmt = (
        select(*_ANALYSIS_COLS)
        .outerjoin(Source, Source.id == Story.source_id)
        .outerjoin(
            StoryStatus,
            (StoryStatus.story_id == Story.id) & (StoryStatus.user_id == user_id),
        )
        .where(
            Story.source_id.in_(source_ids),
            Story.kind == StoryKind.analysis,
            Story.archived.is_(False),
            Story.created_at >= window_since,
            or_(StoryStatus.dismissed.is_(False), StoryStatus.dismissed.is_(None)),
            or_(StoryStatus.read.is_(False), StoryStatus.read.is_(None)),
        )
        .order_by(Story.created_at.desc())
        .limit(20)
    )
    return list((await session.execute(stmt)).all())


async def _auth_friend_analysis(
    session: AsyncSession,
    user_id: uuid.UUID,
    friends: list[uuid.UUID],
    window_since: datetime,
) -> tuple[list[uuid.UUID], list[tuple[object, ...]]]:
    """Recent analysis friend-picks only (window + kind), plus story rows."""
    if not friends:
        return [], []

    # Bound the union to recent analysis — never pull a friend's full reaction history.
    pick_stmt = union(
        select(StoryReaction.story_id)
        .join(Story, Story.id == StoryReaction.story_id)
        .where(
            StoryReaction.user_id.in_(friends),
            Story.kind == StoryKind.analysis,
            Story.archived.is_(False),
            Story.created_at >= window_since,
        ),
        select(Comment.story_id)
        .join(Story, Story.id == Comment.story_id)
        .where(
            Comment.user_id.in_(friends),
            Story.kind == StoryKind.analysis,
            Story.archived.is_(False),
            Story.created_at >= window_since,
        ),
    )
    friend_pick_ids = list((await session.scalars(pick_stmt)).all())
    if not friend_pick_ids:
        return [], []

    rows = list(
        (
            await session.execute(
                select(*_ANALYSIS_COLS)
                .outerjoin(Source, Source.id == Story.source_id)
                .outerjoin(
                    StoryStatus,
                    (StoryStatus.story_id == Story.id)
                    & (StoryStatus.user_id == user_id),
                )
                .where(
                    Story.id.in_(friend_pick_ids),
                    or_(
                        StoryStatus.dismissed.is_(False),
                        StoryStatus.dismissed.is_(None),
                    ),
                    or_(StoryStatus.read.is_(False), StoryStatus.read.is_(None)),
                )
                .order_by(Story.created_at.desc())
                .limit(20)
            )
        ).all()
    )
    return friend_pick_ids, rows


async def today_payload(session: SessionDep, user: OptionalUser) -> TodayOut:
    """Build the combined inbox Today screen payload.

    Hosted Postgres RTT dominates (~1s+/query), so independent reads run on
    separate sessions via asyncio.gather.
    """
    settings = get_settings()
    user_id: uuid.UUID | None = user.id if user is not None else None
    window_since = datetime.now(UTC) - timedelta(days=settings.inbox_candidate_days)

    if user_id is None:
        events, source_ids = await asyncio.gather(
            _run_read(lambda s: _events_list_for_user(s, None, limit=12)),
            _run_read(lambda s: _source_ids(s, None)),
        )
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

        return TodayOut(
            events=events,
            analysis=StoryList(
                items=analysis_items, total=len(analysis_items), limit=20, offset=0
            ),
            friend_pick_count=0,
            new_since=None,
        )

    # Wave 1: identity lookups (independent).
    new_since, source_ids, friends = await asyncio.gather(
        _run_read(lambda s: _touch_last_opened(s, user_id)),
        _run_read(lambda s: _source_ids(s, user_id)),
        _run_read(lambda s: accepted_friend_ids(s, user_id)),
    )

    # Wave 2: feed body in parallel across sessions.
    events, followed_rows, friend_pack = await asyncio.gather(
        _run_read(
            lambda s: _events_list_for_user(
                s, user_id, limit=12, source_ids=source_ids
            )
        ),
        _run_read(
            lambda s: _auth_followed_analysis(
                s, user_id, source_ids, window_since
            )
        ),
        _run_read(
            lambda s: _auth_friend_analysis(s, user_id, friends, window_since)
        ),
    )
    friend_pick_ids, friend_rows = friend_pack

    # Friend picks first, then followed-by-recency; cap at 20.
    merged_rows: list[tuple[object, ...]] = list(friend_rows) + list(followed_rows)
    seen_story: set[uuid.UUID] = set()
    ordered_rows: list[tuple[object, ...]] = []
    for row in merged_rows:
        sid = row[0]
        if not isinstance(sid, uuid.UUID) or sid in seen_story:
            continue
        seen_story.add(sid)
        ordered_rows.append(row)
        if len(ordered_rows) >= 20:
            break

    story_ids = [row[0] for row in ordered_rows if isinstance(row[0], uuid.UUID)]
    friend_profiles, my_reactions, activity, profiles = await asyncio.gather(
        _run_read(
            lambda s: friend_stars_by_story(
                s, user_id, story_ids, friend_ids=friends
            )
        ),
        _run_read(lambda s: my_reactions_by_story(s, user_id, story_ids)),
        _run_read(
            lambda s: friend_activity_by_story(
                s, user_id, story_ids, friend_ids=friends
            )
        ),
        _run_read(lambda s: friend_profiles_map(s, user_id, friend_ids=friends)),
    )

    friend_pick_set = set(friend_pick_ids)
    auth_analysis_items: list[StoryWithStatus] = []
    friend_pick_count = 0
    for row in ordered_rows:
        model = _analysis_row_to_story(row)
        fs = [
            FriendStarOut(user_id=p.id, display_name=display_name(p))
            for p in friend_profiles.get(model.id, [])
        ]
        model.friend_stars = fs
        model.my_reaction = my_reactions.get(model.id)
        read_ids, commented_n, reactions = aggregate_engagement(activity, [model.id])
        model.engagement = FriendEngagementOut(
            read=len(read_ids),
            commented=commented_n,
            reactions=reactions,
            readers=[
                FriendMiniOut(
                    user_id=p.id,
                    display_name=display_name(p),
                    image_url=p.image_url,
                )
                for p in top_readers(read_ids, profiles)
            ],
        )
        if model.id in friend_pick_set or fs:
            friend_pick_count += 1
        auth_analysis_items.append(model)

    auth_analysis_items.sort(key=lambda s: s.read)

    return TodayOut(
        events=events,
        analysis=StoryList(
            items=auth_analysis_items,
            total=len(auth_analysis_items),
            limit=20,
            offset=0,
        ),
        friend_pick_count=friend_pick_count,
        new_since=new_since,
    )
