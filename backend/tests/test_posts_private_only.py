"""Posts are private-only: guests cannot see them and visibility cannot flip."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from api.friends import can_see_post, visible_post_ids_for_viewer
from api.schemas import PostCreate, PostUpdate
from core.models import Post, PostVisibility


def _post(visibility: PostVisibility = PostVisibility.private) -> Post:
    now = datetime.now(UTC)
    return Post(
        id=uuid.uuid4(),
        story_id=uuid.uuid4(),
        author_id=uuid.uuid4(),
        take="hello",
        shared_text=None,
        visibility=visibility,
        last_activity_at=now,
        created_at=now,
        updated_at=now,
    )


@pytest.mark.asyncio
async def test_guest_cannot_see_post_even_if_marked_public() -> None:
    post = _post(PostVisibility.public)
    session = type("S", (), {})()
    assert await can_see_post(session, None, post) is False  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_guest_visible_post_ids_is_empty() -> None:
    session = type("S", (), {"scalars": lambda *a, **k: None})()
    result = await visible_post_ids_for_viewer(session, None)  # type: ignore[arg-type]
    assert result == []


def test_post_create_schema_has_no_visibility_field() -> None:
    fields = PostCreate.model_fields
    assert "visibility" not in fields


def test_post_update_schema_has_no_visibility_field() -> None:
    fields = PostUpdate.model_fields
    assert "visibility" not in fields


class _ScalarBoolSession:
    """Fake session whose ``scalar`` returns a fixed value; records calls."""

    def __init__(self, value: bool) -> None:
        self._value = value
        self.scalar_calls: int = 0

    async def scalar(self, *_args: object, **_kwargs: object) -> bool:
        self.scalar_calls += 1
        return self._value


@pytest.mark.asyncio
async def test_can_see_post_true_when_friend_engaged_via_reaction_read_or_rating() -> None:
    post = _post()
    viewer = uuid.uuid4()
    friend = uuid.uuid4()
    session = _ScalarBoolSession(True)
    result = await can_see_post(
        session,  # type: ignore[arg-type]
        viewer,
        post,
        friend_ids=[friend],
        participant_ids=[],
    )
    assert result is True
    assert session.scalar_calls == 1


@pytest.mark.asyncio
async def test_can_see_post_false_when_no_friend_engagement_found() -> None:
    post = _post()
    viewer = uuid.uuid4()
    friend = uuid.uuid4()
    session = _ScalarBoolSession(False)
    result = await can_see_post(
        session,  # type: ignore[arg-type]
        viewer,
        post,
        friend_ids=[friend],
        participant_ids=[],
    )
    assert result is False


@pytest.mark.asyncio
async def test_can_see_post_skips_engagement_query_with_no_friends() -> None:
    post = _post()
    viewer = uuid.uuid4()
    session = _ScalarBoolSession(True)
    result = await can_see_post(
        session,  # type: ignore[arg-type]
        viewer,
        post,
        friend_ids=[],
        participant_ids=[],
    )
    assert result is False
    assert session.scalar_calls == 0
