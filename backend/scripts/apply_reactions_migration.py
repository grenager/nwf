"""Idempotently apply the story_reactions table + policies + backfill.

Mirrors supabase/migrations/00000000000005_story_reactions.sql but guarded so
it can be run against an already-migrated database without error.
"""

from __future__ import annotations

import asyncio

from sqlalchemy import text

from core.db import dispose_engine, get_sessionmaker

STATEMENTS: list[str] = [
    """
    create table if not exists public.story_reactions (
        user_id uuid not null references public.profiles (id) on delete cascade,
        story_id uuid not null references public.stories (id) on delete cascade,
        reaction text not null check (
            reaction in ('thumbsup', 'heart', 'laugh', 'wow', 'sad', 'angry')
        ),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        primary key (user_id, story_id)
    )
    """,
    "create index if not exists story_reactions_story_idx on public.story_reactions (story_id)",
    "alter table public.story_reactions enable row level security",
    "drop policy if exists story_reactions_select on public.story_reactions",
    """
    create policy story_reactions_select on public.story_reactions
        for select using (
            user_id = auth.uid() or public.is_connected(user_id)
        )
    """,
    "drop policy if exists story_reactions_write on public.story_reactions",
    """
    create policy story_reactions_write on public.story_reactions
        for all using (user_id = auth.uid()) with check (user_id = auth.uid())
    """,
    """
    insert into public.story_reactions (user_id, story_id, reaction)
    select user_id, story_id, 'heart'
    from public.story_statuses
    where starred = true
    on conflict (user_id, story_id) do nothing
    """,
]


async def main() -> None:
    factory = get_sessionmaker()
    async with factory() as session:
        for stmt in STATEMENTS:
            await session.execute(text(stmt))
        await session.commit()
        count = await session.scalar(text("select count(*) from public.story_reactions"))
    print(f"story_reactions ready; rows={count}")
    await dispose_engine()


if __name__ == "__main__":
    asyncio.run(main())
