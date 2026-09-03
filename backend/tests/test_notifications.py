"""Alerts: listing them, and marking them read.

The regression these guard is subtle and was a total outage of the alerts
panel in production, so it is worth stating plainly. FastAPI resolves a
``Query(...)`` default only when it dispatches an HTTP request. A route
handler called as an ordinary Python function receives the ``Query`` object
itself, and passing that to ``.limit()`` blows up inside SQLAlchemy:

    TypeError: int() argument must be ... not 'Query'

``POST /notifications/read`` used to call ``list_notifications`` directly, so
it 500'd on every single request while ``GET /notifications`` -- the same code
reached through the router -- worked fine. The shared work now lives in a
plain function that takes a real ``limit``, and the tests below call the
handlers the way the bug did.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

from api.routers.notifications import (
    DEFAULT_LIMIT,
    list_notifications,
    mark_notifications_read,
)
from api.schemas import NotificationsReadRequest


def _session(unread: int = 0) -> AsyncMock:
    """A session that returns no rows, so only statement building is exercised."""
    session = AsyncMock()
    session.scalars = AsyncMock(
        return_value=MagicMock(all=MagicMock(return_value=[]))
    )
    session.scalar = AsyncMock(return_value=unread)
    return session


def _user() -> MagicMock:
    user = MagicMock()
    user.id = uuid.uuid4()
    return user


@pytest.mark.asyncio
async def test_marking_read_returns_the_list_without_a_route_default() -> None:
    """The exact call that 500'd in production."""
    result = await mark_notifications_read(
        NotificationsReadRequest(notification_ids=None), _session(unread=3), _user()
    )
    assert result.unread_count == 3
    assert result.items == []


@pytest.mark.asyncio
async def test_marking_selected_ids_read_also_returns_the_list() -> None:
    result = await mark_notifications_read(
        NotificationsReadRequest(notification_ids=[uuid.uuid4(), uuid.uuid4()]),
        _session(unread=1),
        _user(),
    )
    assert result.unread_count == 1


@pytest.mark.asyncio
async def test_listing_still_honours_an_explicit_limit() -> None:
    result = await list_notifications(_session(unread=0), _user(), limit=5)
    assert result.unread_count == 0


def test_the_default_limit_is_a_plain_int() -> None:
    """The shell's Query default and the internal default must not diverge.

    If ``DEFAULT_LIMIT`` ever became a ``Query`` again, every internal caller
    would break the same way; asserting the type keeps that impossible.
    """
    assert isinstance(DEFAULT_LIMIT, int)
