"""Current-user endpoints: profile, preferences, sources, read/star/dismiss state."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from api.deps import CurrentUser, SessionDep
from api.routers.events import (
    _build_source_names_and_leads,
    _event_to_summary,
)
from api.schemas import (
    DismissMark,
    EventList,
    EventSummaryOut,
    FriendEngagementOut,
    PreferencesUpdate,
    ProfileOut,
    ReactionSet,
    ReadMark,
    SourceOut,
    StarMark,
    StoryList,
    StoryWithStatus,
    UserSourcesUpdate,
)
from core.models import (
    Event,
    EventStatus,
    Profile,
    Source,
    Story,
    StoryKind,
    StoryReaction,
    StoryStatus,
    UserSource,
)
from core.reactions import REACTION_SET

router = APIRouter(prefix="/me", tags=["me"])


async def _ensure_profile(session: SessionDep, user: CurrentUser) -> Profile:
    profile = await session.get(Profile, user.id)
    if profile is None:
        # The auth trigger normally creates this; self-heal if missing.
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


@router.post("/dismiss", status_code=status.HTTP_204_NO_CONTENT)
async def dismiss_story(
    payload: DismissMark, session: SessionDep, user: CurrentUser
) -> None:
    """Dismiss a story from the inbox (analysis lane)."""
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


@router.post("/events/{event_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_event_read(
    event_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> None:
    event = await session.get(Event, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "event not found")
    stmt = (
        pg_insert(EventStatus)
        .values(
            user_id=user.id,
            event_id=event_id,
            read=True,
            read_at=func.now(),
        )
        .on_conflict_do_update(
            index_elements=[EventStatus.user_id, EventStatus.event_id],
            set_={
                "read": True,
                "read_at": func.now(),
                "updated_at": func.now(),
            },
        )
    )
    await session.execute(stmt)


@router.delete("/events/{event_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def unmark_event_read(
    event_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> None:
    status_row = await session.get(
        EventStatus, {"user_id": user.id, "event_id": event_id}
    )
    if status_row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "event status not found")
    status_row.read = False
    status_row.read_at = None


@router.post("/events/{event_id}/dismiss", status_code=status.HTTP_204_NO_CONTENT)
async def dismiss_event(
    event_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> None:
    event = await session.get(Event, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "event not found")
    stmt = (
        pg_insert(EventStatus)
        .values(
            user_id=user.id,
            event_id=event_id,
            dismissed=True,
            dismissed_at=func.now(),
        )
        .on_conflict_do_update(
            index_elements=[EventStatus.user_id, EventStatus.event_id],
            set_={
                "dismissed": True,
                "dismissed_at": func.now(),
                "updated_at": func.now(),
            },
        )
    )
    await session.execute(stmt)


@router.delete("/events/{event_id}/dismiss", status_code=status.HTTP_204_NO_CONTENT)
async def undismiss_event(
    event_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> None:
    status_row = await session.get(
        EventStatus, {"user_id": user.id, "event_id": event_id}
    )
    if status_row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "event status not found")
    status_row.dismissed = False
    status_row.dismissed_at = None


@router.get("/archived/events", response_model=EventList)
async def list_archived_events(
    session: SessionDep,
    user: CurrentUser,
    limit: int = Query(default=50, le=100, ge=1),
) -> EventList:
    """Handled news events (read or dismissed), most recent action first."""
    last_action = func.greatest(EventStatus.dismissed_at, EventStatus.read_at)
    rows = (
        await session.execute(
            select(Event, EventStatus.read, EventStatus.dismissed)
            .join(
                EventStatus,
                (EventStatus.event_id == Event.id)
                & (EventStatus.user_id == user.id),
            )
            .where(
                or_(
                    EventStatus.dismissed.is_(True),
                    EventStatus.read.is_(True),
                )
            )
            .order_by(last_action.desc().nulls_last())
            .limit(limit)
        )
    ).all()
    event_ids = [event.id for event, _read, _dismissed in rows]
    names_by_event, leads = await _build_source_names_and_leads(
        session, user.id, event_ids
    )
    items: list[EventSummaryOut] = []
    for event, event_read, event_dismissed in rows:
        lead = leads.get(event.id)
        coverage = [lead] if lead is not None else []
        summary = await _event_to_summary(
            session,
            user.id,
            event,
            coverage,
            {},
            None,
            None,
            event_read=bool(event_read),
            event_dismissed=bool(event_dismissed),
            source_names=names_by_event.get(event.id, []),
        )
        summary.story_count = max(event.outlet_count, len(summary.source_names), 1)
        summary.outlet_count = event.outlet_count
        summary.is_scoop = event.outlet_count <= 1
        items.append(summary)
    return EventList(items=items, total=len(items))


@router.get("/archived/analysis", response_model=StoryList)
async def list_archived_analysis(
    session: SessionDep,
    user: CurrentUser,
    limit: int = Query(default=50, le=100, ge=1),
) -> StoryList:
    """Handled analysis (read or dismissed), most recent action first."""
    last_action = func.greatest(StoryStatus.dismissed_at, StoryStatus.read_at)
    rows = (
        await session.execute(
            select(
                Story,
                StoryStatus.read,
                StoryStatus.starred,
                StoryStatus.dismissed,
                Source,
            )
            .join(
                StoryStatus,
                (StoryStatus.story_id == Story.id)
                & (StoryStatus.user_id == user.id),
            )
            .outerjoin(Source, Source.id == Story.source_id)
            .where(
                or_(
                    StoryStatus.dismissed.is_(True),
                    StoryStatus.read.is_(True),
                ),
                Story.kind == StoryKind.analysis,
            )
            .order_by(last_action.desc().nulls_last())
            .limit(limit)
        )
    ).all()
    items: list[StoryWithStatus] = []
    for story, read, starred, dismissed, source in rows:
        model = StoryWithStatus.model_validate(story)
        model.read = bool(read)
        model.starred = bool(starred)
        model.dismissed = bool(dismissed)
        model.source_name = source.name if source else None
        model.source_image_url = source.image_url if source else None
        model.engagement = FriendEngagementOut()
        items.append(model)
    return StoryList(items=items, total=len(items), limit=limit, offset=0)


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


@router.delete("/stars/{story_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_star(
    story_id: str, session: SessionDep, user: CurrentUser
) -> None:
    status_row = await session.get(StoryStatus, {"user_id": user.id, "story_id": story_id})
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
        await session.execute(base.order_by(Story.created_at.desc()).limit(limit).offset(offset))
    ).all()
    items: list[StoryWithStatus] = []
    for story, read, starred, dismissed in rows:
        model = StoryWithStatus.model_validate(story)
        model.read = bool(read)
        model.starred = bool(starred)
        model.dismissed = bool(dismissed)
        items.append(model)
    return StoryList(items=items, total=int(total or 0), limit=limit, offset=offset)
