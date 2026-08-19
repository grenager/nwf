"""Public unsubscribe endpoints for digest, activity, and invitation emails."""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from api.deps import SessionDep
from core.models import EmailSuppression, Invitation, InvitationStatus, Profile

router = APIRouter(prefix="/email", tags=["email"])

UnsubscribeScope = Literal["all", "digest", "instant"]


class UnsubscribeOut(BaseModel):
    ok: bool
    message: str


@router.get("/unsubscribe/invite/{token}", response_model=UnsubscribeOut)
@router.post("/unsubscribe/invite/{token}", response_model=UnsubscribeOut)
async def unsubscribe_invitee(
    token: uuid.UUID, session: SessionDep
) -> UnsubscribeOut:
    """Suppress every email to an invited address that never signed up.

    Invitees have no profile to hold a preference, so the address itself is
    added to the suppression list and any invitation still pending for it is
    revoked — including invitations from other people.
    """
    invitation: Invitation | None = await session.scalar(
        select(Invitation).where(Invitation.unsubscribe_token == token)
    )
    if invitation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "unsubscribe link not found")

    email: str | None = (invitation.invitee_email or "").strip().lower() or None
    if email is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "this link has no email address attached",
        )

    await session.execute(
        pg_insert(EmailSuppression)
        .values(
            email=email,
            reason="invite_unsubscribe",
            invitation_id=invitation.id,
        )
        .on_conflict_do_nothing(index_elements=[EmailSuppression.email])
    )
    await session.execute(
        update(Invitation)
        .where(
            Invitation.invitee_email == email,
            Invitation.status == InvitationStatus.pending,
        )
        .values(status=InvitationStatus.revoked)
    )
    await session.flush()

    return UnsubscribeOut(
        ok=True,
        message=(
            "You will not receive any more email from NewsWithFriends, "
            "and the invitations sent to you have been cancelled."
        ),
    )


@router.get("/unsubscribe/{token}", response_model=UnsubscribeOut)
@router.post("/unsubscribe/{token}", response_model=UnsubscribeOut)
async def unsubscribe_member(
    token: uuid.UUID,
    session: SessionDep,
    scope: UnsubscribeScope = Query(default="all"),
) -> UnsubscribeOut:
    """Opt a profile out of email via their unsubscribe token.

    ``scope`` defaults to ``all`` so a generic "Unsubscribe" link stops every
    kind of email; the daily digest footer narrows it to ``digest``.
    """
    profile: Profile | None = await session.scalar(
        select(Profile).where(Profile.unsubscribe_token == token)
    )
    if profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "unsubscribe link not found")

    if scope in ("all", "digest") and not profile.digest_opt_out:
        profile.digest_opt_out = True
    if scope in ("all", "instant") and not profile.instant_email_opt_out:
        profile.instant_email_opt_out = True
    await session.flush()

    if scope == "digest":
        message = "You have been unsubscribed from daily digest emails."
    elif scope == "instant":
        message = "You have been unsubscribed from instant activity emails."
    else:
        message = "You have been unsubscribed from all NewsWithFriends emails."
    return UnsubscribeOut(ok=True, message=message)
