"""Friend-graph helpers shared by API routers."""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import Select, func, or_, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import (
    Comment,
    Connection,
    ConnectionStatus,
    Post,
    PostParticipant,
    PostVisibility,
    Profile,
    Source,
    StoryRating,
    StoryStatus,
)

CURATED_SOURCE_LIMIT: int = 40


@dataclass(frozen=True)
class ActivityEmailRecipient:
    """A user eligible to receive an instant activity email."""

    user_id: uuid.UUID
    email: str
    first: str | None
    unsubscribe_token: uuid.UUID


async def email_for_user(
    session: AsyncSession, user_id: uuid.UUID
) -> str | None:
    """Look up auth.users.email for a profile id."""
    try:
        row = (
            await session.execute(
                text("select email from auth.users where id = :id"),
                {"id": user_id},
            )
        ).first()
    except SQLAlchemyError:
        return None
    if row is None or not row[0]:
        return None
    return str(row[0]).strip().lower()


async def load_activity_email_recipients(
    session: AsyncSession,
    user_ids: Iterable[uuid.UUID],
) -> list[ActivityEmailRecipient]:
    """Load email + profile fields for users who can receive instant emails.

    Skips ids with no email and profiles with ``instant_email_opt_out``.
    """
    ids: list[uuid.UUID] = list({uid for uid in user_ids})
    if not ids:
        return []

    profiles = list(
        (
            await session.scalars(select(Profile).where(Profile.id.in_(ids)))
        ).all()
    )
    by_id: dict[uuid.UUID, Profile] = {p.id: p for p in profiles}

    recipients: list[ActivityEmailRecipient] = []
    for user_id in ids:
        profile = by_id.get(user_id)
        if profile is None or profile.instant_email_opt_out:
            continue
        email = await email_for_user(session, user_id)
        if not email:
            continue
        recipients.append(
            ActivityEmailRecipient(
                user_id=user_id,
                email=email,
                first=profile.first,
                unsubscribe_token=profile.unsubscribe_token,
            )
        )
    return recipients


@dataclass
class StoryActivity:
    """Sets of friend user-ids who read/commented on a single story."""

    read: set[uuid.UUID] = field(default_factory=set)
    commented: set[uuid.UUID] = field(default_factory=set)


def curated_source_subquery(limit: int = CURATED_SOURCE_LIMIT) -> Any:
    """Top global sources by prominence for guest feeds."""
    return (
        select(Source.id)
        .order_by(Source.prominence.desc().nulls_last(), Source.name)
        .limit(limit)
        .scalar_subquery()
    )


async def global_activity_by_story(
    session: AsyncSession,
    story_ids: list[uuid.UUID],
) -> dict[uuid.UUID, StoryActivity]:
    """Map story_id -> global read/comment activity (all users)."""
    if not story_ids:
        return {}

    activity: dict[uuid.UUID, StoryActivity] = {}

    status_rows = (
        await session.execute(
            select(StoryStatus.story_id, StoryStatus.user_id, StoryStatus.read).where(
                StoryStatus.story_id.in_(story_ids),
                StoryStatus.read.is_(True),
            )
        )
    ).all()
    for story_id, user_id, read in status_rows:
        entry = activity.setdefault(story_id, StoryActivity())
        if read:
            entry.read.add(user_id)

    comment_rows = (
        await session.execute(
            select(Comment.story_id, Comment.user_id).where(
                Comment.story_id.in_(story_ids)
            )
        )
    ).all()
    for story_id, user_id in comment_rows:
        activity.setdefault(story_id, StoryActivity()).commented.add(user_id)

    return activity


async def accepted_friend_ids(session: AsyncSession, user_id: uuid.UUID) -> list[uuid.UUID]:
    """Return user ids of accepted connections (excluding self)."""
    rows = (
        await session.execute(
            select(Connection.first_id, Connection.second_id).where(
                Connection.status == ConnectionStatus.accepted,
                or_(Connection.first_id == user_id, Connection.second_id == user_id),
            )
        )
    ).all()
    friends: set[uuid.UUID] = set()
    for first_id, second_id in rows:
        other = second_id if first_id == user_id else first_id
        friends.add(other)
    return list(friends)


