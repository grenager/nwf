"""Ranking for the platform-wide Discover tab.

Discover answers "what is the whole platform talking about right now", in
contrast to the Conversations feed, which answers "what did my friends say".
It is deliberately story-level and viewer-independent: one row per article,
carrying aggregate counts only. No names, avatars or takes from outside the
viewer's own graph ever appear here, which is what keeps a public-ish surface
compatible with an app whose conversations are all private.

Ranking is a small weighted sum over a trailing window (see
``score_story``). Two shapes of supply feed it:

* organic engagement - members posting, replying, reacting and reading;
* editorial seeds - links posted by an ``is_editorial`` account, which get a
  floor score so a freshly curated morning list still surfaces (newest
  first) on a platform too quiet to have engagement yet.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import ColumnElement, func, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute
from sqlalchemy.sql.functions import coalesce

from core.logging import get_logger
from core.models import (
    Comment,
    CommentReaction,
    Post,
    PostReaction,
    Profile,
    Story,
    StoryStatus,
)

log = get_logger("discover")

#: Email domain reserved for accounts created by ``backend/scripts/seed_*``.
#: Their fabricated reactions and replies would otherwise dominate a
#: platform-wide ranking, so Discover leaves them out. Kept in sync with
#: ``SEED_DOMAIN`` in ``backend/scripts/seed_fake_activity.py``.
SEED_EMAIL_DOMAIN: str = "seed.test"

# Relative worth of each engagement signal. Commenting is the behaviour the
# product exists for, so it leads; reacting is cheaper; a bare read is the
# weakest vote but still a vote. ``posts`` counts distinct people who chose to
# share the article at all.
#
# The weights are even numbers so ``EDITORIAL_FLOOR`` can sit strictly below
# the weakest organic signal: a single member reading an article must outrank
# a curated link nobody has touched.
WEIGHT_COMMENTER: int = 6
WEIGHT_REACTOR: int = 4
WEIGHT_POSTER: int = 4
WEIGHT_READER: int = 2
EDITORIAL_FLOOR: int = 1


@dataclass
class StoryAggregate:
    """Windowed engagement totals for one story, across every post about it."""

    story_id: uuid.UUID
    post_count: int = 0
    poster_ids: set[uuid.UUID] = field(default_factory=set)
    commenter_ids: set[uuid.UUID] = field(default_factory=set)
    comment_count: int = 0
    reactor_ids: set[uuid.UUID] = field(default_factory=set)
    reader_count: int = 0
    has_editorial_post: bool = False
    latest_activity_at: datetime | None = None

    def touch(self, when: datetime | None) -> None:
        """Keep the most recent activity timestamp seen for this story."""
        if when is None:
            return
        if self.latest_activity_at is None or when > self.latest_activity_at:
            self.latest_activity_at = when


def score_story(agg: StoryAggregate) -> int:
    """Engagement score for one story. Higher sorts first.

    Distinct *people* are counted, not raw rows, so one member reacting to
    five posts about the same article does not outrank five members reacting
    once each.

    An editorial post contributes ``EDITORIAL_FLOOR``, deliberately below
    every organic signal: a curated link surfaces on an empty day but is
    outranked the moment a real member engages with anything.
    """
    organic_posters = len(agg.poster_ids)
    score = (
        WEIGHT_COMMENTER * len(agg.commenter_ids)
        + WEIGHT_REACTOR * len(agg.reactor_ids)
        + WEIGHT_POSTER * organic_posters
        + WEIGHT_READER * agg.reader_count
    )
    if agg.has_editorial_post:
        score += EDITORIAL_FLOOR
    return score


def rank_stories(
    aggregates: dict[uuid.UUID, StoryAggregate], limit: int
) -> list[StoryAggregate]:
    """Most active stories first, freshest breaking ties."""

    def sort_key(agg: StoryAggregate) -> tuple[int, float, str]:
        latest = agg.latest_activity_at
        return (
            score_story(agg),
            latest.timestamp() if latest is not None else 0.0,
            # Stable final tie-break so equal stories keep a fixed order
            # between requests instead of shuffling on every reload.
            str(agg.story_id),
        )

    ordered = sorted(aggregates.values(), key=sort_key, reverse=True)
    return ordered[:limit]


async def seed_user_ids(session: AsyncSession) -> list[uuid.UUID]:
    """Ids of accounts created by the seed scripts, by reserved email domain.

    Returns an empty list when ``auth.users`` cannot be read. That only makes
    Discover less selective rather than wrong, so it is logged instead of
    failing the request (same posture as ``friends.email_for_user``).
    """
    try:
        rows = (
            await session.execute(
                text(
                    "select id from auth.users "
                    "where email ilike :pattern"
                ),
                {"pattern": f"%@{SEED_EMAIL_DOMAIN}"},
            )
        ).all()
    except SQLAlchemyError:
        log.warning("discover.seed_lookup_failed")
        return []
    return [uuid.UUID(str(row[0])) for row in rows]


def _excluded(
    column: InstrumentedAttribute[uuid.UUID], excluded: list[uuid.UUID]
) -> list[ColumnElement[bool]]:
    """Optional NOT IN filter, skipped entirely when nothing is excluded."""
    if not excluded:
        return []
    return [column.not_in(excluded)]


async def load_window_aggregates(
    session: AsyncSession,
    *,
    since: datetime,
    exclude_user_ids: list[uuid.UUID],
) -> dict[uuid.UUID, StoryAggregate]:
    """Engagement totals per story for activity at or after ``since``.

    Five grouped queries rather than one join: joining posts, comments,
    reactions and reads in a single statement multiplies rows, and the counts
    would need DISTINCT over the product. Merging small grouped results in
    Python is both cheaper and easier to read - the same batching style the
    feed uses.
    """
    aggregates: dict[uuid.UUID, StoryAggregate] = {}

    def entry(story_id: uuid.UUID) -> StoryAggregate:
        agg = aggregates.get(story_id)
        if agg is None:
            agg = StoryAggregate(story_id=story_id)
            aggregates[story_id] = agg
        return agg

    # Posts: how many people shared the article, and whether any share was an
    # editorial seed. Editorial authors are tracked separately from
    # ``poster_ids`` so they cannot inflate the organic poster count.
    post_rows = (
        await session.execute(
            select(
                Post.story_id,
                Post.author_id,
                Profile.is_editorial,
                func.max(Post.created_at),
                func.count(),
            )
            .join(Profile, Profile.id == Post.author_id)
            .join(Story, Story.id == Post.story_id)
            .where(
                Post.created_at >= since,
                Story.archived.is_(False),
                *_excluded(Post.author_id, exclude_user_ids),
            )
            .group_by(Post.story_id, Post.author_id, Profile.is_editorial)
        )
    ).all()
    for story_id, author_id, is_editorial, latest, count in post_rows:
        agg = entry(story_id)
        agg.post_count += int(count)
        agg.touch(latest)
        if is_editorial:
            agg.has_editorial_post = True
        else:
            agg.poster_ids.add(author_id)

    # Comments carry a denormalised story_id, so replies count even when the
    # post they belong to was created before the window.
    comment_rows = (
        await session.execute(
            select(
                Comment.story_id,
                Comment.user_id,
                func.max(Comment.created_at),
                func.count(),
            )
            .join(Story, Story.id == Comment.story_id)
            .where(
                Comment.created_at >= since,
                Story.archived.is_(False),
                *_excluded(Comment.user_id, exclude_user_ids),
            )
            .group_by(Comment.story_id, Comment.user_id)
        )
    ).all()
    for story_id, user_id, latest, count in comment_rows:
        agg = entry(story_id)
        agg.commenter_ids.add(user_id)
        agg.comment_count += int(count)
        agg.touch(latest)

    # Reactions on posts and on comments both count as reacting to the story.
    post_reaction_rows = (
        await session.execute(
            select(
                Post.story_id,
                PostReaction.user_id,
                func.max(PostReaction.updated_at),
            )
            .join(Post, Post.id == PostReaction.post_id)
            .join(Story, Story.id == Post.story_id)
            .where(
                PostReaction.updated_at >= since,
                Story.archived.is_(False),
                *_excluded(PostReaction.user_id, exclude_user_ids),
            )
            .group_by(Post.story_id, PostReaction.user_id)
        )
    ).all()
    for story_id, user_id, latest in post_reaction_rows:
        agg = entry(story_id)
        agg.reactor_ids.add(user_id)
        agg.touch(latest)

    comment_reaction_rows = (
        await session.execute(
            select(
                Comment.story_id,
                CommentReaction.user_id,
                func.max(CommentReaction.updated_at),
            )
            .join(Comment, Comment.id == CommentReaction.comment_id)
            .join(Story, Story.id == Comment.story_id)
            .where(
                CommentReaction.updated_at >= since,
                Story.archived.is_(False),
                *_excluded(CommentReaction.user_id, exclude_user_ids),
            )
            .group_by(Comment.story_id, CommentReaction.user_id)
        )
    ).all()
    for story_id, user_id, latest in comment_reaction_rows:
        agg = entry(story_id)
        agg.reactor_ids.add(user_id)
        agg.touch(latest)

    # Reads: last_read_at is refreshed on every open, read_at is set once on
    # the first, so a story opened before the window but reopened inside it
    # still counts.
    read_at = coalesce(StoryStatus.last_read_at, StoryStatus.read_at)
    read_rows = (
        await session.execute(
            select(
                StoryStatus.story_id,
                func.count(func.distinct(StoryStatus.user_id)),
                func.max(read_at),
            )
            .join(Story, Story.id == StoryStatus.story_id)
            .where(
                read_at >= since,
                Story.archived.is_(False),
                *_excluded(StoryStatus.user_id, exclude_user_ids),
            )
            .group_by(StoryStatus.story_id)
        )
    ).all()
    for story_id, readers, latest in read_rows:
        agg = entry(story_id)
        agg.reader_count = int(readers)
        agg.touch(latest)

    return aggregates
