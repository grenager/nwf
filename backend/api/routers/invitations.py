"""Email invitations for non-users, anchored to an optional post."""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import or_, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import SQLAlchemyError

from api.deps import CurrentUser, OptionalUser, SessionDep, SettingsDep
from api.friends import display_name
from api.schemas import (
    InvitationAcceptResult,
    InvitationCreate,
    InvitationCreateResult,
    InvitePreviewOut,
)
from core.attribution import resolve_attribution
from core.config import Settings
from core.email import InviteEmailContent, send_invite_email
from core.models import (
    Connection,
    ConnectionStatus,
    Invitation,
    InvitationStatus,
    Post,
    PostParticipant,
    Profile,
    Source,
    Story,
)
from core.supabase_admin import generate_magic_link

router = APIRouter(prefix="/invitations", tags=["invitations"])

_TOKEN_BYTES = 24
_DEFAULT_EXPIRY = timedelta(days=14)


def _new_token() -> str:
    return secrets.token_urlsafe(_TOKEN_BYTES)


def _share_message(
    *,
    inviter_name: str,
    headline: str | None,
    take: str | None,
    personal: str | None,
    invite_url: str,
) -> str:
    bits: list[str] = [f"{inviter_name} shared something with you on NewsWithFriends."]
    if headline:
        bits.append(f"\n\n{headline}")
    if take:
        bits.append(f'\n\n{inviter_name}: "{take}"')
    if personal:
        bits.append(f"\n\n{personal}")
    bits.append(f"\n\nJoin the conversation: {invite_url}")
    return "".join(bits)


async def _find_connection(
    session: SessionDep, a: uuid.UUID, b: uuid.UUID
) -> Connection | None:
    stmt = select(Connection).where(
        or_(
            (Connection.first_id == a) & (Connection.second_id == b),
            (Connection.first_id == b) & (Connection.second_id == a),
        )
    )
    connection: Connection | None = await session.scalar(stmt)
    return connection


async def _ensure_accepted_connection(
    session: SessionDep, inviter_id: uuid.UUID, invitee_id: uuid.UUID
) -> Connection:
    existing = await _find_connection(session, inviter_id, invitee_id)
    if existing is not None:
        if existing.status != ConnectionStatus.accepted:
            existing.status = ConnectionStatus.accepted
            await session.flush()
        return existing
    connection = Connection(
        first_id=inviter_id,
        second_id=invitee_id,
        status=ConnectionStatus.accepted,
    )
    session.add(connection)
    await session.flush()
    return connection


async def _add_participant(
    session: SessionDep, post_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    stmt = (
        pg_insert(PostParticipant)
        .values(post_id=post_id, user_id=user_id)
        .on_conflict_do_nothing(
            index_elements=[PostParticipant.post_id, PostParticipant.user_id]
        )
    )
    await session.execute(stmt)


async def accept_invitation_for_user(
    session: SessionDep,
    invitation: Invitation,
    user_id: uuid.UUID,
) -> InvitationAcceptResult:
    """Mark invitation accepted, friend the inviter, join the post thread."""
    if invitation.status == InvitationStatus.accepted:
        if invitation.accepted_user_id == user_id:
            return InvitationAcceptResult(
                status="already_accepted",
                inviter_id=invitation.inviter_id,
                post_id=invitation.post_id,
                message="Invitation already accepted.",
            )
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "invitation already redeemed by another account",
        )
    if invitation.status in (InvitationStatus.revoked, InvitationStatus.expired):
        raise HTTPException(
            status.HTTP_410_GONE,
            f"invitation is {invitation.status.value}",
        )
    if invitation.expires_at is not None and invitation.expires_at < datetime.now(UTC):
        invitation.status = InvitationStatus.expired
        await session.flush()
        raise HTTPException(status.HTTP_410_GONE, "invitation has expired")

    if invitation.inviter_id == user_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "cannot accept your own invite")

    await _ensure_accepted_connection(session, invitation.inviter_id, user_id)
    if invitation.post_id is not None:
        await _add_participant(session, invitation.post_id, user_id)

    invitation.status = InvitationStatus.accepted
    invitation.accepted_user_id = user_id
    invitation.accepted_at = datetime.now(UTC)
    await session.flush()

    return InvitationAcceptResult(
        status="accepted",
        inviter_id=invitation.inviter_id,
        post_id=invitation.post_id,
        message="You're now friends.",
    )


async def redeem_pending_invitations_for_email(
    session: SessionDep, user_id: uuid.UUID, email: str | None
) -> int:
    """Auto-accept any pending invites matching ``email``. Returns count."""
    if not email:
        return 0
    normalized: str = email.strip().lower()
    if not normalized:
        return 0
    rows = list(
        (
            await session.scalars(
                select(Invitation).where(
                    Invitation.status == InvitationStatus.pending,
                    Invitation.invitee_email == normalized,
                )
            )
        ).all()
    )
    accepted = 0
    for invitation in rows:
        if invitation.inviter_id == user_id:
            continue
        try:
            await accept_invitation_for_user(session, invitation, user_id)
            accepted += 1
        except HTTPException:
            continue
    return accepted


async def _lookup_user_id_by_email(
    session: SessionDep, email: str
) -> uuid.UUID | None:
    try:
        row = (
            await session.execute(
                text("select id from auth.users where lower(email) = :email"),
                {"email": email},
            )
        ).first()
    except SQLAlchemyError:
        return None
    if row is None:
        return None
    user_id: uuid.UUID = row[0]
    return user_id


