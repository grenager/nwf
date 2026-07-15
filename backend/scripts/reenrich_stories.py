"""Backfill link-preview metadata for stories that were saved un-enriched.

Re-runs :func:`fetch_url_metadata` (now with the ScrapingBee proxy fallback)
against stories whose headline is just the host, or that are missing both an
image and a summary, and applies the same field-update rules used when a post
is created. Safe to re-run; only fills gaps, never overwrites good data.

Usage (from ``backend/``)::

    .venv/bin/python -m scripts.reenrich_stories            # all unenriched
    .venv/bin/python -m scripts.reenrich_stories --limit 20
    .venv/bin/python -m scripts.reenrich_stories --url https://x.com/...
"""

from __future__ import annotations

import argparse
import asyncio

import structlog
from sqlalchemy import select

from api.routers.posts import _has_html, _is_hostlike, _looks_unenriched
from core.db import get_sessionmaker
from core.enrich import fetch_url_metadata
from core.models import Story

log = structlog.get_logger(__name__)


async def _reenrich_one(story: Story) -> bool:
    """Fetch metadata and fill gaps. Returns True when anything changed."""
    metadata = await fetch_url_metadata(story.article_url)
    changed = False

    if _is_hostlike(story.full_headline, story.article_url) and metadata.title:
        story.full_headline = metadata.title.strip()
        changed = True
    if metadata.description and (
        not story.summary or _has_html(story.summary)
    ):
        story.summary = metadata.description
        changed = True
    if not story.image_url and metadata.image_url:
        story.image_url = metadata.image_url
        changed = True

    publisher = metadata.publisher_label(story.article_url)
    if publisher and not story.publisher:
        story.publisher = publisher
        changed = True

    return changed


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--url",
        action="append",
        default=None,
        help="Only re-enrich the story with this exact article_url (repeatable).",
    )
    args = parser.parse_args()

    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        stmt = select(Story).order_by(Story.created_at.desc())
        if args.url:
            stmt = stmt.where(Story.article_url.in_(args.url))
        stories: list[Story] = list((await session.execute(stmt)).scalars())

        if not args.url:
            stories = [s for s in stories if _looks_unenriched(s)]
        if args.limit is not None:
            stories = stories[: args.limit]

        log.info("reenrich.start", count=len(stories))
        updated = 0
        for story in stories:
            try:
                if await _reenrich_one(story):
                    updated += 1
                    log.info(
                        "reenrich.updated",
                        url=story.article_url,
                        headline=story.full_headline[:80],
                        has_image=bool(story.image_url),
                        has_summary=bool(story.summary),
                    )
                else:
                    log.info("reenrich.no_change", url=story.article_url)
            except Exception as exc:  # keep going on bad URLs
                log.warning(
                    "reenrich.failed", url=story.article_url, error=str(exc)
                )
        await session.commit()
        log.info("reenrich.done", updated=updated, total=len(stories))


if __name__ == "__main__":
    asyncio.run(main())
