"""Friend-graph helpers shared by API routers."""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import Comment, Connection, ConnectionStatus, Profile, StoryStatus


@dataclass
class StoryActivity:
    """Sets of friend user-ids who read/hearted/commented on a single story."""

    read: set[uuid.UUID] = field(default_factory=set)
    hearted: set[uuid.UUID] = field(default_factory=set)
    commented: set[uuid.UUID] = field(default_factory=set)


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


async def friend_stars_by_story(
    session: AsyncSession,
    user_id: uuid.UUID,
    story_ids: list[uuid.UUID],
) -> dict[uuid.UUID, list[Profile]]:
    """Map story_id -> profiles of friends who starred it."""
    if not story_ids:
        return {}

    friends = await accepted_friend_ids(session, user_id)
    if not friends:
        return {}

    rows = (
        await session.execute(
            select(StoryStatus.story_id, Profile)
            .join(Profile, Profile.id == StoryStatus.user_id)
            .where(
                StoryStatus.story_id.in_(story_ids),
                StoryStatus.user_id.in_(friends),
                StoryStatus.starred.is_(True),
            )
        )
    ).all()

    result: dict[uuid.UUID, list[Profile]] = {}
    for story_id, profile in rows:
        result.setdefault(story_id, []).append(profile)
    return result


async def friend_activity_by_story(
    session: AsyncSession,
    user_id: uuid.UUID,
    story_ids: list[uuid.UUID],
) -> dict[uuid.UUID, StoryActivity]:
    """Map story_id -> which friends read/hearted/commented on it.

    Only accepted connections (friends) are counted; the current user is
    excluded so counts reflect *friends'* engagement.
    """
    if not story_ids:
        return {}

    friends = await accepted_friend_ids(session, user_id)
    if not friends:
        return {}

    activity: dict[uuid.UUID, StoryActivity] = {}

    status_rows = (
        await session.execute(
            select(StoryStatus.story_id, StoryStatus.user_id, StoryStatus.read, StoryStatus.starred)
            .where(
                StoryStatus.story_id.in_(story_ids),
                StoryStatus.user_id.in_(friends),
            )
        )
    ).all()
    for story_id, friend_id, read, starred in status_rows:
        entry = activity.setdefault(story_id, StoryActivity())
        if read:
            entry.read.add(friend_id)
        if starred:
            entry.hearted.add(friend_id)

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
) -> tuple[int, int, int]:
    """Distinct friend counts (read, hearted, commented) across a set of stories."""
    read: set[uuid.UUID] = set()
    hearted: set[uuid.UUID] = set()
    commented: set[uuid.UUID] = set()
    for sid in story_ids:
        entry = activity.get(sid)
        if entry is None:
            continue
        read |= entry.read
        hearted |= entry.hearted
        commented |= entry.commented
    return len(read), len(hearted), len(commented)


def display_name(profile: Profile) -> str:
    if profile.first and profile.last:
        return f"{profile.first} {profile.last}"
    if profile.first:
        return profile.first
    return "Friend"
