"""Seed a friend-of-friend (FOF) visibility test scenario.

Building this by hand means juggling three separate logged-in accounts (you,
a "connector" friend, and a "stranger" neither of you is connected to). This
script does it in one shot against the database directly:

  - a "stranger" account, connected to nobody, who posts four different
    articles (one existing story each)
  - a "connector" account, an accepted friend of the target account, who
    engages with each of the stranger's posts a different way: commenting,
    reacting, rating, and marking read
  - a fifth post from the stranger that nobody touches, as a negative
    control -- it should NOT show up in the target account's feed

After seeding, reload the target account's feed: the four engaged-with posts
should appear, each tagged with the connector's name and the matching
action ("<connector> commented on this" / "rated this" / "reacted to this" /
"read this"), and the fifth (untouched) post should not appear at all.

Fake accounts live under the reserved ``seed.test`` domain, same convention
as ``seed_fake_activity.py``, so they're easy to spot and this script is
fully idempotent: each run clears its own prior FOF test data first.

Examples::

    # List candidate target accounts (id + email) to choose from.
    python -m scripts.seed_fof_test --list-users

    # Seed the FOF scenario for a given account.
    python -m scripts.seed_fof_test --user-email me@example.com

    # Remove all seeded FOF test data (accounts, posts, connections,
    # comments/reactions/ratings/statuses) and exit.
    python -m scripts.seed_fof_test --clear

Run from the ``backend`` directory (so ``core``/``scripts`` are importable).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from core.db import dispose_engine, get_engine

# Reserved domain (shared with seed_fake_activity.py) marking a script-
# generated fake account; a distinct local-part namespaces this script's own
# accounts so seed_fake_activity.py --clear doesn't collide with them.
SEED_DOMAIN: str = "seed.test"
STRANGER_EMAIL: str = "fof.stranger@seed.test"
CONNECTOR_EMAIL: str = "fof.connector@seed.test"

ACTIONS: list[str] = ["commented", "reacted", "rated", "read"]

# Matches FOF_ACTION_LABEL in web/components/post-card.tsx - what the
# attribution tag should read for each action.
ACTION_LABEL: dict[str, str] = {
    "commented": "commented on this",
    "rated": "rated this",
    "reacted": "reacted to this",
    "read": "read this",
}


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
                text("select id from auth.users where id = :id"), {"id": user_id}
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

    rows = (
        await conn.execute(
            text(
                "select id from auth.users where coalesce(email, '') not like :seed"
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


async def _ensure_fake_user(
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
            on conflict (id) do update set first = excluded.first, last = excluded.last
            """
        ),
        {"id": uid, "first": first, "last": last},
    )
    return uid


async def _clear_seeded(conn: AsyncConnection) -> None:
    rows = (
        await conn.execute(
            text("select id from auth.users where lower(email) in (:s, :c)"),
            {"s": STRANGER_EMAIL, "c": CONNECTOR_EMAIL},
        )
    ).all()
    ids: list[uuid.UUID] = [r[0] for r in rows]
    if not ids:
        print("nothing to clear")
        return
    # Posts cascade-delete their comments/reactions/participants/attachments.
    await conn.execute(
        text("delete from public.posts where author_id = any(:ids)"), {"ids": ids}
    )
    await conn.execute(
        text("delete from public.comments where user_id = any(:ids)"), {"ids": ids}
    )
    await conn.execute(
        text("delete from public.story_statuses where user_id = any(:ids)"),
        {"ids": ids},
    )
    await conn.execute(
        text("delete from public.story_ratings where user_id = any(:ids)"),
        {"ids": ids},
    )
    await conn.execute(
        text(
            "delete from public.connections where first_id = any(:ids) "
            "or second_id = any(:ids)"
        ),
        {"ids": ids},
    )
    print(f"cleared seeded FOF test data for {len(ids)} accounts")


async def _run_clear() -> None:
    engine = get_engine()
    async with engine.begin() as conn:
        await _clear_seeded(conn)
    await dispose_engine()
    print("done.")


