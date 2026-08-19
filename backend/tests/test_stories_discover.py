"""Discover feed: curated sources, exclusions, and guest read state."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.routers.stories import discover_stories
from core.models import Story, StoryKind


class _FakeScalarResult:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def all(self) -> list[Any]:
        return self._rows


class _DiscoverSession:
    """Minimal session stub for discover_stories unit tests."""

    def __init__(
        self,
        *,
        execute_rows: list[Any] | None = None,
        scalar_stories: list[Story] | None = None,
        scalar_total: int = 1,
    ) -> None:
        self._execute_rows = execute_rows or []
        self._scalar_stories = scalar_stories or []
        self._scalar_total = scalar_total

    async def execute(self, _stmt: Any, *_args: Any, **_kwargs: Any) -> Any:
        rows = self._execute_rows

        class _Result:
            @staticmethod
            def all() -> list[Any]:
                return rows

        return _Result()

    async def scalars(self, _stmt: Any, *_args: Any, **_kwargs: Any) -> _FakeScalarResult:
        return _FakeScalarResult(self._scalar_stories)

    async def scalar(self, _stmt: Any, *_args: Any, **_kwargs: Any) -> int:
        return self._scalar_total


def _story(story_id: uuid.UUID | None = None) -> Story:
    now = datetime.now(UTC)
    return Story(
        id=story_id or uuid.uuid4(),
        article_url="https://example.com/article",
        full_headline="Sample headline",
        summary="Summary text",
        image_url=None,
        publisher=None,
        source_id=uuid.uuid4(),
        kind=StoryKind.news,
        author_names=[],
        archived=False,
        created_at=now,
        updated_at=now,
    )


@pytest.mark.asyncio
async def test_discover_guest_returns_unread_stories() -> None:
    story = _story()
    session = _DiscoverSession(scalar_stories=[story], scalar_total=1)
    response = MagicMock()

    with patch(
        "api.routers.stories._enrich_story_sources",
        AsyncMock(),
    ):
        result = await discover_stories(
            session,  # type: ignore[arg-type]
            None,  # type: ignore[arg-type]
            response,
            limit=10,
            offset=0,
        )

    assert len(result.items) == 1
    assert result.items[0].read is False
    assert result.items[0].starred is False
    response.headers.__setitem__.assert_called_once()


@pytest.mark.asyncio
async def test_discover_authenticated_excludes_stories_with_visible_post() -> None:
    user_id = uuid.uuid4()
    story_with_post = _story()
    story_without_post = _story()
    session = _DiscoverSession(
        execute_rows=[
            (story_without_post, False, False),
        ],
        scalar_total=2,
    )
    response = MagicMock()
    mock_user = type("U", (), {"id": user_id})()

    with (
        patch(
            "api.routers.stories.primary_post_ids_by_story",
            AsyncMock(
                return_value={story_with_post.id: uuid.uuid4()},
            ),
        ),
        patch(
            "api.routers.stories.friend_stars_by_story",
            AsyncMock(return_value={}),
        ),
        patch(
            "api.routers.stories._enrich_story_sources",
            AsyncMock(),
        ),
    ):
        # Simulate execute returning both stories before filtering
        session._execute_rows = [
            (story_with_post, False, False),
            (story_without_post, False, False),
        ]
        result = await discover_stories(
            session,  # type: ignore[arg-type]
            mock_user,  # type: ignore[arg-type]
            response,
            limit=10,
            offset=0,
        )

    assert len(result.items) == 1
    assert result.items[0].id == story_without_post.id
