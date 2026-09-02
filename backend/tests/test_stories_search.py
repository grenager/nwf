"""Story search helpers and title-search post resolution."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from api.routers.stories import _PostSummary, title_search


class _FakeScalarResult:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def all(self) -> list[Any]:
        return self._rows


class _TitleSearchSession:
    """Minimal session stub for title_search unit tests."""

    async def execute(self, stmt: Any, *_args: Any, **_kwargs: Any) -> Any:
        self.last_stmt = stmt
        return self._execute_result

    async def scalars(self, stmt: Any, *_args: Any, **_kwargs: Any) -> _FakeScalarResult:
        self.last_scalars_stmt = stmt
        return _FakeScalarResult([])


@pytest.mark.asyncio
async def test_title_search_attaches_post_id_when_visible() -> None:
    from core.models import Story, StoryKind

    user_id = uuid.uuid4()
    story_id = uuid.uuid4()
    post_id = uuid.uuid4()
    now = datetime.now(UTC)
    story = Story(
        id=story_id,
        article_url="https://example.com/a",
        full_headline="Climate policy shift",
        summary=None,
        image_url=None,
        publisher=None,
        source_id=None,
        kind=StoryKind.news,
        author_names=[],
        archived=False,
        created_at=now,
        updated_at=now,
    )
    session = _TitleSearchSession()
    session._execute_result = type(
        "R",
        (),
        {"all": lambda self: [(story, False, False)]},
    )()

    mock_user = type("U", (), {"id": user_id})()
    mock_friend_reactors = AsyncMock(return_value={})
    mock_primary = AsyncMock(return_value={story_id: post_id})
    summary = _PostSummary(
        author_name="Ada Lovelace",
        author_image_url=None,
        take="Worth reading.",
        reply_count=3,
    )

    with (
        patch(
            "api.routers.stories.accepted_friend_ids",
            AsyncMock(return_value=[]),
        ),
        patch(
            "api.routers.stories._post_summaries",
            AsyncMock(return_value={post_id: summary}),
        ),
        patch(
            "api.routers.stories.friend_reactors_by_story",
            mock_friend_reactors,
        ),
        patch(
            "api.routers.stories.primary_post_ids_by_story",
            mock_primary,
        ),
    ):
        result = await title_search(
            session,  # type: ignore[arg-type]
            mock_user,  # type: ignore[arg-type]
            q="climate",
            limit=10,
        )

    assert len(result.items) == 1
    assert result.items[0].post_id == post_id
    # A result should read as the conversation it opens, not a bare article.
    assert result.items[0].post_author_name == "Ada Lovelace"
    assert result.items[0].post_take == "Worth reading."
    assert result.items[0].post_reply_count == 3
    mock_primary.assert_awaited_once()


@pytest.mark.asyncio
async def test_title_search_filters_to_stories_with_a_visible_post() -> None:
    from core.models import Story, StoryKind

    user_id = uuid.uuid4()
    story_id = uuid.uuid4()
    now = datetime.now(UTC)
    story = Story(
        id=story_id,
        article_url="https://example.com/b",
        full_headline="Private discussion only",
        summary=None,
        image_url=None,
        publisher=None,
        source_id=None,
        kind=StoryKind.news,
        author_names=[],
        archived=False,
        created_at=now,
        updated_at=now,
    )
    session = _TitleSearchSession()
    session._execute_result = type(
        "R",
        (),
        {"all": lambda self: [(story, False, False)]},
    )()

    mock_user = type("U", (), {"id": user_id})()
    mock_friend_reactors = AsyncMock(return_value={})
    mock_primary = AsyncMock(return_value={})

    with (
        patch(
            "api.routers.stories.accepted_friend_ids",
            AsyncMock(return_value=[]),
        ),
        patch(
            "api.routers.stories._post_summaries",
            AsyncMock(return_value={}),
        ),
        patch(
            "api.routers.stories.friend_reactors_by_story",
            mock_friend_reactors,
        ),
        patch(
            "api.routers.stories.primary_post_ids_by_story",
            mock_primary,
        ),
    ):
        result = await title_search(
            session,  # type: ignore[arg-type]
            mock_user,  # type: ignore[arg-type]
            q="private",
            limit=10,
        )

    assert len(result.items) == 1
    assert result.items[0].post_id is None

    # A story with no post the viewer can open should never reach the ranking
    # step: the query filters those out before they are scored.
    sql: str = str(session.last_stmt)
    assert "EXISTS" in sql.upper()
    assert "posts" in sql
