"""RSS parsing, classification, embedding, and event clustering."""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from time import struct_time
from typing import Any
from urllib.parse import urlparse

import feedparser
import httpx
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from core.classify import classify_story_kind
from core.config import get_settings
from core.embeddings import build_embed_text, embed_text, embeddings_enabled
from core.logging import get_logger
from core.models import Source, Story, StoryKind
from scraper.cluster import assign_story_to_event

log = get_logger("scraper.ingest")


def _struct_to_datetime(value: struct_time | None) -> datetime | None:
    if value is None:
        return None
    try:
        return datetime(*value[:6], tzinfo=UTC)
    except (ValueError, TypeError):
        return None


@dataclass(frozen=True)
class FeedMetadata:
    """Source-level metadata inferred from an RSS/Atom feed's channel."""

    title: str | None = None
    homepage_url: str | None = None
    image_url: str | None = None


def _clean_str(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _origin(url: str | None) -> str | None:
    """Scheme + host of a URL (e.g. ``https://example.com``)."""
    if not url:
        return None
    parsed = urlparse(url)
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}"
    return None


def _hostname_label(url: str | None) -> str | None:
    """Human-ish label from a URL's host (``www.`` stripped)."""
    if not url:
        return None
    host: str | None = urlparse(url).hostname
    if not host:
        return None
    return host[4:] if host.startswith("www.") else host


def _compose_source_name(outlet: str | None, section: str | None) -> str | None:
    """Build a source name from a domain outlet and the feed's channel title.

    Section feeds (e.g. WaPo's ``National``) declare the *section* as their
    ``<title>``, not the publication, so we prefix the outlet domain. When the
    feed title already names the outlet, we keep the title as-is to avoid
    duplication like ``washingtonpost.com — The Washington Post``.
    """
    if not section:
        return outlet
    if not outlet:
        return section
    core = outlet.split(".", 1)[0].lower()
    if core and core in re.sub(r"[^a-z0-9]", "", section.lower()):
        return section
    return f"{outlet} — {section}"


def _feed_image(feed: Any) -> str | None:
    image: Any = getattr(feed, "image", None)
    if isinstance(image, dict):
        href = _clean_str(image.get("href")) or _clean_str(image.get("url"))
        if href:
            return href
    return _clean_str(getattr(feed, "logo", None)) or _clean_str(
        getattr(feed, "icon", None)
    )


def _feed_metadata(feed_text: str) -> FeedMetadata:
    """Extract channel-level title/homepage/logo from raw feed text."""
    parsed = feedparser.parse(feed_text)
    feed: Any = getattr(parsed, "feed", None)
    if not feed:
        return FeedMetadata()
    return FeedMetadata(
        title=_clean_str(getattr(feed, "title", None)),
        homepage_url=_clean_str(getattr(feed, "link", None)),
        image_url=_feed_image(feed),
    )


async def fetch_feed_metadata(rss_url: str) -> FeedMetadata:
    """Fetch an RSS feed and infer its source-level metadata."""
    settings = get_settings()
    async with httpx.AsyncClient(
        timeout=settings.scrape_http_timeout_seconds,
        follow_redirects=True,
        headers={"User-Agent": "NewsWithFriends/0.1 (+https://newswithfriends.app)"},
    ) as client:
        resp = await client.get(rss_url)
        resp.raise_for_status()
        feed_text = resp.text
    return _feed_metadata(feed_text)


def _entry_authors(entry: Any) -> list[str]:
    authors: list[str] = []
    for author in getattr(entry, "authors", []) or []:
        name = author.get("name") if isinstance(author, dict) else None
        if name:
            authors.append(name)
    single = getattr(entry, "author", None)
    if single and single not in authors:
        authors.append(single)
    return authors


_IMG_SRC_RE = re.compile(r"<img[^>]+src=[\"']([^\"']+)[\"']", re.IGNORECASE)


def _first_img_src(html: str | None) -> str | None:
    if not html:
        return None
    match = _IMG_SRC_RE.search(html)
    return match.group(1) if match else None


