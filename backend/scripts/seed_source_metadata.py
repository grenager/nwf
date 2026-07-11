"""Seed sources.kind and bias_score for the catalog.

Run after import_sources.py:
    python scripts/seed_source_metadata.py
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import asyncpg

from core.config import get_settings

REPO_ROOT = Path(__file__).resolve().parents[2]

# Outlets: newspapers, broadcasters, wire services, investigative outlets.
OUTLET_NAMES: frozenset[str] = frozenset(
    {
        "404 Media",
        "Ars Technica",
        "Axios",
        "BBC",
        "Boing Boing",
        "Boston Globe",
        "Business Insider",
        "Chicago Sun-Times",
        "Citation Needed",
        "Deadline",
        "Electrek",
        "Hacker News",
        "LA Times",
        "MGOBLOG",
        "MLB Trade Rumors",
        "Marin Independent Journal",
        "Mother Jones",
        "National Public Radio",
        "Popular Information",
        "Press Watch",
        "Quartz",
        "SF Standard",
        "Straight Arrow News",
        "TechCrunch",
        "TechDirt",
        "The Atlantic",
        "The Financial Times",
        "The Guardian",
        "The New York Times",
        "The New Yorker",
        "The Onion",
        "VentureBeat",
        "Wall Street Journal",
        "Wired",
        "Wolf Street",
    }
)

# AllSides-style bias: -2 (left) .. +2 (right). None = unknown/neutral blog.
BIAS_BY_NAME: dict[str, float] = {
    "BBC": -0.5,
    "National Public Radio": -0.5,
    "The New York Times": -0.5,
    "The Guardian": -1.5,
    "The Atlantic": -0.5,
    "Mother Jones": -2.0,
    "Wall Street Journal": 1.0,
    "Axios": 0.0,
    "LA Times": -0.5,
    "Chicago Sun-Times": -0.5,
    "Boston Globe": -0.5,
    "Wired": -0.5,
    "TechCrunch": 0.0,
    "Business Insider": 0.0,
    "The Financial Times": 0.0,
    "Straight Arrow News": 0.5,
    "SF Standard": -0.5,
    "404 Media": -0.5,
    "Ars Technica": 0.0,
    "TechDirt": -0.5,
    "Boing Boing": -0.5,
    "The New Yorker": -1.0,
    "Quartz": 0.0,
    "Marin Independent Journal": -0.5,
}


# Editorial prominence (readership/reach), 0..100. Higher = shown first in
# cross-outlet coverage. National wires/papers at the top, local outlets low.
PROMINENCE_BY_NAME: dict[str, int] = {
    "The New York Times": 100,
    "Wall Street Journal": 96,
    "BBC": 92,
    "The Guardian": 86,
    "National Public Radio": 84,
    "The Financial Times": 80,
    "The Atlantic": 74,
    "Axios": 72,
    "The New Yorker": 70,
    "Business Insider": 64,
    "LA Times": 66,
    "Boston Globe": 62,
    "Wired": 60,
    "TechCrunch": 54,
    "Ars Technica": 52,
    "Mother Jones": 50,
    "Hacker News": 48,
    "Quartz": 44,
    "404 Media": 42,
    "Chicago Sun-Times": 44,
    "VentureBeat": 40,
    "Deadline": 40,
    "SF Standard": 38,
    "TechDirt": 36,
    "Straight Arrow News": 34,
    "Boing Boing": 30,
    "Popular Information": 30,
    "The Onion": 28,
    "Wolf Street": 26,
    "Electrek": 26,
    "Press Watch": 22,
    "Citation Needed": 20,
    "MLB Trade Rumors": 18,
    "Marin Independent Journal": 14,
    "MGOBLOG": 12,
}


def _asyncpg_dsn() -> str:
    return get_settings().database_url.replace("postgresql+asyncpg://", "postgresql://")


async def main() -> None:
    conn = await asyncpg.connect(_asyncpg_dsn(), timeout=30)
    try:
        rows = await conn.fetch("select id, name from public.sources order by name")
        updated = 0
        for row in rows:
            name: str = row["name"]
            kind = "outlet" if name in OUTLET_NAMES else "author"
            bias = BIAS_BY_NAME.get(name)
            prominence = PROMINENCE_BY_NAME.get(name, 0)
            await conn.execute(
                """
                update public.sources
                set kind = $1::source_kind,
                    bias_score = coalesce($2, bias_score),
                    prominence = $3
                where id = $4
                """,
                kind,
                bias,
                prominence,
                row["id"],
            )
            updated += 1
        print(f"updated kind/bias for {updated} sources")
        counts = await conn.fetch(
            "select kind, count(*) as n from public.sources group by kind order by kind"
        )
        for c in counts:
            print(f"  {c['kind']}: {c['n']}")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
