"""Dev utility: apply supabase/migrations/*.sql (and optional seed.sql) to the
database in DATABASE_URL, without needing Docker or the Supabase CLI.

Usage:
    python scripts/apply_migrations.py [--seed]

Intended for local testing against a hosted Supabase project. Production schema
changes should go through the Supabase migration tooling.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import asyncpg

from core.config import get_settings

REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = REPO_ROOT / "supabase" / "migrations"
SEED_FILE = REPO_ROOT / "supabase" / "seed.sql"


def _asyncpg_dsn() -> str:
    """Strip the SQLAlchemy '+asyncpg' driver suffix for a raw asyncpg DSN."""
    return get_settings().database_url.replace("postgresql+asyncpg://", "postgresql://")


async def _apply(conn: asyncpg.Connection, path: Path) -> None:
    sql = path.read_text(encoding="utf-8")
    print(f"--> applying {path.name} ({len(sql)} bytes)")
    await conn.execute(sql)
    print(f"    ok: {path.name}")


async def main(with_seed: bool) -> None:
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not files:
        print(f"no migrations found in {MIGRATIONS_DIR}", file=sys.stderr)
        raise SystemExit(1)

    conn = await asyncpg.connect(_asyncpg_dsn(), timeout=30)
    try:
        for path in files:
            await _apply(conn, path)
        if with_seed and SEED_FILE.exists():
            await _apply(conn, SEED_FILE)
    finally:
        await conn.close()
    print("done.")


if __name__ == "__main__":
    asyncio.run(main(with_seed="--seed" in sys.argv))
