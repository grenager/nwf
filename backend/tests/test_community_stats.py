"""Public community stats for guest social proof."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from api.routers.community import _GUEST_CACHE_CONTROL, community_stats


class _StatsSession:
    def __init__(self, values: list[int]) -> None:
        self._values = list(values)
        self._index = 0

    async def scalar(self, _stmt: Any, *_args: Any, **_kwargs: Any) -> int:
        if self._index >= len(self._values):
            return 0
        value = self._values[self._index]
        self._index += 1
        return value


@pytest.mark.asyncio
async def test_community_stats_returns_counts_and_cache_header() -> None:
    session = _StatsSession([27, 19, 14])
    response = MagicMock()

    result = await community_stats(session, response)  # type: ignore[arg-type]

    assert result.member_count == 27
    assert result.conversation_count == 19
    assert result.discussing_count == 14
    response.headers.__setitem__.assert_called_once_with(
        "Cache-Control",
        _GUEST_CACHE_CONTROL,
    )
