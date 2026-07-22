"""Tests for instant activity emails (new post / comment / reply)."""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.activity_mail import notify_comment_activity, notify_friends_of_new_post
from api.friends import ActivityEmailRecipient
from core.email import (
    ActivityEmailContent,
    _activity_html,
    _activity_plain,
    _activity_subject,
    send_activity_email,
)


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

    session = AsyncMock()
    session.get = AsyncMock(return_value=None)

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
            new=AsyncMock(return_value=recipients),
        ) as load_mock,
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
    called_ids = set(load_mock.await_args.args[1])
    assert author_id not in called_ids
    assert friend_a in called_ids
    assert friend_b in called_ids

    assert send_mock.await_count == 2
    kinds = {c.args[0].kind for c in send_mock.await_args_list}
    assert kinds == {"new_post"}
    subjects = {_activity_subject(c.args[0]) for c in send_mock.await_args_list}
    assert subjects == {"Shalom posted a new article"}


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

    session = AsyncMock()
    session.get = AsyncMock(return_value=None)

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

    session = AsyncMock()
    session.get = AsyncMock(return_value=None)

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

    with (
        patch(
            "api.activity_mail.load_activity_email_recipients",
            new=AsyncMock(return_value=[]),
        ) as load_mock,
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
