"""Friend-graph helpers shared by API routers."""

from __future__ import annotations

import uuid

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import Connection, ConnectionStatus, Profile, StoryStatus


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


def display_name(profile: Profile) -> str:
    if profile.first and profile.last:
        return f"{profile.first} {profile.last}"
    if profile.first:
        return profile.first
    return "Friend"
