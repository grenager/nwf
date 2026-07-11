"""Tests for RSS parsing in the scraper."""

from __future__ import annotations

import uuid

from core.models import Source
from scraper.ingest import _parse_entries

SAMPLE_RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example Feed</title>
    <item>
      <title>First Story</title>
      <link>https://example.com/first</link>
      <description>Summary one</description>
      <author>Jane Doe</author>
      <pubDate>Wed, 01 Jan 2025 12:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Second Story</title>
      <link>https://example.com/second</link>
      <description>Summary two</description>
    </item>
    <item>
      <title>No link should be skipped</title>
    </item>
  </channel>
</rss>
"""


def _source() -> Source:
    return Source(
        id=uuid.uuid4(),
        name="Example",
        homepage_url="https://example.com",
        rss_url="https://example.com/rss",
    )


def test_parse_entries_extracts_valid_items() -> None:
    entries = _parse_entries(SAMPLE_RSS, _source())
    assert len(entries) == 2

    first = entries[0]
    assert first["article_url"] == "https://example.com/first"
    assert first["full_headline"] == "First Story"
    assert first["summary"] == "Summary one"
    assert "Jane Doe" in first["author_names"]
    assert first["created_at"] is not None


def test_parse_entries_skips_items_without_link() -> None:
    entries = _parse_entries(SAMPLE_RSS, _source())
    titles = {e["full_headline"] for e in entries}
    assert "No link should be skipped" not in titles


def test_parse_entries_handles_missing_date() -> None:
    entries = _parse_entries(SAMPLE_RSS, _source())
    second = entries[1]
    assert second["created_at"] is None
