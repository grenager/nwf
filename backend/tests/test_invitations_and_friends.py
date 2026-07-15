"""Tests for friend requests, FoF recommendations, and email invitations."""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from api.routers.invitations import _share_message, accept_invitation_for_user
from core.email import InviteEmailContent, _html_body, _plain_text, send_invite_email
from core.models import Invitation, InvitationStatus
from core.supabase_admin import generate_magic_link


def test_openapi_includes_people_and_invite_routes() -> None:
    client = TestClient(create_app())
    paths = client.get("/openapi.json").json()["paths"]
    assert "/connections/requests" in paths
    assert "/connections/recommended" in paths
    assert "/invitations" in paths
    assert "/invitations/{token}" in paths
    assert "/invitations/{token}/post" in paths
    assert "/invitations/{token}/accept" in paths


def test_share_message_includes_article_and_link() -> None:
    msg = _share_message(
        inviter_name="Ada",
        headline="Quiet week in AI",
        take="Worth your time",
        personal="Thought of you",
        invite_url="https://nwf.example/invite/abc",
    )
    assert "I wanted to discuss this article with you" in msg
    assert "Ada" in msg
    assert "Quiet week in AI" in msg
    assert "Worth your time" in msg
    assert "Thought of you" in msg
    assert "https://nwf.example/invite/abc" in msg


def test_invite_email_html_and_plain() -> None:
    content = InviteEmailContent(
        to_email="friend@example.com",
        inviter_name="Ada Lovelace",
        invite_url="https://nwf.example/invite/tok",
        message="Let's talk",
        headline="A Story <script>",
        article_url="https://news.example/a",
        image_url="https://cdn.example/i.jpg",
        publisher="The Outlet",
        take='My "take"',
    )
    plain = _plain_text(content)
    assert "Ada Lovelace" in plain
    assert "Join the conversation" in plain
    html = _html_body(content)
    assert "A Story &lt;script&gt;" in html
    assert "Join the conversation" in html
    assert "The Outlet" in html


@pytest.mark.asyncio
async def test_send_invite_email_noop_without_api_key() -> None:
    settings = MagicMock()
    settings.resend_api_key = None
    settings.email_from = "NewsWithFriends <noreply@example.com>"
    sent = await send_invite_email(
        InviteEmailContent(
            to_email="a@b.com",
            inviter_name="Ada",
            invite_url="https://x",
        ),
        settings=settings,
    )
    assert sent is False


@pytest.mark.asyncio
async def test_generate_magic_link_noop_without_service_role() -> None:
    settings = MagicMock()
    settings.supabase_service_role_key = None
    settings.supabase_url = "http://localhost:54321"
    link = await generate_magic_link(
        "a@b.com",
        "http://localhost:3000/auth/callback?next=/invite/t",
        settings=settings,
    )
    assert link is None


@pytest.mark.asyncio
async def test_generate_magic_link_parses_action_link() -> None:
    settings = MagicMock()
    settings.supabase_service_role_key = "service-role"
    settings.supabase_url = "http://localhost:54321"

    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_resp.json.return_value = {
        "action_link": "https://auth.example/verify?token=1"
    }

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch("core.supabase_admin.httpx.AsyncClient", return_value=mock_client):
        link = await generate_magic_link(
            "a@b.com",
            "http://localhost:3000/auth/callback?next=/invite/t",
            settings=settings,
        )
    assert link == "https://auth.example/verify?token=1"
    mock_client.post.assert_awaited_once()


@pytest.mark.asyncio
async def test_accept_invitation_idempotent() -> None:
    inviter = uuid.uuid4()
    invitee = uuid.uuid4()
    invitation = Invitation(
        token="tok",
        inviter_id=inviter,
        invitee_email="friend@example.com",
        status=InvitationStatus.accepted,
        accepted_user_id=invitee,
    )
    session = AsyncMock()
    result = await accept_invitation_for_user(session, invitation, invitee)
    assert result.status == "already_accepted"
    session.flush.assert_not_called()


@pytest.mark.asyncio
async def test_accept_invitation_creates_friendship() -> None:
    inviter = uuid.uuid4()
    invitee = uuid.uuid4()
    post_id = uuid.uuid4()
    invitation = Invitation(
        token="tok2",
        inviter_id=inviter,
        invitee_email="friend@example.com",
        post_id=post_id,
        status=InvitationStatus.pending,
        reusable=False,
        become_friend=False,
    )

    session = AsyncMock()
    # _find_connection -> scalar returns None; then connection is added.
    session.scalar = AsyncMock(return_value=None)
    session.execute = AsyncMock()
    session.flush = AsyncMock()
    session.add = MagicMock()

    result = await accept_invitation_for_user(session, invitation, invitee)
    assert result.status == "accepted"
    assert invitation.status == InvitationStatus.accepted
    assert invitation.accepted_user_id == invitee
    assert result.post_id == post_id
    assert result.became_friend is True
    session.add.assert_called()
    session.execute.assert_awaited()  # post participant upsert


@pytest.mark.asyncio
async def test_accept_reusable_requires_friend_opt_in() -> None:
    inviter = uuid.uuid4()
    invitee = uuid.uuid4()
    post_id = uuid.uuid4()
    invitation = Invitation(
        token="tok3",
        inviter_id=inviter,
        invitee_email=None,
        post_id=post_id,
        status=InvitationStatus.pending,
        reusable=True,
        become_friend=False,
    )

    session = AsyncMock()
    session.scalar = AsyncMock(return_value=None)
    session.flush = AsyncMock()
    session.add = MagicMock()

    # Without add_friend → view-only redemption.
    view_only = await accept_invitation_for_user(session, invitation, invitee)
    assert view_only.status == "view_only"
    assert view_only.became_friend is False
    assert invitation.status == InvitationStatus.pending

    # With add_friend → friend + join.
    session.scalar = AsyncMock(return_value=None)
    session.execute = AsyncMock()
    joined = await accept_invitation_for_user(
        session, invitation, invitee, add_friend=True
    )
    assert joined.status == "accepted"
    assert joined.became_friend is True


@pytest.mark.asyncio
async def test_accept_reusable_auto_friends_when_flag_set() -> None:
    inviter = uuid.uuid4()
    invitee = uuid.uuid4()
    invitation = Invitation(
        token="tok4",
        inviter_id=inviter,
        invitee_email=None,
        post_id=uuid.uuid4(),
        status=InvitationStatus.pending,
        reusable=True,
        become_friend=True,
    )
    session = AsyncMock()
    session.scalar = AsyncMock(return_value=None)
    session.execute = AsyncMock()
    session.flush = AsyncMock()
    session.add = MagicMock()

    result = await accept_invitation_for_user(session, invitation, invitee)
    assert result.status == "accepted"
    assert result.became_friend is True
    assert invitation.status == InvitationStatus.pending  # reusable stays pending



def test_recommended_and_requests_require_auth() -> None:
    client = TestClient(create_app())
    assert client.get("/connections/requests").status_code == 401
    assert client.get("/connections/recommended").status_code == 401
    assert client.post("/invitations", json={"email": "a@b.com"}).status_code == 401
