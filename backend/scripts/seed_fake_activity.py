"""Seed fake friend activity for testing engagement UIs.

Reusable and parameterized (unlike ``seed_demo_friends``, which is hardcoded to
specific real accounts). Pick a target account -- the "me" whose friends get
activity -- create a set of fake friends, connect them as accepted friends, and
generate reads and comments on recent news events and analysis
stories so the engagement summaries and Friends sidebar can be exercised.

Fake friends live under the reserved ``@seed.test`` email domain so the script
is fully idempotent: each run clears the fake friends' prior activity and
re-seeds. Real accounts and their data are never touched.

Examples::

    # List candidate target accounts (id + email) to choose from.
    python -m scripts.seed_fake_activity --list-users

    # Seed 6 fake friends' activity for a given account.
    python -m scripts.seed_fake_activity --user-email me@example.com

    # More friends, deterministic variation.
    python -m scripts.seed_fake_activity --user-id <uuid> --friends 10 --seed 7

    # Remove all fake-friend activity and connections, then exit.
    python -m scripts.seed_fake_activity --clear

Run from the ``backend`` directory (so ``core``/``scripts`` are importable).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import random
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from core.db import dispose_engine, get_engine

# Reserved domain that marks an account as a script-generated fake friend.
SEED_DOMAIN: str = "seed.test"

# Pool of plausible names; cycled (with a numeric suffix on the email) to build
# as many distinct fake friends as requested.
NAME_POOL: list[tuple[str, str]] = [
    ("Ava", "Reyes"),
    ("Milo", "Chen"),
    ("Nadia", "Okafor"),
    ("Theo", "Larsson"),
    ("Priya", "Nair"),
    ("Sam", "Whitfield"),
    ("Lena", "Kovac"),
    ("Owen", "Delgado"),
    ("Iris", "Tanaka"),
    ("Marcus", "Bello"),
    ("Zoe", "Halvorsen"),
    ("Diego", "Marchetti"),
]

# Recency buckets (minutes since a friend's latest activity) so the sidebar and
# "online" indicators show a realistic spread. Cycled across friends.
RECENCY_MINUTES: list[int] = [1, 4, 12, 45, 180, 600, 1_440, 4_320]

COMMENT_TEXTS: list[str] = [
    "This is a big deal — curious how it plays out.",
    "The framing here feels off compared to other outlets.",
    "Finally some real reporting on this.",
    "Not sure I buy the headline, but the details are solid.",
    "Wow, did not see this coming.",
    "Worth reading to the end — the last section is the key.",
    "Anyone have a non-paywalled version?",
    "This lines up with what I read last week.",
    "The comparison across outlets is fascinating.",
    "Skeptical of the sourcing on this one.",
    "Great context in the second half.",
    "This changes how I think about the whole story.",
]


async def _list_users(conn: AsyncConnection) -> None:
    rows = (
        await conn.execute(
            text(
                """
                select u.id, u.email, p.first, p.last
                from auth.users u
                left join public.profiles p on p.id = u.id
                where coalesce(u.email, '') not like :seed
                order by u.created_at
                """
            ),
            {"seed": f"%@{SEED_DOMAIN}"},
        )
    ).all()
    if not rows:
        print("no real user accounts found")
        return
    print(f"{'id':38}  {'email':32}  name")
    for uid, email, first, last in rows:
        name = " ".join(part for part in (first, last) if part) or "—"
        print(f"{uid!s:38}  {(email or '—'):32}  {name}")


async def _resolve_target(
    conn: AsyncConnection, email: str | None, user_id: str | None
) -> uuid.UUID:
    if user_id is not None:
        row = (
            await conn.execute(
                text("select id from auth.users where id = :id"),
                {"id": user_id},
            )
        ).first()
        if row is None:
            raise SystemExit(f"no account with id {user_id}")
        by_id: uuid.UUID = row[0]
        return by_id

    if email is not None:
        row = (
            await conn.execute(
                text("select id from auth.users where lower(email) = lower(:e)"),
                {"e": email},
            )
        ).first()
        if row is None:
            raise SystemExit(f"no account with email {email}")
        by_email: uuid.UUID = row[0]
        return by_email

    # Auto-pick when exactly one non-seed account exists; otherwise ask.
    rows = (
        await conn.execute(
            text(
                """
                select id from auth.users
                where coalesce(email, '') not like :seed
                """
            ),
            {"seed": f"%@{SEED_DOMAIN}"},
        )
    ).all()
    if len(rows) == 1:
        only: uuid.UUID = rows[0][0]
        return only
    raise SystemExit(
        "could not auto-pick a target account; pass --user-email or --user-id "
        "(use --list-users to see options)"
    )


async def _ensure_friend(
    conn: AsyncConnection, first: str, last: str, email: str
) -> uuid.UUID:
    existing = (
        await conn.execute(
            text("select id from auth.users where lower(email) = lower(:e)"),
            {"e": email},
        )
    ).first()
    if existing is not None:
        uid: uuid.UUID = existing[0]
    else:
        uid = uuid.uuid4()
        await conn.execute(
            text(
                """
                insert into auth.users
                    (id, aud, role, email, email_confirmed_at,
                     raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
                values
                    (:id, 'authenticated', 'authenticated', :email, now(),
                     cast(:app_meta as jsonb), cast(:user_meta as jsonb), now(), now())
                on conflict (id) do nothing
                """
            ),
            {
                "id": uid,
                "email": email,
                "app_meta": json.dumps({"provider": "email", "providers": ["email"]}),
                "user_meta": json.dumps({"first": first, "last": last}),
            },
        )

    await conn.execute(
        text(
            """
            insert into public.profiles (id, first, last)
            values (:id, :first, :last)
            on conflict (id) do update
                set first = excluded.first,
                    last = excluded.last
            """
        ),
        {"id": uid, "first": first, "last": last},
    )
    return uid


async def _seed_friend_ids(conn: AsyncConnection) -> list[uuid.UUID]:
    """All fake-friend account ids (by reserved email domain)."""
    rows = (
        await conn.execute(
            text(
                "select id from auth.users where coalesce(email, '') like :seed"
            ),
            {"seed": f"%@{SEED_DOMAIN}"},
        )
    ).all()
    return [r[0] for r in rows]


async def _clear_activity(conn: AsyncConnection, friend_ids: list[uuid.UUID]) -> None:
    if not friend_ids:
        return
    await conn.execute(
        text("delete from public.comments where user_id = any(:ids)"),
        {"ids": friend_ids},
    )
    await conn.execute(
        text("delete from public.story_statuses where user_id = any(:ids)"),
        {"ids": friend_ids},
    )


async def _story_pool(
    conn: AsyncConnection, news_limit: int, analysis_limit: int
) -> tuple[list[uuid.UUID], list[uuid.UUID]]:
    news = (
        await conn.execute(
            text(
                """
                select id from public.stories
                where kind = 'news'
                order by created_at desc
                limit :n
                """
            ),
            {"n": news_limit},
        )
    ).all()
    analysis = (
        await conn.execute(
            text(
                """
                select id from public.stories
                where kind = 'analysis'
                order by created_at desc
                limit :n
                """
            ),
            {"n": analysis_limit},
        )
    ).all()
    return [r[0] for r in news], [r[0] for r in analysis]


async def _run_clear() -> None:
    engine = get_engine()
    async with engine.begin() as conn:
        friend_ids = await _seed_friend_ids(conn)
        await _clear_activity(conn, friend_ids)
        if friend_ids:
            await conn.execute(
                text(
                    """
                    delete from public.connections
                    where first_id = any(:ids) or second_id = any(:ids)
                    """
                ),
                {"ids": friend_ids},
            )
        print(f"cleared activity + connections for {len(friend_ids)} fake friends")
    await dispose_engine()
    print("done.")


async def _run_seed(
    email: str | None,
    user_id: str | None,
    n_friends: int,
    seed: int,
    news_limit: int,
    analysis_limit: int,
) -> None:
    rng = random.Random(seed)
    engine = get_engine()
    async with engine.begin() as conn:
        me_id = await _resolve_target(conn, email, user_id)

        # Build the requested number of fake friends (deterministic emails).
        friends: list[tuple[uuid.UUID, int]] = []  # (id, recency minutes)
        for i in range(n_friends):
            first, last = NAME_POOL[i % len(NAME_POOL)]
            suffix = "" if i < len(NAME_POOL) else str(i // len(NAME_POOL) + 1)
            email_addr = f"{first.lower()}.{last.lower()}{suffix}@{SEED_DOMAIN}"
            fid = await _ensure_friend(conn, first, f"{last}{suffix}", email_addr)
            friends.append((fid, RECENCY_MINUTES[i % len(RECENCY_MINUTES)]))
        friend_ids = [fid for fid, _ in friends]
        print(f"ensured {len(friend_ids)} fake friends")

        await _clear_activity(conn, friend_ids)

        await conn.execute(
            text(
                """
                insert into public.connections (first_id, second_id, status)
                values (:me, :fid, 'accepted')
                on conflict (first_id, second_id)
                    do update set status = 'accepted'
                """
            ),
            [{"me": me_id, "fid": fid} for fid in friend_ids],
        )

        news_ids, analysis_ids = await _story_pool(conn, news_limit, analysis_limit)
        if not news_ids and not analysis_ids:
            raise SystemExit("no stories to seed activity against")

        now = datetime.now(UTC)

        # Build all rows first, then bulk-insert (one round-trip per table) so
        # the script stays fast against a remote database.
        status_rows: list[dict[str, object]] = []
        comment_rows: list[dict[str, object]] = []

        for fid, minutes in friends:
            latest = now - timedelta(minutes=minutes)

            # Reads: a spread of news (drives event engagement) + some analysis.
            read_news = rng.sample(news_ids, k=min(12, len(news_ids)))
            read_analysis = rng.sample(analysis_ids, k=min(6, len(analysis_ids)))
            statuses: dict[uuid.UUID, datetime] = {}
            for idx, sid in enumerate([*read_news, *read_analysis]):
                # First item is the most-recent read; others spread into the past.
                ts = (
                    latest
                    if idx == 0
                    else latest - timedelta(minutes=rng.randint(30, 4_320))
                )
                statuses[sid] = ts
                status_rows.append({"uid": fid, "sid": sid, "ts": ts})

            # Comments on both news and analysis stories.
            commentable = [*read_news, *read_analysis] or [*news_ids, *analysis_ids]
            for _ in range(rng.randint(2, 4)):
                comment_rows.append(
                    {
                        "sid": rng.choice(commentable),
                        "uid": fid,
                        "text": rng.choice(COMMENT_TEXTS),
                        "ts": latest - timedelta(minutes=rng.randint(5, 2_880)),
                    }
                )

        if status_rows:
            await conn.execute(
                text(
                    """
                    insert into public.story_statuses
                        (user_id, story_id, read, read_at, created_at, updated_at)
                    values (:uid, :sid, true, :ts, :ts, :ts)
                    on conflict (user_id, story_id) do update
                        set read = true,
                            read_at = coalesce(
                                public.story_statuses.read_at, excluded.read_at
                            ),
                            updated_at = greatest(
                                public.story_statuses.updated_at,
                                excluded.updated_at
                            )
                    """
                ),
                status_rows,
            )
        if comment_rows:
            await conn.execute(
                text(
                    """
                    insert into public.comments
                        (story_id, user_id, text, created_at, updated_at)
                    values (:sid, :uid, :text, :ts, :ts)
                    """
                ),
                comment_rows,
            )

        print(
            f"seeded {len(status_rows)} reads, "
            f"{len(comment_rows)} comments across {len(friend_ids)} friends "
            f"for target {me_id}"
        )

    await dispose_engine()
    print("done.")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user-email", default=None, help="Target account email.")
    parser.add_argument("--user-id", default=None, help="Target account UUID.")
    parser.add_argument(
        "--friends", type=int, default=6, help="Number of fake friends (default 6)."
    )
    parser.add_argument(
        "--seed", type=int, default=42, help="RNG seed for reproducible output."
    )
    parser.add_argument(
        "--news-limit",
        type=int,
        default=80,
        help="How many recent news stories to draw activity from.",
    )
    parser.add_argument(
        "--analysis-limit",
        type=int,
        default=40,
        help="How many recent analysis stories to draw activity from.",
    )
    parser.add_argument(
        "--list-users",
        action="store_true",
        help="Print candidate target accounts and exit.",
    )
    parser.add_argument(
        "--clear",
        action="store_true",
        help="Remove all fake-friend activity + connections and exit.",
    )
    return parser.parse_args()


async def _amain() -> None:
    args = _parse_args()

    if args.list_users:
        engine = get_engine()
        async with engine.begin() as conn:
            await _list_users(conn)
        await dispose_engine()
        return

    if args.clear:
        await _run_clear()
        return

    if args.friends < 1:
        raise SystemExit("--friends must be >= 1")

    await _run_seed(
        email=args.user_email,
        user_id=args.user_id,
        n_friends=args.friends,
        seed=args.seed,
        news_limit=args.news_limit,
        analysis_limit=args.analysis_limit,
    )


if __name__ == "__main__":
    asyncio.run(_amain())
