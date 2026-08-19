"""Tests for the public unsubscribe endpoints and email suppression."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from api.friends import is_email_suppressed, suppressed_emails
from api.main import create_app
from api.routers.email_prefs import unsubscribe_invitee
from core.db import get_session
from core.models import Invitation, InvitationStatus


def _profile() -> MagicMock:
    profile = MagicMock()
    profile.digest_opt_out = False
    profile.instant_email_opt_out = False
    return profile


def _client(session: AsyncMock) -> TestClient:
    app = create_app()

    async def _override() -> AsyncIterator[AsyncMock]:
        yield session

    app.dependency_overrides[get_session] = _override
    return TestClient(app)


def test_generic_unsubscribe_link_stops_every_kind_of_email() -> None:
    """The default scope must silence instant mail, not just the digest."""
    profile = _profile()
    session = AsyncMock()
    session.scalar = AsyncMock(return_value=profile)

    resp = _client(session).post(f"/email/unsubscribe/{uuid.uuid4()}")

    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    assert profile.digest_opt_out is True
    assert profile.instant_email_opt_out is True


def test_digest_scope_leaves_instant_email_alone() -> None:
    profile = _profile()
    session = AsyncMock()
    session.scalar = AsyncMock(return_value=profile)

    resp = _client(session).post(
        f"/email/unsubscribe/{uuid.uuid4()}?scope=digest"
    )

    assert resp.status_code == 200
    assert "daily digest" in resp.json()["message"]
    assert profile.digest_opt_out is True
    assert profile.instant_email_opt_out is False


def test_instant_scope_leaves_the_digest_alone() -> None:
    profile = _profile()
    session = AsyncMock()
    session.scalar = AsyncMock(return_value=profile)

    resp = _client(session).post(
        f"/email/unsubscribe/{uuid.uuid4()}?scope=instant"
    )

    assert resp.status_code == 200
    assert profile.digest_opt_out is False
    assert profile.instant_email_opt_out is True


def test_unknown_scope_is_rejected() -> None:
    session = AsyncMock()
    session.scalar = AsyncMock(return_value=_profile())

    resp = _client(session).post(
        f"/email/unsubscribe/{uuid.uuid4()}?scope=everything"
    )

    assert resp.status_code == 422


def test_unknown_member_token_is_not_found() -> None:
    session = AsyncMock()
    session.scalar = AsyncMock(return_value=None)

    resp = _client(session).post(f"/email/unsubscribe/{uuid.uuid4()}")

    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_invitee_unsubscribe_suppresses_and_revokes() -> None:
    invitation = Invitation(
        id=uuid.uuid4(),
        token="tok",
        inviter_id=uuid.uuid4(),
        invitee_email="Invited@Example.com",
        status=InvitationStatus.pending,
    )
    session = AsyncMock()
    session.scalar = AsyncMock(return_value=invitation)
    session.execute = AsyncMock()

    result = await unsubscribe_invitee(uuid.uuid4(), session)

    assert result.ok is True
    # One suppression insert plus one bulk revoke of pending invitations.
    assert session.execute.await_count == 2
    insert_values = session.execute.await_args_list[0].args[0].compile().params
    assert insert_values["email"] == "invited@example.com"


@pytest.mark.asyncio
async def test_invitee_unsubscribe_rejects_share_link_token() -> None:
    """Reusable share links have no recipient, so there is nothing to suppress."""
    invitation = Invitation(
        id=uuid.uuid4(),
        token="tok",
        inviter_id=uuid.uuid4(),
        invitee_email=None,
        reusable=True,
        status=InvitationStatus.pending,
    )
    session = AsyncMock()
    session.scalar = AsyncMock(return_value=invitation)

    with pytest.raises(HTTPException) as excinfo:
        await unsubscribe_invitee(uuid.uuid4(), session)
    assert excinfo.value.status_code == 400


@pytest.mark.asyncio
async def test_invitee_unsubscribe_unknown_token_is_not_found() -> None:
    session = AsyncMock()
    session.scalar = AsyncMock(return_value=None)

    with pytest.raises(HTTPException) as excinfo:
        await unsubscribe_invitee(uuid.uuid4(), session)
    assert excinfo.value.status_code == 404


@pytest.mark.asyncio
async def test_suppressed_emails_normalizes_and_short_circuits() -> None:
    session = AsyncMock()
    scalars_result = MagicMock()
    scalars_result.all.return_value = ["taken@example.com"]
    session.scalars = AsyncMock(return_value=scalars_result)

    found = await suppressed_emails(session, [" Taken@Example.com ", "ok@x.com"])
    assert found == {"taken@example.com"}

    session.scalars.reset_mock()
    assert await suppressed_emails(session, ["", "   "]) == set()
    session.scalars.assert_not_awaited()


@pytest.mark.asyncio
async def test_is_email_suppressed() -> None:
    session = AsyncMock()
    with patch(
        "api.friends.suppressed_emails",
        new=AsyncMock(return_value={"a@b.com"}),
    ):
        assert await is_email_suppressed(session, "A@B.com") is True
    with patch(
        "api.friends.suppressed_emails", new=AsyncMock(return_value=set())
    ):
        assert await is_email_suppressed(session, "c@d.com") is False
    assert await is_email_suppressed(session, None) is False
