"""Admin-only endpoints: list users and seed friendships."""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime

import asyncio

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import SQLAlchemyError

from api.deps import AdminUser, SessionDep, SettingsDep
from api.friends import display_name
from api.schemas import (
    AdminFriendRef,
    AdminFriendshipCreate,
    AdminUserCreate,
    AdminUserOut,
    ConnectionOut,
)
from core.models import (
    Comment,
    Connection,
    ConnectionStatus,
    Post,
    Profile,
    StoryRating,
    StoryStatus,
)
from core.supabase_admin import AuthUserCreateError, create_auth_user, delete_auth_user

router = APIRouter(prefix="/admin", tags=["admin"])


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
    session: SessionDep, user_a: uuid.UUID, user_b: uuid.UUID
) -> Connection:
    existing = await _find_connection(session, user_a, user_b)
    if existing is not None:
        if existing.status != ConnectionStatus.accepted:
            existing.status = ConnectionStatus.accepted
            await session.flush()
        return existing
    connection = Connection(
        first_id=user_a,
        second_id=user_b,
        status=ConnectionStatus.accepted,
    )
    session.add(connection)
    await session.flush()
    return connection


@router.get("/users", response_model=list[AdminUserOut])
async def list_users(session: SessionDep, _admin: AdminUser) -> list[AdminUserOut]:
    """List every profile with email, last activity, and accepted friends."""
    profiles: list[Profile] = list(
        (await session.scalars(select(Profile).order_by(Profile.created_at))).all()
    )
    if not profiles:
        return []

    emails: dict[uuid.UUID, str | None] = {}
    try:
        rows = (await session.execute(text("select id, email from auth.users"))).all()
        for row in rows:
            user_id: uuid.UUID = row[0]
            email_val: str | None = row[1]
            emails[user_id] = email_val
    except SQLAlchemyError:
        # auth.users may be unavailable depending on DB role grants.
        emails = {}

    comment_last: dict[uuid.UUID, datetime] = dict(
        (
            await session.execute(
                select(Comment.user_id, func.max(Comment.created_at)).group_by(
                    Comment.user_id
                )
            )
        )
        .tuples()
        .all()
    )
    rating_last: dict[uuid.UUID, datetime] = dict(
        (
            await session.execute(
                select(StoryRating.user_id, func.max(StoryRating.updated_at)).group_by(
                    StoryRating.user_id
                )
            )
        )
        .tuples()
        .all()
    )
    post_last: dict[uuid.UUID, datetime] = dict(
        (
            await session.execute(
                select(Post.author_id, func.max(Post.created_at)).group_by(Post.author_id)
            )
        )
        .tuples()
        .all()
    )
    status_last: dict[uuid.UUID, datetime] = dict(
        (
            await session.execute(
                select(StoryStatus.user_id, func.max(StoryStatus.updated_at)).group_by(
                    StoryStatus.user_id
                )
            )
        )
        .tuples()
        .all()
    )

    profile_by_id: dict[uuid.UUID, Profile] = {p.id: p for p in profiles}

    accepted: list[Connection] = list(
        (
            await session.scalars(
                select(Connection).where(Connection.status == ConnectionStatus.accepted)
            )
        ).all()
    )
    friends_map: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for conn in accepted:
        friends_map[conn.first_id].append(conn.second_id)
        friends_map[conn.second_id].append(conn.first_id)

    out: list[AdminUserOut] = []
    for profile in profiles:
        candidates: list[datetime] = [
            t
            for t in (
                status_last.get(profile.id),
                comment_last.get(profile.id),
                rating_last.get(profile.id),
                post_last.get(profile.id),
            )
            if t is not None
        ]
        last_active: datetime | None = max(candidates) if candidates else None
        friend_refs: list[AdminFriendRef] = []
        for fid in friends_map.get(profile.id, []):
            friend_profile: Profile | None = profile_by_id.get(fid)
            friend_refs.append(
                AdminFriendRef(
                    user_id=fid,
                    display_name=(
                        display_name(friend_profile) if friend_profile else "Friend"
                    ),
                )
            )
        friend_refs.sort(key=lambda f: f.display_name.lower())
        out.append(
            AdminUserOut(
                id=profile.id,
                first=profile.first,
                last=profile.last,
                email=emails.get(profile.id),
                last_active_at=last_active,
                friends=friend_refs,
            )
        )
    return out


