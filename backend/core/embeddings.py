"""Hosted embeddings client (OpenAI text-embedding-3-small)."""

from __future__ import annotations

import asyncio
import re

import httpx

from core.config import get_settings
from core.logging import get_logger

log = get_logger("core.embeddings")

_EMBEDDING_DIM = 1536
_MAX_CHARS = 8000


def embeddings_enabled() -> bool:
    return bool(get_settings().embeddings_api_key)


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", " ", text)


def build_embed_text(headline: str, summary: str | None) -> str:
    """Compose the text we send to the embeddings API."""
    parts: list[str] = [headline.strip()]
    if summary:
        clean = _strip_html(summary).strip()
        if clean:
            parts.append(clean[:4000])
    return "\n\n".join(parts)[:_MAX_CHARS]


async def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed a batch of texts. Returns empty list if API key is not configured."""
    settings = get_settings()
    if not settings.embeddings_api_key:
        return []

    if not texts:
        return []

    last_error: Exception | None = None
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(
                    "https://api.openai.com/v1/embeddings",
                    headers={
                        "Authorization": f"Bearer {settings.embeddings_api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": settings.embeddings_model,
                        "input": texts,
                    },
                )
                resp.raise_for_status()
                data = resp.json()
            break
        except (httpx.HTTPStatusError, httpx.TimeoutException) as exc:
            last_error = exc
            retryable = isinstance(exc, httpx.TimeoutException) or (
                isinstance(exc, httpx.HTTPStatusError)
                and exc.response.status_code >= 500
            )
            if not retryable or attempt == 2:
                raise
            wait = 2**attempt
            log.warning("embeddings.retry", attempt=attempt + 1, wait_seconds=wait)
            await asyncio.sleep(wait)
    else:
        assert last_error is not None
        raise last_error

    items: list[dict[str, object]] = sorted(
        data["data"],
        key=lambda x: int(str(x["index"])),
    )
    vectors: list[list[float]] = []
    for item in items:
        embedding = item["embedding"]
        if not isinstance(embedding, list):
            raise TypeError("unexpected embedding payload")
        vectors.append([float(v) for v in embedding])
    return vectors


async def embed_text(text: str) -> list[float] | None:
    """Embed a single text; None if embeddings are disabled."""
    results = await embed_texts([text])
    return results[0] if results else None
