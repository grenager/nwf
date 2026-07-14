"""Comments are replies under a post; maintain post_participants on insert."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from api.deps import CurrentUser, SessionDep
from api.friends import can_see_post, display_name
from api.schemas import CommentCreate, CommentOut, CommentUpdate
from core.models import Comment, Post, PostParticipant, Profile

router = APIRouter(prefix="/comments", tags=["comments"])


def _to_out(comment: Comment, author: Profile | None) -> CommentOut:
    return CommentOut(
        id=comment.id,
        story_id=comment.story_id,
        post_id=comment.post_id,
        user_id=comment.user_id,
        author_name=display_name(author) if author else "Friend",
        author_image_url=author.image_url if author else None,
        text=comment.text,
        created_at=comment.created_at,
        updated_at=comment.updated_at,
    )


async def _add_participant(
    session: SessionDep, post_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    stmt = (
        pg_insert(PostParticipant)
        .values(post_id=post_id, user_id=user_id)
        .on_conflict_do_nothing(
            index_elements=[PostParticipant.post_id, PostParticipant.user_id]
        )
    )
    await session.execute(stmt)


@router.get("", response_model=list[CommentOut])
async def list_comments(
    session: SessionDep,
    user: CurrentUser,
    post_id: uuid.UUID | None = Query(default=None),
    story_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=100, le=500, ge=1),
    offset: int = Query(default=0, ge=0),
) -> list[CommentOut]:
    if post_id is None and story_id is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "post_id or story_id is required"
        )

    if post_id is not None:
        post = await session.get(Post, post_id)
        if post is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "post not found")
        if not await can_see_post(session, user.id, post):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "not permitted")
        stmt = (
            select(Comment, Profile)
            .join(Profile, Profile.id == Comment.user_id)
            .where(Comment.post_id == post_id)
            .order_by(Comment.created_at.asc())
            .limit(limit)
            .offset(offset)
        )
        rows = (await session.execute(stmt)).all()
        return [_to_out(c, a) for c, a in rows]

    # story_id path: return replies on posts about that story that the viewer can see
    assert story_id is not None
    posts = list(
        (
            await session.scalars(select(Post).where(Post.story_id == story_id))
        ).all()
    )
    visible_ids: list[uuid.UUID] = []
    for post in posts:
        if await can_see_post(session, user.id, post):
            visible_ids.append(post.id)
    if not visible_ids:
        return []
    stmt = (
        select(Comment, Profile)
        .join(Profile, Profile.id == Comment.user_id)
        .where(Comment.post_id.in_(visible_ids))
        .order_by(Comment.created_at.asc())
        .limit(limit)
        .offset(offset)
    )
    rows = (await session.execute(stmt)).all()
    return [_to_out(c, a) for c, a in rows]


@router.post("", response_model=CommentOut, status_code=status.HTTP_201_CREATED)
async def create_comment(
    payload: CommentCreate, session: SessionDep, user: CurrentUser
) -> CommentOut:
    post = await session.get(Post, payload.post_id)
    if post is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "post not found")
    if not await can_see_post(session, user.id, post):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not permitted")

    comment = Comment(
        story_id=post.story_id,
        post_id=post.id,
        user_id=user.id,
        text=payload.text,
    )
    session.add(comment)
    await session.flush()
    await _add_participant(session, post.id, user.id)
    post.last_activity_at = datetime.now(UTC)
    await session.refresh(comment)
    author = await session.get(Profile, user.id)
    return _to_out(comment, author)


@router.get("/{comment_id}", response_model=CommentOut)
async def get_comment(
    comment_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> CommentOut:
    comment = await session.get(Comment, comment_id)
    if comment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "comment not found")
    if comment.post_id is not None:
        post = await session.get(Post, comment.post_id)
        if post is None or not await can_see_post(session, user.id, post):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "not permitted")
    elif comment.user_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not permitted")
    author = await session.get(Profile, comment.user_id)
    return _to_out(comment, author)


@router.put("/{comment_id}", response_model=CommentOut)
async def update_comment(
    comment_id: uuid.UUID,
    payload: CommentUpdate,
    session: SessionDep,
    user: CurrentUser,
) -> CommentOut:
    comment = await session.get(Comment, comment_id)
    if comment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "comment not found")
    if comment.user_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not the author")
    comment.text = payload.text
    await session.flush()
    await session.refresh(comment)
    author = await session.get(Profile, comment.user_id)
    return _to_out(comment, author)


@router.delete("/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(
    comment_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> None:
    comment = await session.get(Comment, comment_id)
    if comment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "comment not found")
    if comment.user_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not the author")
    await session.delete(comment)