async def average_friend_count_for_active_users(session: AsyncSession) -> float:
    """Mean accepted-friend count among users who have posted or commented.

    Powers the "the average active user has N friends" nudge, so "active" is
    deliberately engagement-based rather than every signed-up profile — a long
    tail of empty accounts would drag the number toward zero and make the
    comparison meaningless.
    """
    active = (
        select(Post.author_id.label("user_id"))
        .union(select(Comment.user_id.label("user_id")))
        .subquery()
    )
    accepted_edges = (
        select(Connection.first_id.label("user_id"))
        .where(Connection.status == ConnectionStatus.accepted)
        .union_all(
            select(Connection.second_id.label("user_id")).where(
                Connection.status == ConnectionStatus.accepted
            )
        )
        .subquery()
    )
    per_user = (
        select(
            accepted_edges.c.user_id,
            func.count().label("friend_count"),
        )
        .group_by(accepted_edges.c.user_id)
        .subquery()
    )
    stmt = select(
        func.coalesce(func.avg(func.coalesce(per_user.c.friend_count, 0)), 0.0)
    ).select_from(
        active.outerjoin(per_user, per_user.c.user_id == active.c.user_id)
    )
    average = await session.scalar(stmt)
    return float(average) if average is not None else 0.0


async def friend_ids_for_users(
    session: AsyncSession, user_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, set[uuid.UUID]]:
    """Map each given user id -> ids of their accepted friends, in one query."""
    ids: list[uuid.UUID] = list({uid for uid in user_ids})
    if not ids:
        return {}
    rows = (
        await session.execute(
            select(Connection.first_id, Connection.second_id).where(
                Connection.status == ConnectionStatus.accepted,
                or_(
                    Connection.first_id.in_(ids),
                    Connection.second_id.in_(ids),
                ),
            )
        )
    ).all()
    wanted: set[uuid.UUID] = set(ids)
    result: dict[uuid.UUID, set[uuid.UUID]] = {uid: set() for uid in ids}
    for first_id, second_id in rows:
        if first_id in wanted:
            result[first_id].add(second_id)
        if second_id in wanted:
            result[second_id].add(first_id)
    return result


async def friend_stars_by_story(
    session: AsyncSession,
    user_id: uuid.UUID,
    story_ids: list[uuid.UUID],
    *,
    friend_ids: list[uuid.UUID] | None = None,
) -> dict[uuid.UUID, list[Profile]]:
    """Map story_id -> profiles of friends who rated it."""
    if not story_ids:
        return {}

    friends: list[uuid.UUID] = (
        friend_ids
        if friend_ids is not None
        else await accepted_friend_ids(session, user_id)
    )
    if not friends:
        return {}

    rows = (
        await session.execute(
            select(StoryRating.story_id, Profile)
            .join(Profile, Profile.id == StoryRating.user_id)
            .where(
                StoryRating.story_id.in_(story_ids),
                StoryRating.user_id.in_(friends),
            )
        )
    ).all()

    result: dict[uuid.UUID, list[Profile]] = {}
    for story_id, profile in rows:
        result.setdefault(story_id, []).append(profile)
    return result


async def my_ratings_by_story(
    session: AsyncSession,
    user_id: uuid.UUID,
    story_ids: list[uuid.UUID],
) -> dict[uuid.UUID, float]:
    """Map story_id -> the current user's own half-star rating (if any)."""
    if not story_ids:
        return {}
    rows = (
        await session.execute(
            select(StoryRating.story_id, StoryRating.rating).where(
                StoryRating.story_id.in_(story_ids),
                StoryRating.user_id == user_id,
            )
        )
    ).all()
    return {story_id: float(rating) for story_id, rating in rows}


async def ratings_for_users_by_story(
    session: AsyncSession,
    story_ids: list[uuid.UUID],
    user_ids: Iterable[uuid.UUID],
) -> dict[uuid.UUID, dict[uuid.UUID, float]]:
    """Map story_id -> {user_id: half-star rating} for the given users."""
    users = list(user_ids)
    if not story_ids or not users:
        return {}
    rows = (
        await session.execute(
            select(
                StoryRating.story_id,
                StoryRating.user_id,
                StoryRating.rating,
            ).where(
                StoryRating.story_id.in_(story_ids),
                StoryRating.user_id.in_(users),
            )
        )
    ).all()
    result: dict[uuid.UUID, dict[uuid.UUID, float]] = {}
    for story_id, uid, rating in rows:
        result.setdefault(story_id, {})[uid] = float(rating)
    return result


