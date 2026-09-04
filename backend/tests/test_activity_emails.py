"""Tests for instant activity emails (new post / comment / reply)."""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.activity_mail import notify_comment_activity, notify_friends_of_new_post
from api.friends import ActivityEmailRecipient, PendingInviteRecipient
from core.email import (
    ActivityEmailContent,
    _activity_html,
    _activity_plain,
    _activity_subject,
    send_activity_email,
)


class _NullSavepoint:
    """Stands in for the SAVEPOINT the notify_* helpers open on the session."""

    async def __aenter__(self) -> _NullSavepoint:
        return self

    async def __aexit__(self, *exc: object) -> bool:
        return False


def _mail_session() -> AsyncMock:
    """A mock session shaped like the AsyncSession the notify_* helpers use."""
    session = AsyncMock()
    session.get = AsyncMock(return_value=None)
    session.begin_nested = MagicMock(return_value=_NullSavepoint())
    return session


def _content(**overrides: object) -> ActivityEmailContent:
    base: dict[str, object] = {
        "to_email": "friend@example.com",
        "recipient_first": "Ada",
        "actor_name": "Shalom",
        "actor_image_url": "https://cdn.example/a.jpg",
        "kind": "new_post",
        "headline": "Quiet week in AI",
        "source_label": "The Outlet",
        "story_image_url": "https://cdn.example/story.jpg",
        "excerpt": "Worth a look",
        "action_url": "https://www.newswithfriends.org/post/abc",
        "unsubscribe_url": "https://www.newswithfriends.org/unsubscribe/tok",
    }
    base.update(overrides)
    return ActivityEmailContent(**base)  # type: ignore[arg-type]


def test_activity_subjects() -> None:
    assert (
        _activity_subject(_content(kind="new_post", actor_name="Shalom"))
        == "Shalom posted a new article"
    )
    assert (
        _activity_subject(_content(kind="comment", actor_name="Teg"))
        == "Teg commented on your article"
    )
    assert (
        _activity_subject(_content(kind="reply", actor_name="Heather"))
        == "Heather responded to your comment"
    )


def test_activity_html_and_plain_escape() -> None:
    content = _content(
        kind="comment",
        actor_name="Teg",
        headline='A Story <script>alert("x")</script>',
        excerpt='Nice "take"',
    )
    plain = _activity_plain(content)
    assert "Teg commented on your article" in plain
    assert "View conversation" in plain
    assert "Unsubscribe:" in plain

    html = _activity_html(content)
    assert "A Story &lt;script&gt;" in html
    assert "View conversation" in html
    assert "Unsubscribe" in html
    assert "<script>" not in html


def test_activity_pending_note_and_cta_override_render() -> None:
    content = _content(
        pending_note="Join to read the conversation.",
        cta_label="Join the conversation",
    )
    plain = _activity_plain(content)
    assert "Join to read the conversation." in plain
    assert "Join the conversation: " in plain

    html = _activity_html(content)
    assert "Join to read the conversation." in html
    assert "Join the conversation</a>" in html


@pytest.mark.asyncio
async def test_send_activity_email_noop_without_api_key() -> None:
    settings = MagicMock()
    settings.resend_api_key = None
    settings.email_from = "NewsWithFriends <noreply@example.com>"
    sent = await send_activity_email(_content(), settings=settings)
    assert sent is False


