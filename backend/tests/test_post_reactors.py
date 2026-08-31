"""Listing who reacted to a post, for the reactor-list modal."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from api.routers.posts import list_post_reactors
from core.models import Post, PostReaction, PostVisibility, Profile


def _profile(user_id: uuid.UUID, first: str) -> Profile:
    now = datetime.now(UTC)
    return Profile(
        id=user_id,
        first=first,
        last="Tester",
        image_url=None,
        is_admin=False,
        dense_mode=False,
        dark_mode=False,
        created_at=now,
        updated_at=now,
    )


def _post(post_id: uuid.UUID, author_id: uuid.UUID, story_id: uuid.UUID) -> Post:
    now = datetime.now(UTC)
    return Post(
        id=post_id,
        story_id=story_id,
        author_id=author_id,
        take="A take",
        shared_text=None,
        visibility=PostVisibility.private,
        last_activity_at=now,
        created_at=now,
        updated_at=now,
    )


def _reaction(
    post_id: uuid.UUID, user_id: uuid.UUID, reaction: str, updated_at: datetime
) -> PostReaction:
    return PostReaction(
        user_id=user_id,
        post_id=post_id,
        reaction=reaction,
        created_at=updated_at,
        updated_at=updated_at,
    )


class _ReactorsSession:
    """Session stub returning a seeded Post and a canned reaction/profile join."""

    def __init__(
        self, post: Post | None, rows: list[tuple[PostReaction, Profile]]
    ) -> None:
        self._post = post
        self._rows = rows

    async def get(self, model: Any, key: Any) -> Any:
        if model is Post:
            return self._post if self._post is not None and key == self._post.id else None
        return None

    async def execute(self, _stmt: Any) -> Any:
        rows = self._rows
        return type("R", (), {"all": lambda self: rows})()


@pytest.mark.asyncio
async def test_list_post_reactors_404_when_post_missing() -> None:
    session = _ReactorsSession(None, [])
    user = type("U", (), {"id": uuid.uuid4()})()

    with pytest.raises(HTTPException) as exc_info:
        await list_post_reactors(uuid.uuid4(), session, user)  # type: ignore[arg-type]
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_list_post_reactors_403_when_not_visible() -> None:
    post_id = uuid.uuid4()
    post = _post(post_id, uuid.uuid4(), uuid.uuid4())
    session = _ReactorsSession(post, [])
    user = type("U", (), {"id": uuid.uuid4()})()

    with patch("api.routers.posts.can_see_post", AsyncMock(return_value=False)):
        with pytest.raises(HTTPException) as exc_info:
            await list_post_reactors(post_id, session, user)  # type: ignore[arg-type]
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_list_post_reactors_empty_when_no_reactions() -> None:
    post_id = uuid.uuid4()
    post = _post(post_id, uuid.uuid4(), uuid.uuid4())
    session = _ReactorsSession(post, [])
    user = type("U", (), {"id": uuid.uuid4()})()

    with patch("api.routers.posts.can_see_post", AsyncMock(return_value=True)):
        result = await list_post_reactors(post_id, session, user)  # type: ignore[arg-type]
    assert result == []


@pytest.mark.asyncio
async def test_list_post_reactors_shape_and_ordering() -> None:
    post_id = uuid.uuid4()
    author_id = uuid.uuid4()
    post = _post(post_id, author_id, uuid.uuid4())

    earlier_id, later_id = uuid.uuid4(), uuid.uuid4()
    earlier_profile = _profile(earlier_id, "Ava")
    later_profile = _profile(later_id, "Mia")
    now = datetime.now(UTC)
    earlier = now - timedelta(hours=2)
    later = now - timedelta(minutes=5)

    # Rows are returned pre-ordered by the query (most-recent first); the
    # handler must not re-sort them.
    rows = [
        (_reaction(post_id, later_id, "love", later), later_profile),
        (_reaction(post_id, earlier_id, "like", earlier), earlier_profile),
    ]
    session = _ReactorsSession(post, rows)
    user = type("U", (), {"id": author_id})()

    with patch("api.routers.posts.can_see_post", AsyncMock(return_value=True)):
        result = await list_post_reactors(post_id, session, user)  # type: ignore[arg-type]

    assert [r.user_id for r in result] == [later_id, earlier_id]
    assert result[0].reaction == "love"
    assert result[0].display_name == "Mia Tester"
    assert result[0].reacted_at == later
    assert result[1].reaction == "like"
    assert result[1].display_name == "Ava Tester"
    assert result[1].reacted_at == earlier
