"""Email invitations and reusable share links, anchored to an optional post."""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Body, HTTPException, status
from sqlalchemy import func, or_, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import SQLAlchemyError

from api.deps import CurrentUser, OptionalUser, SessionDep, SettingsDep
from api.friends import display_name
from api.routers.posts import serialize_post
from api.schemas import (
    InvitationAcceptRequest,
    InvitationAcceptResult,
    InvitationCreate,
    InvitationCreateResult,
    InvitePreviewOut,
    PostOut,
)
from core.attribution import resolve_attribution
from core.config import Settings
from core.email import InviteEmailContent, send_invite_email
from core.models import (
    Comment,
    Connection,
    ConnectionStatus,
    Invitation,
    InvitationRedemption,
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
_DEFAULT_SHARE_PREFIX = (
    "I'm using NewsWithFriends to discuss articles privately with friends. "
    "I'd like to invite you to my private discussion about this article."
)


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
    # The link renders a rich preview (headline + image) in messaging apps, so
    # keep the text itself to a short note plus the invite URL.
    body: str = (personal or "").strip() or _DEFAULT_SHARE_PREFIX
    return f"{body}\n{invite_url}"


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


async def _record_redemption(
    session: SessionDep,
    invitation_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    became_friend: bool,
) -> InvitationRedemption:
    """Insert or update a reusable-link redemption. Idempotent per user."""
    existing = await session.scalar(
        select(InvitationRedemption).where(
            InvitationRedemption.invitation_id == invitation_id,
            InvitationRedemption.user_id == user_id,
        )
    )
    if existing is not None:
        if became_friend and not existing.became_friend:
            existing.became_friend = True
            await session.flush()
        return existing
    redemption = InvitationRedemption(
        invitation_id=invitation_id,
        user_id=user_id,
        became_friend=became_friend,
    )
    session.add(redemption)
    await session.flush()
    return redemption


async def accept_invitation_for_user(
    session: SessionDep,
    invitation: Invitation,
    user_id: uuid.UUID,
    *,
    add_friend: bool | None = None,
) -> InvitationAcceptResult:
    """Redeem an invitation: optionally friend the inviter and join the post.

    - Reusable links: record a per-user redemption (do not flip invite status).
    - Single-use email invites: mark accepted (legacy behavior).
    - Friending happens when ``invitation.become_friend`` or ``add_friend``.
    - Post participation is granted only when friended.
    """
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

    # Reusable open share links: friend only when the inviter opted in or the
    # recipient explicitly agrees. Single-use email invites keep legacy
    # auto-friend behavior unless the recipient declines (add_friend=False).
    if invitation.reusable:
        should_friend: bool = bool(invitation.become_friend) or bool(add_friend)
    else:
        should_friend = False if add_friend is False else True

    if invitation.reusable:
        existing_redemption = await session.scalar(
            select(InvitationRedemption).where(
                InvitationRedemption.invitation_id == invitation.id,
                InvitationRedemption.user_id == user_id,
            )
        )
        if existing_redemption is not None and existing_redemption.became_friend:
            return InvitationAcceptResult(
                status="already_accepted",
                inviter_id=invitation.inviter_id,
                post_id=invitation.post_id,
                message="You're already connected.",
                became_friend=True,
            )
        if not should_friend:
            await _record_redemption(
                session, invitation.id, user_id, became_friend=False
            )
            return InvitationAcceptResult(
                status="view_only",
                inviter_id=invitation.inviter_id,
                post_id=invitation.post_id,
                message="You can keep browsing. Add them as a friend to join.",
                became_friend=False,
            )
        await _ensure_accepted_connection(session, invitation.inviter_id, user_id)
        if invitation.post_id is not None:
            await _add_participant(session, invitation.post_id, user_id)
        await _record_redemption(session, invitation.id, user_id, became_friend=True)
        return InvitationAcceptResult(
            status="accepted",
            inviter_id=invitation.inviter_id,
            post_id=invitation.post_id,
            message="You're now friends.",
            became_friend=True,
        )

    # Single-use email invitation path.
    if invitation.status == InvitationStatus.accepted:
        if invitation.accepted_user_id == user_id:
            return InvitationAcceptResult(
                status="already_accepted",
                inviter_id=invitation.inviter_id,
                post_id=invitation.post_id,
                message="Invitation already accepted.",
                became_friend=True,
            )
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "invitation already redeemed by another account",
        )

    if not should_friend:
        return InvitationAcceptResult(
            status="view_only",
            inviter_id=invitation.inviter_id,
            post_id=invitation.post_id,
            message="Add them as a friend to join the conversation.",
            became_friend=False,
        )

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
        became_friend=True,
    )


