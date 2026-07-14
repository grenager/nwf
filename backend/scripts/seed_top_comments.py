"""Seed friend posts + replies on recent stories for the current user.

Idempotent per (friend, story): won't recreate a post a friend already made.

Run:  python -m scripts.seed_top_comments
"""

from __future__ import annotations

import asyncio
import random
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text

from api.friends import accepted_friend_ids
from core.db import dispose_engine, get_sessionmaker
from core.models import Story, StoryKind, UserSource

ME_ID = uuid.UUID("6c577d24-f7cf-4d3d-96b9-ecd708489271")

TAKES: list[str] = [
    "The cross-outlet framing here is wild — Fox and NYT read like different events.",
    "Been following this all week. This is the clearest write-up so far.",
    "Anyone else think the headline oversells it?",
    "This is the story I keep coming back to.",
    "Feels like there's a bigger story underneath this one.",
    "Solid reporting, but I want to see the primary documents.",
    "Sharing this with the group chat — important context.",
    "The timing of this is not a coincidence.",
    "Curious what the follow-up looks like tomorrow.",
    "Genuinely surprised this isn't bigger news.",
]


async def main() -> None:
    rng = random.Random(7)
    factory = get_sessionmaker()
    async with factory() as session:
        friends: list[uuid.UUID] = await accepted_friend_ids(session, ME_ID)
        if not friends:
            raise SystemExit("no accepted friends for current user")

        followed = (
            select(UserSource.source_id)
            .where(UserSource.user_id == ME_ID)
            .scalar_subquery()
        )
        targets = list(
            (
                await session.scalars(
                    select(Story.id)
                    .where(
                        Story.source_id.in_(followed),
                        Story.archived.is_(False),
                        Story.kind.in_([StoryKind.news, StoryKind.analysis]),
                    )
                    .order_by(Story.created_at.desc())
                    .limit(20)
                )
            ).all()
        )
        if not targets:
            # Fall back to any recent stories.
            targets = list(
                (
                    await session.scalars(
                        select(Story.id)
                        .where(Story.archived.is_(False))
                        .order_by(Story.created_at.desc())
                        .limit(20)
                    )
                ).all()
            )

        now = datetime.now(UTC)
        added = 0
        for sid in targets:
            if rng.random() > 0.6:
                continue
            posters = rng.sample(friends, k=min(rng.randint(1, 2), len(friends)))
            for fid in posters:
                existing = await session.scalar(
                    text(
                        """
                        select 1 from public.posts
                        where author_id = :uid and story_id = :sid limit 1
                        """
                    ),
                    {"uid": fid, "sid": sid},
                )
                if existing:
                    continue
                ts = now - timedelta(minutes=rng.randint(5, 1440))
                post_id = uuid.uuid4()
                await session.execute(
                    text(
                        """
                        insert into public.posts
                            (id, story_id, author_id, take, visibility,
                             last_activity_at, created_at, updated_at)
                        values
                            (:pid, :sid, :uid, :take, 'private', :ts, :ts, :ts)
                        """
                    ),
                    {
                        "pid": post_id,
                        "sid": sid,
                        "uid": fid,
                        "take": rng.choice(TAKES),
                        "ts": ts,
                    },
                )
                await session.execute(
                    text(
                        """
                        insert into public.post_participants (post_id, user_id, joined_at)
                        values (:pid, :uid, :ts)
                        on conflict do nothing
                        """
                    ),
                    {"pid": post_id, "uid": fid, "ts": ts},
                )
                added += 1
        await session.commit()
        print(f"added {added} posts across {len(targets)} stories")

    await dispose_engine()


if __name__ == "__main__":
    asyncio.run(main())
