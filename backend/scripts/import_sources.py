"""Import a source catalog into the ``sources`` table.

Reads a JSON file in the legacy Mongoose export format (camelCase keys) and
upserts rows on ``homepage_url``. Idempotent: re-running updates existing rows.

``last_scraped_at`` is intentionally left untouched (NULL for new rows) so the
scraper picks freshly-imported sources first (oldest-first selection).

Usage:
    python scripts/import_sources.py [path/to/sources.json]

Defaults to ``<repo>/data/sources.json``.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Any

import asyncpg

from core.config import get_settings

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_JSON = REPO_ROOT / "data" / "sources.json"

_NULLISH = {None, "", "undefined", "null"}


def _asyncpg_dsn() -> str:
    return get_settings().database_url.replace("postgresql+asyncpg://", "postgresql://")


def _clean(value: Any) -> str | None:
    """Normalize legacy placeholder strings to NULL."""
    if isinstance(value, str):
        value = value.strip()
    return None if value in _NULLISH else value


def _bias(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _map(record: dict[str, Any]) -> dict[str, Any] | None:
    homepage_url = _clean(record.get("homepageUrl"))
    name = _clean(record.get("name"))
    if not homepage_url or not name:
        return None
    tags = record.get("tags") or []
    if not isinstance(tags, list):
        tags = []
    return {
        "name": name,
        "homepage_url": homepage_url,
        "rss_url": _clean(record.get("rssUrl")),
        "include_selector": _clean(record.get("includeSelector")),
        "exclude_selector": _clean(record.get("excludeSelector")),
        "bias_score": _bias(record.get("biasScore")),
        "tags": [str(t) for t in tags],
        "image_url": _clean(record.get("imageUrl")),
        "has_paywall": bool(record.get("hasPaywall", False)),
    }


UPSERT = """
insert into public.sources
    (name, homepage_url, rss_url, include_selector, exclude_selector,
     bias_score, tags, image_url, has_paywall)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
on conflict (homepage_url) do update set
    name = excluded.name,
    rss_url = excluded.rss_url,
    include_selector = excluded.include_selector,
    exclude_selector = excluded.exclude_selector,
    bias_score = excluded.bias_score,
    tags = excluded.tags,
    image_url = excluded.image_url,
    has_paywall = excluded.has_paywall,
    updated_at = now()
returning (xmax = 0) as inserted
"""


async def main(json_path: Path) -> None:
    raw = json.loads(json_path.read_text(encoding="utf-8"))
    mapped = [m for m in (_map(r) for r in raw) if m is not None]
    print(f"loaded {len(raw)} records -> {len(mapped)} valid sources from {json_path.name}")

    conn = await asyncpg.connect(_asyncpg_dsn(), timeout=30)
    inserted = updated = 0
    try:
        for src in mapped:
            was_inserted = await conn.fetchval(
                UPSERT,
                src["name"],
                src["homepage_url"],
                src["rss_url"],
                src["include_selector"],
                src["exclude_selector"],
                src["bias_score"],
                src["tags"],
                src["image_url"],
                src["has_paywall"],
            )
            if was_inserted:
                inserted += 1
            else:
                updated += 1
        total = await conn.fetchval("select count(*) from public.sources")
    finally:
        await conn.close()

    print(f"inserted={inserted} updated={updated}; sources table now has {total} rows")


if __name__ == "__main__":
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_JSON
    asyncio.run(main(path))
