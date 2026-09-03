"""What one thing to ask a member to do, if anything.

NewsWithFriends only works if people put articles into it, and the app has
never said so out loud. This works out the single most useful ask for one
viewer -- invite someone, or share something -- so the feed can state the
expectation once, in a ribbon they can dismiss.

Two rules shape everything here:

**Never quote a statistic about other members.** "Most people post daily"
would be a claim about a handful of friends, and it is not true. A norm
stated far above what someone is actually doing tends to produce
disengagement rather than effort -- if everyone is succeeding and I am not,
I am not motivated, I am disqualified. What the app *can* say honestly is
what it is for: it works best when people share most days. That is a
statement of design intent, true on day one and true forever.

**Name the person, not the population.** "Sarah hasn't seen anything from
you in nine days" beats any average, and unlike a comparison it gets
*stronger* as the circle gets smaller -- which is the case that matters,
because a member with one friend is the member most at risk of drifting off.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import Post, Profile

#: Below this, the thin feed is the binding problem, whatever else is true.
MIN_COMFORTABLE_FRIENDS: int = 3

#: Days of silence before the app mentions it. Short enough to be a habit,
#: long enough that a weekend away does not trigger it.
QUIET_DAYS: int = 3

StandardsKind = Literal["first_post", "invite", "share"]


async def _days_since_last_post(
    session: AsyncSession, viewer_id: uuid.UUID, *, now: datetime
) -> int | None:
    """Whole days since this member last posted, or None if they never have."""
    last: datetime | None = await session.scalar(
        select(func.max(Post.created_at)).where(Post.author_id == viewer_id)
    )
    if last is None:
        return None
    if last.tzinfo is None:
        last = last.replace(tzinfo=UTC)
    return max(0, (now - last).days)


async def _quietest_friend_name(
    session: AsyncSession, friend_ids: list[uuid.UUID]
) -> str | None:
    """A friend to name in the ask, so the consequence is a person.

    Picks the first by name rather than anything cleverer: the point is to
    make the cost concrete, not to single anyone out for neglect.
    """
    if not friend_ids:
        return None
    profile: Profile | None = await session.scalar(
        select(Profile).where(Profile.id.in_(friend_ids)).order_by(Profile.first)
    )
    if profile is None:
        return None
    name: str = (profile.first or "").strip()
    return name or None


async def standards_nudge(
    session: AsyncSession,
    viewer_id: uuid.UUID,
    friend_ids: list[uuid.UUID],
    *,
    now: datetime | None = None,
) -> tuple[StandardsKind, int, str | None] | None:
    """The one ask worth making, as ``(kind, value, friend_name)``.

    Returns ``None`` when nothing applies -- someone with a few friends who
    shared recently is doing exactly what the app wants and should be left
    alone. Only ever one ask: a list of a member's shortcomings is not a
    prompt, it is a scolding.

    Priority, highest first:

    ``first_post``
        They have never posted. This is the one the ribbon refuses to let go
        of, because it is the moment the expectation is set: someone who
        reads for a month without ever sharing has quietly learned that
        NewsWithFriends is a place you consume, and that is very hard to
        unlearn later.

    ``invite``
        Fewer friends than a feed needs to feel alive. Ranked under the first
        post because a member who shares gives their one friend something,
        while a member with five friends who never shares gives nobody
        anything.

    ``share``
        Posted before, but quiet lately. The gentlest of the three, and the
        only one about a habit rather than a beginning.
    """
    moment: datetime = now or datetime.now(UTC)
    friend_count: int = len(friend_ids)

    days: int | None = await _days_since_last_post(session, viewer_id, now=moment)
    if days is None:
        name: str | None = await _quietest_friend_name(session, friend_ids)
        return ("first_post", friend_count, name)

    if friend_count < MIN_COMFORTABLE_FRIENDS:
        return ("invite", friend_count, None)

    if days >= QUIET_DAYS:
        return ("share", days, await _quietest_friend_name(session, friend_ids))

    return None
