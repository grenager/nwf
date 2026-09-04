"""Which single ask the feed ribbon should make, if any.

The value of this feature is entirely in *restraint*: one ask, only when it
applies, never a list of someone's shortcomings. So what these guard is
mostly what the nudge declines to say.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from api.standards import (
    MIN_COMFORTABLE_FRIENDS,
    QUIET_DAYS,
    standards_nudge,
)

NOW = datetime(2026, 9, 3, 12, 0, tzinfo=UTC)


def _session(last_post: datetime | None, friend_first: str | None = "Sarah"):
    """A session answering the two queries the nudge makes."""
    session = AsyncMock()
    profile = MagicMock()
    profile.first = friend_first
    # max(created_at) first, then the friend profile lookup.
    session.scalar = AsyncMock(side_effect=[last_post, profile])
    return session


def _friends(n: int) -> list[uuid.UUID]:
    return [uuid.uuid4() for _ in range(n)]


@pytest.mark.asyncio
async def test_a_thin_circle_is_asked_to_invite() -> None:
    result = await standards_nudge(
        _session(NOW), uuid.uuid4(), _friends(1), now=NOW
    )
    assert result == ("invite", 1, None)


@pytest.mark.asyncio
async def test_the_invite_ask_wins_over_being_quiet() -> None:
    """Someone with one friend who has posted before still has a lonely time.

    Telling them to post harder addresses the wrong constraint, so only the
    invite is raised -- never both.
    """
    long_ago = NOW - timedelta(days=30)
    result = await standards_nudge(
        _session(long_ago), uuid.uuid4(), _friends(1), now=NOW
    )
    assert result is not None
    assert result[0] == "invite"


@pytest.mark.asyncio
async def test_the_first_post_outranks_a_thin_circle() -> None:
    """Never having posted beats every other ask, including inviting.

    A member with one friend who shares gives that friend something; a member
    with five friends who has never shared gives nobody anything, and has
    quietly learned the app is a place you only read.
    """
    result = await standards_nudge(
        _session(None), uuid.uuid4(), _friends(1), now=NOW
    )
    assert result is not None
    assert result[0] == "first_post"


@pytest.mark.asyncio
async def test_the_first_post_ask_carries_the_friend_count() -> None:
    """``value`` is the friend count here, not a day count.

    There is no honest number of days to report for someone who has never
    posted, so the slot carries the one fact the copy can use.
    """
    kind, value, name = await standards_nudge(  # type: ignore[misc]
        _session(None), uuid.uuid4(), _friends(4), now=NOW
    )
    assert kind == "first_post"
    assert value == 4
    assert name == "Sarah"


@pytest.mark.asyncio
async def test_silence_past_the_threshold_is_asked_to_share() -> None:
    quiet = NOW - timedelta(days=QUIET_DAYS)
    kind, days, name = await standards_nudge(  # type: ignore[misc]
        _session(quiet), uuid.uuid4(), _friends(MIN_COMFORTABLE_FRIENDS), now=NOW
    )
    assert kind == "share"
    assert days == QUIET_DAYS
    assert name == "Sarah"


@pytest.mark.asyncio
async def test_someone_doing_the_right_thing_is_left_alone() -> None:
    """The important case: no ribbon at all."""
    recent = NOW - timedelta(days=QUIET_DAYS - 1)
    result = await standards_nudge(
        _session(recent), uuid.uuid4(), _friends(MIN_COMFORTABLE_FRIENDS), now=NOW
    )
    assert result is None


@pytest.mark.asyncio
async def test_posting_today_silences_the_ribbon() -> None:
    result = await standards_nudge(
        _session(NOW), uuid.uuid4(), _friends(5), now=NOW
    )
    assert result is None


@pytest.mark.asyncio
async def test_a_missing_friend_name_is_not_faked() -> None:
    """With nobody to name, the copy has to fall back, not invent a person."""
    kind, _value, name = await standards_nudge(  # type: ignore[misc]
        _session(None, friend_first=None), uuid.uuid4(), _friends(4), now=NOW
    )
    assert kind == "first_post"
    assert name is None


@pytest.mark.asyncio
async def test_a_naive_timestamp_does_not_blow_up() -> None:
    """Postgres can hand back a naive datetime; days must still compute."""
    naive = (NOW - timedelta(days=10)).replace(tzinfo=None)
    kind, days, _ = await standards_nudge(  # type: ignore[misc]
        _session(naive), uuid.uuid4(), _friends(4), now=NOW
    )
    assert kind == "share"
    assert days == 10


@pytest.mark.asyncio
async def test_an_empty_feed_still_carries_the_ask() -> None:
    """The empty feed is where the ask matters most, not least.

    A member whose one friend hasn't posted yet sees nothing at all, and is
    the member most likely to decide there is nothing here to do -- so the
    early return for an empty feed has to carry the nudge too.
    """
    from api.routers import feed as feed_router

    session = AsyncMock()
    profile = MagicMock()
    profile.first = "Sarah"
    # Two aggregate counts, then the nudge's own two queries.
    session.scalar = AsyncMock(side_effect=[0, 0, None, profile])

    payload = await feed_router._empty_feed(
        session, None, viewer_id=uuid.uuid4(), friends=_friends(1)
    )
    assert payload.standards is not None
    assert payload.standards.kind == "first_post"


@pytest.mark.asyncio
async def test_a_signed_out_visitor_is_never_nudged() -> None:
    """No viewer means no ask -- and no query issued to look for one."""
    from api.routers import feed as feed_router

    session = AsyncMock()
    session.scalar = AsyncMock(side_effect=[0, 0])

    payload = await feed_router._empty_feed(session, None)
    assert payload.standards is None
    assert session.scalar.await_count == 2
