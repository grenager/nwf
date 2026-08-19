"""Audience resolution for the "Who will see this?" comment explainer."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from api.routers.posts import get_post_audience
from core.models import Post, PostVisibility, Profile


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


class _AudienceSession:
    """Session stub returning seeded Post/Profile lookups."""

    def __init__(self, post: Post, profiles: dict[uuid.UUID, Profile]) -> None:
        self._post = post
        self._profiles = profiles

    async def get(self, model: Any, key: Any) -> Any:
        if model is Post:
            return self._post if key == self._post.id else None
        if model is Profile:
            return self._profiles.get(key)
        return None

    async def scalars(self, _stmt: Any) -> Any:
        wanted = list(self._profiles.values())
        return type("R", (), {"all": lambda self: wanted})()


@pytest.mark.asyncio
async def test_audience_groups_viewer_and_author_friends() -> None:
    viewer_id = uuid.uuid4()
    author_id = uuid.uuid4()
    my_friend_id = uuid.uuid4()
    author_friend_id = uuid.uuid4()
    post_id = uuid.uuid4()

    post = _post(post_id, author_id, uuid.uuid4())
    profiles = {
        author_id: _profile(author_id, "Ava"),
        my_friend_id: _profile(my_friend_id, "Mia"),
        author_friend_id: _profile(author_friend_id, "Fred"),
    }
    session = _AudienceSession(post, profiles)
    user = type("U", (), {"id": viewer_id})()

    friend_map: dict[uuid.UUID, set[uuid.UUID]] = {
        viewer_id: {my_friend_id, author_id},
        author_id: {author_friend_id, viewer_id},
    }

    with (
        patch("api.routers.posts.can_see_post", AsyncMock(return_value=True)),
        patch(
            "api.routers.posts.post_participant_ids",
            AsyncMock(return_value=[author_id, viewer_id]),
        ),
        patch(
            "api.routers.posts.friend_ids_for_users",
            AsyncMock(return_value=friend_map),
        ),
        patch(
            "api.routers.posts.average_friend_count_for_active_users",
            AsyncMock(return_value=17.4),
        ),
    ):
        result = await get_post_audience(post_id, session, user)  # type: ignore[arg-type]

    assert result.average_friend_count == pytest.approx(17.4)
    assert result.viewer_is_author is False
    assert result.author_name == "Ava Tester"
    assert result.your_friend_count == 2
    assert result.author_friend_count == 2

    by_id = {p.user_id: p for p in result.people}
    # The viewer is never listed; their own access is implicit.
    assert viewer_id not in by_id
    assert by_id[author_id].relation == "author"
    assert by_id[my_friend_id].relation == "your_friend"
    assert by_id[author_friend_id].relation == "author_friend"
    # Author first, then the viewer's friends, then the author's.
    assert [p.relation for p in result.people] == [
        "author",
        "your_friend",
        "author_friend",
    ]


@pytest.mark.asyncio
async def test_audience_marks_viewer_as_author() -> None:
    viewer_id = uuid.uuid4()
    friend_id = uuid.uuid4()
    post_id = uuid.uuid4()

    post = _post(post_id, viewer_id, uuid.uuid4())
    profiles = {friend_id: _profile(friend_id, "Sam")}
    session = _AudienceSession(post, profiles)
    session._profiles[viewer_id] = _profile(viewer_id, "Me")
    user = type("U", (), {"id": viewer_id})()

    with (
        patch("api.routers.posts.can_see_post", AsyncMock(return_value=True)),
        patch(
            "api.routers.posts.post_participant_ids",
            AsyncMock(return_value=[viewer_id]),
        ),
        patch(
            "api.routers.posts.friend_ids_for_users",
            AsyncMock(return_value={viewer_id: {friend_id}}),
        ),
        patch(
            "api.routers.posts.average_friend_count_for_active_users",
            AsyncMock(return_value=0.0),
        ),
    ):
        result = await get_post_audience(post_id, session, user)  # type: ignore[arg-type]

    assert result.viewer_is_author is True
    assert [p.user_id for p in result.people] == [friend_id]
    assert result.people[0].relation == "your_friend"