@pytest.mark.asyncio
async def test_notify_friends_of_new_post_fans_out() -> None:
    author_id = uuid.uuid4()
    friend_a = uuid.uuid4()
    friend_b = uuid.uuid4()
    opted_out = uuid.uuid4()

    post = MagicMock()
    post.id = uuid.uuid4()
    post.author_id = author_id
    post.take = "My take"

    story = MagicMock()
    story.full_headline = "Quiet week"
    story.article_url = "https://news.example/a"
    story.source_id = None
    story.publisher = "Outlet"
    story.image_url = None

    author = MagicMock()
    author.id = author_id
    author.first = "Shalom"
    author.last = None
    author.image_url = None

    session = _mail_session()

    recipients = [
        ActivityEmailRecipient(
            user_id=friend_a,
            email="a@example.com",
            first="Ada",
            unsubscribe_token=uuid.uuid4(),
        ),
        ActivityEmailRecipient(
            user_id=friend_b,
            email="b@example.com",
            first="Bob",
            unsubscribe_token=uuid.uuid4(),
        ),
    ]

    with (
        patch(
            "api.activity_mail.accepted_friend_ids",
            new=AsyncMock(return_value=[friend_a, friend_b, opted_out, author_id]),
        ),
        patch(
            "api.activity_mail.load_activity_email_recipients",
            new=AsyncMock(side_effect=[recipients, []]),
        ) as load_mock,
        patch(
            "api.activity_mail.pending_connection_ids",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "api.activity_mail.load_pending_invite_recipients",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "api.activity_mail.send_activity_email",
            new=AsyncMock(return_value=True),
        ) as send_mock,
        patch(
            "api.activity_mail.get_settings",
            return_value=MagicMock(
                app_url=lambda p: f"https://nwf.example{p}",
                resend_api_key="rk",
            ),
        ),
    ):
        await notify_friends_of_new_post(
            session, post=post, story=story, author=author
        )

    # Author excluded from audience passed to loader
    called_ids = set(load_mock.await_args_list[0].args[1])
    assert author_id not in called_ids
    assert friend_a in called_ids
    assert friend_b in called_ids

    assert send_mock.await_count == 2
    kinds = {c.args[0].kind for c in send_mock.await_args_list}
    assert kinds == {"new_post"}
    subjects = {_activity_subject(c.args[0]) for c in send_mock.await_args_list}
    assert subjects == {"Shalom posted a new article"}


@pytest.mark.asyncio
async def test_notify_friends_of_new_post_reaches_pending_audiences() -> None:
    """Unanswered requests and un-signed-up invitees hear about a new post."""
    author_id = uuid.uuid4()
    friend_id = uuid.uuid4()
    pending_id = uuid.uuid4()

    post = MagicMock()
    post.id = uuid.uuid4()
    post.author_id = author_id
    post.take = "My take"

    story = MagicMock()
    story.full_headline = "Quiet week"
    story.article_url = "https://news.example/a"
    story.source_id = None
    story.publisher = "Outlet"
    story.image_url = None

    author = MagicMock()
    author.id = author_id
    author.first = "Shalom"
    author.last = None
    author.image_url = None

    session = _mail_session()

    friend = ActivityEmailRecipient(
        user_id=friend_id,
        email="friend@example.com",
        first="Ada",
        unsubscribe_token=uuid.uuid4(),
    )
    pending = ActivityEmailRecipient(
        user_id=pending_id,
        email="pending@example.com",
        first="Bob",
        unsubscribe_token=uuid.uuid4(),
    )
    invitation_id = uuid.uuid4()
    invitee = PendingInviteRecipient(
        invitation_id=invitation_id,
        email="invitee@example.com",
        invite_token="tok123",
        unsubscribe_token=uuid.uuid4(),
    )

    with (
        patch(
            "api.activity_mail.accepted_friend_ids",
            new=AsyncMock(return_value=[friend_id]),
        ),
        patch(
            "api.activity_mail.load_activity_email_recipients",
            new=AsyncMock(side_effect=[[friend], [pending]]),
        ),
        patch(
            "api.activity_mail.pending_connection_ids",
            new=AsyncMock(return_value=[pending_id]),
        ),
        patch(
            "api.activity_mail.load_pending_invite_recipients",
            new=AsyncMock(return_value=[invitee]),
        ) as invite_mock,
        patch(
            "api.activity_mail.send_activity_email",
            new=AsyncMock(return_value=True),
        ) as send_mock,
        patch(
            "api.activity_mail.get_settings",
            return_value=MagicMock(
                app_url=lambda p: f"https://nwf.example{p}",
                resend_api_key="rk",
            ),
        ),
    ):
        await notify_friends_of_new_post(
            session, post=post, story=story, author=author
        )

    # Invitees are scoped to this author, never the whole invitation table.
    assert invite_mock.await_args.kwargs["inviter_id"] == author_id

    by_email: dict[str, ActivityEmailContent] = {
        call.args[0].to_email: call.args[0] for call in send_mock.await_args_list
    }
    assert set(by_email) == {
        "friend@example.com",
        "pending@example.com",
        "invitee@example.com",
    }

    accepted = by_email["friend@example.com"]
    assert accepted.pending_note is None
    assert accepted.action_url == f"https://nwf.example/post/{post.id}"

    requested = by_email["pending@example.com"]
    assert requested.pending_note is not None
    assert requested.action_url == "https://nwf.example/friends"
    assert requested.cta_label == "Accept friend request"

    invited = by_email["invitee@example.com"]
    assert invited.pending_note is not None
    assert invited.action_url == "https://nwf.example/invite/tok123"
    assert (
        invited.unsubscribe_url
        == f"https://nwf.example/unsubscribe/invite/{invitee.unsubscribe_token}"
    )

    # The nudge is recorded so the invitee is not emailed again today.
    assert session.execute.await_count == 1


