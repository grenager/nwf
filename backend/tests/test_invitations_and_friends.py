"""Tests for friend requests, FoF recommendations, and email invitations."""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from api.friends import (
    ensure_friend_capacity,
    ensure_invite_capacity,
    friend_slots_used,
    pending_invites_used,
)
from api.main import create_app
from api.routers.invitations import (
    _APP_FOOTER,
    _DEFAULT_INVITE_PREFIX,
    _share_message,
    accept_invitation_for_user,
    create_invitation,
)
from api.schemas import InvitationCreate
from core.email import InviteEmailContent, _html_body, _plain_text, send_invite_email
from core.models import (
    Connection,
    ConnectionStatus,
    Invitation,
    InvitationStatus,
)
from core.supabase_admin import generate_magic_link


def _limits(*, max_friends: int = 150, max_pending_invites: int = 25) -> MagicMock:
    """Settings stub pinning the caps a test depends on."""
    settings = MagicMock()
    settings.max_friends = max_friends
    settings.max_pending_invites = max_pending_invites
    return settings


def test_openapi_includes_people_and_invite_routes() -> None:
    client = TestClient(create_app())
    paths = client.get("/openapi.json").json()["paths"]
    assert "/connections/requests" in paths
    assert "/connections/recommended" in paths
    assert "/invitations" in paths
    assert "/invitations/{token}" in paths
    assert "/invitations/{token}/post" in paths
    assert "/invitations/{token}/accept" in paths


def test_share_message_leads_with_the_article_not_the_app() -> None:
    """The headline comes first; the product is a footnote under the link."""
    msg = _share_message(
        headline="Quiet week in AI",
        take="Worth your time",
        personal="Thought of you",
        invite_url="https://nwf.example/invite/abc",
    )
    lines = msg.splitlines()
    assert lines[0] == "Quiet week in AI"
    # A note written for this person beats the take attached to the post.
    assert lines[1] == "Thought of you"
    assert "Worth your time" not in msg
    assert lines[2] == "https://nwf.example/invite/abc"
    assert lines[-1] == _APP_FOOTER
    # The old copy opened by pitching the product. It must not do that again.
    assert not msg.startswith("I'm using NewsWithFriends")


def test_share_message_uses_the_take_when_there_is_no_personal_note() -> None:
    msg = _share_message(
        headline="Quiet week in AI",
        take="Worth your time",
        personal=None,
        invite_url="https://nwf.example/invite/abc",
    )
    assert msg.splitlines()[:3] == [
        "Quiet week in AI",
        "Worth your time",
        "https://nwf.example/invite/abc",
    ]


def test_share_message_is_headline_and_link_with_nothing_to_say() -> None:
    """No take, no note: the headline still has to carry the message."""
    msg = _share_message(
        headline="Quiet week in AI",
        take=None,
        personal=None,
        invite_url="https://nwf.example/invite/abc",
    )
    assert msg.splitlines() == [
        "Quiet week in AI",
        "https://nwf.example/invite/abc",
        _APP_FOOTER,
    ]


def test_share_message_invites_to_the_app_without_an_article() -> None:
    """A standalone invite has no article, so it must not point at one."""
    msg = _share_message(
        headline=None,
        take=None,
        personal=None,
        invite_url="https://nwf.example/invite/abc",
    )
    assert msg.startswith(_DEFAULT_INVITE_PREFIX)
    assert "this article" not in msg
    assert "https://nwf.example/invite/abc" in msg


@pytest.mark.asyncio
async def test_create_invitation_mints_a_link_without_a_post() -> None:
    """Someone who has posted nothing yet still needs an invite to hand out."""
    from core.models import Profile

    user_id = uuid.uuid4()
    session = AsyncMock()
    session.get = AsyncMock(
        return_value=Profile(id=user_id, first="Ada", last="Lovelace")
    )
    session.add = MagicMock()
    session.flush = AsyncMock()

    settings = MagicMock()
    settings.app_base_url = "https://nwf.example"

    result = await create_invitation(
        InvitationCreate(email=None, post_id=None, become_friend=True),
        session,
        MagicMock(id=user_id),
        settings,
    )

    assert result.status == "invited"
    assert result.invite_url is not None
    assert result.invite_url.startswith("https://nwf.example/invite/")
    assert result.email_sent is False
    assert "this article" not in result.share_message

    invitation = session.add.call_args.args[0]
    assert invitation.post_id is None
    assert invitation.reusable is True
    assert invitation.become_friend is True


