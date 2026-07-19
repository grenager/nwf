"""Helpers to create directed alert notifications (mentions, reactions, friends)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import delete, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import Notification, NotificationKind


async def create_notification(
    session: AsyncSession,
    *,
    recipient_id: uuid.UUID,
    actor_id: uuid.UUID,
    kind: NotificationKind,
    post_id: uuid.UUID | None = None,
    comment_id: uuid.UUID | None = None,
    story_id: uuid.UUID | None = None,
) -> None:
    """Insert or refresh a notification. No-op when recipient is the actor.

    Dedup indexes cause reaction/friend rows to upsert: ``read_at`` is cleared
    and ``created_at`` is bumped so the alert resurfaces as unread.
    """
    if recipient_id == actor_id:
        return

    now = datetime.now(UTC)
    values: dict[str, object] = {
        "recipient_id": recipient_id,
        "actor_id": actor_id,
        "kind": kind,
        "post_id": post_id,
        "comment_id": comment_id,
        "story_id": story_id,
        "read_at": None,
        "created_at": now,
    }
    stmt = pg_insert(Notification).values(**values)

    if kind == NotificationKind.post_reaction and post_id is not None:
        stmt = stmt.on_conflict_do_update(
            index_elements=["recipient_id", "actor_id", "post_id"],
            index_where=text(
                "kind = 'post_reaction' AND post_id IS NOT NULL"
            ),
            set_={
                "read_at": None,
                "created_at": now,
                "story_id": story_id,
            },
        )
    elif kind == NotificationKind.comment_reaction and comment_id is not None:
        stmt = stmt.on_conflict_do_update(
            index_elements=["recipient_id", "actor_id", "comment_id"],
            index_where=text(
                "kind = 'comment_reaction' AND comment_id IS NOT NULL"
            ),
            set_={
                "read_at": None,
                "created_at": now,
                "post_id": post_id,
                "story_id": story_id,
            },
        )
    elif kind in {
        NotificationKind.friend_request,
        NotificationKind.friend_accepted,
    }:
        stmt = stmt.on_conflict_do_update(
            index_elements=["recipient_id", "actor_id", "kind"],
            index_where=text(
                "kind IN ('friend_request', 'friend_accepted')"
            ),
            set_={"read_at": None, "created_at": now},
        )
    # Mentions have no dedup index — each mention event is its own row.

    await session.execute(stmt)


async def delete_reaction_notification(
    session: AsyncSession,
    *,
    recipient_id: uuid.UUID,
    actor_id: uuid.UUID,
    kind: NotificationKind,
    post_id: uuid.UUID | None = None,
    comment_id: uuid.UUID | None = None,
) -> None:
    """Best-effort removal when a reaction is cleared."""
    if recipient_id == actor_id:
        return
    conditions = [
        Notification.recipient_id == recipient_id,
        Notification.actor_id == actor_id,
        Notification.kind == kind,
    ]
    if kind == NotificationKind.post_reaction and post_id is not None:
        conditions.append(Notification.post_id == post_id)
    elif kind == NotificationKind.comment_reaction and comment_id is not None:
        conditions.append(Notification.comment_id == comment_id)
    else:
        return
    await session.execute(delete(Notification).where(*conditions))
