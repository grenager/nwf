"""Helpers for a post's comment thread.

A post has no text of its own: whoever shares an article says what they think
in the first comment, exactly as everyone else does. These helpers name that
comment so the places that need a one-line excerpt of a thread (emails,
invite previews, search results, moderation reports) all agree on what "what
this post says" means.

"First" is by ``created_at``, with ``id`` breaking ties so the answer is
stable. It is not necessarily the sharer's: if they delete their opening
comment, the next one speaks for the thread, which is the sensible fallback
rather than a special case.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import Comment


async def opening_comment_texts(
    session: AsyncSession, post_ids: list[uuid.UUID]
) -> dict[uuid.UUID, str]:
    """Map post id -> text of its first comment, for the posts that have one.

    One query for the whole set: callers render lists, and a per-post lookup
    here would be an N+1 on the feed and search paths.
    """
    if not post_ids:
        return {}

    rows = (
        await session.execute(
            select(Comment.post_id, Comment.text, Comment.created_at, Comment.id)
            .where(Comment.post_id.in_(post_ids))
            .order_by(Comment.created_at.asc(), Comment.id.asc())
        )
    ).all()

    first: dict[uuid.UUID, str] = {}
    for post_id, text, _created_at, _comment_id in rows:
        if post_id is None or post_id in first:
            continue
        first[post_id] = text
    return first


async def opening_comment_text(
    session: AsyncSession, post_id: uuid.UUID
) -> str | None:
    """Text of a single post's first comment, or None if nobody has spoken."""
    texts = await opening_comment_texts(session, [post_id])
    return texts.get(post_id)
