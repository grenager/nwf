"""Resolve the source attribution (name + logo) shown for a story.

Attribution priority:

1. A curated :class:`Source` whose homepage host matches the article host — a
   genuine publisher we scrape directly (gives us a name *and* a logo).
2. The OpenGraph/Substack-derived ``publisher`` label stored on the story
   (e.g. ``"Derek Thompson on Substack"``), used when no curated source matches
   or when the linked source is an aggregator (e.g. Hacker News linking out).
3. The bare article host as a last resort.
"""

from __future__ import annotations

from core.enrich import hosts_match, registrable_host


def resolve_attribution(
    *,
    article_url: str,
    source_name: str | None,
    source_homepage_url: str | None,
    source_image_url: str | None,
    publisher: str | None,
) -> tuple[str | None, str | None]:
    """Return ``(display_name, logo_url)`` for a story's source attribution."""
    article_host = registrable_host(article_url)
    if source_name and hosts_match(article_host, registrable_host(source_homepage_url)):
        return source_name, source_image_url
    if publisher:
        return publisher, None
    return article_host, None
