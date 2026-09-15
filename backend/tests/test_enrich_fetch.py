"""How the link preview behaves when a publisher refuses the fetch.

Some publishers serve OpenGraph tags to the whitelisted crawler UA and some
refuse it outright, so the direct fetch tries both before paying for the
proxy. And the proxy itself gets two attempts, because it reports a target's
refusal as its own 5xx.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from core.enrich import (
    SCRAPINGBEE_ENDPOINT,
    _fetch_direct,
    _fetch_via_scrapingbee,
    _redact,
)

OG_HTML: str = (
    '<html><head><meta property="og:title" content="A Headline">'
    '<meta property="og:description" content="Some description."></head></html>'
)


def _response(status: int, body: str = "") -> Any:
    resp = MagicMock()
    resp.status_code = status
    resp.text = body
    resp.headers = {"content-type": "text/html; charset=utf-8"}
    if status >= 400:
        request = httpx.Request("GET", "https://example.com/a")
        real = httpx.Response(status, request=request)
        resp.raise_for_status = MagicMock(
            side_effect=httpx.HTTPStatusError(
                f"Client error '{status}' for url 'https://example.com/a'",
                request=request,
                response=real,
            )
        )
    else:
        resp.raise_for_status = MagicMock()
    return resp


def _client(responses: list[Any]) -> tuple[Any, list[dict[str, Any]]]:
    """A stand-in httpx client that serves `responses` in order, recording
    the user agent and query params of each call."""
    calls: list[dict[str, Any]] = []
    client = AsyncMock()
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=None)

    async def get(url: str, **kwargs: Any) -> Any:
        calls.append({"url": url, "params": kwargs.get("params")})
        return responses[len(calls) - 1]

    client.get = get
    return client, calls


def _factory(client: Any) -> Any:
    """Records the headers each client is constructed with."""
    seen: list[dict[str, str]] = []

    def make(*_args: Any, **kwargs: Any) -> Any:
        seen.append(kwargs.get("headers") or {})
        return client

    make.seen = seen  # type: ignore[attr-defined]
    return make


@pytest.mark.asyncio
async def test_a_403_to_the_crawler_is_retried_as_a_browser() -> None:
    client, _calls = _client([_response(403), _response(200, OG_HTML)])
    factory = _factory(client)
    with patch("core.enrich.httpx.AsyncClient", factory):
        meta = await _fetch_direct("https://example.com/a", 5.0)

    assert meta is not None
    assert meta.title == "A Headline"
    agents = [h.get("User-Agent", "") for h in factory.seen]  # type: ignore[attr-defined]
    assert len(agents) == 2
    assert agents[0].startswith("facebookexternalhit")
    assert "Chrome" in agents[1]


@pytest.mark.asyncio
async def test_the_crawler_ua_is_preferred_when_it_works() -> None:
    """No second request, and no second bill, when the first one answers."""
    client, _calls = _client([_response(200, OG_HTML)])
    factory = _factory(client)
    with patch("core.enrich.httpx.AsyncClient", factory):
        meta = await _fetch_direct("https://example.com/a", 5.0)

    assert meta is not None and meta.title == "A Headline"
    assert len(factory.seen) == 1  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_a_server_error_is_not_a_ua_problem_so_it_is_not_retried() -> None:
    client, _calls = _client([_response(500), _response(200, OG_HTML)])
    factory = _factory(client)
    with patch("core.enrich.httpx.AsyncClient", factory):
        meta = await _fetch_direct("https://example.com/a", 5.0)

    assert meta is None
    assert len(factory.seen) == 1  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_scrapingbee_escalates_to_a_rendered_attempt() -> None:
    """A 500 from the proxy is usually the target refusing it, so try harder."""
    client, calls = _client([_response(500), _response(200, OG_HTML)])
    settings = MagicMock()
    settings.scrapingbee_api_key = "secret-key"
    settings.scrapingbee_timeout_seconds = 5.0

    with (
        patch("core.enrich.httpx.AsyncClient", _factory(client)),
        patch("core.enrich.get_settings", return_value=settings),
    ):
        meta = await _fetch_via_scrapingbee("https://example.com/a")

    assert meta is not None and meta.title == "A Headline"
    assert [c["url"] for c in calls] == [SCRAPINGBEE_ENDPOINT] * 2
    assert calls[0]["params"]["render_js"] == "false"
    assert calls[1]["params"]["render_js"] == "true"
    assert calls[1]["params"]["stealth_proxy"] == "true"


@pytest.mark.asyncio
async def test_scrapingbee_is_skipped_without_a_key() -> None:
    settings = MagicMock()
    settings.scrapingbee_api_key = None
    with patch("core.enrich.get_settings", return_value=settings):
        assert await _fetch_via_scrapingbee("https://example.com/a") is None


def test_the_api_key_never_reaches_a_log_line() -> None:
    """The key is a query parameter, so httpx puts it in every error message."""
    message = (
        "Server error '500' for url 'https://app.scrapingbee.com/api/v1/"
        "?api_key=secret-key&url=https%3A%2F%2Fexample.com"
    )
    redacted = _redact(message, "secret-key")
    assert "secret-key" not in redacted
    assert "***" in redacted


@pytest.mark.asyncio
async def test_a_refusal_is_reported_as_refused_not_just_empty() -> None:
    """A challenged page is a real article we cannot read, not a bad link."""
    from core.enrich import fetch_url_outcome

    client, _calls = _client([_response(403), _response(403)])
    settings = MagicMock()
    settings.url_fetch_timeout_seconds = 5.0
    settings.scrapingbee_api_key = None

    with (
        patch("core.enrich.httpx.AsyncClient", _factory(client)),
        patch("core.enrich.get_settings", return_value=settings),
    ):
        outcome = await fetch_url_outcome("https://example.com/a")

    assert outcome.refused is True
    assert outcome.metadata.title is None


@pytest.mark.asyncio
async def test_a_missing_page_is_not_a_refusal() -> None:
    """A 404 stays a bad link, so the composer keeps blocking it."""
    from core.enrich import fetch_url_outcome

    client, _calls = _client([_response(404), _response(404)])
    settings = MagicMock()
    settings.url_fetch_timeout_seconds = 5.0
    settings.scrapingbee_api_key = None

    with (
        patch("core.enrich.httpx.AsyncClient", _factory(client)),
        patch("core.enrich.get_settings", return_value=settings),
    ):
        outcome = await fetch_url_outcome("https://example.com/missing")

    assert outcome.refused is False


@pytest.mark.asyncio
async def test_a_page_that_answers_is_never_marked_refused() -> None:
    from core.enrich import fetch_url_outcome

    client, _calls = _client([_response(200, OG_HTML)])
    settings = MagicMock()
    settings.url_fetch_timeout_seconds = 5.0
    settings.scrapingbee_api_key = None

    with (
        patch("core.enrich.httpx.AsyncClient", _factory(client)),
        patch("core.enrich.get_settings", return_value=settings),
    ):
        outcome = await fetch_url_outcome("https://example.com/a")

    assert outcome.refused is False
    assert outcome.metadata.title == "A Headline"
