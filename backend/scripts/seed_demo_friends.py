"""Seed demo user accounts, friend connections, and fake activity.

Creates auth.users rows (the on_auth_user_created trigger backfills profiles),
sets profile names/phones, connects the current account to a handful of
friends, and gives those friends realistic reads / comments so the
Today engagement summaries and Friends sidebar can be tested end-to-end.

Idempotent: re-running clears the seeded friends' activity first and upserts
accounts by email.

Run:  python -m scripts.seed_demo_friends
"""

from __future__ import annotations

import asyncio
import json
import random
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from core.db import dispose_engine, get_engine

# The currently signed-in account (grenager@gmail.com == Trond, admin).
ME_ID = uuid.UUID("6c577d24-f7cf-4d3d-96b9-ecd708489271")

# (first, last, email, phone|None) — the phone_4159028648 Trond entry is the
# current account and is represented by ME_ID, so it is intentionally omitted.
USERS: list[tuple[str, str, str, str | None]] = [
    ("Dan", "Bree", "phone_4158062733@temp.placeholder", "+14158062733"),
    ("Reed", "Grenager", "reedgrenager@gmail.com", None),
    ("Shalom", "Ormsby", "shalomormsby@gmail.com", None),
    ("John", "Neely", "jhneely@mac.com", None),
    ("rockeot", "rocketo", "gahcia@givememail.club", None),
    ("Nima", "Ila", "nimaila@proton.me", None),
    ("Brad", "Brooks", "ninthart@gmail.com", None),
    ("YC", "H", "dodoche@yopmail.com", None),
    ("Ghastly", "Jack", "sullyatt@gmail.com", None),
    ("Ed", "Colloton", "ed@bvp.com", None),
    ("Viacheslav", "Varenia", "auditor.ua@gmail.com", None),
    ("Joel", "Scott", "joeldscott@gmail.com", None),
    ("Heather", "Hughes", "heatherehughes@gmail.com", "+15103934698"),
    ("Ben", "Wen", "phone_6176996014@temp.placeholder", "+16176996014"),
    ("shalom", "ormsby", "phone_4153023183@temp.placeholder", "+14153023183"),
    ("Jasper", "Grenager", "phone_4157204580@temp.placeholder", "+14157204580"),
    ("Jasper", "Grenager", "jaspergrenager@gmail.com", None),
    ("Paul", "Echaniz", "phone_6462218072@temp.placeholder", "+16462218072"),
    ("Ben", "Wen", "benwen@benwen.com", None),
    ("Nils", "Cunningham", "nilscunningham@icloud.com", None),
]

# Friends to connect to me, mapped to "minutes since last activity" so the
# sidebar shows a spread of online / recent / older buckets.
FRIENDS_RECENCY: dict[str, int] = {
    "phone_6176996014@temp.placeholder": 1,      # Ben — online
    "heatherehughes@gmail.com": 3,               # Heather — online
    "phone_4158062733@temp.placeholder": 25,     # Dan — last hour
    "reedgrenager@gmail.com": 300,               # Reed — ~5h ago
    "jhneely@mac.com": 1200,                     # John Neely — ~20h ago
    "jaspergrenager@gmail.com": 4320,            # Jasper — ~3d ago
}

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
]


async def _ensure_user(
    conn: AsyncConnection, first: str, last: str, email: str, phone: str | None
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
                "app_meta": json.dumps(
                    {"provider": "email", "providers": ["email"]}
                ),
                "user_meta": json.dumps({"first": first, "last": last}),
            },
        )

    # Trigger may have created the profile; upsert names/phone explicitly.
    await conn.execute(
        text(
            """
            insert into public.profiles (id, first, last, phone)
            values (:id, :first, :last, :phone)
            on conflict (id) do update
                set first = excluded.first,
                    last = excluded.last,
                    phone = coalesce(excluded.phone, public.profiles.phone)
            """
        ),
        {"id": uid, "first": first, "last": last, "phone": phone},
    )
    return uid