@pytest.mark.asyncio
async def test_invitee_nudge_not_recorded_when_send_fails() -> None:
    """A failed send must not consume the invitee's daily throttle slot."""
    author_id = uuid.uuid4()

    post = MagicMock()
    post.id = uuid.uuid4()
    post.author_id = author_id
    post.take = None

    story = MagicMock()
    story.full_headline = "Headline"
    story.article_url = "https://news.example/a"
    story.source_id = None
    story.publisher = None
    story.image_url = None

    author = MagicMock()
    author.id = author_id
    author.first = "Shalom"
    author.last = None
    author.image_url = None

    session = _mail_session()

    invitee = PendingInviteRecipient(
        invitation_id=uuid.uuid4(),
        email="invitee@example.com",
        invite_token="tok123",
        unsubscribe_token=uuid.uuid4(),
    )

    with (
        patch(
            "api.activity_mail.accepted_friend_ids",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "api.activity_mail.load_activity_email_recipients",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "api.activity_mail.pending_connection_ids",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "api.activity_mail.load_pending_invite_recipients",
            new=AsyncMock(return_value=[invitee]),
        ),
        patch(
            "api.activity_mail.send_activity_email",
            new=AsyncMock(return_value=False),
        ) as send_mock,
        patch(
            "api.activity_mail.get_settings",
            return_value=MagicMock(
                app_url=lambda p: f"https://nwf.example{p}",
                resend_api_key=None,
            ),
        ),
    ):
        await notify_friends_of_new_post(
            session, post=post, story=story, author=author
        )

    assert send_mock.await_count == 1
    session.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_notify_comment_activity_nudges_invited_conversation() -> None:
    """People invited to this post hear about new replies in it."""
    author_id = uuid.uuid4()
    commenter_id = uuid.uuid4()

    post = MagicMock()
    post.id = uuid.uuid4()
    post.author_id = author_id

    story = MagicMock()
    story.full_headline = "Headline"
    story.article_url = "https://news.example/a"
    story.source_id = None
    story.publisher = None
    story.image_url = None

    commenter = MagicMock()
    commenter.id = commenter_id
    commenter.first = "Teg"
    commenter.last = None
    commenter.image_url = None

    session = _mail_session()

    invitee = PendingInviteRecipient(
        invitation_id=uuid.uuid4(),
        email="invitee@example.com",
        invite_token="tok456",
        unsubscribe_token=uuid.uuid4(),
    )

    with (
        patch(
            "api.activity_mail.load_activity_email_recipients",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "api.activity_mail.load_pending_invite_recipients",
            new=AsyncMock(return_value=[invitee]),
        ) as invite_mock,
        patch(
            "api.activity_mail.send_activity_email",
            new=AsyncMock(return_value=True),
        ) as send_mock,
        patch(
            "api.activity_mail.get_settings",
            return_value=MagicMock(
                app_url=lambda p: f"https://nwf.example{p}",
                resend_api_key="rk",
            ),
        ),
    ):
        await notify_comment_activity(
            session,
            post=post,
            story=story,
            comment_text="Great thread",
            commenter=commenter,
            parent_author_id=None,
        )

    # Scoped to this conversation rather than everyone the commenter invited.
    assert invite_mock.await_args.kwargs["post_id"] == post.id

    assert send_mock.await_count == 1
    content: ActivityEmailContent = send_mock.await_args.args[0]
    assert content.kind == "conversation"
    assert content.to_email == "invitee@example.com"
    assert (
        _activity_subject(content)
        == "Teg replied in a conversation you were invited to"
    )