def test_invite_email_html_and_plain() -> None:
    content = InviteEmailContent(
        to_email="friend@example.com",
        inviter_name="Ada Lovelace",
        invite_url="https://nwf.example/invite/tok",
        unsubscribe_url="https://nwf.example/unsubscribe/invite/u",
        message="Let's talk",
        headline="A Story <script>",
        article_url="https://news.example/a",
        image_url="https://cdn.example/i.jpg",
        publisher="The Outlet",
        take='My "take"',
    )
    plain = _plain_text(content)
    assert "Ada Lovelace" in plain
    assert "Accept invitation" in plain
    html = _html_body(content)
    assert "A Story &lt;script&gt;" in html
    assert "Accept invitation" in html
    assert "The Outlet" in html


def test_invite_email_greets_recipient_by_first_name() -> None:
    content = InviteEmailContent(
        to_email="teg@example.com",
        inviter_name="Ada Lovelace",
        invite_url="https://nwf.example/invite/tok",
        unsubscribe_url="https://nwf.example/unsubscribe/invite/u",
        recipient_name="Teg Grenager",
    )
    assert _plain_text(content).startswith("Hi Teg,")
    assert "Hi Teg," in _html_body(content)


def test_invite_email_omits_greeting_without_recipient_name() -> None:
    content = InviteEmailContent(
        to_email="teg@example.com",
        inviter_name="Ada Lovelace",
        invite_url="https://nwf.example/invite/tok",
        unsubscribe_url="https://nwf.example/unsubscribe/invite/u",
    )
    assert not _plain_text(content).startswith("Hi ")
    assert "Hi " not in _html_body(content)


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
            unsubscribe_url="https://x/unsubscribe/invite/u",
        ),
        settings=settings,
    )
    assert sent is False


def test_invite_email_carries_unsubscribe_link() -> None:
    """Invitees who never asked for this must be able to opt out."""
    content = InviteEmailContent(
        to_email="friend@example.com",
        inviter_name="Ada",
        invite_url="https://nwf.example/invite/tok",
        unsubscribe_url="https://nwf.example/unsubscribe/invite/abc",
    )
    plain = _plain_text(content)
    assert (
        "Unsubscribe from these emails: "
        "https://nwf.example/unsubscribe/invite/abc" in plain
    )
    html = _html_body(content)
    assert 'href="https://nwf.example/unsubscribe/invite/abc"' in html
    assert "Unsubscribe from these emails" in html