async def friend_ratings_by_story(
    session: AsyncSession,
    user_id: uuid.UUID,
    story_ids: list[uuid.UUID],
    *,
    friend_ids: list[uuid.UUID] | None = None,
) -> dict[uuid.UUID, tuple[float, int]]:
    """Map story_id -> (average rating, count) among the viewer's friends."""
    if not story_ids:
        return {}
    friends: list[uuid.UUID] = (
        friend_ids
        if friend_ids is not None
        else await accepted_friend_ids(session, user_id)
    )
    if not friends:
        return {}
    rows = (
        await session.execute(
            select(StoryRating.story_id, StoryRating.rating).where(
                StoryRating.story_id.in_(story_ids),
                StoryRating.user_id.in_(friends),
            )
        )
    ).all()
    buckets: dict[uuid.UUID, list[float]] = {}
    for story_id, rating in rows:
        buckets.setdefault(story_id, []).append(float(rating))
    return {
        story_id: (sum(values) / len(values), len(values))
        for story_id, values in buckets.items()
    }


async def friend_activity_by_story(
    session: AsyncSession,
    user_id: uuid.UUID,
    story_ids: list[uuid.UUID],
    *,
    friend_ids: list[uuid.UUID] | None = None,
) -> dict[uuid.UUID, StoryActivity]:
    """Map story_id -> which friends read/commented on it.

    Only accepted connections (friends) are counted; the current user is
    excluded so counts reflect *friends'* engagement.
    """
    if not story_ids:
        return {}

    friends: list[uuid.UUID] = (
        friend_ids
        if friend_ids is not None
        else await accepted_friend_ids(session, user_id)
    )
    if not friends:
        return {}

    activity: dict[uuid.UUID, StoryActivity] = {}

    status_rows = (
        await session.execute(
            select(StoryStatus.story_id, StoryStatus.user_id, StoryStatus.read)
            .where(
                StoryStatus.story_id.in_(story_ids),
                StoryStatus.user_id.in_(friends),
                StoryStatus.read.is_(True),
            )
        )
    ).all()
    for story_id, friend_id, read in status_rows:
        entry = activity.setdefault(story_id, StoryActivity())
        if read:
            entry.read.add(friend_id)

    comment_rows = (
        await session.execute(
            select(Comment.story_id, Comment.user_id).where(
                Comment.story_id.in_(story_ids),
                Comment.user_id.in_(friends),
            )
        )
    ).all()
    for story_id, friend_id in comment_rows:
        activity.setdefault(story_id, StoryActivity()).commented.add(friend_id)

    return activity


def aggregate_engagement(
    activity: dict[uuid.UUID, StoryActivity],
    story_ids: Iterable[uuid.UUID],
) -> tuple[set[uuid.UUID], int]:
    """Distinct friend readers and comment count across the given stories."""
    read: set[uuid.UUID] = set()
    commented: set[uuid.UUID] = set()
    for sid in story_ids:
        entry = activity.get(sid)
        if entry is None:
            continue
        read |= entry.read
        commented |= entry.commented
    return read, len(commented)


async def friend_profiles_map(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    friend_ids: list[uuid.UUID] | None = None,
) -> dict[uuid.UUID, Profile]:
    """Map friend user-id -> Profile for all accepted connections."""
    friends: list[uuid.UUID] = (
        friend_ids
        if friend_ids is not None
        else await accepted_friend_ids(session, user_id)
    )
    if not friends:
        return {}
    rows = await session.scalars(select(Profile).where(Profile.id.in_(friends)))
    return {p.id: p for p in rows.all()}


def top_readers(
    read_ids: set[uuid.UUID],
    profiles: dict[uuid.UUID, Profile],
    limit: int = 3,
) -> list[Profile]:
    """Return up to `limit` reader profiles for avatar display."""
    out: list[Profile] = []
    for rid in read_ids:
        profile = profiles.get(rid)
        if profile is None:
            continue
        out.append(profile)
        if len(out) >= limit:
            break
    return out


def display_name(profile: Profile) -> str:
    if profile.first and profile.last:
        return f"{profile.first} {profile.last}"
    if profile.first:
        return profile.first
    return "Friend"


async def post_participant_ids(
    session: AsyncSession, post_id: uuid.UUID
) -> list[uuid.UUID]:
    """User ids who author or reply on a post."""
    rows = await session.scalars(
        select(PostParticipant.user_id).where(PostParticipant.post_id == post_id)
    )
    return list(rows.all())


async def can_see_post(
    session: AsyncSession,
    viewer_id: uuid.UUID | None,
    post: Post,
    *,
    friend_ids: list[uuid.UUID] | None = None,
    participant_ids: list[uuid.UUID] | None = None,
) -> bool:
    """True if viewer may see the post (public, participant, or FoF of participant)."""
    if post.visibility == PostVisibility.public:
        return True
    if viewer_id is None:
        return False
    if post.author_id == viewer_id:
        return True
    participants: list[uuid.UUID] = (
        participant_ids
        if participant_ids is not None
        else await post_participant_ids(session, post.id)
    )
    if viewer_id in participants:
        return True
    friends: list[uuid.UUID] = (
        friend_ids
        if friend_ids is not None
        else await accepted_friend_ids(session, viewer_id)
    )
    friend_set = set(friends)
    return any(pid in friend_set for pid in participants)


