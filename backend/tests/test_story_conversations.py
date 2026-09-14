"""The story page: which conversations about an article a viewer may read.

This is the hand-off from Discover (platform-wide) to the private half of the
app, so the tests pin what it must not show: other people's threads, and the
editorial seeding post, which exists to surface the article rather than to be
replied to.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from api.routers.stories import get_story_conversations


class _EmptySession:
    """Fails loudly if the guest path touches the database at all."""

    async def scalars(self, *_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("guests must not trigger a conversation query")

    async def execute(self, *_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("guests must not trigger a conversation query")


def test_route_is_registered() -> None:
    client = TestClient(create_app())
    paths = client.get("/openapi.json").json()["paths"]
    assert "/stories/{story_id}/conversations" in paths


@pytest.mark.asyncio
async def test_guest_gets_no_conversations_and_no_queries() -> None:
    """A guest can see that a story is trending, never who is discussing it."""
    result = await get_story_conversations(
        uuid.uuid4(),
        _EmptySession(),  # type: ignore[arg-type]
        None,
    )
    assert result.items == []
    assert result.viewer_has_post is False


class _RecordingSession:
    def __init__(self) -> None:
        self.statements: list[Any] = []

    async def scalars(self, stmt: Any, *_args: Any, **_kwargs: Any) -> Any:
        self.statements.append(stmt)

        class _Empty:
            def all(self) -> list[Any]:
                return []

        return _Empty()

    async def execute(self, stmt: Any, *_args: Any, **_kwargs: Any) -> Any:
        self.statements.append(stmt)

        class _Empty:
            def all(self) -> list[Any]:
                return []

            def first(self) -> None:
                return None

        return _Empty()


class _User:
    id = uuid.uuid4()


@pytest.mark.asyncio
async def test_candidate_query_scopes_to_friends_and_skips_editorial() -> None:
    session = _RecordingSession()
    result = await get_story_conversations(
        uuid.uuid4(),
        session,  # type: ignore[arg-type]
        _User(),  # type: ignore[arg-type]
    )
    assert result.items == []
    sql = " ".join(str(s) for s in session.statements)
    # The friend-graph rule and the editorial exclusion both reach the SQL.
    assert "post_participants" in sql
    assert "is_editorial" in sql
    # Most recently active thread first, not oldest-posted.
    assert "last_activity_at DESC" in sql