@pytest.mark.asyncio
async def test_notify_comment_activity_emails_post_author() -> None:
    author_id = uuid.uuid4()
    commenter_id = uuid.uuid4()

    post = MagicMock()
    post.id = uuid.uuid4()
    post.author_id = author_id

    story = MagicMock()
    story.full_headline = "Headline"
    story.article_url = "https://news.example/a"
    story.source_id = None
    story.publisher = None
    story.image_url = None

    commenter = MagicMock()
    commenter.id = commenter_id
    commenter.first = "Teg"
    commenter.last = None
    commenter.image_url = None

    session = _mail_session()

    recipient = ActivityEmailRecipient(
        user_id=author_id,
        email="author@example.com",
        first="Shalom",
        unsubscribe_token=uuid.uuid4(),
    )

    with (
        patch(
            "api.activity_mail.load_activity_email_recipients",
            new=AsyncMock(return_value=[recipient]),
        ),
        patch(
            "api.activity_mail.load_pending_invite_recipients",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "api.activity_mail.send_activity_email",
            new=AsyncMock(return_value=True),
        ) as send_mock,
        patch(
            "api.activity_mail.get_settings",
            return_value=MagicMock(
                app_url=lambda p: f"https://nwf.example{p}",
                resend_api_key="rk",
            ),
        ),
    ):
        await notify_comment_activity(
            session,
            post=post,
            story=story,
            comment_text="Nice piece",
            commenter=commenter,
            parent_author_id=None,
        )

    assert send_mock.await_count == 1
    content: ActivityEmailContent = send_mock.await_args.args[0]
    assert content.kind == "comment"
    assert content.to_email == "author@example.com"
    assert _activity_subject(content) == "Teg commented on your article"


@pytest.mark.asyncio
async def test_notify_reply_dedupes_and_prefers_reply_framing() -> None:
    """When the post author is also the parent-comment author, send one reply email."""
    author_id = uuid.uuid4()
    commenter_id = uuid.uuid4()

    post = MagicMock()
    post.id = uuid.uuid4()
    post.author_id = author_id

    story = MagicMock()
    story.full_headline = "Headline"
    story.article_url = "https://news.example/a"
    story.source_id = None
    story.publisher = None
    story.image_url = None

    commenter = MagicMock()
    commenter.id = commenter_id
    commenter.first = "Heather"
    commenter.last = None
    commenter.image_url = None

    session = _mail_session()

    recipient = ActivityEmailRecipient(
        user_id=author_id,
        email="author@example.com",
        first="Shalom",
        unsubscribe_token=uuid.uuid4(),
    )

    with (
        patch(
            "api.activity_mail.load_activity_email_recipients",
            new=AsyncMock(return_value=[recipient]),
        ) as load_mock,
        patch(
            "api.activity_mail.load_pending_invite_recipients",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "api.activity_mail.send_activity_email",
            new=AsyncMock(return_value=True),
        ) as send_mock,
        patch(
            "api.activity_mail.get_settings",
            return_value=MagicMock(
                app_url=lambda p: f"https://nwf.example{p}",
                resend_api_key="rk",
            ),
        ),
    ):
        await notify_comment_activity(
            session,
            post=post,
            story=story,
            comment_text="Agree",
            commenter=commenter,
            parent_author_id=author_id,  # same as post author
        )

    # Loader asked about a single recipient id (deduped)
    called_ids = list(load_mock.await_args.args[1])
    assert called_ids.count(author_id) == 1 or set(called_ids) == {author_id}

    assert send_mock.await_count == 1
    content: ActivityEmailContent = send_mock.await_args.args[0]
    assert content.kind == "reply"
    assert (
        _activity_subject(content) == "Heather responded to your comment"
    )


@pytest.mark.asyncio
async def test_notify_skips_self_comment_on_own_post() -> None:
    user_id = uuid.uuid4()

    post = MagicMock()
    post.id = uuid.uuid4()
    post.author_id = user_id

    story = MagicMock()
    story.full_headline = "Headline"
    story.article_url = "https://news.example/a"
    story.source_id = None
    story.publisher = None
    story.image_url = None

    commenter = MagicMock()
    commenter.id = user_id
    commenter.first = "Teg"
    commenter.last = None
    commenter.image_url = None

    session = AsyncMock()
    session.begin_nested = MagicMock(return_value=_NullSavepoint())

    with (
        patch(
            "api.activity_mail.load_activity_email_recipients",
            new=AsyncMock(return_value=[]),
        ) as load_mock,
        patch(
            "api.activity_mail.load_pending_invite_recipients",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "api.activity_mail.send_activity_email",
            new=AsyncMock(return_value=True),
        ) as send_mock,
    ):
        await notify_comment_activity(
            session,
            post=post,
            story=story,
            comment_text="Note to self",
            commenter=commenter,
            parent_author_id=None,
        )

    load_mock.assert_not_awaited()
    send_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_pending_invite_loader_skips_suppressed_and_registered() -> None:
    """Only addresses that still need an invitation get nudged."""
    from api.friends import load_pending_invite_recipients

    inviter = uuid.uuid4()

    def _invitation(email: str) -> MagicMock:
        invitation = MagicMock()
        invitation.id = uuid.uuid4()
        invitation.invitee_email = email
        invitation.token = f"tok-{email}"
        invitation.unsubscribe_token = uuid.uuid4()
        return invitation

    fresh = _invitation("fresh@example.com")
    session = AsyncMock()
    session.begin_nested = MagicMock(return_value=_NullSavepoint())
    scalars_result = MagicMock()
    scalars_result.all.return_value = [
        fresh,
        _invitation("Opted@Example.com"),
        _invitation("member@example.com"),
    ]
    session.scalars = AsyncMock(return_value=scalars_result)

    with (
        patch(
            "api.friends.suppressed_emails",
            new=AsyncMock(return_value={"opted@example.com"}),
        ),
        patch(
            "api.friends.emails_with_accounts",
            new=AsyncMock(return_value={"member@example.com"}),
        ),
    ):
        recipients = await load_pending_invite_recipients(
            session, inviter_id=inviter
        )

    assert [r.email for r in recipients] == ["fresh@example.com"]
    assert recipients[0].invitation_id == fresh.id


