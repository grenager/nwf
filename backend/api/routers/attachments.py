"""Attachments: related article URLs hung off a post (optionally a reply)."""

from __future__ import annotations

import uuid
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from api.deps import CurrentUser, SessionDep
from api.friends import can_see_post
from api.schemas import AttachmentCreate, AttachmentOut
from core.models import Attachment, Comment, Post, Story

router = APIRouter(prefix="/attachments", tags=["attachments"])


def _headline_from_url(url: str) -> str:
    parsed = urlparse(url)
    path: str = parsed.path.rstrip("/")
    slug: str = path.rsplit("/", 1)[-1] if path else ""
    slug = slug.rsplit(".", 1)[0]
    words: list[str] = [w for w in slug.replace("_", "-").split("-") if w]
    if not words or all(w.isdigit() for w in words):
        return parsed.netloc or url
    return " ".join(w.capitalize() for w in words)


@router.post("", response_model=AttachmentOut, status_code=status.HTTP_201_CREATED)
async def create_attachment(
    payload: AttachmentCreate, session: SessionDep, user: CurrentUser
) -> AttachmentOut:
    post = await session.get(Post, payload.post_id)
    if post is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "post not found")
    if not await can_see_post(session, user.id, post):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not permitted")

    if payload.comment_id is not None:
        comment = await session.get(Comment, payload.comment_id)
        if comment is None or comment.post_id != post.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid comment_id")

    url: str = payload.article_url.strip()
    story = await session.scalar(select(Story).where(Story.article_url == url))
    if story is None:
        story = Story(article_url=url, full_headline=_headline_from_url(url))
        session.add(story)
        await session.flush()

    attachment = Attachment(
        post_id=post.id,
        comment_id=payload.comment_id,
        article_url=url,
        story_id=story.id,
        attached_by=user.id,
    )
    session.add(attachment)
    await session.flush()
    await session.refresh(attachment)
    return AttachmentOut.model_validate(attachment)


@router.delete("/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_attachment(
    attachment_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> None:
    attachment = await session.get(Attachment, attachment_id)
    if attachment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "attachment not found")
    if attachment.attached_by != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not the author")
    await session.delete(attachment)
