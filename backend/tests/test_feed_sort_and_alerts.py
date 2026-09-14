"""The Conversations tab: how it is ordered, and the alerts folded into it.

Alerts stopped being a destination, so a mention or a reaction has to reach
the viewer on the thread it happened in — which only works if reacting counts
as activity for the ordering, and if opening the thread is what clears it.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from api.friends import visible_post_ids_for_viewer
from api.routers.feed import THREAD_ALERT_KINDS, _card_activity
from core.models import NotificationKind


class _StatementRecordingSession:
    def __init__(self) -> None:
        self.statements: list[Any] = []

    async def scalars(self, stmt: Any, *_args: Any, **_kwargs: Any) -> Any:
        self.statements.append(stmt)

        class _Empty:
            def all(self) -> list[Any]:
                return []

        return _Empty()


async def _candidate_sql(sort: str) -> str:
    session = _StatementRecordingSession()
    await visible_post_ids_for_viewer(
        session,  # type: ignore[arg-type]
        uuid.uuid4(),
        friend_ids=[uuid.uuid4()],
        limit=40,
        since_days=14,
        min_results=0,
        max_since_days=365,
        sort=sort,  # type: ignore[arg-type]
    )
    return str(session.statements[0])


@pytest.mark.asyncio
async def test_activity_sort_orders_by_last_activity() -> None:
    sql = await _candidate_sql("activity")
    assert "last_activity_at DESC" in sql


@pytest.mark.asyncio
async def test_created_sort_keeps_newest_posted_order() -> None:
    sql = await _candidate_sql("created")
    assert "created_at DESC" in sql
    assert "last_activity_at DESC" not in sql


@pytest.mark.asyncio
async def test_window_column_matches_the_sort_column() -> None:
    """Mismatched columns would drop the very threads a reply should revive.

    Windowing on ``created_at`` while ordering by ``last_activity_at`` filters
    out an old post before the ordering ever sees it, so a fresh reply on a
    three-week-old thread would never come back.
    """
    activity_sql = await _candidate_sql("activity")
    assert "posts.last_activity_at >=" in activity_sql
    assert "posts.created_at >=" not in activity_sql

    created_sql = await _candidate_sql("created")
    assert "posts.created_at >=" in created_sql
    assert "posts.last_activity_at >=" not in created_sql


def test_only_thread_scoped_alerts_fold_into_the_feed() -> None:
    """Friend-graph events have no thread to sit on and stay on People."""
    assert set(THREAD_ALERT_KINDS) == {
        NotificationKind.mention,
        NotificationKind.post_reaction,
        NotificationKind.comment_reaction,
    }
    for kind in (
        NotificationKind.friend_request,
        NotificationKind.friend_accepted,
        NotificationKind.friend_connected,
    ):
        assert kind not in THREAD_ALERT_KINDS


@pytest.mark.asyncio
async def test_card_activity_makes_no_query_without_posts() -> None:
    session = _StatementRecordingSession()
    result = await _card_activity(
        session,  # type: ignore[arg-type]
        uuid.uuid4(),
        [],
    )
    assert result == {}
    assert session.statements == []


@pytest.mark.asyncio
async def test_card_activity_queries_unread_thread_alerts_only() -> None:
    session = _StatementRecordingSession()
    await _card_activity(
        session,  # type: ignore[arg-type]
        uuid.uuid4(),
        [uuid.uuid4(), uuid.uuid4()],
    )
    sql = str(session.statements[0])
    assert "notifications.read_at IS NULL" in sql
    assert "notifications.kind IN" in sql
    assert "created_at DESC" in sql
