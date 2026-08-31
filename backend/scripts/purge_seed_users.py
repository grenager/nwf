"""Permanently delete every seed.test fake account, full stop.

Every seed script in this repo (``seed_demo_friends``, ``seed_fake_activity``,
``seed_fof_test``) creates fake accounts under the reserved ``seed.test``
email domain. This deletes those accounts outright -- not just their
activity or connections, the accounts themselves -- so nothing is left
hanging around after a test session.

This relies on the database's own cascade-delete rules rather than
enumerating tables by hand: every table referencing ``profiles.id`` is
``on delete cascade``, and ``profiles.id`` itself cascades from
``auth.users.id``. So deleting the ``auth.users`` row takes everything with
it (posts, comments, reactions, connections, notifications, ...) and stays
correct even as new tables get added later.

Defaults to a dry run -- it lists what it would delete and does nothing
until you pass ``--yes``.

Run (from the ``backend`` directory):

    python -m scripts.purge_seed_users            # list accounts, delete nothing
    python -m scripts.purge_seed_users --yes       # actually delete them
"""

from __future__ import annotations

import argparse
import asyncio
import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from core.db import dispose_engine, get_engine

SEED_DOMAIN: str = "seed.test"


async def _seed_accounts(conn: AsyncConnection) -> list[tuple[uuid.UUID, str]]:
    rows = (
        await conn.execute(
            text(
                """
                select u.id, u.email
                from auth.users u
                where u.email ilike :pattern
                order by u.email
                """
            ),
            {"pattern": f"%@{SEED_DOMAIN}"},
        )
    ).all()
    return [(r[0], r[1]) for r in rows]


async def _run(confirm: bool) -> None:
    engine = get_engine()
    async with engine.begin() as conn:
        accounts = await _seed_accounts(conn)
        if not accounts:
            print(f"no accounts found under @{SEED_DOMAIN}")
            await dispose_engine()
            return

        print(f"{len(accounts)} seed.test account(s):")
        for uid, email in accounts:
            print(f"  {uid}  {email}")

        if not confirm:
            print("\nDry run -- nothing deleted. Re-run with --yes to delete these.")
            await dispose_engine()
            return

        ids = [uid for uid, _email in accounts]
        # Cascades through profiles and every table that references it.
        await conn.execute(
            text("delete from auth.users where id = any(:ids)"), {"ids": ids}
        )
        print(f"\ndeleted {len(accounts)} account(s) and everything tied to them.")

    await dispose_engine()
    print("done.")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Actually delete (default is a dry run that only lists accounts).",
    )
    return parser.parse_args()


async def _amain() -> None:
    args = _parse_args()
    await _run(confirm=args.yes)


if __name__ == "__main__":
    asyncio.run(_amain())
