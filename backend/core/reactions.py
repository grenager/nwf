"""Canonical set of story reaction types shared across the backend."""

from __future__ import annotations

# Order is meaningful: it drives the reaction picker layout on the client.
REACTIONS: tuple[str, ...] = (
    "thumbsup",
    "heart",
    "laugh",
    "wow",
    "sad",
    "angry",
)

REACTION_SET: frozenset[str] = frozenset(REACTIONS)
