"""Backfill story kinds and embeddings for existing stories.

Usage:
    python scripts/backfill_embeddings.py [--limit N]
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import select

from core.classify import classify_story_kind
from core.db import dispose_engine, get_sessionmaker
from core.embeddings import build_embed_text, embed_text, embeddings_enabled
from core.logging import configure_logging, get_logger
from core.models import Source, Story

log = get_logger("scripts.backfill")


async def main(limit: int | None) -> None:
    configure_logging()
    if not embeddings_enabled():
        print("EMBEDDINGS_API_KEY not set; cannot backfill embeddings.", file=sys.stderr)
        raise SystemExit(1)

    factory = get_sessionmaker()
    async with factory() as session:
        stmt = (
            select(Story)
            .where(Story.embedding.is_(None))
            .order_by(Story.created_at.desc())
        )
        if limit is not None:
            stmt = stmt.limit(limit)
        stories = list((await session.scalars(stmt)).all())
        print(f"embedding {len(stories)} stories without vectors...")

        for i, story in enumerate(stories, start=1):
            source = await session.get(Source, story.source_id) if story.source_id else None
            if source is not None:
                story.kind = classify_story_kind(
                    story.article_url, story.section, source.kind
                )

            text = build_embed_text(story.full_headline, story.summary)
            vector = await embed_text(text)
            if vector is not None:
                story.embedding = vector

            if i % 25 == 0:
                await session.commit()
                print(f"  committed {i}/{len(stories)}")

        await session.commit()
        print("done.")

    await dispose_engine()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()
    asyncio.run(main(args.limit))