def audience_label(visibility: PostVisibility, participant_count: int) -> str:
    """Human-readable audience for the composer / card chrome."""
    if visibility == PostVisibility.public:
        return "public"
    if participant_count <= 1:
        return "visible to friends"
    return f"visible to friends of {participant_count} participants"


async def visible_post_ids_for_viewer(
    session: AsyncSession,
    viewer_id: uuid.UUID | None,
    *,
    friend_ids: list[uuid.UUID] | None = None,
    limit: int = 100,
    since_days: int = 14,
    min_results: int = 0,
    max_since_days: int | None = None,
) -> list[uuid.UUID]:
    """Candidate post ids the viewer may see, newest-posted first.

    Guests see only public posts. Authenticated users see public posts plus
    private posts where they are a participant or a friend of any participant.
    Sorted by ``created_at`` so a new reply does not bump a post to the top.

    ``since_days`` keeps the common case cheap by only scanning recent posts. If
    that window yields fewer than ``min_results`` posts, the lookback widens to
    ``max_since_days`` (``None`` for no cutoff) so a quiet week still produces a
    full feed instead of a near-empty one.
    """
    friends: list[uuid.UUID] | None = None
    if viewer_id is not None:
        friends = (
            friend_ids
            if friend_ids is not None
            else await accepted_friend_ids(session, viewer_id)
        )

    def query(since: datetime | None) -> Select[tuple[uuid.UUID]]:
        if viewer_id is None:
            stmt = select(Post.id).where(
                Post.visibility == PostVisibility.public
            )
            if since is not None:
                stmt = stmt.where(Post.created_at >= since)
            return stmt.order_by(Post.created_at.desc()).limit(limit)

        # Posts where viewer or any friend is a participant, OR public.
        participant_filter = [viewer_id, *(friends or [])]
        stmt = (
            select(Post.id)
            .outerjoin(PostParticipant, PostParticipant.post_id == Post.id)
            .where(
                or_(
                    Post.visibility == PostVisibility.public,
                    Post.author_id == viewer_id,
                    PostParticipant.user_id.in_(participant_filter),
                ),
            )
        )
        if since is not None:
            stmt = stmt.where(Post.created_at >= since)
        return (
            stmt.group_by(Post.id, Post.created_at)
            .order_by(Post.created_at.desc())
            .limit(limit)
        )

    now = datetime.now(UTC)
    recent = await session.scalars(query(now - timedelta(days=since_days)))
    post_ids: list[uuid.UUID] = list(recent.all())

    wanted: int = min(min_results, limit)
    if len(post_ids) >= wanted or (
        max_since_days is not None and max_since_days <= since_days
    ):
        return post_ids

    # Widen the window. The result is a superset in the same order, so it simply
    # replaces the recent-only pass.
    wider: datetime | None = (
        now - timedelta(days=max_since_days)
        if max_since_days is not None
        else None
    )
    return list((await session.scalars(query(wider))).all())


async def primary_post_ids_by_story(
    session: AsyncSession,
    viewer_id: uuid.UUID,
    story_ids: list[uuid.UUID],
    *,
    friend_ids: list[uuid.UUID] | None = None,
) -> dict[uuid.UUID, uuid.UUID]:
    """Most recent viewer-visible post id per story (for search → detail links)."""
    if not story_ids:
        return {}

    friends: list[uuid.UUID] = (
        friend_ids
        if friend_ids is not None
        else await accepted_friend_ids(session, viewer_id)
    )
    participant_filter: list[uuid.UUID] = [viewer_id, *friends]
    rows = (
        await session.execute(
            select(Post.id, Post.story_id, Post.created_at)
            .outerjoin(PostParticipant, PostParticipant.post_id == Post.id)
            .where(
                Post.story_id.in_(story_ids),
                or_(
                    Post.visibility == PostVisibility.public,
                    Post.author_id == viewer_id,
                    PostParticipant.user_id.in_(participant_filter),
                ),
            )
            .group_by(Post.id, Post.story_id, Post.created_at)
            .order_by(Post.created_at.desc())
        )
    ).all()

    result: dict[uuid.UUID, uuid.UUID] = {}
    for post_id, story_id, _created_at in rows:
        if story_id not in result:
            result[story_id] = post_id
    return result