@router.post(
    "/friendships",
    response_model=ConnectionOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_friendship(
    payload: AdminFriendshipCreate, session: SessionDep, _admin: AdminUser
) -> Connection:
    """Create (or upgrade to) an accepted friendship between two users."""
    if payload.user_a == payload.user_b:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "cannot friend a user with themselves"
        )

    profile_a: Profile | None = await session.get(Profile, payload.user_a)
    profile_b: Profile | None = await session.get(Profile, payload.user_b)
    if profile_a is None or profile_b is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "one or both users not found")

    connection = await _ensure_accepted_connection(
        session, payload.user_a, payload.user_b
    )
    await session.refresh(connection)
    return connection


@router.delete("/friendships", status_code=status.HTTP_204_NO_CONTENT)
async def delete_friendship(
    session: SessionDep,
    _admin: AdminUser,
    user_a: uuid.UUID,
    user_b: uuid.UUID,
) -> None:
    """Remove the connection between two users (either orientation)."""
    if user_a == user_b:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "cannot unfriend a user from themselves"
        )

    existing = await _find_connection(session, user_a, user_b)
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "friendship not found")
    await session.delete(existing)
    await session.flush()


@router.post(
    "/users",
    response_model=AdminUserOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_user(
    payload: AdminUserCreate,
    session: SessionDep,
    _admin: AdminUser,
    settings: SettingsDep,
) -> AdminUserOut:
    """Pre-create a full account claimable later via magic-link sign-in."""
    email: str = payload.email.strip().lower()
    if "@" not in email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid email")

    first: str | None = payload.first.strip() if payload.first else None
    last: str | None = payload.last.strip() if payload.last else None
    if first == "":
        first = None
    if last == "":
        last = None

    try:
        user_id: uuid.UUID = await create_auth_user(
            email, first=first, last=last, settings=settings
        )
    except AuthUserCreateError as exc:
        code: int = exc.status_code or 502
        if code == 409 or "already" in str(exc).lower():
            raise HTTPException(
                status.HTTP_409_CONFLICT, "a user with that email already exists"
            ) from exc
        if code == 503:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)
            ) from exc
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST if code in (400, 422) else status.HTTP_502_BAD_GATEWAY,
            str(exc),
        ) from exc

    # Trigger creates the profile from Auth's insert; wait briefly if needed.
    profile: Profile | None = None
    for _ in range(10):
        session.expire_all()
        profile = await session.scalar(
            select(Profile).where(Profile.id == user_id)
        )
        if profile is not None:
            break
        await asyncio.sleep(0.05)
    if profile is None:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "user created in auth but profile is missing",
        )
    if first is not None:
        profile.first = first
    if last is not None:
        profile.last = last
    await session.flush()
    await session.refresh(profile)

    return AdminUserOut(
        id=profile.id,
        first=profile.first,
        last=profile.last,
        email=email,
        last_active_at=None,
        friends=[],
    )


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: uuid.UUID,
    session: SessionDep,
    admin: AdminUser,
    settings: SettingsDep,
) -> None:
    """Permanently delete a user (auth + cascaded profile/app data)."""
    if user_id == admin.id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "cannot delete your own account"
        )

    profile: Profile | None = await session.get(Profile, user_id)
    if profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")

    ok: bool = await delete_auth_user(user_id, settings=settings)
    if not ok:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "user delete requires SUPABASE_SERVICE_ROLE_KEY",
        )

    # Auth delete cascades to profiles; drop any cached ORM state.
    session.expire_all()