@pytest.mark.asyncio
async def test_send_invite_email_sets_list_unsubscribe_header() -> None:
    settings = MagicMock()
    settings.resend_api_key = "rk"
    settings.email_from = "NewsWithFriends <noreply@example.com>"

    mock_resp = MagicMock()
    mock_resp.raise_for_status = MagicMock()
    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_resp)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch("core.email.httpx.AsyncClient", return_value=mock_client):
        sent = await send_invite_email(
            InviteEmailContent(
                to_email="a@b.com",
                inviter_name="Ada",
                invite_url="https://x",
                unsubscribe_url="https://x/unsubscribe/invite/u",
            ),
            settings=settings,
        )

    assert sent is True
    headers = mock_client.post.await_args.kwargs["json"]["headers"]
    assert headers["List-Unsubscribe"] == "<https://x/unsubscribe/invite/u>"
    assert headers["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"


@pytest.mark.asyncio
async def test_friend_slots_used_counts_only_connections() -> None:
    """Outstanding invitations no longer eat into the friend limit."""
    session = AsyncMock()
    session.scalar = AsyncMock(return_value=7)
    assert await friend_slots_used(session, uuid.uuid4()) == 7
    # One query, not two: invitations are not consulted at all.
    assert session.scalar.await_count == 1


@pytest.mark.asyncio
async def test_pending_invites_used_counts_outstanding_invitations() -> None:
    session = AsyncMock()
    session.scalar = AsyncMock(return_value=3)
    assert await pending_invites_used(session, uuid.uuid4()) == 3


@pytest.mark.asyncio
async def test_ensure_friend_capacity_allows_below_the_limit() -> None:
    session = AsyncMock()
    session.scalar = AsyncMock(return_value=49)
    settings = MagicMock()
    settings.max_friends = 50
    await ensure_friend_capacity(session, uuid.uuid4(), settings=settings)


@pytest.mark.asyncio
async def test_ensure_friend_capacity_raises_at_the_limit() -> None:
    session = AsyncMock()
    session.scalar = AsyncMock(return_value=50)
    settings = MagicMock()
    settings.max_friends = 50
    with pytest.raises(HTTPException) as excinfo:
        await ensure_friend_capacity(session, uuid.uuid4(), settings=settings)
    assert excinfo.value.status_code == 409
    assert "50-friend limit" in excinfo.value.detail


@pytest.mark.asyncio
async def test_a_prolific_inviter_keeps_their_friend_slots() -> None:
    """The regression this split exists to prevent.

    Under the old rule, 20 friends plus 40 invitations in flight filled a
    50-slot account and blocked the next invite -- the wall landed on the
    people doing the most inviting, exactly when it started working.
    """
    session = AsyncMock()
    session.scalar = AsyncMock(return_value=20)
    settings = MagicMock()
    settings.max_friends = 50
    await ensure_friend_capacity(session, uuid.uuid4(), settings=settings)


@pytest.mark.asyncio
async def test_ensure_invite_capacity_raises_at_the_limit() -> None:
    session = AsyncMock()
    session.scalar = AsyncMock(return_value=25)
    settings = MagicMock()
    settings.max_pending_invites = 25
    with pytest.raises(HTTPException) as excinfo:
        await ensure_invite_capacity(session, uuid.uuid4(), settings=settings)
    assert excinfo.value.status_code == 409
    assert "25 invitations still outstanding" in excinfo.value.detail


@pytest.mark.asyncio
async def test_ensure_invite_capacity_allows_below_the_limit() -> None:
    session = AsyncMock()
    session.scalar = AsyncMock(return_value=24)
    settings = MagicMock()
    settings.max_pending_invites = 25
    await ensure_invite_capacity(session, uuid.uuid4(), settings=settings)


@pytest.mark.asyncio
async def test_accept_invitation_refuses_when_accepter_is_full() -> None:
    """A full account cannot grow by accepting an invitation."""
    invitation = Invitation(
        token="tok-full",
        inviter_id=uuid.uuid4(),
        invitee_email="friend@example.com",
        status=InvitationStatus.pending,
        reusable=False,
    )
    session = AsyncMock()
    # No existing connection, then one count: the friend limit no longer
    # consults invitations.
    session.scalar = AsyncMock(side_effect=[None, 50])
    session.add = MagicMock()

    with (
        patch("api.friends.get_settings", return_value=_limits(max_friends=50)),
        pytest.raises(HTTPException) as excinfo,
    ):
        await accept_invitation_for_user(session, invitation, uuid.uuid4())
    assert excinfo.value.status_code == 409
    session.add.assert_not_called()
    assert invitation.status == InvitationStatus.pending


@pytest.mark.asyncio
async def test_email_invite_degrades_to_view_only_when_inviter_is_full() -> None:
    """Sending an invite no longer reserves the inviter a slot.

    It is capped as outbound mail instead, so by redemption time the inviter
    can genuinely be full. That must leave the recipient reading rather than
    push the inviter over their own limit.
    """
    invitation = Invitation(
        token="tok-mail-full",
        inviter_id=uuid.uuid4(),
        invitee_email="friend@example.com",
        post_id=uuid.uuid4(),
        status=InvitationStatus.pending,
        reusable=False,
    )
    session = AsyncMock()
    # No existing connection; the redeemer has room, the inviter does not.
    session.scalar = AsyncMock(side_effect=[None, 0, 50])
    session.execute = AsyncMock()
    session.flush = AsyncMock()
    session.add = MagicMock()

    with (
        patch("api.friends.get_settings", return_value=_limits(max_friends=50)),
        patch(
            "api.routers.invitations.get_settings",
            return_value=_limits(max_friends=50),
        ),
    ):
        result = await accept_invitation_for_user(session, invitation, uuid.uuid4())

    assert result.status == "view_only"
    assert result.became_friend is False
    # The invitation stays open so it can still be redeemed once room frees up.
    assert invitation.status == InvitationStatus.pending
    session.add.assert_not_called()


@pytest.mark.asyncio
async def test_reusable_link_degrades_to_view_only_when_inviter_is_full() -> None:
    """Share links reserve no slot, so a full inviter must not error the reader."""
    invitation = Invitation(
        token="tok-share",
        inviter_id=uuid.uuid4(),
        invitee_email=None,
        post_id=uuid.uuid4(),
        status=InvitationStatus.pending,
        reusable=True,
        become_friend=True,
    )
    session = AsyncMock()
    # redemption lookup, connection lookup, the redeemer's count, the
    # inviter's, then the redemption lookup again
    session.scalar = AsyncMock(side_effect=[None, None, 0, 50, None])
    session.execute = AsyncMock()
    session.flush = AsyncMock()
    session.add = MagicMock()

    with (
        patch("api.friends.get_settings", return_value=_limits(max_friends=50)),
        patch(
            "api.routers.invitations.get_settings",
            return_value=_limits(max_friends=50),
        ),
    ):
        result = await accept_invitation_for_user(session, invitation, uuid.uuid4())
    assert result.status == "view_only"
    assert result.became_friend is False
    assert "full" in result.message


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
    """Single-use email invites auto-friend even when become_friend is false."""
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


@pytest.mark.asyncio
async def test_accept_reusable_skips_alert_when_already_friends() -> None:
    """Sharing a link with an existing friend must not re-announce them."""
    inviter = uuid.uuid4()
    invitee = uuid.uuid4()
    post_id = uuid.uuid4()
    invitation = Invitation(
        token="tok-friend",
        inviter_id=inviter,
        invitee_email=None,
        post_id=post_id,
        status=InvitationStatus.pending,
        reusable=True,
        become_friend=True,
    )

    session = AsyncMock()
    session.execute = AsyncMock()
    session.flush = AsyncMock()
    session.add = MagicMock()
    # 1) redemption lookup, 2) _find_connection, 3) redemption lookup again.
    session.scalar = AsyncMock(
        side_effect=[
            None,
            Connection(
                first_id=inviter,
                second_id=invitee,
                status=ConnectionStatus.accepted,
            ),
            None,
        ]
    )

    with patch(
        "api.routers.invitations._notify_new_friendship", new=AsyncMock()
    ) as notify:
        result = await accept_invitation_for_user(session, invitation, invitee)

    notify.assert_not_awaited()
    assert result.status == "already_friends"
    assert result.became_friend is True
    assert result.post_id == post_id
    session.execute.assert_awaited()  # still joined to the shared post


@pytest.mark.asyncio
async def test_accept_single_use_skips_alert_when_already_friends() -> None:
    """Same for a single-use email invite sent to an existing friend."""
    inviter = uuid.uuid4()
    invitee = uuid.uuid4()
    invitation = Invitation(
        token="tok-friend-2",
        inviter_id=inviter,
        invitee_email="friend@example.com",
        status=InvitationStatus.pending,
        reusable=False,
    )

    session = AsyncMock()
    session.execute = AsyncMock()
    session.flush = AsyncMock()
    session.add = MagicMock()
    session.scalar = AsyncMock(
        return_value=Connection(
            first_id=inviter, second_id=invitee, status=ConnectionStatus.accepted
        )
    )

    with patch(
        "api.routers.invitations._notify_new_friendship", new=AsyncMock()
    ) as notify:
        result = await accept_invitation_for_user(session, invitation, invitee)

    notify.assert_not_awaited()
    assert result.status == "already_friends"
    assert result.became_friend is True
    assert invitation.status == InvitationStatus.accepted
