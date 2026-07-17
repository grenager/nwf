"""Parse @mentions embedded in post takes and comment bodies.

The client stores mentions as react-mentions markup: ``@[Display Name](uuid)``.
These helpers extract the referenced user ids so the API can grant access and
feed the digest, without trusting the display-name portion of the markup.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Iterable

# `@[` display text `](` a UUID `)`. Display text may not contain a closing
# bracket; the id must be a canonical UUID so bogus markup is ignored.
_MENTION_RE: re.Pattern[str] = re.compile(
    r"@\[[^\]]+\]\("
    r"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)"
)


def extract_mention_ids(text: str | None) -> list[uuid.UUID]:
    """Return de-duplicated user ids referenced by mention markup, in order."""
    if not text:
        return []
    seen: set[uuid.UUID] = set()
    ordered: list[uuid.UUID] = []
    for raw in _MENTION_RE.findall(text):
        try:
            parsed: uuid.UUID = uuid.UUID(raw)
        except ValueError:
            continue
        if parsed in seen:
            continue
        seen.add(parsed)
        ordered.append(parsed)
    return ordered


def resolve_mentioned_friend_ids(
    text: str | None,
    *,
    allowed_ids: Iterable[uuid.UUID],
    exclude_id: uuid.UUID | None = None,
) -> list[uuid.UUID]:
    """Mentioned ids restricted to ``allowed_ids`` (e.g. the author's friends).

    ``exclude_id`` drops self-mentions so an author never grants themselves a
    redundant participant row.
    """
    allowed: set[uuid.UUID] = set(allowed_ids)
    return [
        mentioned_id
        for mentioned_id in extract_mention_ids(text)
        if mentioned_id in allowed and mentioned_id != exclude_id
    ]
