"""Add dummy friend comments to the *top* articles currently on Today.

Targets the same events/analysis the API surfaces for the current user, so the
comments are visible in the story modals. Idempotent per (friend, story):
it won't duplicate a comment a friend already left on a story.

Run:  python -m scripts.seed_top_comments
"""

from __future__ import annotations

import asyncio
import random
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text

from api.friends import accepted_friend_ids
from api.routers.events import _build_coverage_rows, _load_events_for_user
from core.db import dispose_engine, get_sessionmaker
from core.models import Story, StoryKind, UserSource

ME_ID = uuid.UUID("6c577d24-f7cf-4d3d-96b9-ecd708489271")

COMMENTS: list[str] = [
    "The cross-outlet framing here is wild — Fox and NYT read like different events.",
    "Been following this all week. This is the clearest write-up so far.",
    "Anyone else think the headline oversells it?",
    "This is the story I keep coming back to.",
    "The Deadline version has details the others skipped.",
    "Feels like there's a bigger story underneath this one.",
    "Solid reporting, but I want to see the primary documents.",
    "Sharing this with the group chat — important context.",
    "The timing of this is not a coincidence.",
    "Curious what the follow-up looks like tomorrow.",
    "Genuinely surprised this isn't bigger news.",
    "Good thread of coverage to compare side by side.",
]


async def main() -> None:
    rng = random.Random(7)
    factory = get_sessionmaker()
    async with factory() as session:
        friends: list[uuid.UUID] = await accepted_friend_ids(session, ME_ID)
        if not friends:
            raise SystemExit("no accepted friends for current user")

        # Top news stories: lead + coverage of the top events shown on Today.
        events = await _load_events_for_user(session, ME_ID, limit=8)
        story_ids: list[uuid.UUID] = []
        for event in events:
            coverage = await _build_coverage_rows(session, ME_ID, event.id)
            story_ids.extend(c.story_id for c in coverage[:3])

        # Plus the top analysis pieces from followed sources.
        followed = (
            select(UserSource.source_id)
            .where(UserSource.user_id == ME_ID)
            .scalar_subquery()
        )
        analysis = (
            await session.scalars(
                select(Story.id)
                .where(
                    Story.source_id.in_(followed),
                    Story.kind == StoryKind.analysis,
                    Story.archived.is_(False),
                )
                .order_by(Story.created_at.desc())
                .limit(10)
            )
        ).all()
        story_ids.extend(analysis)

        # De-dup, keep order.
        seen: set[uuid.UUID] = set()
        targets: list[uuid.UUID] = []
        for sid in story_ids:
            if sid not in seen:
                seen.add(sid)
                targets.append(sid)

        now = datetime.now(UTC)
        added = 0
        for sid in targets:
            # Comment on ~60% of the top stories.
            if rng.random() > 0.6:
                continue
            commenters = rng.sample(friends, k=min(rng.randint(1, 3), len(friends)))
            for fid in commenters:
                existing = await session.scalar(
                    text(
                        """
                        select 1 from public.comments
                        where user_id = :uid and story_id = :sid limit 1
                        """
                    ),
                    {"uid": fid, "sid": sid},
                )
                if existing:
                    continue
                ts = now - timedelta(minutes=rng.randint(5, 1440))
                await session.execute(
                    text(
                        """
                        insert into public.comments
                            (story_id, user_id, text, created_at, updated_at)
                        values (:sid, :uid, :text, :ts, :ts)
                        """
                    ),
                    {
                        "sid": sid,
                        "uid": fid,
                        "text": rng.choice(COMMENTS),
                        "ts": ts,
                    },
                )
                added += 1
        await session.commit()
        print(f"added {added} comments across {len(targets)} top stories")

    await dispose_engine()


if __name__ == "__main__":
    asyncio.run(main())
