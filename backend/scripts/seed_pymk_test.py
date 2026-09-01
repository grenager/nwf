"""Seed a "people you may know" (PYMK) test scenario.

``GET /connections/recommended`` only suggests someone who is a friend *of
a friend* and not already connected to you in any way. Once you've friended
everyone you know, there is nobody left to suggest and the feed's PYMK strip
correctly renders nothing -- which makes it impossible to look at. This
builds the missing graph shape directly in the database:

  - N "connector" accounts, each an accepted friend of the target account
  - M "candidate" accounts, each an accepted friend of one or more
    connectors but connected to the target account in no way at all

That makes every candidate a friend-of-a-friend, so they show up in the
strip. Candidates are wired to a varying number of connectors so their
mutual-friend counts differ and the ranking (highest mutual count first) is
visible. Half of them get an avatar and half don't, which exercises both the
image and the initials path at the strip's larger avatar size.

Nothing here touches your real friends' accounts: the connectors are fake
accounts too, so the only graph modified is the target's own. They will show
up in the target's friends list and sidebar until cleared.

Fake accounts live under the reserved ``seed.test`` domain, same convention
as ``seed_fake_activity.py`` and ``seed_fof_test.py``, under their own
``pymk.`` local-part namespace so clearing one script's data leaves the
others alone. Each run clears its own prior data first, so it is idempotent.

Examples::

    # List candidate target accounts (id + email) to choose from.
    python -m scripts.seed_pymk_test --list-users

    # Seed the PYMK scenario for a given account.
    python -m scripts.seed_pymk_test --user-email me@example.com

    # More or fewer suggestions (the API returns at most 12).
    python -m scripts.seed_pymk_test --user-email me@example.com \
        --connectors 3 --candidates 8

    # Remove everything this script created and exit.
    python -m scripts.seed_pymk_test --clear

Run from the ``backend`` directory (so ``core``/``scripts`` are importable).
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from core.db import dispose_engine, get_engine

# Reserved domain (shared with the other seed scripts) marking a script-
# generated fake account; the ``pymk.`` prefix namespaces this script's own
# accounts so the other scripts' --clear can't collide with them.
SEED_DOMAIN: str = "seed.test"
EMAIL_PREFIX: str = "pymk."

DEFAULT_CONNECTORS: int = 4
# The API caps recommendations at 12; enough to overflow the strip and make
# the horizontal scroll real.
DEFAULT_CANDIDATES: int = 12

CONNECTOR_NAMES: list[tuple[str, str]] = [
    ("Dana", "Whitfield"),
    ("Marcus", "Iyer"),
    ("Priya", "Okonkwo"),
    ("Tomas", "Lindqvist"),
    ("Rachel", "Amari"),
    ("Nils", "Bergstrom"),
]

CANDIDATE_NAMES: list[tuple[str, str]] = [
    ("Ingrid", "Halvorsen"),
    ("Omar", "Castellanos"),
    ("Wen", "Zhao"),
    ("Beatrice", "Fontaine"),
    ("Kwame", "Asante"),
    ("Saoirse", "Donnelly"),
    ("Yuki", "Tanabe"),
    ("Ravi", "Krishnan"),
    ("Elena", "Vasquez"),
    ("Joachim", "Brenner"),
    ("Amara", "Nwosu"),
    ("Lars", "Pedersen"),
    ("Fatima", "El-Amin"),
    ("Diego", "Moreau"),
    ("Sunniva", "Rekdal"),
    ("Theo", "Marchetti"),
]

AVATAR_COLORS: list[str] = [
    "#0f766e", "#7c2d12", "#3730a3", "#831843",
    "#166534", "#854d0e", "#1e40af", "#701a75",
]


def _avatar_data_uri(color: str, initials: str) -> str:
    """A self-contained avatar image.

    Deliberately a data URI rather than a URL to an avatar service: the point
    is to exercise the ``<img>`` path in the UI, and a card showing a broken
    image because some placeholder host was unreachable would test the
    opposite of what we want.
    """
    svg: str = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">'
        f'<rect width="128" height="128" fill="{color}"/>'
        '<text x="64" y="84" font-family="Helvetica,Arial,sans-serif" '
        'font-size="52" font-weight="bold" fill="#ffffff" '
        f'text-anchor="middle">{initials}</text>'
        "</svg>"
    )
    encoded: str = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return f"data:image/svg+xml;base64,{encoded}"


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
            text("select id from auth.users where coalesce(email, '') not like :seed"),
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
    conn: AsyncConnection,
    first: str,
    last: str,
    email: str,
    image_url: str | None,
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
            insert into public.profiles (id, first, last, image_url)
            values (:id, :first, :last, :image_url)
            on conflict (id) do update set
                first = excluded.first,
                last = excluded.last,
                image_url = excluded.image_url
            """
        ),
        {"id": uid, "first": first, "last": last, "image_url": image_url},
    )
    return uid


async def _befriend(
    conn: AsyncConnection, a: uuid.UUID, b: uuid.UUID
) -> None:
    """Accepted connection between two accounts.

    ``connections`` is unique on (first_id, second_id) without enforcing an
    ordering, and readers check both directions, so one row in a fixed
    orientation is enough.
    """
    await conn.execute(
        text(
            """
            insert into public.connections (first_id, second_id, status)
            values (:a, :b, 'accepted')
            on conflict (first_id, second_id) do update set status = 'accepted'
            """
        ),
        {"a": a, "b": b},
    )


