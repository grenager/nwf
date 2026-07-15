"""Best-effort enrichment of a user-submitted article URL.

Given a bare URL (e.g. pasted into the share composer), we try to recover a
human headline, description, hero image, and publisher name by fetching the
page and parsing its OpenGraph / Twitter-card / ``<title>`` metadata. This is
intentionally dependency-free (regex over the HTML ``<head>``) so it stays
cheap and never blocks posting when a site is slow or unparseable.
"""

from __future__ import annotations

import html
import json
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
    author: str | None = None
    platform: str | None = None

    @property
    def is_empty(self) -> bool:
        return not any(
            (
                self.title,
                self.description,
                self.image_url,
                self.site_name,
                self.canonical_url,
                self.author,
                self.platform,
            )
        )

    def publisher_label(self, url: str | None = None) -> str | None:
        """Human attribution, e.g. ``"Derek Thompson on Substack"``.

        Prefers the article's author (or ``og:site_name``) and appends the
        hosting platform when it adds information. Falls back to the platform
        alone (``"Substack"``), then the bare host.
        """
        name: str | None = _clean(self.site_name) or _clean(self.author)
        platform: str | None = _clean(self.platform)
        if name and platform and platform.lower() not in name.lower():
            return f"{name} on {platform}"
        return name or platform or registrable_host(url)


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


# Platforms detected by signature strings present anywhere in the page. Order
# matters: the first match wins. Substack is first-class because so many shared
# links are Substack newsletters.
_PLATFORM_SIGNALS: tuple[tuple[str, str], ...] = (
    ("substackcdn.com", "Substack"),
    ("substack-post-media", "Substack"),
    (".substack.com", "Substack"),
    ("cdn-client.medium.com", "Medium"),
    ("static.ghost.org", "Ghost"),
    (".beehiiv.com", "beehiiv"),
)

_PRELOADS_RE: re.Pattern[str] = re.compile(
    r"window\._preloads\s*=\s*JSON\.parse\(\s*\"", re.IGNORECASE
)


def _js_string_literal(page_html: str, quote_index: int) -> str:
    """Return the JS/JSON double-quoted string literal starting at ``quote_index``."""
    out: list[str] = []
    j = quote_index + 1
    n = len(page_html)
    while j < n:
        ch = page_html[j]
        if ch == "\\":
            out.append(page_html[j : j + 2])
            j += 2
            continue
        if ch == '"':
            break
        out.append(ch)
        j += 1
    return '"' + "".join(out) + '"'


def _substack_publication(page_html: str) -> str | None:
    """Pull the publication name from Substack's ``window._preloads`` blob.

    Substack posts (including custom-domain ones like derekthompson.org that
    omit ``og:site_name``) embed a JSON preload with ``pub.name`` — the true
    newsletter/publication name, which is the best possible attribution.
    """
    match = _PRELOADS_RE.search(page_html)
    if match is None:
        return None
    literal = _js_string_literal(page_html, match.end() - 1)
    try:
        inner: object = json.loads(literal)
        data: object = json.loads(inner) if isinstance(inner, str) else inner
    except (ValueError, RecursionError):
        return None
    if not isinstance(data, dict):
        return None
    pub = data.get("pub")
    if not isinstance(pub, dict):
        return None
    for key in ("name", "copyright", "subdomain"):
        value = _clean(pub.get(key) if isinstance(pub.get(key), str) else None)
        if value:
            return value
    return None


def _detect_platform(page_html: str, generator: str | None) -> str | None:
    """Best-effort hosting-platform label (Substack, Medium, Ghost, ...)."""
    for needle, label in _PLATFORM_SIGNALS:
        if needle in page_html:
            return label
    gen = (generator or "").strip().lower()
    if gen.startswith("ghost"):
        return "Ghost"
    if "wordpress" in gen:
        return "WordPress"
    return None


