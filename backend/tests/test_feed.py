"""Feed guards: serializer query count, and lookback widening.

The feed used to call ``serialize_post`` (and ``post_participant_ids``) once per
post, firing hundreds of sequential queries. These tests pin the batched path so
a future refactor can't silently reintroduce the N+1. They also pin the candidate
query's lookback behaviour: recent-window first, widened only when the feed would
otherwise come up short.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest

from api.friends import (
    fof_attribution_by_post,
    primary_post_ids_by_story,
    viewer_visible_post_ids,
    visible_post_ids_for_viewer,
)
from api.routers.feed import (
    FEED_SHARED_TEXT_MAX_CHARS,
    _build_post_outs,
    _feed_shared_text_teaser,
    _participants_by_post,
)
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
            visibility=PostVisibility.private,
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
        unread_reply_counts={},
        last_seen_by_post={},
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


class _ScriptedSession:
    """Serves a scripted result per ``scalars`` call and records the statements."""

    def __init__(self, results: list[list[uuid.UUID]]) -> None:
        self._results: list[list[uuid.UUID]] = list(results)
        self.statements: list[Any] = []

    async def scalars(
        self, stmt: Any, *_args: Any, **_kwargs: Any
    ) -> _FakeScalarResult:
        self.statements.append(stmt)
        rows = self._results.pop(0) if self._results else []
        return _FakeScalarResult(rows)

    def has_date_cutoff(self, index: int) -> bool:
        return "created_at >=" in str(self.statements[index])


def _ids(n: int) -> list[uuid.UUID]:
    return [uuid.uuid4() for _ in range(n)]


@pytest.mark.asyncio
async def test_recent_window_satisfying_minimum_makes_one_query() -> None:
    viewer = uuid.uuid4()
    session = _ScriptedSession([_ids(20)])
    result = await visible_post_ids_for_viewer(
        session,  # type: ignore[arg-type]
        viewer,
        friend_ids=[],
        limit=40,
        since_days=14,
        min_results=20,
        max_since_days=365,
    )
    assert len(result) == 20
    assert len(session.statements) == 1


@pytest.mark.asyncio
async def test_thin_recent_window_widens_lookback() -> None:
    viewer = uuid.uuid4()
    wide = _ids(18)
    session = _ScriptedSession([_ids(3), wide])
    result = await visible_post_ids_for_viewer(
        session,  # type: ignore[arg-type]
        viewer,
        friend_ids=[],
        limit=40,
        since_days=14,
        min_results=20,
        max_since_days=365,
    )
    # The widened pass is a superset, so it replaces the recent-only result.
    assert result == wide
    assert len(session.statements) == 2
    assert session.has_date_cutoff(0)
    assert session.has_date_cutoff(1)


@pytest.mark.asyncio
async def test_widening_without_max_lookback_drops_the_cutoff() -> None:
    viewer = uuid.uuid4()
    session = _ScriptedSession([_ids(1), _ids(9)])
    await visible_post_ids_for_viewer(
        session,  # type: ignore[arg-type]
        viewer,
        friend_ids=[],
        limit=40,
        since_days=14,
        min_results=20,
        max_since_days=None,
    )
    assert len(session.statements) == 2
    assert session.has_date_cutoff(0)
    assert not session.has_date_cutoff(1)


@pytest.mark.asyncio
async def test_no_minimum_never_widens() -> None:
    viewer = uuid.uuid4()
    session = _ScriptedSession([_ids(2)])
    result = await visible_post_ids_for_viewer(
        session,  # type: ignore[arg-type]
        viewer,
        friend_ids=[],
        limit=40,
        since_days=14,
    )
    assert len(result) == 2
    assert len(session.statements) == 1


@pytest.mark.asyncio
async def test_minimum_above_limit_does_not_force_a_second_pass() -> None:
    viewer = uuid.uuid4()
    session = _ScriptedSession([_ids(5)])
    result = await visible_post_ids_for_viewer(
        session,  # type: ignore[arg-type]
        viewer,
        friend_ids=[],
        limit=5,
        since_days=14,
        min_results=20,
        max_since_days=365,
    )
    assert len(result) == 5
    assert len(session.statements) == 1


@pytest.mark.asyncio
async def test_viewer_query_widens_without_refetching_friends() -> None:
    viewer = uuid.uuid4()
    wide = _ids(20)
    session = _ScriptedSession([_ids(1), wide])
    result = await visible_post_ids_for_viewer(
        session,  # type: ignore[arg-type]
        viewer,
        friend_ids=[uuid.uuid4()],
        limit=40,
        since_days=14,
        min_results=20,
        max_since_days=365,
    )
    assert result == wide
    # Two candidate queries and no extra friend lookup.
    assert len(session.statements) == 2


def test_feed_shared_text_teaser_short_text_unchanged() -> None:
    text: str = "A short pasted excerpt."
    teaser, truncated = _feed_shared_text_teaser(text)
    assert teaser == text
    assert truncated is False


def test_feed_shared_text_teaser_long_text_truncated() -> None:
    text: str = "x" * (FEED_SHARED_TEXT_MAX_CHARS + 50)
    teaser, truncated = _feed_shared_text_teaser(text)
    assert truncated is True
    assert teaser is not None
    assert len(teaser) == FEED_SHARED_TEXT_MAX_CHARS
    assert teaser == text[:FEED_SHARED_TEXT_MAX_CHARS]


class _ExecuteResult:
    def __init__(self, rows: list[tuple[uuid.UUID, uuid.UUID, datetime]]) -> None:
        self._rows = rows

    def all(self) -> list[tuple[uuid.UUID, uuid.UUID, datetime]]:
        return self._rows


class _ExecuteSession:
    def __init__(self, rows: list[tuple[uuid.UUID, uuid.UUID, datetime]]) -> None:
        self._rows = rows
        self.execute_calls: int = 0

    async def execute(self, *_args: Any, **_kwargs: Any) -> _ExecuteResult:
        self.execute_calls += 1
        return _ExecuteResult(self._rows)


@pytest.mark.asyncio
async def test_primary_post_ids_by_story_picks_most_recent_per_story() -> None:
    viewer = uuid.uuid4()
    story_a = uuid.uuid4()
    story_b = uuid.uuid4()
    newer_a = uuid.uuid4()
    older_a = uuid.uuid4()
    only_b = uuid.uuid4()
    now = datetime.now(UTC)
    session = _ExecuteSession(
        [
            (newer_a, story_a, now),
            (older_a, story_a, now),
            (only_b, story_b, now),
        ]
    )
    result = await primary_post_ids_by_story(
        session,  # type: ignore[arg-type]
        viewer,
        [story_a, story_b],
        friend_ids=[],
    )
    assert result == {story_a: newer_a, story_b: only_b}
    assert session.execute_calls == 1


@pytest.mark.asyncio
async def test_primary_post_ids_by_story_empty_when_no_stories() -> None:
    session = _ExecuteSession([])
    result = await primary_post_ids_by_story(
        session,  # type: ignore[arg-type]
        uuid.uuid4(),
        [],
    )
    assert result == {}
    assert session.execute_calls == 0


class _ScalarsSession:
    def __init__(self, rows: list[uuid.UUID]) -> None:
        self._rows = rows
        self.scalars_calls: int = 0

    async def scalars(self, *_args: Any, **_kwargs: Any) -> _FakeScalarResult:
        self.scalars_calls += 1
        return _FakeScalarResult(self._rows)


@pytest.mark.asyncio
async def test_viewer_visible_post_ids_returns_the_allowed_subset() -> None:
    visible = uuid.uuid4()
    hidden = uuid.uuid4()
    session = _ScalarsSession([visible])
    result = await viewer_visible_post_ids(
        session,  # type: ignore[arg-type]
        uuid.uuid4(),
        [visible, hidden],
        friend_ids=[],
    )
    assert result == {visible}
    assert session.scalars_calls == 1


@pytest.mark.asyncio
async def test_viewer_visible_post_ids_skips_the_query_when_empty() -> None:
    session = _ScalarsSession([])
    result = await viewer_visible_post_ids(
        session,  # type: ignore[arg-type]
        uuid.uuid4(),
        [],
    )
    assert result == set()


class _ScriptedExecuteSession:
    """Returns one canned row-list per successive ``execute`` call, in order."""

    def __init__(self, results: list[list[tuple[Any, ...]]]) -> None:
        self._results: list[list[tuple[Any, ...]]] = list(results)
        self.execute_calls: int = 0

    async def execute(self, *_args: Any, **_kwargs: Any) -> _ExecuteResult:
        self.execute_calls += 1
        rows = self._results.pop(0) if self._results else []
        return _ExecuteResult(rows)


def _post_for_story(story_id: uuid.UUID) -> Post:
    now = datetime.now(UTC)
    return Post(
        id=uuid.uuid4(),
        story_id=story_id,
        author_id=uuid.uuid4(),
        take="a take",
        visibility=PostVisibility.private,
        last_activity_at=now,
        created_at=now,
        updated_at=now,
    )


@pytest.mark.asyncio
async def test_fof_attribution_picks_most_recent_action() -> None:
    friend = uuid.uuid4()
    story = uuid.uuid4()
    post = _post_for_story(story)
    earlier = datetime(2026, 1, 1, tzinfo=UTC)
    later = datetime(2026, 1, 2, tzinfo=UTC)
    # comments (earlier), reactions (none), story reads (none), ratings (later)
    session = _ScriptedExecuteSession(
        [
            [(post.id, friend, earlier)],
            [],
            [],
            [(story, friend, later)],
        ]
    )
    result = await fof_attribution_by_post(
        session,  # type: ignore[arg-type]
        [post],
        friend_ids=[friend],
    )
    assert result[post.id].kind == "rated"
    assert result[post.id].acted_at == later


@pytest.mark.asyncio
async def test_fof_attribution_tie_breaks_toward_more_notable_action() -> None:
    friend = uuid.uuid4()
    story = uuid.uuid4()
    post = _post_for_story(story)
    same_time = datetime(2026, 1, 1, tzinfo=UTC)
    # comments and reactions land at the exact same timestamp - commenting is
    # the more notable/effortful action and should win the tie-break.
    session = _ScriptedExecuteSession(
        [
            [(post.id, friend, same_time)],
            [(post.id, friend, same_time)],
            [],
            [],
        ]
    )
    result = await fof_attribution_by_post(
        session,  # type: ignore[arg-type]
        [post],
        friend_ids=[friend],
    )
    assert result[post.id].kind == "commented"


@pytest.mark.asyncio
async def test_fof_attribution_story_level_read_unlocks_every_post_on_it() -> None:
    friend = uuid.uuid4()
    story = uuid.uuid4()
    post_a = _post_for_story(story)
    post_b = _post_for_story(story)
    ts = datetime(2026, 1, 1, tzinfo=UTC)
    session = _ScriptedExecuteSession(
        [
            [],
            [],
            [(story, friend, ts)],
            [],
        ]
    )
    result = await fof_attribution_by_post(
        session,  # type: ignore[arg-type]
        [post_a, post_b],
        friend_ids=[friend],
    )
    assert result[post_a.id].kind == "read"
    assert result[post_b.id].kind == "read"


@pytest.mark.asyncio
async def test_fof_attribution_empty_inputs_make_no_query() -> None:
    session = _ScriptedExecuteSession([])
    assert await fof_attribution_by_post(session, [], friend_ids=[uuid.uuid4()]) == {}  # type: ignore[arg-type]
    post = _post_for_story(uuid.uuid4())
    assert await fof_attribution_by_post(session, [post], friend_ids=[]) == {}  # type: ignore[arg-type]
    assert session.execute_calls == 0
