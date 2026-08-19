"""Public aggregate stats for guest social proof."""

from __future__ import annotations

from fastapi import APIRouter, Response
from sqlalchemy import func, select, union

from api.deps import SessionDep
from api.schemas import CommunityStatsOut
from core.models import Comment, Post, Profile

router = APIRouter(prefix="/community", tags=["community"])

_GUEST_CACHE_CONTROL: str = "public, s-maxage=30, stale-while-revalidate=300"


@router.get("/stats", response_model=CommunityStatsOut)
async def community_stats(session: SessionDep, response: Response) -> CommunityStatsOut:
    """Unauthenticated site-wide activity counts for guest UI."""
    response.headers["Cache-Control"] = _GUEST_CACHE_CONTROL

    member_count: int = int(
        (await session.scalar(select(func.count()).select_from(Profile))) or 0
    )
    conversation_count: int = int(
        (await session.scalar(select(func.count()).select_from(Post))) or 0
    )

    participants = union(
        select(Comment.user_id.label("user_id")),
        select(Post.author_id.label("user_id")),
    ).subquery()
    discussing_count: int = int(
        (
            await session.scalar(
                select(func.count(func.distinct(participants.c.user_id)))
            )
        )
        or 0
    )

    return CommunityStatsOut(
        member_count=member_count,
        discussing_count=discussing_count,
        conversation_count=conversation_count,
    )
