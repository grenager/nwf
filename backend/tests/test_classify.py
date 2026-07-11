"""Tests for per-article story kind classification."""

from __future__ import annotations

from core.classify import classify_story_kind
from core.models import SourceKind, StoryKind


def test_url_opinion_path() -> None:
    kind = classify_story_kind(
        "https://www.nytimes.com/2025/01/01/opinion/climate.html",
        None,
        SourceKind.outlet,
    )
    assert kind == StoryKind.analysis


def test_section_opinion() -> None:
    kind = classify_story_kind(
        "https://www.bbc.com/news/world",
        "Opinion",
        SourceKind.outlet,
    )
    assert kind == StoryKind.analysis


def test_author_source_defaults_analysis() -> None:
    kind = classify_story_kind(
        "https://example.substack.com/p/post",
        None,
        SourceKind.author,
    )
    assert kind == StoryKind.analysis


def test_outlet_news_default() -> None:
    kind = classify_story_kind(
        "https://www.bbc.com/news/world",
        "World",
        SourceKind.outlet,
    )
    assert kind == StoryKind.news