async def _run_seed(email: str | None, user_id: str | None) -> None:
    engine = get_engine()
    async with engine.begin() as conn:
        me_id = await _resolve_target(conn, email, user_id)
        await _clear_seeded(conn)

        stranger_id = await _ensure_fake_user(conn, "Fof", "Stranger", STRANGER_EMAIL)
        connector_id = await _ensure_fake_user(
            conn, "Fof", "Connector", CONNECTOR_EMAIL
        )

        # Connector is a direct friend of the target; stranger is connected
        # to nobody -- the exact shape FOF visibility needs to be exercised.
        await conn.execute(
            text(
                """
                insert into public.connections (first_id, second_id, status)
                values (:me, :connector, 'accepted')
                on conflict (first_id, second_id) do update set status = 'accepted'
                """
            ),
            {"me": me_id, "connector": connector_id},
        )

        story_rows = (
            await conn.execute(
                text(
                    "select id, full_headline from public.stories "
                    "order by created_at desc limit :n"
                ),
                {"n": len(ACTIONS) + 1},
            )
        ).all()
        if len(story_rows) < len(ACTIONS) + 1:
            raise SystemExit(
                f"need at least {len(ACTIONS) + 1} stories in the database to seed "
                "this scenario; scrape/import some first"
            )

        now = datetime.now(UTC)
        posts: list[tuple[uuid.UUID, uuid.UUID, str, str]] = []  # (post, story, action, headline)
        for i, (story_id, headline) in enumerate(story_rows):
            post_id = uuid.uuid4()
            ts = now - timedelta(minutes=5 * i)
            await conn.execute(
                text(
                    """
                    insert into public.posts
                        (id, story_id, author_id, take, last_activity_at,
                         created_at, updated_at)
                    values (:id, :sid, :author, :take, :ts, :ts, :ts)
                    """
                ),
                {
                    "id": post_id,
                    "sid": story_id,
                    "author": stranger_id,
                    "take": "Worth a read.",
                    "ts": ts,
                },
            )
            await conn.execute(
                text(
                    """
                    insert into public.post_participants (post_id, user_id, joined_at)
                    values (:pid, :uid, :ts)
                    on conflict do nothing
                    """
                ),
                {"pid": post_id, "uid": stranger_id, "ts": ts},
            )
            action = ACTIONS[i] if i < len(ACTIONS) else "none (control)"
            posts.append((post_id, story_id, action, headline))

        for post_id, story_id, action, _headline in posts:
            ts = now - timedelta(minutes=1)
            if action == "commented":
                await conn.execute(
                    text(
                        """
                        insert into public.comments
                            (story_id, post_id, user_id, text, created_at, updated_at)
                        values (:sid, :pid, :uid, :text, :ts, :ts)
                        """
                    ),
                    {
                        "sid": story_id,
                        "pid": post_id,
                        "uid": connector_id,
                        "text": "Interesting - hadn't seen this one.",
                        "ts": ts,
                    },
                )
            elif action == "reacted":
                await conn.execute(
                    text(
                        """
                        insert into public.post_reactions
                            (user_id, post_id, reaction, created_at, updated_at)
                        values (:uid, :pid, 'like', :ts, :ts)
                        """
                    ),
                    {"uid": connector_id, "pid": post_id, "ts": ts},
                )
            elif action == "rated":
                await conn.execute(
                    text(
                        """
                        insert into public.story_ratings
                            (user_id, story_id, rating, created_at, updated_at)
                        values (:uid, :sid, 4.5, :ts, :ts)
                        """
                    ),
                    {"uid": connector_id, "sid": story_id, "ts": ts},
                )
            elif action == "read":
                await conn.execute(
                    text(
                        """
                        insert into public.story_statuses
                            (user_id, story_id, read, read_at, created_at, updated_at)
                        values (:uid, :sid, true, :ts, :ts, :ts)
                        """
                    ),
                    {"uid": connector_id, "sid": story_id, "ts": ts},
                )
            # "none (control)": deliberately left untouched.

        print(f"target account: {me_id}")
        print(f"stranger: {stranger_id} ({STRANGER_EMAIL})")
        print(f"connector (target's friend): {connector_id} ({CONNECTOR_EMAIL})")
        print()
        print("posts seeded (all authored by the stranger):")
        for _post_id, _story_id, action, headline in posts:
            if action in ACTION_LABEL:
                tag = f'should appear, tagged "Fof Connector {ACTION_LABEL[action]}"'
            else:
                tag = "should NOT appear in feed"
            print(f"  [{action:16}] {headline[:60]!r} -- {tag}")

    await dispose_engine()
    print("\ndone. Reload the target account's feed to check.")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user-email", default=None, help="Target account email.")
    parser.add_argument("--user-id", default=None, help="Target account UUID.")
    parser.add_argument(
        "--list-users",
        action="store_true",
        help="Print candidate target accounts and exit.",
    )
    parser.add_argument(
        "--clear",
        action="store_true",
        help="Remove all seeded FOF test data and exit.",
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

    await _run_seed(email=args.user_email, user_id=args.user_id)


if __name__ == "__main__":
    asyncio.run(_amain())
