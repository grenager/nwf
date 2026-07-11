"""Per-article news vs analysis classification."""

from __future__ import annotations

import re

from core.models import SourceKind, StoryKind

# URL path segments that indicate opinion/analysis content.
_OPINION_PATH_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"/opinion/", re.I),
    re.compile(r"/opinions/", re.I),
    re.compile(r"/commentisfree/", re.I),
    re.compile(r"/editorial/", re.I),
    re.compile(r"/commentary/", re.I),
    re.compile(r"/columnists?/", re.I),
    re.compile(r"/perspective/", re.I),
    re.compile(r"/viewpoint/", re.I),
]

# RSS section/category labels indicating analysis.
_ANALYSIS_SECTION_LABELS: frozenset[str] = frozenset(
    {
        "opinion",
        "op-ed",
        "oped",
        "editorial",
        "commentary",
        "commentisfree",
        "analysis",
        "perspective",
        "viewpoint",
        "column",
        "columns",
    }
)


def classify_story_kind(
    article_url: str,
    section: str | None,
    source_kind: SourceKind,
) -> StoryKind:
    """Classify a story as news or analysis using URL, section, then source default."""
    url_lower = article_url.lower()
    for pattern in _OPINION_PATH_PATTERNS:
        if pattern.search(url_lower):
            return StoryKind.analysis

    if section:
        normalized = section.strip().lower()
        if normalized in _ANALYSIS_SECTION_LABELS:
            return StoryKind.analysis
        for label in _ANALYSIS_SECTION_LABELS:
            if label in normalized:
                return StoryKind.analysis

    if source_kind == SourceKind.author:
        return StoryKind.analysis
    return StoryKind.news
