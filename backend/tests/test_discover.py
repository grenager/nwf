"""Discover ranking: scoring, ordering, window widening, and what it excludes.

Discover is the one platform-wide surface in an otherwise private app, so
these tests pin both halves of that bargain: the ranking that makes it worth
opening, and the exclusions (seed accounts, editorial posts leaking into
friend feeds) that keep it honest.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from api.discover import (
    StoryAggregate,
    rank_stories,
    score_story,
    seed_user_ids,
)
from api.friends import non_editorial_author_clause, visible_post_ids_for_viewer
from api.main import create_app
from core.models import Post, Profile


def _agg(**kwargs: Any) -> StoryAggregate:
    agg = StoryAggregate(story_id=kwargs.pop("story_id", uuid.uuid4()))
    for key, value in kwargs.items():
        setattr(agg, key, value)
    return agg


def test_commenting_outranks_reacting_outranks_reading() -> None:
    commented = _agg(commenter_ids={uuid.uuid4()})
    reacted = _agg(reactor_ids={uuid.uuid4()})
    read = _agg(reader_count=1)
    assert score_story(commented) > score_story(reacted) > score_story(read)


def test_distinct_people_counted_not_rows() -> None:
    """One member reacting to five posts is one vote, not five."""
    one_person = _agg(reactor_ids={uuid.uuid4()})
    five_people = _agg(reactor_ids={uuid.uuid4() for _ in range(5)})
    assert score_story(five_people) > score_story(one_person)


def test_editorial_seed_scores_above_nothing_and_below_engagement() -> None:
    seeded = _agg(has_editorial_post=True, post_count=1)
    silent = _agg()
    one_read = _agg(reader_count=1)
    assert score_story(seeded) > score_story(silent)
    assert score_story(seeded) < score_story(one_read)


def test_editorial_author_does_not_count_as_an_organic_poster() -> None:
    """The editorial account posting is supply, not a member's endorsement."""
    editorial_only = _agg(has_editorial_post=True, post_count=1)
    member_post = _agg(poster_ids={uuid.uuid4()}, post_count=1)
    assert score_story(member_post) > score_story(editorial_only)


def test_ranking_orders_by_score_then_recency() -> None:
    now = datetime.now(UTC)
    hot = _agg(commenter_ids={uuid.uuid4(), uuid.uuid4()}, latest_activity_at=now)
    older_seed = _agg(
        has_editorial_post=True, latest_activity_at=now - timedelta(hours=5)
    )
    newer_seed = _agg(has_editorial_post=True, latest_activity_at=now)
    aggregates = {a.story_id: a for a in (older_seed, hot, newer_seed)}

    ordered = rank_stories(aggregates, limit=10)

    assert [a.story_id for a in ordered] == [
        hot.story_id,
        newer_seed.story_id,
        older_seed.story_id,
    ]


def test_ranking_respects_limit() -> None:
    aggregates = {a.story_id: a for a in (_agg(reader_count=i) for i in range(10))}
    assert len(rank_stories(aggregates, limit=3)) == 3


def test_ranking_is_stable_for_equal_stories() -> None:
    """Equal cards keep a fixed order instead of shuffling on every reload."""
    aggregates = {a.story_id: a for a in (_agg(reader_count=1) for _ in range(5))}
    first = [a.story_id for a in rank_stories(aggregates, limit=5)]
    second = [a.story_id for a in rank_stories(aggregates, limit=5)]
    assert first == second


class _RaisingSession:
    """Stands in for a session whose role cannot read ``auth.users``."""

    async def execute(self, *_args: Any, **_kwargs: Any) -> Any:
        from sqlalchemy.exc import SQLAlchemyError

        raise SQLAlchemyError("permission denied for table users")


@pytest.mark.asyncio
async def test_seed_lookup_failure_degrades_instead_of_raising() -> None:
    assert await seed_user_ids(_RaisingSession()) == []  # type: ignore[arg-type]


def test_editorial_posts_are_excluded_from_the_friend_feed_query() -> None:
    """The SQL itself must exclude them.

    Having no friends is not enough: story-level read engagement unlocks every
    post about an article, so an editorial post about a widely-read story
    would otherwise surface in Conversations.
    """
    compiled = str(non_editorial_author_clause())
    assert "NOT (EXISTS" in compiled
    assert "profiles.is_editorial" in compiled


class _StatementRecordingSession:
    def __init__(self) -> None:
        self.statements: list[Any] = []

    async def scalars(self, stmt: Any, *_args: Any, **_kwargs: Any) -> Any:
        self.statements.append(stmt)

        class _Empty:
            def all(self) -> list[Any]:
                return []

        return _Empty()


@pytest.mark.asyncio
async def test_feed_candidate_query_filters_editorial_authors() -> None:
    session = _StatementRecordingSession()
    await visible_post_ids_for_viewer(
        session,  # type: ignore[arg-type]
        uuid.uuid4(),
        friend_ids=[uuid.uuid4()],
        limit=40,
        since_days=14,
        min_results=0,
        max_since_days=365,
    )
    assert "is_editorial" in str(session.statements[0])


@pytest.mark.asyncio
async def test_editorial_post_is_not_visible_to_anyone_else() -> None:
    from api.friends import can_see_post

    editorial_author = uuid.uuid4()
    post = Post(
        id=uuid.uuid4(),
        story_id=uuid.uuid4(),
        author_id=editorial_author,
    )

    class _Session:
        async def get(self, _model: Any, _pk: Any) -> Profile:
            return Profile(id=editorial_author, is_editorial=True)

    assert not await can_see_post(
        _Session(),  # type: ignore[arg-type]
        uuid.uuid4(),
        post,
        friend_ids=[],
        participant_ids=[],
    )


def test_discover_route_is_registered() -> None:
    client = TestClient(create_app())
    paths = client.get("/openapi.json").json()["paths"]
    assert "/discover" in paths


def test_discover_is_readable_by_guests() -> None:
    """No auth header: Discover is what a signed-out visitor is shown."""
    client = TestClient(create_app())
    resp = client.get("/discover")
    # Either the payload or a DB-less environment error, never a 401/403.
    assert resp.status_code not in (401, 403)