@pytest.mark.asyncio
async def test_pending_invite_loader_requires_a_scope() -> None:
    """Guard against accidentally emailing every invitee in the database."""
    from api.friends import load_pending_invite_recipients

    with pytest.raises(ValueError):
        await load_pending_invite_recipients(AsyncMock())


@pytest.mark.asyncio
async def test_opted_out_recipients_are_skipped_by_loader() -> None:
    """load_activity_email_recipients filters instant_email_opt_out."""
    from api.friends import load_activity_email_recipients

    opted = uuid.uuid4()
    ok = uuid.uuid4()

    opted_profile = MagicMock()
    opted_profile.id = opted
    opted_profile.instant_email_opt_out = True
    opted_profile.first = "Out"
    opted_profile.unsubscribe_token = uuid.uuid4()

    ok_profile = MagicMock()
    ok_profile.id = ok
    ok_profile.instant_email_opt_out = False
    ok_profile.first = "In"
    ok_profile.unsubscribe_token = uuid.uuid4()

    session = AsyncMock()
    session.begin_nested = MagicMock(return_value=_NullSavepoint())
    scalars_result = MagicMock()
    scalars_result.all.return_value = [opted_profile, ok_profile]
    session.scalars = AsyncMock(return_value=scalars_result)

    with patch(
        "api.friends.email_for_user",
        new=AsyncMock(side_effect=lambda _s, uid: f"{uid}@example.com"),
    ):
        recipients = await load_activity_email_recipients(session, [opted, ok])

    assert len(recipients) == 1
    assert recipients[0].user_id == ok


@pytest.mark.asyncio
async def test_email_db_failure_does_not_poison_caller_transaction() -> None:
    """A DB error while emailing must not roll back the caller's own writes.

    The notify_* helpers query the caller's session, so a failing statement
    used to leave the surrounding transaction aborted -- the comment or post
    that triggered the email was rolled back with it and the request 500'd.
    The SAVEPOINT confines the damage to the email work.
    """
    post = MagicMock()
    post.id = uuid.uuid4()
    post.author_id = uuid.uuid4()
    post.take = "a take"
    story = MagicMock()
    author = MagicMock()
    author.id = post.author_id

    rolled_back: list[bool] = []

    class _TrackingSavepoint(_NullSavepoint):
        async def __aexit__(self, *exc: object) -> bool:
            rolled_back.append(exc[0] is not None)
            return False

    session = AsyncMock()
    session.get = AsyncMock(return_value=None)
    session.begin_nested = MagicMock(return_value=_TrackingSavepoint())

    with patch(
        "api.activity_mail.accepted_friend_ids",
        new=AsyncMock(side_effect=RuntimeError("column does not exist")),
    ):
        # Must not raise: the caller's request has to survive this.
        await notify_friends_of_new_post(
            session, post=post, story=story, author=author
        )

    # The savepoint saw the exception, so only the email work was undone.
    assert rolled_back == [True]


def test_activity_html_makes_card_and_lead_clickable() -> None:
    """The headline, image, lead line and excerpt all link to the post."""
    content = _content(kind="comment", actor_name="Teg")
    body = _activity_html(content)
    anchor = f'<a href="{content.action_url}"'
    # lead + avatar, article card, excerpt, button, and the plain-text fallback
    assert body.count(anchor) == 5
    headline_start = body.index("Quiet week in AI")
    card_anchor = body.rindex(anchor, 0, headline_start)
    assert "</a>" not in body[card_anchor:headline_start]
    # images inside anchors must not pick up a link border in Outlook/Gmail
    assert body.count('border="0"') == 2
