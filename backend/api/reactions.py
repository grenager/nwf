"""Shared helpers for post/comment reaction aggregation and upserts."""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Iterable
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from api.deps import SessionDep
from api.schemas import ReactionSummary
from core.models import CommentReaction, PostReaction


def _pack(
    counts: dict[uuid.UUID, dict[str, int]],
    mine: dict[uuid.UUID, str],
    target_ids: Iterable[uuid.UUID],
) -> dict[uuid.UUID, tuple[list[ReactionSummary], str | None]]:
    out: dict[uuid.UUID, tuple[list[ReactionSummary], str | None]] = {}
    for tid in target_ids:
        tallies = counts.get(tid, {})
        summaries = [
            ReactionSummary(reaction=r, count=c)
            for r, c in sorted(tallies.items(), key=lambda kv: (-kv[1], kv[0]))
        ]
        out[tid] = (summaries, mine.get(tid))
    return out


async def load_comment_reactions(
    session: SessionDep,
    comment_ids: Iterable[uuid.UUID],
    viewer_id: uuid.UUID | None,
) -> dict[uuid.UUID, tuple[list[ReactionSummary], str | None]]:
    ids = list(comment_ids)
    if not ids:
        return {}
    rows = (
        await session.execute(
            select(
                CommentReaction.comment_id,
                CommentReaction.user_id,
                CommentReaction.reaction,
            ).where(CommentReaction.comment_id.in_(ids))
        )
    ).all()
    counts: dict[uuid.UUID, dict[str, int]] = defaultdict(
        lambda: defaultdict(int)
    )
    mine: dict[uuid.UUID, str] = {}
    for comment_id, user_id, reaction in rows:
        counts[comment_id][reaction] += 1
        if viewer_id is not None and user_id == viewer_id:
            mine[comment_id] = reaction
    return _pack(counts, mine, ids)


async def load_post_reactions(
    session: SessionDep,
    post_ids: Iterable[uuid.UUID],
    viewer_id: uuid.UUID | None,
) -> dict[uuid.UUID, tuple[list[ReactionSummary], str | None]]:
    ids = list(post_ids)
    if not ids:
        return {}
    rows = (
        await session.execute(
            select(
                PostReaction.post_id,
                PostReaction.user_id,
                PostReaction.reaction,
            ).where(PostReaction.post_id.in_(ids))
        )
    ).all()
    counts: dict[uuid.UUID, dict[str, int]] = defaultdict(
        lambda: defaultdict(int)
    )
    mine: dict[uuid.UUID, str] = {}
    for post_id, user_id, reaction in rows:
        counts[post_id][reaction] += 1
        if viewer_id is not None and user_id == viewer_id:
            mine[post_id] = reaction
    return _pack(counts, mine, ids)


async def upsert_comment_reaction(
    session: SessionDep,
    *,
    user_id: uuid.UUID,
    comment_id: uuid.UUID,
    reaction: str,
) -> None:
    now = datetime.now(UTC)
    stmt = (
        pg_insert(CommentReaction)
        .values(
            user_id=user_id,
            comment_id=comment_id,
            reaction=reaction,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_update(
            index_elements=[
                CommentReaction.user_id,
                CommentReaction.comment_id,
            ],
            set_={"reaction": reaction, "updated_at": now},
        )
    )
    await session.execute(stmt)


async def upsert_post_reaction(
    session: SessionDep,
    *,
    user_id: uuid.UUID,
    post_id: uuid.UUID,
    reaction: str,
) -> None:
    now = datetime.now(UTC)
    stmt = (
        pg_insert(PostReaction)
        .values(
            user_id=user_id,
            post_id=post_id,
            reaction=reaction,
            created_at=now,
            updated_at=now,
        )
        .on_conflict_do_update(
            index_elements=[PostReaction.user_id, PostReaction.post_id],
            set_={"reaction": reaction, "updated_at": now},
        )
    )
    await session.execute(stmt)


async def delete_comment_reaction(
    session: SessionDep, *, user_id: uuid.UUID, comment_id: uuid.UUID
) -> bool:
    row = await session.get(
        CommentReaction, {"user_id": user_id, "comment_id": comment_id}
    )
    if row is None:
        return False
    await session.delete(row)
    return True


async def delete_post_reaction(
    session: SessionDep, *, user_id: uuid.UUID, post_id: uuid.UUID
) -> bool:
    row = await session.get(
        PostReaction, {"user_id": user_id, "post_id": post_id}
    )
    if row is None:
        return False
    await session.delete(row)
    return True
