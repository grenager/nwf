"""Wipe all events and re-cluster news stories from scratch.

Processes news stories oldest-first so event first_seen_at and centroids
build up in chronological order.

Usage:
    python scripts/recluster_events.py
"""

from __future__ import annotations

import asyncio

from sqlalchemy import select, text

from core.config import get_settings
from core.db import dispose_engine, get_sessionmaker
from core.logging import configure_logging, get_logger
from core.models import Story, StoryKind
from scraper.cluster import assign_story_to_event

log = get_logger("scripts.recluster")


async def main() -> None:
    configure_logging()
    settings = get_settings()
    print(f"reclustering with threshold={settings.event_cluster_threshold}")

    factory = get_sessionmaker()
    async with factory() as session:
        await session.execute(text("DELETE FROM public.story_events"))
        await session.execute(text("DELETE FROM public.events"))
        await session.commit()
        print("cleared existing events and story_events")

        stmt = (
            select(Story)
            .where(Story.kind == StoryKind.news, Story.embedding.is_not(None))
            .order_by(Story.created_at.asc())
        )
        stories = list((await session.scalars(stmt)).all())
        print(f"clustering {len(stories)} news stories...")

        for i, story in enumerate(stories, start=1):
            await assign_story_to_event(session, story, story.embedding)  # type: ignore[arg-type]
            if i % 100 == 0:
                await session.commit()
                print(f"  processed {i}/{len(stories)}")

        await session.commit()
        print("done.")

    await dispose_engine()


if __name__ == "__main__":
    asyncio.run(main())
