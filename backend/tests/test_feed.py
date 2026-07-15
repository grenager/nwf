"""Regression guard: the feed serializer must stay O(1) in query count.

The feed used to call ``serialize_post`` (and ``post_participant_ids``) once per
post, firing hundreds of sequential queries. These tests pin the batched path so
a future refactor can't silently reintroduce the N+1.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest

from api.routers.feed import _build_post_outs, _participants_by_post
from core.models import Post, PostVisibility, Story, StoryKind


class _FakeScalarResult:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def all(self) -> list[Any]:
        return self._rows


class _FakeResult:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def all(self) -> list[Any]:
        return self._rows

    def scalars(self) -> _FakeScalarResult:
        return _FakeScalarResult(self._rows)


class _CountingSession:
    """Minimal async session stand-in that counts DB round-trips."""

    def __init__(self) -> None:
        self.execute_calls: int = 0
        self.scalars_calls: int = 0
        self.get_calls: int = 0

    async def execute(self, *_args: Any, **_kwargs: Any) -> _FakeResult:
        self.execute_calls += 1
        return _FakeResult([])

    async def scalars(self, *_args: Any, **_kwargs: Any) -> _FakeScalarResult:
        self.scalars_calls += 1
        return _FakeScalarResult([])

    async def scalar(self, *_args: Any, **_kwargs: Any) -> int:
        self.execute_calls += 1
        return 0

    async def get(self, *_args: Any, **_kwargs: Any) -> None:
        self.get_calls += 1
        return None

    @property
    def total_queries(self) -> int:
        return self.execute_calls + self.scalars_calls + self.get_calls


def _make_posts(n: int) -> tuple[list[Post], dict[uuid.UUID, Story]]:
    now = datetime.now(UTC)
    posts: list[Post] = []
    stories: dict[uuid.UUID, Story] = {}
    for _ in range(n):
        story = Story(
            id=uuid.uuid4(),
            article_url="https://example.com/a",
            full_headline="Headline",
            summary=None,
            image_url=None,
            publisher=None,
            source_id=None,
            kind=StoryKind.news,
        )
        stories[story.id] = story
        post = Post(
            id=uuid.uuid4(),
            story_id=story.id,
            author_id=uuid.uuid4(),
            take="a take",
            visibility=PostVisibility.public,
            last_activity_at=now,
            created_at=now,
            updated_at=now,
        )
        posts.append(post)
    return posts, stories


async def _count_build_queries(n: int, *, viewer_id: uuid.UUID | None) -> int:
    posts, stories = _make_posts(n)
    session = _CountingSession()
    outs = await _build_post_outs(
        session,  # type: ignore[arg-type]
        posts,
        viewer_id=viewer_id,
        friends=[],
        stories=stories,
        sources={},
        participants_by_post={},
        status_by_story={},
        activity={},
        friend_profiles={},
        unread_post_ids=set(),
    )
    assert len(outs) == n
    return session.total_queries


@pytest.mark.asyncio
async def test_build_post_outs_query_count_is_constant_for_guest() -> None:
    one = await _count_build_queries(1, viewer_id=None)
    many = await _count_build_queries(50, viewer_id=None)
    assert one == many
    # replies + post reactions + ratings (execute) + attachments + authors (scalars)
    assert many <= 6


@pytest.mark.asyncio
async def test_build_post_outs_query_count_is_constant_for_viewer() -> None:
    viewer = uuid.uuid4()
    one = await _count_build_queries(1, viewer_id=viewer)
    many = await _count_build_queries(50, viewer_id=viewer)
    assert one == many
    # guest set + comment reactions when reply bodies are shown
    assert many <= 7


@pytest.mark.asyncio
async def test_participants_batched_in_single_query() -> None:
    session = _CountingSession()
    ids = [uuid.uuid4() for _ in range(25)]
    result = await _participants_by_post(session, ids)  # type: ignore[arg-type]
    assert result == {}
    assert session.execute_calls == 1


@pytest.mark.asyncio
async def test_participants_empty_makes_no_query() -> None:
    session = _CountingSession()
    result = await _participants_by_post(session, [])  # type: ignore[arg-type]
    assert result == {}
    assert session.total_queries == 0
