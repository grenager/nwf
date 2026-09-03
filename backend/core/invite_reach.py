"""Share links that reached someone but never converted.

A share-tray link carries no ``invitee_email``, so the invitee nudge in
``api.activity_mail`` can never fire for it: the primary invite path gets no
follow-up at all and the link expires in silence. There is nobody to mail on
the receiving end -- but the inviter is right there, and they are the one who
can follow up in the thread where they sent it.

So the signal goes back the other way: "two people opened your link, nobody
joined". That is a nudge a person can act on, in the medium that actually
converts, which the app has no access to.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import (
    Invitation,
    InvitationRedemption,
    InvitationStatus,
    Post,
    Profile,
    Story,
)

# How long a link gets to convert on its own before the inviter hears about
# it. Someone who opens a link at lunch and signs up after dinner is a normal
# conversion, not a miss -- telling the inviter otherwise would be wrong by
# the time they read it.
REACH_SETTLE_WINDOW: timedelta = timedelta(hours=24)


@dataclass(frozen=True)
class InviteReach:
    """One inviter's opened-but-unconverted share links."""

    inviter_id: uuid.UUID
    invitation_ids: tuple[uuid.UUID, ...]
    #: Distinct links that were opened and brought nobody in.
    link_count: int
    #: Total opens across those links. Opens, not people -- one person opening
    #: a link three times counts three times, which is why the copy says
    #: "opened", never "people".
    open_count: int
    #: Headline of the conversation behind the most-opened link, when there is
    #: one; a standalone invite has no article to name.
    headline: str | None
    #: Post to send the inviter back to, so re-sharing is one tap away.
    post_id: uuid.UUID | None


async def load_invite_reach(
    session: AsyncSession,
    *,
    now: datetime | None = None,
    settle_window: timedelta = REACH_SETTLE_WINDOW,
) -> list[InviteReach]:
    """Find inviters owed a "nobody joined" note, grouped one per inviter.

    A link qualifies when it has no recipient address to nudge instead, its
    counters are trustworthy, somebody opened it, the settle window has
    passed, nobody redeemed it, and its inviter has not already been told.

    Inviters who opted out of digest email are skipped: this is the same kind
    of unprompted summary mail, and one opt-out should cover both.
    """
    moment: datetime = now or datetime.now(UTC)

    redeemed = select(InvitationRedemption.invitation_id).where(
        InvitationRedemption.invitation_id == Invitation.id
    )
    stmt = (
        select(Invitation)
        .where(
            # No address on file, so the invitee cannot be nudged directly --
            # this is exactly the population that gets no follow-up today.
            Invitation.invitee_email.is_(None),
            # Zeros on an uninstrumented row mean "not measured", not "never
            # opened", so they can never establish that a link was opened.
            Invitation.instrumented.is_(True),
            Invitation.open_count > 0,
            Invitation.status == InvitationStatus.pending,
            Invitation.inviter_reach_email_at.is_(None),
            Invitation.first_opened_at.is_not(None),
            Invitation.first_opened_at < moment - settle_window,
            ~redeemed.exists(),
        )
        .order_by(Invitation.open_count.desc())
    )
    invitations: list[Invitation] = list((await session.scalars(stmt)).all())
    if not invitations:
        return []

    by_inviter: dict[uuid.UUID, list[Invitation]] = {}
    for invitation in invitations:
        by_inviter.setdefault(invitation.inviter_id, []).append(invitation)

    opted_out: set[uuid.UUID] = set(
        (
            await session.scalars(
                select(Profile.id).where(
                    Profile.id.in_(by_inviter.keys()),
                    Profile.digest_opt_out.is_(True),
                )
            )
        ).all()
    )

    reaches: list[InviteReach] = []
    for inviter_id, links in by_inviter.items():
        if inviter_id in opted_out:
            continue
        # Ordered by opens above, so the first link with a post is the one
        # worth naming in the email.
        headline: str | None = None
        post_id: uuid.UUID | None = None
        for link in links:
            if link.post_id is None:
                continue
            post_id = link.post_id
            post: Post | None = await session.get(Post, link.post_id)
            story: Story | None = (
                await session.get(Story, post.story_id) if post else None
            )
            headline = story.full_headline if story else None
            break
        reaches.append(
            InviteReach(
                inviter_id=inviter_id,
                invitation_ids=tuple(link.id for link in links),
                link_count=len(links),
                open_count=sum(link.open_count for link in links),
                headline=headline,
                post_id=post_id,
            )
        )
    return reaches


async def mark_reach_notified(
    session: AsyncSession,
    invitation_ids: Sequence[uuid.UUID],
    *,
    now: datetime | None = None,
) -> None:
    """Stamp links as reported so the inviter is only told about them once."""
    if not invitation_ids:
        return
    await session.execute(
        update(Invitation)
        .where(Invitation.id.in_(list(invitation_ids)))
        .values(inviter_reach_email_at=now or datetime.now(UTC))
    )