def parse_html_metadata(page_html: str) -> UrlMetadata:
    """Extract OpenGraph/Twitter/title metadata from raw HTML (best-effort)."""
    og: dict[str, str] = {}
    twitter: dict[str, str] = {}
    named: dict[str, str] = {}
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
        else:
            named.setdefault(prop, content)

    title = og.get("og:title") or twitter.get("twitter:title")
    if title is None:
        match = _TITLE_RE.search(page_html)
        title = _clean(match.group(1)) if match else None

    description = og.get("og:description") or twitter.get("twitter:description")
    image_url = og.get("og:image") or twitter.get("twitter:image")

    canonical_url: str | None = None
    canonical_match = _CANONICAL_RE.search(page_html)
    if canonical_match:
        canonical_url = _clean(_tag_attrs(canonical_match.group(0)).get("href"))

    platform = _detect_platform(page_html, named.get("generator"))

    # Author: prefer an explicit name meta over article:author (often a URL).
    author = named.get("author") or og.get("og:article:author")
    article_author = og.get("article:author")
    if author is None and article_author and not article_author.startswith("http"):
        author = article_author

    # Site/publication name. Substack omits og:site_name on custom domains, so
    # recover the real publication name from its preload blob.
    site_name = og.get("og:site_name")
    if site_name is None and platform == "Substack":
        site_name = _substack_publication(page_html)

    return UrlMetadata(
        title=title,
        description=description,
        image_url=image_url,
        site_name=site_name,
        canonical_url=canonical_url,
        author=author,
        platform=platform,
    )


_LINK_PREVIEW_HEADERS: dict[str, str] = {
    # Identify as the canonical link-preview crawler. Publishers (e.g. NYT)
    # whitelist this UA to serve OpenGraph tags for social embeds, whereas
    # generic/bot UAs get a 403 that would drop us to a bare-slug title.
    "User-Agent": (
        "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Metadata worth keeping. Some sites (e.g. X/Twitter) block direct fetches but
# yield rich cards through the proxy, so treat a title-less result as a miss
# that should trigger the ScrapingBee fallback.
def _worth_keeping(meta: UrlMetadata) -> bool:
    return bool(meta.title or meta.description or meta.image_url)


async def _fetch_direct(url: str, timeout_seconds: float) -> UrlMetadata | None:
    """Direct fetch. Returns None when the fetch/parse failed (should retry)."""
    try:
        async with httpx.AsyncClient(
            timeout=timeout_seconds,
            follow_redirects=True,
            headers=_LINK_PREVIEW_HEADERS,
        ) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            if "html" not in resp.headers.get("content-type", "").lower():
                return UrlMetadata()
            return parse_html_metadata(resp.text)
    except (httpx.HTTPError, ValueError) as exc:
        log.info("enrich.fetch_failed", url=url, error=str(exc))
        return None


async def _fetch_via_scrapingbee(url: str) -> UrlMetadata | None:
    """Proxy/JS-render fallback via ScrapingBee. Returns None on failure."""
    settings = get_settings()
    api_key = settings.scrapingbee_api_key
    if not api_key:
        return None
    params: dict[str, str] = {
        "api_key": api_key,
        "url": url,
        # OG/Twitter-card tags live in the initial <head>, so skip JS rendering
        # (~10x cheaper). Premium proxies are what get us past bot walls that
        # 403/404 a direct fetch (e.g. Economist).
        "render_js": "false",
        "premium_proxy": "true",
    }
    try:
        async with httpx.AsyncClient(
            timeout=settings.scrapingbee_timeout_seconds,
        ) as client:
            resp = await client.get(
                "https://app.scrapingbee.com/api/v1/", params=params
            )
            resp.raise_for_status()
            return parse_html_metadata(resp.text)
    except (httpx.HTTPError, ValueError) as exc:
        log.info("enrich.scrapingbee_failed", url=url, error=str(exc))
        return None


async def fetch_url_metadata(url: str) -> UrlMetadata:
    """Fetch a URL and parse its head metadata; never raises on failure.

    Tries a cheap direct fetch first, then falls back to ScrapingBee (when
    configured) if the site blocks us or returns no usable preview metadata.
    """
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return UrlMetadata()

    settings = get_settings()
    direct = await _fetch_direct(url, settings.scrape_http_timeout_seconds)
    if direct is not None and _worth_keeping(direct):
        return direct

    proxied = await _fetch_via_scrapingbee(url)
    if proxied is not None and _worth_keeping(proxied):
        return proxied

    # Neither yielded usable metadata; return whatever we have (possibly empty).
    return direct or proxied or UrlMetadata()


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
