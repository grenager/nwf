"""Best-effort instant activity emails for posts and comments."""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from api.friends import (
    ActivityEmailRecipient,
    PendingInviteRecipient,
    accepted_friend_ids,
    display_name,
    load_activity_email_recipients,
    load_pending_invite_recipients,
    pending_connection_ids,
)
from core.attribution import resolve_attribution
from core.config import Settings, get_settings
from core.email import ActivityEmailContent, send_activity_email
from core.logging import get_logger
from core.models import Invitation, Post, Profile, Source, Story

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


@dataclass(frozen=True)
class _ActivityContext:
    """Fields shared by every recipient of a single activity event."""

    actor_name: str
    actor_image_url: str | None
    headline: str | None
    source_label: str | None
    excerpt: str | None
    story_image_url: str | None
    settings: Settings


async def _context(
    session: AsyncSession,
    *,
    story: Story,
    actor: Profile,
    excerpt: str | None,
) -> _ActivityContext:
    source_label, story_image = await _story_attribution(session, story)
    return _ActivityContext(
        actor_name=display_name(actor),
        actor_image_url=actor.image_url,
        headline=story.full_headline,
        source_label=source_label,
        excerpt=excerpt,
        story_image_url=story_image,
        settings=get_settings(),
    )


def _content(
    ctx: _ActivityContext,
    *,
    kind: str,
    to_email: str,
    recipient_first: str | None,
    action_url: str,
    unsubscribe_url: str,
    pending_note: str | None = None,
    cta_label: str | None = None,
) -> ActivityEmailContent:
    return ActivityEmailContent(
        to_email=to_email,
        recipient_first=recipient_first,
        actor_name=ctx.actor_name,
        actor_image_url=ctx.actor_image_url,
        kind=kind,
        headline=ctx.headline,
        source_label=ctx.source_label,
        story_image_url=ctx.story_image_url,
        excerpt=ctx.excerpt,
        action_url=action_url,
        unsubscribe_url=unsubscribe_url,
        pending_note=pending_note,
        cta_label=cta_label,
    )


def _member_content(
    ctx: _ActivityContext,
    recipient: ActivityEmailRecipient,
    *,
    kind: str,
    action_url: str,
    pending_note: str | None = None,
    cta_label: str | None = None,
) -> ActivityEmailContent:
    """Email content for someone who already has an account."""
    return _content(
        ctx,
        kind=kind,
        to_email=recipient.email,
        recipient_first=recipient.first,
        action_url=action_url,
        unsubscribe_url=ctx.settings.app_url(
            f"/unsubscribe/{recipient.unsubscribe_token}"
        ),
        pending_note=pending_note,
        cta_label=cta_label,
    )


def _invitee_content(
    ctx: _ActivityContext,
    recipient: PendingInviteRecipient,
    *,
    kind: str,
    pending_note: str,
) -> ActivityEmailContent:
    """Email content for an invited address with no account yet.

    The CTA goes to the invite landing page, which is the only place they can
    see the conversation before signing up, and the unsubscribe link is scoped
    to their invitation rather than a profile they do not have.
    """
    return _content(
        ctx,
        kind=kind,
        to_email=recipient.email,
        recipient_first=None,
        action_url=ctx.settings.app_url(f"/invite/{recipient.invite_token}"),
        unsubscribe_url=ctx.settings.app_url(
            f"/unsubscribe/invite/{recipient.unsubscribe_token}"
        ),
        pending_note=pending_note,
        cta_label="Join the conversation",
    )


async def _send_to_invitees(
    session: AsyncSession,
    contents: Sequence[tuple[PendingInviteRecipient, ActivityEmailContent]],
    *,
    settings: Settings,
) -> None:
    """Send invitee nudges and record which invitations were actually mailed."""
    if not contents:
        return
    results: list[bool] = list(
        await asyncio.gather(
            *[
                send_activity_email(content, settings=settings)
                for _recipient, content in contents
            ]
        )
    )
    mailed: list[uuid.UUID] = [
        recipient.invitation_id
        for (recipient, _content), sent in zip(contents, results, strict=True)
        if sent
    ]
    if not mailed:
        return
    await session.execute(
        update(Invitation)
        .where(Invitation.id.in_(mailed))
        .values(last_activity_email_at=datetime.now(UTC))
    )


