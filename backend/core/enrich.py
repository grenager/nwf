"""Best-effort enrichment of a user-submitted article URL.

Given a bare URL (e.g. pasted into the share composer), we try to recover a
human headline, description, hero image, and publisher name by fetching the
page and parsing its OpenGraph / Twitter-card / ``<title>`` metadata. This is
intentionally dependency-free (regex over the HTML ``<head>``) so it stays
cheap and never blocks posting when a site is slow or unparseable.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

from core.config import get_settings
from core.logging import get_logger

log = get_logger("core.enrich")

_META_TAG_RE: re.Pattern[str] = re.compile(r"<meta\b[^>]*>", re.IGNORECASE)
_ATTR_RE: re.Pattern[str] = re.compile(
    r"""(\w[\w:-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))""",
    re.IGNORECASE,
)
_TITLE_RE: re.Pattern[str] = re.compile(
    r"<title\b[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL
)
_CANONICAL_RE: re.Pattern[str] = re.compile(
    r"<link\b[^>]*\brel=[\"']canonical[\"'][^>]*>", re.IGNORECASE
)


@dataclass(frozen=True)
class UrlMetadata:
    """Publisher/article metadata recovered from a page's ``<head>``."""

    title: str | None = None
    description: str | None = None
    image_url: str | None = None
    site_name: str | None = None
    canonical_url: str | None = None

    @property
    def is_empty(self) -> bool:
        return not any(
            (
                self.title,
                self.description,
                self.image_url,
                self.site_name,
                self.canonical_url,
            )
        )


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = html.unescape(value).strip()
    return stripped or None


def _tag_attrs(tag: str) -> dict[str, str]:
    attrs: dict[str, str] = {}
    for match in _ATTR_RE.finditer(tag):
        key = match.group(1).lower()
        value = match.group(3) or match.group(4) or match.group(5) or ""
        attrs[key] = value
    return attrs


def parse_html_metadata(page_html: str) -> UrlMetadata:
    """Extract OpenGraph/Twitter/title metadata from raw HTML (best-effort)."""
    og: dict[str, str] = {}
    twitter: dict[str, str] = {}
    for tag in _META_TAG_RE.findall(page_html):
        attrs = _tag_attrs(tag)
        content = _clean(attrs.get("content"))
        if not content:
            continue
        prop = (attrs.get("property") or attrs.get("name") or "").lower()
        if prop.startswith("og:"):
            og.setdefault(prop, content)
        elif prop.startswith("twitter:"):
            twitter.setdefault(prop, content)

    title = og.get("og:title") or twitter.get("twitter:title")
    if title is None:
        match = _TITLE_RE.search(page_html)
        title = _clean(match.group(1)) if match else None

    description = og.get("og:description") or twitter.get("twitter:description")
    image_url = og.get("og:image") or twitter.get("twitter:image")
    site_name = og.get("og:site_name")

    canonical_url: str | None = None
    canonical_match = _CANONICAL_RE.search(page_html)
    if canonical_match:
        canonical_url = _clean(_tag_attrs(canonical_match.group(0)).get("href"))

    return UrlMetadata(
        title=title,
        description=description,
        image_url=image_url,
        site_name=site_name,
        canonical_url=canonical_url,
    )


async def fetch_url_metadata(url: str) -> UrlMetadata:
    """Fetch a URL and parse its head metadata; never raises on failure."""
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return UrlMetadata()
    settings = get_settings()
    try:
        async with httpx.AsyncClient(
            timeout=settings.scrape_http_timeout_seconds,
            follow_redirects=True,
            headers={
                "User-Agent": (
                    "NewsWithFriends/0.1 (+https://newswithfriends.app)"
                ),
                "Accept": "text/html,application/xhtml+xml",
            },
        ) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "")
            if "html" not in content_type.lower():
                return UrlMetadata()
            return parse_html_metadata(resp.text)
    except (httpx.HTTPError, ValueError) as exc:
        log.info("enrich.fetch_failed", url=url, error=str(exc))
        return UrlMetadata()


def registrable_host(url: str | None) -> str | None:
    """Lowercased host with a leading ``www.`` stripped, or ``None``."""
    if not url:
        return None
    host = urlparse(url).hostname
    if not host:
        return None
    host = host.lower()
    return host[4:] if host.startswith("www.") else host


def hosts_match(story_host: str | None, source_host: str | None) -> bool:
    """True when two hosts belong to the same site (suffix match)."""
    if not story_host or not source_host:
        return False
    if story_host == source_host:
        return True
    return story_host.endswith("." + source_host) or source_host.endswith(
        "." + story_host
    )
