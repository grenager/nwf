"""Incremental event clustering via pgvector cosine similarity."""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from datetime import UTC, datetime

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import get_settings
from core.logging import get_logger
from core.models import Event, Story, StoryEvent, StoryKind

log = get_logger("scraper.cluster")


def _vector_literal(embedding: list[float]) -> str:
    return "[" + ",".join(f"{v:.8f}" for v in embedding) + "]"


async def _find_best_event(
    session: AsyncSession, embedding: list[float]
) -> tuple[uuid.UUID, float] | None:
    """Return (event_id, similarity) for the closest active event, if any."""
    settings = get_settings()
    vec = _vector_literal(embedding)
    row = (
        await session.execute(
            text(
                """
                select e.id,
                       1 - (e.centroid <=> CAST(:vec AS extensions.vector)) as similarity
                from public.events e
                where e.first_seen_at > now() - make_interval(hours => :hours)
                  and e.centroid is not null
                order by e.centroid <=> CAST(:vec AS extensions.vector)
                limit 1
                """
            ),
            {"vec": vec, "hours": settings.event_active_hours},
        )
    ).first()
    if row is None:
        return None
    return uuid.UUID(str(row[0])), float(row[1])


async def count_distinct_outlets(session: AsyncSession, event_id: uuid.UUID) -> int:
    result = await session.scalar(
        select(func.count(func.distinct(Story.source_id)))
        .select_from(StoryEvent)
        .join(Story, Story.id == StoryEvent.story_id)
        .where(StoryEvent.event_id == event_id, Story.source_id.is_not(None))
    )
    return int(result or 0)


async def _recompute_outlet_count(session: AsyncSession, event_id: uuid.UUID) -> int:
    """Persist distinct-outlet breadth on the event row."""
    n: int = await count_distinct_outlets(session, event_id)
    await session.execute(
        text(
            """
            update public.events
            set outlet_count = :n,
                updated_at = now()
            where id = :event_id
            """
        ),
        {"n": max(n, 1), "event_id": str(event_id)},
    )
    return max(n, 1)


async def _recompute_centroid(session: AsyncSession, event_id: uuid.UUID) -> None:
    """Set event centroid to the mean of member story embeddings."""
    await session.execute(
        text(
            """
            update public.events e
            set centroid = sub.avg_vec,
                updated_at = now()
            from (
                select avg(s.embedding)::extensions.vector(1536) as avg_vec
                from public.story_events se
                join public.stories s on s.id = se.story_id
                where se.event_id = :event_id
                  and s.embedding is not null
            ) sub
            where e.id = :event_id
              and sub.avg_vec is not null
            """
        ),
        {"event_id": str(event_id)},
    )


async def recompute_events(
    session: AsyncSession, event_ids: Iterable[uuid.UUID]
) -> None:
    """Recompute centroids and outlet counts for many events in two queries.

    Batched alternative to calling ``_recompute_centroid`` /
    ``_recompute_outlet_count`` per story: each event is updated once no matter
    how many stories joined it during a batch, which avoids repeatedly rewriting
    its HNSW vector-index entry.
    """
    ids: list[uuid.UUID] = list(dict.fromkeys(event_ids))
    if not ids:
        return
    await session.execute(
        text(
            """
            update public.events e
            set centroid = sub.avg_vec,
                updated_at = now()
            from (
                select se.event_id,
                       avg(s.embedding)::extensions.vector(1536) as avg_vec
                from public.story_events se
                join public.stories s on s.id = se.story_id
                where se.event_id = any(:ids)
                  and s.embedding is not null
                group by se.event_id
            ) sub
            where e.id = sub.event_id
              and sub.avg_vec is not null
            """
        ),
        {"ids": ids},
    )
    await session.execute(
        text(
            """
            update public.events e
            set outlet_count = sub.n,
                updated_at = now()
            from (
                select se.event_id,
                       greatest(count(distinct s.source_id), 1)::int as n
                from public.story_events se
                join public.stories s on s.id = se.story_id
                where se.event_id = any(:ids)
                  and s.source_id is not null
                group by se.event_id
            ) sub
            where e.id = sub.event_id
            """
        ),
        {"ids": ids},
    )


async def assign_story_to_event(
    session: AsyncSession,
    story: Story,
    embedding: list[float],
    *,
    recompute: bool = True,
) -> uuid.UUID | None:
    """Cluster a news story into an event. Returns event id or None if skipped.

    When ``recompute`` is False the caller is responsible for refreshing the
    event's centroid/outlet_count later (e.g. via :func:`recompute_events`),
    which lets batch ingestion update each event once instead of per story.
    """
    if story.kind != StoryKind.news:
        return None

    settings = get_settings()
    match = await _find_best_event(session, embedding)
    event_id: uuid.UUID

    if match is not None and match[1] >= settings.event_cluster_threshold:
        event_id = match[0]
        log.debug(
            "cluster.join",
            story_id=str(story.id),
            event_id=str(event_id),
            similarity=match[1],
        )
    else:
        event = Event(
            title=story.full_headline,
            centroid=embedding,
            origin_story_id=story.id,
            first_seen_at=story.created_at or datetime.now(UTC),
            outlet_count=1,
        )
        session.add(event)
        await session.flush()
        event_id = event.id
        log.debug("cluster.new", story_id=str(story.id), event_id=str(event_id))

    # Link story to event (idempotent)
    existing = await session.scalar(
        select(StoryEvent.event_id).where(StoryEvent.story_id == story.id)
    )
    if existing == event_id:
        return event_id

    if existing is not None:
        await session.execute(
            text("delete from public.story_events where story_id = :sid"),
            {"sid": str(story.id)},
        )

    session.add(StoryEvent(story_id=story.id, event_id=event_id))
    await session.flush()
    if recompute:
        await _recompute_centroid(session, event_id)
        await _recompute_outlet_count(session, event_id)
    return event_id