async def notify_friends_of_new_post(
    session: AsyncSession,
    *,
    post: Post,
    story: Story,
    author: Profile,
) -> None:
    """Email the author's friends about a new post. Never raises.

    Reaches three audiences: accepted friends, people with an unanswered friend
    request from the author, and addresses the author invited that have not
    signed up. The latter two get a note explaining they need to accept first.
    """
    try:
        async with session.begin_nested():
            friend_ids: list[uuid.UUID] = await accepted_friend_ids(
                session, post.author_id
            )
            audience: list[uuid.UUID] = [
                fid for fid in friend_ids if fid != post.author_id
            ]
            recipients = await load_activity_email_recipients(session, audience)
            pending_ids: list[uuid.UUID] = await pending_connection_ids(
                session, post.author_id
            )
            pending_recipients = await load_activity_email_recipients(
                session, pending_ids
            )
            invitees = await load_pending_invite_recipients(
                session, inviter_id=post.author_id
            )
            if not (recipients or pending_recipients or invitees):
                return

            ctx = await _context(
                session, story=story, actor=author, excerpt=_truncate(post.take)
            )
            settings: Settings = ctx.settings
            action_url: str = settings.app_url(f"/post/{post.id}")
            friends_url: str = settings.app_url("/friends")
            pending_note: str = (
                f"Accept {ctx.actor_name}'s friend request to read the "
                f"conversation."
            )
            invitee_note: str = (
                f"{ctx.actor_name} invited you to NewsWithFriends. Join to read "
                f"the conversation."
            )

            await asyncio.gather(
                *[
                    send_activity_email(
                        _member_content(
                            ctx, recipient, kind="new_post", action_url=action_url
                        ),
                        settings=settings,
                    )
                    for recipient in recipients
                ],
                *[
                    send_activity_email(
                        _member_content(
                            ctx,
                            recipient,
                            kind="new_post",
                            action_url=friends_url,
                            pending_note=pending_note,
                            cta_label="Accept friend request",
                        ),
                        settings=settings,
                    )
                    for recipient in pending_recipients
                ],
            )
            await _send_to_invitees(
                session,
                [
                    (
                        invitee,
                        _invitee_content(
                            ctx, invitee, kind="new_post", pending_note=invitee_note
                        ),
                    )
                    for invitee in invitees
                ],
                settings=settings,
            )
    except Exception as exc:
        # Never fail the API on email issues. The work above runs inside a
        # SAVEPOINT because some of it queries the database on the caller's
        # session: without one, a failed statement leaves the surrounding
        # transaction aborted and the caller's own writes (the post, the
        # comment) get rolled back with it.
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
    """Email post author, parent-comment author, and invitees. Never raises.

    Dedupes so one person gets at most one email; parent-author framing
    (``reply``) wins over post-author framing (``comment``). Anyone invited to
    this specific conversation is nudged too, since the article was already
    shared with them in their invitation.
    """
    try:
        async with session.begin_nested():
            # recipient_id -> kind, preferring reply over comment
            targets: dict[uuid.UUID, str] = {}
            if post.author_id != commenter.id:
                targets[post.author_id] = "comment"
            if (
                parent_author_id is not None
                and parent_author_id != commenter.id
            ):
                targets[parent_author_id] = "reply"

            recipients = (
                await load_activity_email_recipients(session, targets.keys())
                if targets
                else []
            )
            invitees = await load_pending_invite_recipients(
                session, post_id=post.id
            )
            if not (recipients or invitees):
                return

            ctx = await _context(
                session, story=story, actor=commenter, excerpt=_truncate(comment_text)
            )
            settings: Settings = ctx.settings
            action_url: str = settings.app_url(f"/post/{post.id}")

            await asyncio.gather(
                *[
                    send_activity_email(
                        _member_content(
                            ctx,
                            recipient,
                            kind=targets[recipient.user_id],
                            action_url=action_url,
                        ),
                        settings=settings,
                    )
                    for recipient in recipients
                    if recipient.user_id in targets
                ]
            )
            await _send_to_invitees(
                session,
                [
                    (
                        invitee,
                        _invitee_content(
                            ctx,
                            invitee,
                            kind="conversation",
                            pending_note=(
                                "Join NewsWithFriends to read the full thread."
                            ),
                        ),
                    )
                    for invitee in invitees
                ],
                settings=settings,
            )
    except Exception as exc:
        # Never fail the API on email issues. The work above runs inside a
        # SAVEPOINT because some of it queries the database on the caller's
        # session: without one, a failed statement leaves the surrounding
        # transaction aborted and the caller's own writes (the post, the
        # comment) get rolled back with it.
        log.warning(
            "activity_mail.comment.error",
            post_id=str(post.id),
            error=str(exc),
        )


# Re-export for callers / tests
__all__ = [
    "notify_comment_activity",
    "notify_friends_of_new_post",
]