async def redeem_pending_invitations_for_email(
    session: SessionDep, user_id: uuid.UUID, email: str | None
) -> int:
    """Auto-accept any pending email invites matching ``email``. Returns count."""
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
                    Invitation.reusable.is_(False),
                )
            )
        ).all()
    )
    accepted = 0
    for invitation in rows:
        if invitation.inviter_id == user_id:
            continue
        try:
            # Email invites historically auto-friend on signup.
            result = await accept_invitation_for_user(
                session,
                invitation,
                user_id,
                add_friend=True,
            )
            if result.status in ("accepted", "already_accepted"):
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


async def _reply_count(session: SessionDep, post_id: uuid.UUID | None) -> int:
    if post_id is None:
        return 0
    count: int | None = await session.scalar(
        select(func.count()).select_from(Comment).where(Comment.post_id == post_id)
    )
    return int(count or 0)


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
    raw_email: str | None = (payload.email or "").strip().lower() or None
    personal: str | None = (payload.message or "").strip() or None
    become_friend: bool = bool(payload.become_friend)

    post: Post | None = None
    story: Story | None = None
    publisher: str | None = None
    take: str | None = None
    if payload.post_id is not None:
        post, story, publisher, take = await _post_teaser(session, payload.post_id)
        if post is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "post not found")

    inviter = await session.get(Profile, user.id)
    inviter_name: str = display_name(inviter) if inviter else "A friend"

    # Open reusable share link (no email target).
    if raw_email is None:
        if payload.post_id is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "post_id is required for open share links",
            )
        token: str = _new_token()
        invitation = Invitation(
            token=token,
            inviter_id=user.id,
            invitee_email=None,
            post_id=payload.post_id,
            message=personal,
            become_friend=become_friend,
            reusable=True,
            status=InvitationStatus.pending,
            expires_at=datetime.now(UTC) + _DEFAULT_EXPIRY,
        )
        session.add(invitation)
        await session.flush()
        durable_url: str = _durable_invite_url(settings, token)
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
            message="Share link ready.",
            email_sent=False,
        )

    email: str = raw_email
    if "@" not in email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid email")

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

    token = _new_token()
    invitation = Invitation(
        token=token,
        inviter_id=user.id,
        invitee_email=email,
        post_id=payload.post_id,
        message=personal,
        become_friend=become_friend,
        reusable=False,
        status=InvitationStatus.pending,
        expires_at=datetime.now(UTC) + _DEFAULT_EXPIRY,
    )
    session.add(invitation)
    await session.flush()

    durable_url = _durable_invite_url(settings, token)
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
    replies = await _reply_count(session, invitation.post_id)

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
        become_friend=bool(invitation.become_friend),
        reply_count=replies,
        reusable=bool(invitation.reusable),
    )


@router.get("/{token}/post", response_model=PostOut)
async def get_invitation_post(
    token: str,
    session: SessionDep,
    user: OptionalUser,
) -> PostOut:
    """Token-scoped post detail: reveals conversation even for private posts."""
    invitation = await session.scalar(
        select(Invitation).where(Invitation.token == token)
    )
    if invitation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "invitation not found")
    if invitation.status in (InvitationStatus.revoked, InvitationStatus.expired):
        raise HTTPException(
            status.HTTP_410_GONE,
            f"invitation is {invitation.status.value}",
        )
    if invitation.expires_at is not None and invitation.expires_at < datetime.now(UTC):
        invitation.status = InvitationStatus.expired
        await session.flush()
        raise HTTPException(status.HTTP_410_GONE, "invitation has expired")
    if invitation.post_id is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "invitation has no anchored post"
        )

    post = await session.get(Post, invitation.post_id)
    if post is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "post not found")

    viewer_id: uuid.UUID | None = user.id if user is not None else None
    return await serialize_post(
        session,
        post,
        viewer_id=viewer_id,
        force_replies=True,
    )


@router.post("/{token}/accept", response_model=InvitationAcceptResult)
async def accept_invitation(
    token: str,
    session: SessionDep,
    user: CurrentUser,
    payload: InvitationAcceptRequest = Body(
        default_factory=InvitationAcceptRequest
    ),
) -> InvitationAcceptResult:
    invitation = await session.scalar(
        select(Invitation).where(Invitation.token == token)
    )
    if invitation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "invitation not found")
    return await accept_invitation_for_user(
        session, invitation, user.id, add_friend=payload.add_friend
    )