async def _post_teaser(
    session: SessionDep, post_id: uuid.UUID | None
) -> tuple[Post | None, Story | None, str | None, str | None]:
    """Return post, story, publisher label, take."""
    if post_id is None:
        return None, None, None, None
    post = await session.get(Post, post_id)
    if post is None:
        return None, None, None, None
    story = await session.get(Story, post.story_id)
    source: Source | None = None
    if story is not None and story.source_id is not None:
        source = await session.get(Source, story.source_id)
    publisher: str | None = None
    if story is not None:
        publisher, _logo = resolve_attribution(
            article_url=story.article_url,
            source_name=source.name if source else None,
            source_homepage_url=source.homepage_url if source else None,
            source_image_url=source.image_url if source else None,
            publisher=story.publisher,
        )
    return post, story, publisher, post.take


def _durable_invite_url(settings: Settings, token: str) -> str:
    return f"{settings.app_base_url.rstrip('/')}/invite/{token}"


def _auth_callback_next(settings: Settings, token: str) -> str:
    """Redirect target after magic-link exchange."""
    return f"{settings.app_base_url.rstrip('/')}/auth/callback?next=/invite/{token}"


@router.post("", response_model=InvitationCreateResult, status_code=status.HTTP_201_CREATED)
async def create_invitation(
    payload: InvitationCreate,
    session: SessionDep,
    user: CurrentUser,
    settings: SettingsDep,
) -> InvitationCreateResult:
    email: str = payload.email.strip().lower()
    if "@" not in email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid email")

    personal: str | None = (payload.message or "").strip() or None
    post: Post | None = None
    story: Story | None = None
    publisher: str | None = None
    take: str | None = None
    if payload.post_id is not None:
        post, story, publisher, take = await _post_teaser(session, payload.post_id)
        if post is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "post not found")

    # Existing account → real friend request (no invitation row).
    existing_id = await _lookup_user_id_by_email(session, email)
    if existing_id is not None:
        if existing_id == user.id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "that email is your own account"
            )
        connection = await _find_connection(session, user.id, existing_id)
        if connection is not None:
            if (
                connection.status == ConnectionStatus.pending
                and connection.second_id == user.id
            ):
                connection.status = ConnectionStatus.accepted
                await session.flush()
                return InvitationCreateResult(
                    status="connected",
                    user_id=existing_id,
                    share_message="You're already connected.",
                    message="You're now friends.",
                )
            if connection.status == ConnectionStatus.accepted:
                return InvitationCreateResult(
                    status="connected",
                    user_id=existing_id,
                    share_message="You're already friends.",
                    message="Already friends.",
                )
            return InvitationCreateResult(
                status="requested",
                user_id=existing_id,
                share_message="Friend request already pending.",
                message="Friend request already pending.",
            )
        session.add(
            Connection(
                first_id=user.id,
                second_id=existing_id,
                status=ConnectionStatus.pending,
            )
        )
        await session.flush()
        return InvitationCreateResult(
            status="requested",
            user_id=existing_id,
            share_message="Friend request sent.",
            message="Friend request sent.",
        )

    inviter = await session.get(Profile, user.id)
    inviter_name: str = display_name(inviter) if inviter else "A friend"
    token: str = _new_token()
    invitation = Invitation(
        token=token,
        inviter_id=user.id,
        invitee_email=email,
        post_id=payload.post_id,
        message=personal,
        status=InvitationStatus.pending,
        expires_at=datetime.now(UTC) + _DEFAULT_EXPIRY,
    )
    session.add(invitation)
    await session.flush()

    durable_url: str = _durable_invite_url(settings, token)
    magic: str | None = await generate_magic_link(
        email,
        _auth_callback_next(settings, token),
        settings=settings,
    )
    email_link: str = magic or durable_url
    emailed: bool = await send_invite_email(
        InviteEmailContent(
            to_email=email,
            inviter_name=inviter_name,
            invite_url=email_link,
            message=personal,
            headline=story.full_headline if story else None,
            article_url=story.article_url if story else None,
            image_url=story.image_url if story else None,
            publisher=publisher,
            take=take,
        ),
        settings=settings,
    )

    share = _share_message(
        inviter_name=inviter_name,
        headline=story.full_headline if story else None,
        take=take,
        personal=personal,
        invite_url=durable_url,
    )
    return InvitationCreateResult(
        status="invited",
        invitation_id=invitation.id,
        invite_url=durable_url,
        share_message=share,
        message=(
            "Invite email sent." if emailed else "Invite created — copy the link to share."
        ),
        email_sent=emailed,
    )


@router.get("/{token}", response_model=InvitePreviewOut)
async def get_invitation_preview(
    token: str,
    session: SessionDep,
    _user: OptionalUser,
) -> InvitePreviewOut:
    invitation = await session.scalar(
        select(Invitation).where(Invitation.token == token)
    )
    if invitation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "invitation not found")

    inviter = await session.get(Profile, invitation.inviter_id)
    post, story, publisher, take = await _post_teaser(session, invitation.post_id)

    return InvitePreviewOut(
        token=invitation.token,
        status=invitation.status.value,
        invitee_email=invitation.invitee_email,
        inviter_id=invitation.inviter_id,
        inviter_name=display_name(inviter) if inviter else "A friend",
        inviter_image_url=inviter.image_url if inviter else None,
        message=invitation.message,
        post_id=invitation.post_id,
        story_id=story.id if story else None,
        headline=story.full_headline if story else None,
        article_url=story.article_url if story else None,
        image_url=story.image_url if story else None,
        publisher=publisher,
        take=take if post else None,
    )


@router.post("/{token}/accept", response_model=InvitationAcceptResult)
async def accept_invitation(
    token: str,
    session: SessionDep,
    user: CurrentUser,
) -> InvitationAcceptResult:
    invitation = await session.scalar(
        select(Invitation).where(Invitation.token == token)
    )
    if invitation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "invitation not found")
    return await accept_invitation_for_user(session, invitation, user.id)
