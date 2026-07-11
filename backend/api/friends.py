"""Friend-graph helpers shared by API routers."""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.models import (
    Comment,
    Connection,
    ConnectionStatus,
    Profile,
    StoryReaction,
    StoryStatus,
)


@dataclass
class StoryActivity:
    """Sets of friend user-ids who read/reacted/commented on a single story."""

    read: set[uuid.UUID] = field(default_factory=set)
    commented: set[uuid.UUID] = field(default_factory=set)
    # reaction type -> set of friend ids who used that reaction
    reactions: dict[str, set[uuid.UUID]] = field(default_factory=dict)


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
    """Map story_id -> profiles of friends who reacted to it (any reaction)."""
    if not story_ids:
        return {}

    friends = await accepted_friend_ids(session, user_id)
    if not friends:
        return {}

    rows = (
        await session.execute(
            select(StoryReaction.story_id, Profile)
            .join(Profile, Profile.id == StoryReaction.user_id)
            .where(
                StoryReaction.story_id.in_(story_ids),
                StoryReaction.user_id.in_(friends),
            )
        )
    ).all()

    result: dict[uuid.UUID, list[Profile]] = {}
    for story_id, profile in rows:
        result.setdefault(story_id, []).append(profile)
    return result


async def my_reactions_by_story(
    session: AsyncSession,
    user_id: uuid.UUID,
    story_ids: list[uuid.UUID],
) -> dict[uuid.UUID, str]:
    """Map story_id -> the current user's own reaction (if any)."""
    if not story_ids:
        return {}
    rows = (
        await session.execute(
            select(StoryReaction.story_id, StoryReaction.reaction).where(
                StoryReaction.story_id.in_(story_ids),
                StoryReaction.user_id == user_id,
            )
        )
    ).all()
    return {story_id: reaction for story_id, reaction in rows}


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

    reaction_rows = (
        await session.execute(
            select(
                StoryReaction.story_id,
                StoryReaction.user_id,
                StoryReaction.reaction,
            ).where(
                StoryReaction.story_id.in_(story_ids),
                StoryReaction.user_id.in_(friends),
            )
        )
    ).all()
    for story_id, friend_id, reaction in reaction_rows:
        entry = activity.setdefault(story_id, StoryActivity())
        entry.reactions.setdefault(reaction, set()).add(friend_id)

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
) -> tuple[set[uuid.UUID], int, dict[str, int]]:
    """Distinct friend readers, comment count, and per-reaction counts."""
    read: set[uuid.UUID] = set()
    commented: set[uuid.UUID] = set()
    reactions: dict[str, set[uuid.UUID]] = {}
    for sid in story_ids:
        entry = activity.get(sid)
        if entry is None:
            continue
        read |= entry.read
        commented |= entry.commented
        for kind, friend_ids in entry.reactions.items():
            reactions.setdefault(kind, set()).update(friend_ids)
    reaction_counts: dict[str, int] = {
        kind: len(ids) for kind, ids in reactions.items() if ids
    }
    return read, len(commented), reaction_counts


async def friend_profiles_map(
    session: AsyncSession, user_id: uuid.UUID
) -> dict[uuid.UUID, Profile]:
    """Map friend user-id -> Profile for all accepted connections."""
    friends = await accepted_friend_ids(session, user_id)
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
