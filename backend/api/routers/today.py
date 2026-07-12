"""Today screen: combined events + analysis lanes."""

from __future__ import annotations

from fastapi import APIRouter

from api.deps import OptionalUser, SessionDep
from api.routers import events as events_router
from api.schemas import TodayOut

router = APIRouter(prefix="/today", tags=["today"])


@router.get("", response_model=TodayOut)
async def get_today(session: SessionDep, user: OptionalUser) -> TodayOut:
    """Combined Today payload: news events + analysis + friend pick count."""
    return await events_router.today_payload(session, user)
