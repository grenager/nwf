"""Conversations: threads the viewer participates in, sorted by latest reply."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from api.deps import CurrentUser, SessionDep
from api.friends import can_see_post, display_name
from api.schemas import ConversationList, ConversationOut
from core.attribution import resolve_attribution
from core.models import (
    Comment,
    Post,
    PostParticipant,
    PostRead,
    Profile,
    Source,
    Story,
)

router = APIRouter(prefix="/conversations", tags=["conversations"])


@router.get("", response_model=ConversationList)
async def list_conversations(
    session: SessionDep,
    user: CurrentUser,
    limit: int = Query(default=30, le=100, ge=1),
) -> ConversationList:
    """Threads the viewer authored or joined that have at least one reply."""
    # Posts where the viewer is author or a participant.
    participated_ids = list(
        (
            await session.scalars(
                select(PostParticipant.post_id).where(
                    PostParticipant.user_id == user.id
                )
            )
        ).all()
    )
    authored_ids = list(
        (
            await session.scalars(
                select(Post.id).where(Post.author_id == user.id)
            )
        ).all()
    )
    candidate_ids: list[uuid.UUID] = list(
        dict.fromkeys([*participated_ids, *authored_ids])
    )
    if not candidate_ids:
        return ConversationList(items=[], threads_with_unread=0)

    # Latest reply per post (only posts that have replies).
    latest_subq = (
        select(
            Comment.post_id.label("post_id"),
            func.max(Comment.created_at).label("latest_at"),
            func.count(Comment.id).label("reply_count"),
        )
        .where(
            Comment.post_id.in_(candidate_ids),
            Comment.post_id.is_not(None),
        )
        .group_by(Comment.post_id)
        .subquery()
    )
    rows = (
        await session.execute(
            select(Post, Story, Source, latest_subq.c.latest_at, latest_subq.c.reply_count)
            .join(latest_subq, latest_subq.c.post_id == Post.id)
            .join(Story, Story.id == Post.story_id)
            .outerjoin(Source, Source.id == Story.source_id)
            .order_by(latest_subq.c.latest_at.desc())
            .limit(limit)
        )
    ).all()

    if not rows:
        return ConversationList(items=[], threads_with_unread=0)

    post_ids: list[uuid.UUID] = [post.id for post, *_ in rows]

    # Read cursors.
    seen_rows = (
        await session.execute(
            select(PostRead.post_id, PostRead.last_seen_at).where(
                PostRead.user_id == user.id,
                PostRead.post_id.in_(post_ids),
            )
        )
    ).all()
    last_seen: dict[uuid.UUID, datetime] = {
        pid: at for pid, at in seen_rows
    }

    # All non-own replies for unread counts + latest reply preview.
    reply_rows = (
        await session.execute(
            select(Comment, Profile)
            .join(Profile, Profile.id == Comment.user_id)
            .where(Comment.post_id.in_(post_ids))
            .order_by(Comment.created_at.desc())
        )
    ).all()
    unread_counts: dict[uuid.UUID, int] = {pid: 0 for pid in post_ids}
    latest_reply: dict[uuid.UUID, tuple[Comment, Profile]] = {}
    for comment, author in reply_rows:
        if comment.post_id is None:
            continue
        if comment.post_id not in latest_reply:
            latest_reply[comment.post_id] = (comment, author)
        if comment.user_id == user.id:
            continue
        cursor = last_seen.get(comment.post_id)
        if cursor is None or comment.created_at > cursor:
            unread_counts[comment.post_id] = (
                unread_counts.get(comment.post_id, 0) + 1
            )

    # Author profiles for the posts themselves.
    author_ids: set[uuid.UUID] = {post.author_id for post, *_ in rows}
    authors: dict[uuid.UUID, Profile] = {
        p.id: p
        for p in (
            await session.scalars(
                select(Profile).where(Profile.id.in_(author_ids))
            )
        ).all()
    }

    items: list[ConversationOut] = []
    for post, story, source, latest_at, reply_count in rows:
        author = authors.get(post.author_id)
        source_name, source_image_url = resolve_attribution(
            article_url=story.article_url,
            source_name=source.name if source else None,
            source_homepage_url=source.homepage_url if source else None,
            source_image_url=source.image_url if source else None,
            publisher=story.publisher,
        )
        latest = latest_reply.get(post.id)
        latest_comment: Comment | None = latest[0] if latest else None
        latest_author: Profile | None = latest[1] if latest else None
        items.append(
            ConversationOut(
                post_id=post.id,
                story_id=story.id,
                full_headline=story.full_headline,
                article_url=story.article_url,
                source_name=source_name,
                source_image_url=source_image_url,
                image_url=story.image_url,
                author_id=post.author_id,
                author_name=display_name(author) if author else "Friend",
                author_image_url=author.image_url if author else None,
                reply_count=int(reply_count),
                unread_count=unread_counts.get(post.id, 0),
                last_seen_at=last_seen.get(post.id),
                latest_reply_at=latest_at,
                latest_reply_text=(
                    latest_comment.text if latest_comment is not None else None
                ),
                latest_reply_author_name=(
                    display_name(latest_author)
                    if latest_author is not None
                    else None
                ),
                latest_reply_author_image_url=(
                    latest_author.image_url
                    if latest_author is not None
                    else None
                ),
            )
        )

    threads_with_unread = sum(1 for item in items if item.unread_count > 0)
    return ConversationList(
        items=items, threads_with_unread=threads_with_unread
    )


@router.post("/{post_id}/seen", status_code=status.HTTP_204_NO_CONTENT)
async def mark_thread_seen(
    post_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> None:
    """Stamp the viewer's per-thread read cursor to now."""
    post = await session.get(Post, post_id)
    if post is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "post not found")
    if not await can_see_post(session, user.id, post):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not permitted")

    now = datetime.now(UTC)
    stmt = (
        pg_insert(PostRead)
        .values(user_id=user.id, post_id=post_id, last_seen_at=now)
        .on_conflict_do_update(
            index_elements=[PostRead.user_id, PostRead.post_id],
            set_={"last_seen_at": now},
        )
    )
    await session.execute(stmt)
