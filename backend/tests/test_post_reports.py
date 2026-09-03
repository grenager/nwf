"""Reporting a post for a content violation, and admin takedowns."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from api.routers.posts import delete_post, report_post
from api.schemas import PostReportCreate
from core.email import (
    ContentReportEmailContent,
    _report_html,
    _report_plain,
    _report_subject,
)
from core.models import Post, PostVisibility, Profile, Story, StoryKind


def _profile(user_id: uuid.UUID, first: str, *, is_admin: bool = False) -> Profile:
    now = datetime.now(UTC)
    return Profile(
        id=user_id,
        first=first,
        last="Tester",
        image_url=None,
        is_admin=is_admin,
        dense_mode=False,
        dark_mode=False,
        created_at=now,
        updated_at=now,
    )


def _post(post_id: uuid.UUID, author_id: uuid.UUID, story_id: uuid.UUID) -> Post:
    now = datetime.now(UTC)
    return Post(
        id=post_id,
        story_id=story_id,
        author_id=author_id,
        take="A questionable take",
        shared_text=None,
        visibility=PostVisibility.private,
        last_activity_at=now,
        created_at=now,
        updated_at=now,
    )


def _story(story_id: uuid.UUID) -> Story:
    now = datetime.now(UTC)
    return Story(
        id=story_id,
        article_url="https://example.com/piece",
        full_headline="A headline",
        kind=StoryKind.news,
        author_names=[],
        archived=False,
        created_at=now,
        updated_at=now,
    )


class _ReportSession:
    """Session stub serving the post, its story, and profiles by id."""

    def __init__(
        self,
        post: Post | None,
        story: Story | None = None,
        profiles: dict[uuid.UUID, Profile] | None = None,
    ) -> None:
        self._post = post
        self._story = story
        self._profiles = profiles or {}
        self.deleted: list[Any] = []

    async def get(self, model: Any, key: Any) -> Any:
        if model is Post:
            return self._post if self._post is not None and key == self._post.id else None
        if model is Story:
            return self._story if self._story is not None and key == self._story.id else None
        if model is Profile:
            return self._profiles.get(key)
        return None

    async def scalars(self, _stmt: Any) -> Any:
        admin_ids = [p.id for p in self._profiles.values() if p.is_admin]
        return type("R", (), {"all": lambda self: admin_ids})()

    async def delete(self, obj: Any) -> None:
        self.deleted.append(obj)


def _user(user_id: uuid.UUID, *, email: str | None = "someone@example.com",
          is_admin: bool = False) -> Any:
    return type("U", (), {"id": user_id, "email": email, "is_admin": is_admin})()


@pytest.mark.asyncio
async def test_report_404_when_post_missing() -> None:
    session = _ReportSession(None)
    with pytest.raises(HTTPException) as exc_info:
        await report_post(
            uuid.uuid4(), PostReportCreate(), session, _user(uuid.uuid4())  # type: ignore[arg-type]
        )
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_report_404_when_post_not_visible_to_reporter() -> None:
    post_id, story_id = uuid.uuid4(), uuid.uuid4()
    session = _ReportSession(_post(post_id, uuid.uuid4(), story_id))
    with patch("api.routers.posts.can_see_post", AsyncMock(return_value=False)):
        with pytest.raises(HTTPException) as exc_info:
            await report_post(
                post_id, PostReportCreate(), session, _user(uuid.uuid4())  # type: ignore[arg-type]
            )
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_report_emails_admins_with_post_contents_and_link() -> None:
    post_id, story_id = uuid.uuid4(), uuid.uuid4()
    author_id, reporter_id, admin_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    session = _ReportSession(
        _post(post_id, author_id, story_id),
        _story(story_id),
        {
            author_id: _profile(author_id, "Ava"),
            reporter_id: _profile(reporter_id, "Bo"),
            admin_id: _profile(admin_id, "Root", is_admin=True),
        },
    )
    sent = AsyncMock(return_value=True)
    with (
        patch("api.routers.posts.can_see_post", AsyncMock(return_value=True)),
        patch(
            "api.routers.posts.email_for_user",
            AsyncMock(side_effect=lambda _s, uid: f"{uid}@example.com"),
        ),
        patch("api.routers.posts.send_content_report_email", sent),
    ):
        result = await report_post(
            post_id,
            PostReportCreate(reason="Harassment"),
            session,  # type: ignore[arg-type]
            _user(reporter_id, email="bo@example.com"),
        )

    assert result.emailed is True
    content: ContentReportEmailContent = sent.await_args.args[0]
    assert content.to_emails == (f"{admin_id}@example.com",)
    assert content.reason == "Harassment"
    assert content.take == "A questionable take"
    assert content.headline == "A headline"
    assert content.reporter_email == "bo@example.com"
    assert str(post_id) in content.post_url


@pytest.mark.asyncio
async def test_report_uses_configured_moderation_address() -> None:
    post_id, story_id = uuid.uuid4(), uuid.uuid4()
    admin_id = uuid.uuid4()
    session = _ReportSession(
        _post(post_id, uuid.uuid4(), story_id),
        _story(story_id),
        {admin_id: _profile(admin_id, "Root", is_admin=True)},
    )
    sent = AsyncMock(return_value=True)
    settings = type("S", (), {
        "moderation_report_email": "moderation@example.com",
        "app_url": lambda self, path: f"https://app.test{path}",
    })()
    with (
        patch("api.routers.posts.can_see_post", AsyncMock(return_value=True)),
        patch("api.routers.posts.email_for_user", AsyncMock(return_value=None)),
        patch("api.routers.posts.get_settings", lambda: settings),
        patch("api.routers.posts.send_content_report_email", sent),
    ):
        await report_post(
            post_id, PostReportCreate(), session, _user(uuid.uuid4())  # type: ignore[arg-type]
        )

    content: ContentReportEmailContent = sent.await_args.args[0]
    assert content.to_emails == ("moderation@example.com",)
    assert content.post_url == f"https://app.test/post/{post_id}"


@pytest.mark.asyncio
async def test_report_reports_when_no_email_went_out() -> None:
    post_id, story_id = uuid.uuid4(), uuid.uuid4()
    session = _ReportSession(_post(post_id, uuid.uuid4(), story_id), _story(story_id))
    with (
        patch("api.routers.posts.can_see_post", AsyncMock(return_value=True)),
        patch("api.routers.posts.email_for_user", AsyncMock(return_value=None)),
        patch(
            "api.routers.posts.send_content_report_email",
            AsyncMock(return_value=False),
        ),
    ):
        result = await report_post(
            post_id, PostReportCreate(), session, _user(uuid.uuid4())  # type: ignore[arg-type]
        )
    assert result.emailed is False


@pytest.mark.asyncio
async def test_delete_post_allows_admin_takedown() -> None:
    post_id = uuid.uuid4()
    post = _post(post_id, uuid.uuid4(), uuid.uuid4())
    session = _ReportSession(post)
    with patch("api.routers.posts.is_admin_user", AsyncMock(return_value=True)):
        await delete_post(post_id, session, _user(uuid.uuid4()))  # type: ignore[arg-type]
    assert session.deleted == [post]


@pytest.mark.asyncio
async def test_delete_post_still_403_for_a_non_admin_stranger() -> None:
    post_id = uuid.uuid4()
    session = _ReportSession(_post(post_id, uuid.uuid4(), uuid.uuid4()))
    with patch("api.routers.posts.is_admin_user", AsyncMock(return_value=False)):
        with pytest.raises(HTTPException) as exc_info:
            await delete_post(post_id, session, _user(uuid.uuid4()))  # type: ignore[arg-type]
    assert exc_info.value.status_code == 403
    assert session.deleted == []


def test_report_email_body_carries_contents_and_link() -> None:
    content = ContentReportEmailContent(
        to_emails=("root@example.com",),
        reporter_name="Bo Tester",
        reporter_email="bo@example.com",
        author_name="Ava Tester",
        author_email="ava@example.com",
        reason="Harassment & abuse",
        headline="A headline",
        article_url="https://example.com/piece",
        take="A questionable take",
        shared_text=None,
        post_url="https://app.test/post/abc",
    )
    plain: str = _report_plain(content)
    assert "A questionable take" in plain
    assert "https://app.test/post/abc" in plain
    assert "Harassment & abuse" in plain
    assert "Ava Tester" in _report_subject(content)

    body: str = _report_html(content)
    assert "https://app.test/post/abc" in body
    # Reason text is user-supplied, so it must not land in the HTML raw.
    assert "Harassment &amp; abuse" in body
    assert "Harassment & abuse" not in body