def _entry_image(entry: Any) -> str | None:
    """Best-effort article image from the many places feeds hide it."""
    # Media RSS <media:content url=...>, prefer entries flagged as images.
    media = getattr(entry, "media_content", None)
    if isinstance(media, list):
        for item in media:
            url = item.get("url")
            medium = str(item.get("medium", "")).lower()
            mime = str(item.get("type", "")).lower()
            if url and (medium == "image" or mime.startswith("image") or not medium):
                return str(url)

    # Media RSS <media:thumbnail url=...>
    thumb = getattr(entry, "media_thumbnail", None)
    if isinstance(thumb, list) and thumb and thumb[0].get("url"):
        return str(thumb[0]["url"])

    # <link rel="enclosure" type="image/*">
    for link in getattr(entry, "links", []) or []:
        if link.get("rel") == "enclosure" and str(link.get("type", "")).startswith(
            "image"
        ):
            return str(link.get("href"))

    # First <img> inside content:encoded / Atom content.
    for content in getattr(entry, "content", []) or []:
        src = _first_img_src(content.get("value") if isinstance(content, dict) else None)
        if src:
            return src

    # First <img> inside the summary/description HTML.
    return _first_img_src(getattr(entry, "summary", None))


def _entry_section(entry: Any) -> str | None:
    tags = getattr(entry, "tags", None) or []
    if tags:
        first = tags[0]
        if isinstance(first, dict):
            term = first.get("term")
            if term:
                return str(term)
        elif first:
            return str(first)
    category = getattr(entry, "category", None)
    return str(category) if category else None


def _parse_entries(feed_text: str, source: Source) -> list[dict[str, Any]]:
    """Parse feed text into story upsert dicts."""
    parsed = feedparser.parse(feed_text)
    stories: list[dict[str, Any]] = []
    for entry in parsed.entries:
        url = getattr(entry, "link", None)
        headline = getattr(entry, "title", None)
        if not url or not headline:
            continue
        published = _struct_to_datetime(
            getattr(entry, "published_parsed", None)
            or getattr(entry, "updated_parsed", None)
        )
        section = _entry_section(entry)
        kind = classify_story_kind(str(url), section, source.kind)
        stories.append(
            {
                "article_url": url,
                "source_id": source.id,
                "full_headline": headline,
                "summary": getattr(entry, "summary", None),
                "section": section,
                "type": "rss",
                "kind": kind,
                "image_url": _entry_image(entry),
                "author_names": _entry_authors(entry),
                "created_at": published,
                "last_scraped_at": datetime.now(UTC),
            }
        )
    return stories


async def _postprocess_story(session: AsyncSession, story_id: uuid.UUID) -> None:
    """Embed and cluster a single story after upsert."""
    story = await session.get(Story, story_id)
    if story is None:
        return

    if not embeddings_enabled():
        return

    if story.embedding is None:
        text = build_embed_text(story.full_headline, story.summary)
        vector = await embed_text(text)
        if vector is not None:
            story.embedding = vector
            await session.flush()

    if story.kind == StoryKind.news and story.embedding is not None:
        await assign_story_to_event(session, story, story.embedding)


async def ingest_source(session: AsyncSession, source: Source) -> int:
    """Fetch, parse, upsert, embed, and cluster a single source's feed."""
    if not source.rss_url:
        log.warning("scraper.skip_no_rss", source_id=str(source.id), name=source.name)
        return 0

    settings = get_settings()
    async with httpx.AsyncClient(
        timeout=settings.scrape_http_timeout_seconds,
        follow_redirects=True,
        headers={"User-Agent": "NewsWithFriends/0.1 (+https://newswithfriends.app)"},
    ) as client:
        resp = await client.get(source.rss_url)
        resp.raise_for_status()
        feed_text = resp.text

    rows = _parse_entries(feed_text, source)
    written = 0
    story_ids: list[uuid.UUID] = []

    for row in rows:
        set_values: dict[str, Any] = {
            "full_headline": row["full_headline"],
            "summary": row["summary"],
            "section": row["section"],
            "kind": row["kind"],
            "image_url": row["image_url"],
            "author_names": row["author_names"],
            "last_scraped_at": row["last_scraped_at"],
            "updated_at": func.now(),
        }
        if row.get("created_at") is None:
            row.pop("created_at", None)

        stmt = (
            pg_insert(Story)
            .values(**row)
            .on_conflict_do_update(
                index_elements=[Story.article_url],
                set_=set_values,
            )
            .returning(Story.id)
        )
        result = await session.execute(stmt)
        sid = result.scalar_one()
        story_ids.append(sid)
        written += 1

    source.last_scraped_at = datetime.now(UTC)
    await session.flush()

    for sid in story_ids:
        try:
            await _postprocess_story(session, sid)
        except Exception as exc:  # log and continue
            log.error("scraper.postprocess_failed", story_id=str(sid), error=str(exc))

    log.info(
        "scraper.ingested",
        source_id=str(source.id),
        name=source.name,
        entries=written,
    )
    return written
