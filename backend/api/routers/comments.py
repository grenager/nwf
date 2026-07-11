"""Comments: visible to author + accepted connections (fixes legacy leak)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import Select, or_, select

from api.deps import CurrentUser, SessionDep
from api.schemas import CommentCreate, CommentOut, CommentUpdate
from core.models import Comment, Connection, ConnectionStatus

router = APIRouter(prefix="/comments", tags=["comments"])


def _visible_author_ids_subquery(
    user_id: uuid.UUID,
) -> Select[tuple[uuid.UUID, uuid.UUID]]:
    """User ids whose comments the current user may see: self + accepted friends."""
    return select(Connection.first_id, Connection.second_id).where(
        Connection.status == ConnectionStatus.accepted,
        or_(Connection.first_id == user_id, Connection.second_id == user_id),
    )


async def _friend_ids(session: SessionDep, user_id: uuid.UUID) -> set[uuid.UUID]:
    rows = (await session.execute(_visible_author_ids_subquery(user_id))).all()
    ids: set[uuid.UUID] = {user_id}
    for first_id, second_id in rows:
        ids.add(first_id)
        ids.add(second_id)
    return ids


@router.get("", response_model=list[CommentOut])
async def list_comments(
    session: SessionDep,
    user: CurrentUser,
    story_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=100, le=500, ge=1),
    offset: int = Query(default=0, ge=0),
) -> list[Comment]:
    visible = await _friend_ids(session, user.id)
    stmt = select(Comment).where(Comment.user_id.in_(visible))
    if story_id is not None:
        stmt = stmt.where(Comment.story_id == story_id)
    stmt = stmt.order_by(Comment.created_at.desc()).limit(limit).offset(offset)
    return list((await session.scalars(stmt)).all())


@router.post("", response_model=CommentOut, status_code=status.HTTP_201_CREATED)
async def create_comment(
    payload: CommentCreate, session: SessionDep, user: CurrentUser
) -> Comment:
    comment = Comment(story_id=payload.story_id, user_id=user.id, text=payload.text)
    session.add(comment)
    await session.flush()
    await session.refresh(comment)
    return comment


@router.get("/{comment_id}", response_model=CommentOut)
async def get_comment(
    comment_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> Comment:
    comment = await session.get(Comment, comment_id)
    if comment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "comment not found")
    visible = await _friend_ids(session, user.id)
    if comment.user_id not in visible:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not permitted")
    return comment


@router.put("/{comment_id}", response_model=CommentOut)
async def update_comment(
    comment_id: uuid.UUID,
    payload: CommentUpdate,
    session: SessionDep,
    user: CurrentUser,
) -> Comment:
    comment = await session.get(Comment, comment_id)
    if comment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "comment not found")
    if comment.user_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not the author")
    comment.text = payload.text
    await session.flush()
    await session.refresh(comment)
    return comment


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
