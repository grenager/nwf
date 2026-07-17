"""Tests for digest copy, email rendering, and public unsubscribe route."""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from core.config import Settings
from core.email import (
    DigestEmailContent,
    DigestLineContent,
    DigestLineInput,
    _digest_html_body,
    _digest_plain_text,
    _digest_subject,
    digest_email_from_user_digest,
    send_digest_email,
)
from digest.copy import (
    first_name,
    name_list,
    phrase_comments_on_your_post,
    phrase_friend_post,
    phrase_reactions_on_your_post,
    phrase_reply_to_comment,
)


def test_openapi_includes_unsubscribe() -> None:
    client = TestClient(create_app())
    paths = client.get("/openapi.json").json()["paths"]
    assert "/email/unsubscribe/{token}" in paths


def test_name_list_formatting() -> None:
    assert name_list(["Teg"]) == "Teg"
    assert name_list(["Teg", "Jim"]) == "Teg and Jim"
    assert name_list(["Teg", "Jim", "Ada", "Bob", "Eve", "Zoe"]) == (
        "Teg, Jim, and 4 others"
    )


def test_phrase_helpers() -> None:
    assert phrase_friend_post("Teg") == "Teg posted an article"
    assert (
        phrase_friend_post("Teg", friend_comment_count=2)
        == "Teg posted an article and 2 friends commented"
    )
    assert (
        phrase_comments_on_your_post(["Teg", "Jim", "Ada", "Bob", "Eve", "Zoe"])
        == "Teg, Jim, and 4 others commented on your post"
    )
    assert phrase_reply_to_comment(["Shalom"]) == "Shalom responded to your comment"
    assert phrase_reactions_on_your_post(5) == "5 friends reacted to your post"
    assert first_name(None) == "Someone"
    assert first_name("  Teg ") == "Teg"


def test_digest_email_links_use_app_base_url() -> None:
    settings = Settings(app_base_url="https://www.newswithfriends.org")
    post_id = uuid.uuid4()
    token = uuid.uuid4()
    content = digest_email_from_user_digest(
        to_email="a@b.com",
        recipient_first="Ada",
        lines=[
            DigestLineInput(
                text="Teg posted an article",
                post_id=post_id,
                headline="A headline",
                story_image_url="https://cdn.example/story.jpg",
                source_label="The Atlantic",
                actor_image_urls=("https://cdn.example/teg.jpg",),
            ),
            DigestLineInput(text="+2 more updates in your feed", post_id=None),
        ],
        unsubscribe_token=token,
        settings=settings,
    )
    assert content.feed_url == "https://www.newswithfriends.org/"
    assert content.unsubscribe_url == (
        f"https://www.newswithfriends.org/unsubscribe/{token}"
    )
    assert content.lines[0].href == (
        f"https://www.newswithfriends.org/post/{post_id}"
    )
    assert content.lines[1].href == "https://www.newswithfriends.org/"

    html = _digest_html_body(content)
    assert f"https://www.newswithfriends.org/post/{post_id}" in html
    assert f"https://www.newswithfriends.org/unsubscribe/{token}" in html
    assert "Open NewsWithFriends" in html
    assert "https://cdn.example/story.jpg" in html
    assert "https://cdn.example/teg.jpg" in html
    assert "The Atlantic" in html
    assert 'width="40"' in html

    plain = _digest_plain_text(content)
    assert "Hi Ada," in plain
    assert content.lines[0].href in plain


def test_digest_subject_from_top_line() -> None:
    content = DigestEmailContent(
        to_email="a@b.com",
        recipient_first=None,
        lines=[
            DigestLineContent(
                text="Shalom responded to your comment",
                href="https://www.newswithfriends.org/post/x",
            )
        ],
        feed_url="https://www.newswithfriends.org/",
        unsubscribe_url="https://www.newswithfriends.org/unsubscribe/t",
    )
    assert _digest_subject(content) == "Shalom responded to your comment"


@pytest.mark.asyncio
async def test_send_digest_email_noop_without_api_key() -> None:
    settings = MagicMock()
    settings.resend_api_key = None
    settings.email_from = "NewsWithFriends <noreply@example.com>"
    sent = await send_digest_email(
        DigestEmailContent(
            to_email="a@b.com",
            recipient_first="Ada",
            lines=[
                DigestLineContent(
                    text="Teg posted an article",
                    href="https://www.newswithfriends.org/post/x",
                )
            ],
            feed_url="https://www.newswithfriends.org/",
            unsubscribe_url="https://www.newswithfriends.org/unsubscribe/t",
        ),
        settings=settings,
    )
    assert sent is False


def test_app_url_helper() -> None:
    settings = Settings(app_base_url="https://www.newswithfriends.org/")
    assert settings.app_url("/post/abc") == "https://www.newswithfriends.org/post/abc"
    assert settings.app_url("post/abc") == "https://www.newswithfriends.org/post/abc"


def test_friend_notice_email_html() -> None:
    from core.email import (
        FriendNoticeEmailContent,
        _friend_notice_html,
        _friend_notice_subject,
    )

    request = FriendNoticeEmailContent(
        to_email="a@b.com",
        actor_name="Teg",
        actor_image_url="https://cdn.example/teg.jpg",
        action_url="https://www.newswithfriends.org/friends",
        kind="request",
    )
    assert _friend_notice_subject(request) == "Teg sent you a friend request"
    html = _friend_notice_html(request)
    assert "https://cdn.example/teg.jpg" in html
    assert "https://www.newswithfriends.org/friends" in html
    assert "Review friend requests" in html

    accepted = FriendNoticeEmailContent(
        to_email="a@b.com",
        actor_name="Jim",
        actor_image_url=None,
        action_url="https://www.newswithfriends.org/friends",
        kind="accepted",
    )
    assert _friend_notice_subject(accepted) == "Jim accepted your friend request"
    assert "accepted your friend request" in _friend_notice_html(accepted)


@pytest.mark.asyncio
async def test_send_friend_notice_noop_without_api_key() -> None:
    from core.email import FriendNoticeEmailContent, send_friend_notice_email

    settings = MagicMock()
    settings.resend_api_key = None
    settings.email_from = "NewsWithFriends <noreply@example.com>"
    sent = await send_friend_notice_email(
        FriendNoticeEmailContent(
            to_email="a@b.com",
            actor_name="Teg",
            actor_image_url=None,
            action_url="https://www.newswithfriends.org/friends",
            kind="request",
        ),
        settings=settings,
    )
    assert sent is False
