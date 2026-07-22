"""Best-effort instant activity emails for posts and comments."""

from __future__ import annotations

import asyncio
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from api.friends import (
    accepted_friend_ids,
    display_name,
    load_activity_email_recipients,
)
from core.attribution import resolve_attribution
from core.config import Settings, get_settings
from core.email import ActivityEmailContent, send_activity_email
from core.logging import get_logger
from core.models import Post, Profile, Source, Story

log = get_logger("activity_mail")

_EXCERPT_MAX = 280


def _truncate(text: str | None, limit: int = _EXCERPT_MAX) -> str | None:
    if text is None:
        return None
    cleaned: str = " ".join(text.split())
    if not cleaned:
        return None
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[: limit - 1].rstrip() + "…"


async def _story_attribution(
    session: AsyncSession, story: Story
) -> tuple[str | None, str | None]:
    source = (
        await session.get(Source, story.source_id) if story.source_id else None
    )
    source_name, _logo = resolve_attribution(
        article_url=story.article_url,
        source_name=source.name if source else None,
        source_homepage_url=source.homepage_url if source else None,
        source_image_url=source.image_url if source else None,
        publisher=story.publisher,
    )
    return source_name, story.image_url


async def notify_friends_of_new_post(
    session: AsyncSession,
    *,
    post: Post,
    story: Story,
    author: Profile,
) -> None:
    """Email the author's friends about a new post. Never raises."""
    try:
        friend_ids: list[uuid.UUID] = await accepted_friend_ids(
            session, post.author_id
        )
        audience: list[uuid.UUID] = [
            fid for fid in friend_ids if fid != post.author_id
        ]
        recipients = await load_activity_email_recipients(session, audience)
        if not recipients:
            return

        settings: Settings = get_settings()
        source_label, story_image = await _story_attribution(session, story)
        actor_name: str = display_name(author)
        action_url: str = settings.app_url(f"/post/{post.id}")
        excerpt: str | None = _truncate(post.take)

        async def _send_one(recipient_email: str, first: str | None, token: uuid.UUID) -> None:
            await send_activity_email(
                ActivityEmailContent(
                    to_email=recipient_email,
                    recipient_first=first,
                    actor_name=actor_name,
                    actor_image_url=author.image_url,
                    kind="new_post",
                    headline=story.full_headline,
                    source_label=source_label,
                    story_image_url=story_image,
                    excerpt=excerpt,
                    action_url=action_url,
                    unsubscribe_url=settings.app_url(f"/unsubscribe/{token}"),
                ),
                settings=settings,
            )

        await asyncio.gather(
            *[
                _send_one(r.email, r.first, r.unsubscribe_token)
                for r in recipients
            ]
        )
    except Exception as exc:  # never fail the API on email issues
        log.warning(
            "activity_mail.new_post.error",
            post_id=str(post.id),
            error=str(exc),
        )


async def notify_comment_activity(
    session: AsyncSession,
    *,
    post: Post,
    story: Story,
    comment_text: str,
    commenter: Profile,
    parent_author_id: uuid.UUID | None,
) -> None:
    """Email post author and/or parent-comment author. Never raises.

    Dedupes so one person gets at most one email; parent-author framing
    (``reply``) wins over post-author framing (``comment``).
    """
    try:
        # recipient_id -> kind, preferring reply over comment
        targets: dict[uuid.UUID, str] = {}
        if post.author_id != commenter.id:
            targets[post.author_id] = "comment"
        if (
            parent_author_id is not None
            and parent_author_id != commenter.id
        ):
            targets[parent_author_id] = "reply"

        if not targets:
            return

        recipients = await load_activity_email_recipients(
            session, targets.keys()
        )
        if not recipients:
            return

        settings: Settings = get_settings()
        source_label, story_image = await _story_attribution(session, story)
        actor_name: str = display_name(commenter)
        action_url: str = settings.app_url(f"/post/{post.id}")
        excerpt: str | None = _truncate(comment_text)

        async def _send_one(
            recipient_email: str,
            first: str | None,
            token: uuid.UUID,
            kind: str,
        ) -> None:
            await send_activity_email(
                ActivityEmailContent(
                    to_email=recipient_email,
                    recipient_first=first,
                    actor_name=actor_name,
                    actor_image_url=commenter.image_url,
                    kind=kind,
                    headline=story.full_headline,
                    source_label=source_label,
                    story_image_url=story_image,
                    excerpt=excerpt,
                    action_url=action_url,
                    unsubscribe_url=settings.app_url(f"/unsubscribe/{token}"),
                ),
                settings=settings,
            )

        await asyncio.gather(
            *[
                _send_one(
                    r.email,
                    r.first,
                    r.unsubscribe_token,
                    targets[r.user_id],
                )
                for r in recipients
                if r.user_id in targets
            ]
        )
    except Exception as exc:  # never fail the API on email issues
        log.warning(
            "activity_mail.comment.error",
            post_id=str(post.id),
            error=str(exc),
        )


# Re-export for callers / tests
__all__ = [
    "notify_friends_of_new_post",
    "notify_comment_activity",
]