async def _clear_seeded(conn: AsyncConnection) -> int:
    """Delete this script's accounts outright.

    Every table referencing ``profiles.id`` is ``on delete cascade`` and
    ``profiles.id`` cascades from ``auth.users.id``, so removing the
    ``auth.users`` row takes the connections with it -- and stays correct as
    new tables get added. Same approach as ``purge_seed_users.py``.
    """
    rows = (
        await conn.execute(
            text(
                "select id from auth.users where email ilike :pattern"
            ),
            {"pattern": f"{EMAIL_PREFIX}%@{SEED_DOMAIN}"},
        )
    ).all()
    ids: list[uuid.UUID] = [r[0] for r in rows]
    if not ids:
        return 0
    await conn.execute(
        text("delete from auth.users where id = any(:ids)"), {"ids": ids}
    )
    return len(ids)


async def _run_clear() -> None:
    engine = get_engine()
    async with engine.begin() as conn:
        removed: int = await _clear_seeded(conn)
    await dispose_engine()
    if removed == 0:
        print("nothing to clear")
    else:
        print(f"cleared {removed} seeded PYMK account(s) and everything tied to them.")
    print("done.")


async def _run_seed(
    email: str | None, user_id: str | None, connectors: int, candidates: int
) -> None:
    if connectors > len(CONNECTOR_NAMES):
        raise SystemExit(f"--connectors must be at most {len(CONNECTOR_NAMES)}")
    if candidates > len(CANDIDATE_NAMES):
        raise SystemExit(f"--candidates must be at most {len(CANDIDATE_NAMES)}")

    engine = get_engine()
    async with engine.begin() as conn:
        me_id = await _resolve_target(conn, email, user_id)
        await _clear_seeded(conn)

        # Connectors: fake accounts that ARE the target's friends. They are
        # the bridge each suggestion is reached through.
        connector_ids: list[uuid.UUID] = []
        for i in range(connectors):
            first, last = CONNECTOR_NAMES[i]
            cid = await _ensure_fake_user(
                conn,
                first,
                last,
                f"{EMAIL_PREFIX}connector{i + 1}@{SEED_DOMAIN}",
                _avatar_data_uri(
                    AVATAR_COLORS[i % len(AVATAR_COLORS)], first[0] + last[0]
                ),
            )
            await _befriend(conn, me_id, cid)
            connector_ids.append(cid)

        # Candidates: friends of connectors, connected to the target in no
        # way at all -- which is exactly what makes them suggestible.
        seeded: list[tuple[str, int, bool]] = []  # (name, mutuals, has_avatar)
        for i in range(candidates):
            first, last = CANDIDATE_NAMES[i]
            # Cycle the mutual count down from `connectors` so the ranking is
            # easy to eyeball: the highest counts must sort to the front.
            mutuals: int = connectors - (i % connectors)
            has_avatar: bool = i % 2 == 0
            cand_id = await _ensure_fake_user(
                conn,
                first,
                last,
                f"{EMAIL_PREFIX}candidate{i + 1}@{SEED_DOMAIN}",
                _avatar_data_uri(
                    AVATAR_COLORS[i % len(AVATAR_COLORS)], first[0] + last[0]
                )
                if has_avatar
                else None,
            )
            for connector_id in connector_ids[:mutuals]:
                await _befriend(conn, connector_id, cand_id)
            seeded.append((f"{first} {last}", mutuals, has_avatar))

        print(f"target account: {me_id}")
        print(f"connectors (now the target's friends): {connectors}")
        print(f"candidates (should appear as suggestions): {candidates}")
        print()
        print("expected in the strip, highest mutual count first:")
        for name, mutuals, has_avatar in sorted(
            seeded, key=lambda s: -s[1]
        ):
            avatar = "avatar" if has_avatar else "initials"
            print(f"  {name:24} {mutuals} mutual  ({avatar})")

    await dispose_engine()
    print(
        "\ndone. Reload the target account's feed -- the strip sits after the "
        "third post, or at the top if the feed is shorter."
    )
    print("Clean up with: python -m scripts.seed_pymk_test --clear")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user-email", default=None, help="Target account email.")
    parser.add_argument("--user-id", default=None, help="Target account UUID.")
    parser.add_argument(
        "--connectors",
        type=int,
        default=DEFAULT_CONNECTORS,
        help=f"Fake friends to bridge through (default {DEFAULT_CONNECTORS}).",
    )
    parser.add_argument(
        "--candidates",
        type=int,
        default=DEFAULT_CANDIDATES,
        help=f"Suggestions to create (default {DEFAULT_CANDIDATES}).",
    )
    parser.add_argument(
        "--list-users",
        action="store_true",
        help="Print candidate target accounts and exit.",
    )
    parser.add_argument(
        "--clear",
        action="store_true",
        help="Remove everything this script created and exit.",
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

    if args.connectors < 1 or args.candidates < 1:
        raise SystemExit("--connectors and --candidates must both be at least 1")

    await _run_seed(
        email=args.user_email,
        user_id=args.user_id,
        connectors=args.connectors,
        candidates=args.candidates,
    )


if __name__ == "__main__":
    asyncio.run(_amain())
