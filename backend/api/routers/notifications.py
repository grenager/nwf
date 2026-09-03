"""Alerts: directed notifications (mentions, reactions, friend events)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Query
from sqlalchemy import func, select, update

from api.deps import CurrentUser, SessionDep
from api.friends import identify
from api.schemas import (
    NotificationList,
    NotificationOut,
    NotificationsReadRequest,
)
from core.models import Comment, Notification, Profile, Story

router = APIRouter(prefix="/notifications", tags=["notifications"])

DEFAULT_LIMIT: int = 30
MAX_LIMIT: int = 100


async def _load_notifications(
    session: SessionDep, user_id: uuid.UUID, limit: int
) -> NotificationList:
    """Build the alert list for one user.

    A plain function, deliberately: the route below is a thin shell around it
    so nothing ever calls a *route handler* directly. FastAPI resolves a
    ``Query(...)`` default only when it dispatches the request, so an internal
    call would receive the ``Query`` object itself rather than an int -- which
    is exactly how ``POST /notifications/read`` came to 500 on every request.
    """
    rows = list(
        (
            await session.scalars(
                select(Notification)
                .where(Notification.recipient_id == user_id)
                .order_by(Notification.created_at.desc())
                .limit(limit)
            )
        ).all()
    )
    unread_count = int(
        (
            await session.scalar(
                select(func.count())
                .select_from(Notification)
                .where(
                    Notification.recipient_id == user_id,
                    Notification.read_at.is_(None),
                )
            )
        )
        or 0
    )
    if not rows:
        return NotificationList(items=[], unread_count=unread_count)

    actor_ids: set[uuid.UUID] = {n.actor_id for n in rows}
    story_ids: set[uuid.UUID] = {n.story_id for n in rows if n.story_id}
    comment_ids: set[uuid.UUID] = {
        n.comment_id for n in rows if n.comment_id
    }

    actors: dict[uuid.UUID, Profile] = {
        p.id: p
        for p in (
            await session.scalars(
                select(Profile).where(Profile.id.in_(actor_ids))
            )
        ).all()
    }
    stories: dict[uuid.UUID, Story] = {}
    if story_ids:
        stories = {
            s.id: s
            for s in (
                await session.scalars(
                    select(Story).where(Story.id.in_(story_ids))
                )
            ).all()
        }
    comments: dict[uuid.UUID, Comment] = {}
    if comment_ids:
        comments = {
            c.id: c
            for c in (
                await session.scalars(
                    select(Comment).where(Comment.id.in_(comment_ids))
                )
            ).all()
        }

    items: list[NotificationOut] = []
    for note in rows:
        actor = actors.get(note.actor_id)
        story = stories.get(note.story_id) if note.story_id else None
        comment = (
            comments.get(note.comment_id) if note.comment_id else None
        )
        snippet: str | None = None
        if comment is not None:
            text = comment.text.strip()
            snippet = text if len(text) <= 140 else f"{text[:137]}..."
        items.append(
            NotificationOut(
                id=note.id,
                kind=note.kind,
                actor_id=note.actor_id,
                actor_name=await identify(session, actor),
                actor_image_url=actor.image_url if actor else None,
                post_id=note.post_id,
                comment_id=note.comment_id,
                story_id=note.story_id,
                full_headline=story.full_headline if story else None,
                comment_snippet=snippet,
                read_at=note.read_at,
                created_at=note.created_at,
            )
        )

    return NotificationList(items=items, unread_count=unread_count)


@router.get("", response_model=NotificationList)
async def list_notifications(
    session: SessionDep,
    user: CurrentUser,
    limit: int = Query(default=DEFAULT_LIMIT, le=MAX_LIMIT, ge=1),
) -> NotificationList:
    """Recent directed alerts for the signed-in user."""
    return await _load_notifications(session, user.id, limit)


@router.post("/read", response_model=NotificationList)
async def mark_notifications_read(
    payload: NotificationsReadRequest,
    session: SessionDep,
    user: CurrentUser,
) -> NotificationList:
    """Mark all (or selected) notifications as read, then return the list."""
    now = datetime.now(UTC)
    stmt = (
        update(Notification)
        .where(
            Notification.recipient_id == user.id,
            Notification.read_at.is_(None),
        )
        .values(read_at=now)
    )
    if payload.notification_ids is not None:
        stmt = stmt.where(Notification.id.in_(payload.notification_ids))
    await session.execute(stmt)
    await session.flush()
    return await _load_notifications(session, user.id, DEFAULT_LIMIT)
