"""Who can open a profile card, and how much of it they see.

Every avatar and name in the web app links to `/user/<id>`, so the card has
to load for people the viewer is not connected to. The activity behind it
does not.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi import HTTPException

from api.routers.connections import friend_profile
from core.models import Connection, ConnectionStatus, Profile


def _profile(user_id: uuid.UUID, first: str, *, is_admin: bool = False) -> Profile:
    now = datetime.now(UTC)
    return Profile(
        id=user_id,
        first=first,
        last="Reader",
        image_url="https://cdn.example/a.png",
        is_admin=is_admin,
        dense_mode=False,
        dark_mode=False,
        created_at=now,
        updated_at=now,
    )


class _ProfileSession:
    """Session stub that only answers `get(Profile, id)` lookups."""

    def __init__(self, profiles: dict[uuid.UUID, Profile]) -> None:
        self._profiles = profiles
        self.executed = 0

    async def get(self, model: Any, key: Any) -> Any:
        if model is Profile:
            return self._profiles.get(key)
        return None

    async def execute(self, *_a: Any, **_k: Any) -> Any:
        self.executed += 1
        raise AssertionError("stranger's card should not query activity")

    async def scalar(self, *_a: Any, **_k: Any) -> Any:
        self.executed += 1
        raise AssertionError("stranger's card should not query activity")


def _user(user_id: uuid.UUID) -> Any:
    return type("U", (), {"id": user_id, "is_admin": False})()


@pytest.mark.asyncio
async def test_stranger_gets_the_card_without_activity() -> None:
    viewer_id, other_id = uuid.uuid4(), uuid.uuid4()
    session = _ProfileSession(
        {viewer_id: _profile(viewer_id, "Ada"), other_id: _profile(other_id, "Grace")}
    )

    import api.routers.connections as mod

    original = mod._find_between

    async def _none(*_a: Any, **_k: Any) -> Connection | None:
        return None

    mod._find_between = _none
    try:
        result = await friend_profile(other_id, session, _user(viewer_id))
    finally:
        mod._find_between = original

    assert result.display_name == "Grace Reader"
    assert result.image_url == "https://cdn.example/a.png"
    assert result.can_view_activity is False
    assert result.is_friend is False
    assert result.recent == []
    assert result.reads == 0
    # No activity queries were run at all, not just no activity returned.
    assert session.executed == 0


@pytest.mark.asyncio
async def test_nameless_stranger_does_not_leak_their_email() -> None:
    """Friend lists fall back to the account email when no name is set. A
    stranger's card must not — anyone holding a user id could read it."""
    viewer_id, other_id = uuid.uuid4(), uuid.uuid4()
    nameless = _profile(other_id, "Grace")
    nameless.first = None
    nameless.last = None
    session = _ProfileSession({viewer_id: _profile(viewer_id, "Ada"), other_id: nameless})

    import api.routers.connections as mod

    original = mod._find_between

    async def _none(*_a: Any, **_k: Any) -> Connection | None:
        return None

    mod._find_between = _none
    try:
        result = await friend_profile(other_id, session, _user(viewer_id))
    finally:
        mod._find_between = original

    assert result.display_name == "Friend"
    # The email lookup goes through the session; it must never have run.
    assert session.executed == 0


@pytest.mark.asyncio
async def test_unknown_user_is_404() -> None:
    viewer_id = uuid.uuid4()
    session = _ProfileSession({viewer_id: _profile(viewer_id, "Ada")})

    import api.routers.connections as mod

    original = mod._find_between

    async def _none(*_a: Any, **_k: Any) -> Connection | None:
        return None

    mod._find_between = _none
    try:
        with pytest.raises(HTTPException) as exc:
            await friend_profile(uuid.uuid4(), session, _user(viewer_id))
    finally:
        mod._find_between = original

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_a_pending_connection_already_unlocks_activity() -> None:
    """A sent-but-unaccepted request used to be the bar for the whole card;
    keep it as the bar for the activity half."""
    viewer_id, other_id = uuid.uuid4(), uuid.uuid4()
    session = _ProfileSession(
        {viewer_id: _profile(viewer_id, "Ada"), other_id: _profile(other_id, "Grace")}
    )

    import api.routers.connections as mod

    original = mod._find_between

    async def _pending(*_a: Any, **_k: Any) -> Connection:
        return Connection(
            id=uuid.uuid4(),
            first_id=viewer_id,
            second_id=other_id,
            status=ConnectionStatus.pending,
        )

    mod._find_between = _pending
    try:
        # The activity path is exercised elsewhere; here we only assert that
        # it is *reached* (the stub raises rather than returning a card).
        with pytest.raises(AssertionError):
            await friend_profile(other_id, session, _user(viewer_id))
    finally:
        mod._find_between = original
