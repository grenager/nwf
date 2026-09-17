"""Posts are private-only: guests cannot see them and visibility cannot flip."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from api.friends import can_see_post, fof_engagement_clause, visible_post_ids_for_viewer
from api.schemas import PostCreate, PostUpdate
from core.models import Post, PostVisibility


def _post(visibility: PostVisibility = PostVisibility.private) -> Post:
    now = datetime.now(UTC)
    return Post(
        id=uuid.uuid4(),
        story_id=uuid.uuid4(),
        author_id=uuid.uuid4(),
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

    async def get(self, *_args: object, **_kwargs: object) -> None:
        # can_see_post looks the author's profile up to reject editorial
        # seeding posts. None means "ordinary member" for these cases.
        return None


@pytest.mark.asyncio
async def test_can_see_post_true_when_friend_engaged_via_reaction_or_read() -> None:
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


def test_fof_engagement_clause_mirrors_can_see_post_ids() -> None:
    """The candidate query must bind the viewer's id only to participation.

    `fof_engagement_clause` decides which conversations the feed and story
    page list; `can_see_post` decides which may be opened. If the viewer's
    id reached the reaction or story-read branches, their own reading of a
    trending story would unlock strangers' threads - listed, then 403 on
    open. So the viewer appears once (participation) and friends appear
    three times (participation, reaction, story read).
    """
    viewer = uuid.uuid4()
    friend = uuid.uuid4()
    stmt = select(Post.id).where(fof_engagement_clause(viewer, [friend]))
    # in_() binds as one list-valued parameter, so flatten before counting.
    bound_ids = [
        item
        for value in stmt.compile().params.values()
        for item in (value if isinstance(value, list) else [value])
    ]
    assert bound_ids.count(viewer) == 1
    assert bound_ids.count(friend) == 3