async def main() -> None:
    rng = random.Random(42)
    engine = get_engine()
    async with engine.begin() as conn:
        # Name the current account.
        await conn.execute(
            text(
                """
                update public.profiles
                set first = 'Trond', last = 'Grenager',
                    phone = coalesce(phone, '+14159028648')
                where id = :id
                """
            ),
            {"id": ME_ID},
        )

        email_to_id: dict[str, uuid.UUID] = {}
        for first, last, email, phone in USERS:
            uid = await _ensure_user(conn, first, last, email, phone)
            email_to_id[email] = uid
        print(f"ensured {len(email_to_id)} accounts")

        friend_ids: list[uuid.UUID] = [
            email_to_id[e] for e in FRIENDS_RECENCY if e in email_to_id
        ]

        # Fresh start for seeded friends' activity (keeps re-runs idempotent).
        await conn.execute(
            text("delete from public.comments where user_id = any(:ids)"),
            {"ids": friend_ids},
        )
        await conn.execute(
            text("delete from public.story_statuses where user_id = any(:ids)"),
            {"ids": friend_ids},
        )

        # Connect me to each friend (accepted).
        for connect_id in friend_ids:
            await conn.execute(
                text(
                    """
                    insert into public.connections (first_id, second_id, status)
                    values (:me, :fid, 'accepted')
                    on conflict (first_id, second_id) do update set status = 'accepted'
                    """
                ),
                {"me": ME_ID, "fid": connect_id},
            )
        print(f"connected {len(friend_ids)} friends")

        # Pool of stories to attribute activity to.
        news = (
            await conn.execute(
                text(
                    """
                    select s.id, src.name
                    from public.stories s
                    join public.sources src on src.id = s.source_id
                    where s.kind = 'news'
                    order by s.created_at desc
                    limit 80
                    """
                )
            )
        ).all()
        analysis = (
            await conn.execute(
                text(
                    """
                    select s.id
                    from public.stories s
                    where s.kind = 'analysis'
                    order by s.created_at desc
                    limit 40
                    """
                )
            )
        ).all()
        news_ids: list[uuid.UUID] = [r[0] for r in news]
        analysis_ids: list[uuid.UUID] = [r[0] for r in analysis]
        if not news_ids:
            raise SystemExit("no news stories to seed activity against")

        now = datetime.now(UTC)
        total_reads = total_comments = 0

        for email, minutes in FRIENDS_RECENCY.items():
            fid = email_to_id.get(email)
            if fid is None:
                continue
            latest = now - timedelta(minutes=minutes)

            # Most-recent activity is a NEWS read (drives last_source + online).
            lead_story: uuid.UUID = rng.choice(news_ids)
            statuses: dict[uuid.UUID, datetime] = {lead_story: latest}

            # Additional reads spread earlier in time.
            extra = rng.sample(news_ids, k=min(12, len(news_ids))) + rng.sample(
                analysis_ids, k=min(5, len(analysis_ids))
            )
            for sid in extra:
                if sid in statuses:
                    continue
                statuses[sid] = latest - timedelta(minutes=rng.randint(30, 4320))

            for sid, ts in statuses.items():
                await conn.execute(
                    text(
                        """
                        insert into public.story_statuses
                            (user_id, story_id, read, created_at, updated_at)
                        values (:uid, :sid, true, :ts, :ts)
                        on conflict (user_id, story_id) do update
                            set read = true,
                                updated_at = greatest(
                                    public.story_statuses.updated_at, excluded.updated_at
                                )
                        """
                    ),
                    {"uid": fid, "sid": sid, "ts": ts},
                )
            total_reads += len(statuses)

            # A couple of comments, slightly before their latest activity.
            for _ in range(rng.randint(2, 4)):
                sid = rng.choice(news_ids)
                cts = latest - timedelta(minutes=rng.randint(5, 2880))
                await conn.execute(
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
                        "text": rng.choice(COMMENT_TEXTS),
                        "ts": cts,
                    },
                )
                total_comments += 1

        print(
            f"seeded activity: {total_reads} reads, "
            f"{total_comments} comments across {len(friend_ids)} friends"
        )

    await dispose_engine()
    print("done.")


if __name__ == "__main__":
    asyncio.run(main())
