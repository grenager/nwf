"""RSS parsing and story upsert logic."""

from __future__ import annotations

from datetime import UTC, datetime
from time import struct_time
from typing import Any

import feedparser
import httpx
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from core.logging import get_logger
from core.models import Source, Story

log = get_logger("scraper.ingest")


def _struct_to_datetime(value: struct_time | None) -> datetime | None:
    if value is None:
        return None
    try:
        return datetime(*value[:6], tzinfo=UTC)
    except (ValueError, TypeError):
        return None


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


def _entry_image(entry: Any) -> str | None:
    media = getattr(entry, "media_content", None)
    if media and isinstance(media, list) and media and media[0].get("url"):
        return str(media[0]["url"])
    for link in getattr(entry, "links", []) or []:
        if link.get("rel") == "enclosure" and str(link.get("type", "")).startswith("image"):
            return str(link.get("href"))
    return None


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
        stories.append(
            {
                "article_url": url,
                "source_id": source.id,
                "full_headline": headline,
                "summary": getattr(entry, "summary", None),
                "section": getattr(entry, "category", None),
                "type": "rss",
                "image_url": _entry_image(entry),
                "author_names": _entry_authors(entry),
                "created_at": published,
                "last_scraped_at": datetime.now(UTC),
            }
        )
    return stories


async def ingest_source(session: AsyncSession, source: Source) -> int:
    """Fetch, parse, and upsert a single source's feed. Returns rows written."""
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
    for row in rows:
        # Don't clobber created_at on conflict if the feed omitted a date.
        set_values: dict[str, Any] = {
            "full_headline": row["full_headline"],
            "summary": row["summary"],
            "section": row["section"],
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
        )
        await session.execute(stmt)
        written += 1

    source.last_scraped_at = datetime.now(UTC)
    await session.flush()
    log.info(
        "scraper.ingested",
        source_id=str(source.id),
        name=source.name,
        entries=written,
    )
    return written
