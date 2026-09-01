"""Source pages: host normalization, visibility, and attribution resolution."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from api.routers.sources import get_source, normalize_host
from core.models import Post, PostVisibility, Profile, Source, Story, StoryKind


def _profile(first: str) -> Profile:
    now = datetime.now(UTC)
    return Profile(
        id=uuid.uuid4(),
        first=first,
        last="Reader",
        image_url=None,
        is_admin=False,
        dense_mode=False,
        dark_mode=False,
        created_at=now,
        updated_at=now,
    )


def _story(url: str, headline: str, *, publisher: str | None = None) -> Story:
    now = datetime.now(UTC)
    return Story(
        id=uuid.uuid4(),
        article_url=url,
        full_headline=headline,
        summary=None,
        image_url=None,
        publisher=publisher,
        source_id=None,
        kind=StoryKind.news,
        author_names=[],
        archived=False,
        created_at=now,
        updated_at=now,
    )


def _post(story: Story, author: Profile) -> Post:
    now = datetime.now(UTC)
    return Post(
        id=uuid.uuid4(),
        story_id=story.id,
        author_id=author.id,
        take="A take",
        shared_text=None,
        visibility=PostVisibility.private,
        last_activity_at=now,
        created_at=now,
        updated_at=now,
    )


class _SourceSession:
    """Session stub returning one canned (Post, Story, Profile, Source) join."""

    def __init__(self, rows: list[tuple[Any, ...]]) -> None:
        self._rows = rows

    async def execute(self, _stmt: Any, *_a: Any, **_k: Any) -> Any:
        rows = self._rows
        return type("R", (), {"all": lambda self: rows})()


def _user() -> Any:
    return type("U", (), {"id": uuid.uuid4(), "is_admin": False})()


def test_normalize_host_strips_www_and_case() -> None:
    assert normalize_host("WWW.NYTimes.com") == "nytimes.com"
    assert normalize_host(" example.org ") == "example.org"
    assert normalize_host("derekthompson.substack.com") == "derekthompson.substack.com"


@pytest.mark.asyncio
async def test_guest_gets_an_empty_named_page() -> None:
    result = await get_source("www.nytimes.com", _SourceSession([]), None, limit=50)
    assert result.host == "nytimes.com"
    assert result.name == "nytimes.com"
    assert result.posts == []


@pytest.mark.asyncio
async def test_lists_only_posts_from_the_requested_host() -> None:
    author = _profile("Ada")
    wanted = _story("https://www.nytimes.com/2026/a", "On the record")
    other = _story("https://example.com/b", "Somewhere else")
    rows = [
        (_post(wanted, author), wanted, author, None),
        (_post(other, author), other, author, None),
    ]
    session = _SourceSession(rows)

    with (
        patch("api.routers.sources.accepted_friend_ids", AsyncMock(return_value=[])),
        patch(
            "api.routers.sources.visible_post_ids_for_viewer",
            AsyncMock(return_value=[rows[0][0].id, rows[1][0].id]),
        ),
        patch("api.routers.sources._reply_counts", AsyncMock(return_value={})),
    ):
        result = await get_source("nytimes.com", session, _user(), limit=50)

    assert result.post_count == 1
    assert [p.full_headline for p in result.posts] == ["On the record"]
    assert result.posts[0].author_name == "Ada Reader"


@pytest.mark.asyncio
async def test_curated_source_supplies_name_logo_and_homepage() -> None:
    author = _profile("Ada")
    story = _story("https://www.nytimes.com/2026/a", "On the record")
    now = datetime.now(UTC)
    source = Source(
        id=uuid.uuid4(),
        name="The New York Times",
        homepage_url="https://www.nytimes.com",
        image_url="https://cdn.example/nyt.png",
        tags=[],
        has_paywall=True,
        created_at=now,
        updated_at=now,
    )
    post = _post(story, author)
    session = _SourceSession([(post, story, author, source)])

    with (
        patch("api.routers.sources.accepted_friend_ids", AsyncMock(return_value=[])),
        patch(
            "api.routers.sources.visible_post_ids_for_viewer",
            AsyncMock(return_value=[post.id]),
        ),
        patch("api.routers.sources._reply_counts", AsyncMock(return_value={post.id: 4})),
    ):
        result = await get_source("nytimes.com", session, _user(), limit=50)

    assert result.name == "The New York Times"
    assert result.image_url == "https://cdn.example/nyt.png"
    assert result.homepage_url == "https://www.nytimes.com"
    assert result.posts[0].reply_count == 4


@pytest.mark.asyncio
async def test_falls_back_to_the_publisher_label_without_a_curated_source() -> None:
    author = _profile("Ada")
    story = _story(
        "https://derekthompson.substack.com/p/x",
        "Slow Boring",
        publisher="Derek Thompson on Substack",
    )
    post = _post(story, author)
    session = _SourceSession([(post, story, author, None)])

    with (
        patch("api.routers.sources.accepted_friend_ids", AsyncMock(return_value=[])),
        patch(
            "api.routers.sources.visible_post_ids_for_viewer",
            AsyncMock(return_value=[post.id]),
        ),
        patch("api.routers.sources._reply_counts", AsyncMock(return_value={})),
    ):
        result = await get_source("derekthompson.substack.com", session, _user(), limit=50)

    assert result.name == "Derek Thompson on Substack"
    assert result.image_url is None


@pytest.mark.asyncio
async def test_host_with_no_visible_posts_is_an_empty_page_not_an_error() -> None:
    session = _SourceSession([])
    with (
        patch("api.routers.sources.accepted_friend_ids", AsyncMock(return_value=[])),
        patch(
            "api.routers.sources.visible_post_ids_for_viewer",
            AsyncMock(return_value=[]),
        ),
    ):
        result = await get_source("nytimes.com", session, _user(), limit=50)

    assert result.name == "nytimes.com"
    assert result.posts == []
