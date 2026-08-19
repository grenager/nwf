"""Discussion activity helper for guest discover cards."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest

from api.friends import discussion_activity_by_story
from api.schemas import StoryDiscussionOut


class _DiscussionSession:
    def __init__(
        self,
        count_rows: list[tuple[Any, ...]],
        avatar_rows: list[tuple[Any, ...]],
    ) -> None:
        self._count_rows = count_rows
        self._avatar_rows = avatar_rows
        self._call = 0

    async def execute(self, _stmt: Any, *_args: Any, **_kwargs: Any) -> Any:
        rows = self._count_rows if self._call == 0 else self._avatar_rows
        self._call += 1

        class _Result:
            def __init__(self, data: list[tuple[Any, ...]]) -> None:
                self._data = data

            def all(self) -> list[tuple[Any, ...]]:
                return self._data

        return _Result(rows)


@pytest.mark.asyncio
async def test_discussion_activity_exposes_counts_and_avatars_only() -> None:
    story_id = uuid.uuid4()
    user_a = uuid.uuid4()
    user_b = uuid.uuid4()
    last_at = datetime.now(UTC)
    session = _DiscussionSession(
        count_rows=[(story_id, 2, last_at)],
        avatar_rows=[
            (story_id, user_a, "https://cdn.example/a.jpg"),
            (story_id, user_b, "https://cdn.example/b.jpg"),
        ],
    )

    result = await discussion_activity_by_story(session, [story_id])  # type: ignore[arg-type]

    discussion: StoryDiscussionOut = result[story_id]
    assert discussion.people_count == 2
    assert discussion.last_comment_at == last_at
    assert len(discussion.avatar_urls) == 2
    payload = discussion.model_dump()
    assert "user_id" not in payload
    assert "display_name" not in payload
