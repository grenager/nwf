"""Friend connections: request, accept, list, remove, activity, invite."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import SQLAlchemyError

from api.deps import CurrentUser, SessionDep
from api.friends import accepted_friend_ids, display_name
from api.schemas import (
    ConnectionCreate,
    ConnectionOut,
    ConnectionUpdate,
    FriendActivityItem,
    FriendProfileOut,
    FriendsOverviewOut,
    FriendSummaryOut,
    InviteCreate,
    InviteResult,
)
from core.models import (
    Comment,
    Connection,
    ConnectionStatus,
    Profile,
    Source,
    Story,
    StoryKind,
    StoryStatus,
)

router = APIRouter(prefix="/connections", tags=["connections"])

# No presence system exists; treat "online" as any engagement within this window.
_ONLINE_WINDOW = timedelta(minutes=5)


async def _find_between(
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


@router.get("", response_model=list[ConnectionOut])
async def list_connections(
    session: SessionDep, user: CurrentUser
) -> list[Connection]:
    stmt = select(Connection).where(
        or_(Connection.first_id == user.id, Connection.second_id == user.id)
    )
    return list((await session.scalars(stmt)).all())


@router.get("/friends", response_model=FriendsOverviewOut)
async def list_friends(session: SessionDep, user: CurrentUser) -> FriendsOverviewOut:
    """Accepted friends with recent-activity ordering for the sidebar."""
    friend_ids = await accepted_friend_ids(session, user.id)
    if not friend_ids:
        return FriendsOverviewOut(friends=[], total=0, online=0)

    profiles: dict[uuid.UUID, Profile] = {
        p.id: p
        for p in (
            await session.scalars(select(Profile).where(Profile.id.in_(friend_ids)))
        ).all()
    }

    status_last: dict[uuid.UUID, datetime] = dict(
        (
            await session.execute(
                select(StoryStatus.user_id, func.max(StoryStatus.updated_at))
                .where(StoryStatus.user_id.in_(friend_ids))
                .group_by(StoryStatus.user_id)
            )
        )
        .tuples()
        .all()
    )
    comment_last: dict[uuid.UUID, datetime] = dict(
        (
            await session.execute(
                select(Comment.user_id, func.max(Comment.created_at))
                .where(Comment.user_id.in_(friend_ids))
                .group_by(Comment.user_id)
            )
        )
        .tuples()
        .all()
    )

    # Most recent news source each friend read (Postgres DISTINCT ON).
    last_source: dict[uuid.UUID, str] = dict(
        (
            await session.execute(
                select(StoryStatus.user_id, Source.name)
                .join(Story, Story.id == StoryStatus.story_id)
                .join(Source, Source.id == Story.source_id)
                .where(
                    StoryStatus.user_id.in_(friend_ids),
                    StoryStatus.read.is_(True),
                    Story.kind == StoryKind.news,
                )
                .order_by(StoryStatus.user_id, StoryStatus.updated_at.desc())
                .distinct(StoryStatus.user_id)
            )
        )
        .tuples()
        .all()
    )

    now = datetime.now(UTC)
    summaries: list[FriendSummaryOut] = []
    for fid in friend_ids:
        profile = profiles.get(fid)
        candidates = [
            t for t in (status_last.get(fid), comment_last.get(fid)) if t is not None
        ]
        last_active = max(candidates) if candidates else None
        online = last_active is not None and (now - last_active) <= _ONLINE_WINDOW
        summaries.append(
            FriendSummaryOut(
                user_id=fid,
                display_name=display_name(profile) if profile else "Friend",
                image_url=profile.image_url if profile else None,
                online=online,
                last_active_at=last_active,
                last_source_name=last_source.get(fid),
            )
        )

    summaries.sort(
        key=lambda f: (
            not f.online,
            -f.last_active_at.timestamp() if f.last_active_at else float("inf"),
        )
    )
    online_count = sum(1 for f in summaries if f.online)
    return FriendsOverviewOut(
        friends=summaries, total=len(summaries), online=online_count
    )


@router.get("/friends/{friend_id}", response_model=FriendProfileOut)
async def friend_profile(
    friend_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> FriendProfileOut:
    """Detailed profile + recent activity for an accepted friend or yourself."""
    is_self: bool = friend_id == user.id
    viewer = await session.get(Profile, user.id)
    is_admin: bool = user.is_admin or bool(viewer and viewer.is_admin)
    if not is_self and not is_admin:
        friend_ids = await accepted_friend_ids(session, user.id)
        if friend_id not in friend_ids:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "not your friend")

    profile = await session.get(Profile, friend_id)

    reads = await session.scalar(
        select(func.count())
        .select_from(StoryStatus)
        .where(StoryStatus.user_id == friend_id, StoryStatus.read.is_(True))
    )
    comments = await session.scalar(
        select(func.count()).select_from(Comment).where(Comment.user_id == friend_id)
    )

    status_rows = (
        await session.execute(
            select(
                Story,
                Source,
                StoryStatus.updated_at,
            )
            .join(StoryStatus, StoryStatus.story_id == Story.id)
            .outerjoin(Source, Source.id == Story.source_id)
            .where(
                StoryStatus.user_id == friend_id,
                StoryStatus.read.is_(True),
            )
            .order_by(StoryStatus.updated_at.desc())
            .limit(15)
        )
    ).all()

    comment_rows = (
        await session.execute(
            select(Comment, Story, Source)
            .join(Story, Story.id == Comment.story_id)
            .outerjoin(Source, Source.id == Story.source_id)
            .where(Comment.user_id == friend_id)
            .order_by(Comment.created_at.desc())
            .limit(15)
        )
    ).all()

    items: list[FriendActivityItem] = []
    for story, source, updated_at in status_rows:
        items.append(
            FriendActivityItem(
                kind="read",
                story_id=story.id,
                headline=story.full_headline,
                source_name=source.name if source else None,
                article_url=story.article_url,
                at=updated_at,
            )
        )
    for comment, story, source in comment_rows:
        items.append(
            FriendActivityItem(
                kind="commented",
                story_id=story.id,
                headline=story.full_headline,
                source_name=source.name if source else None,
                article_url=story.article_url,
                at=comment.created_at,
                comment_text=comment.text,
            )
        )
    items.sort(key=lambda i: i.at, reverse=True)

    last_active = items[0].at if items else None
    now = datetime.now(UTC)
    online = last_active is not None and (now - last_active) <= _ONLINE_WINDOW

    return FriendProfileOut(
        user_id=friend_id,
        display_name=display_name(profile) if profile else "Friend",
        first=profile.first if profile else None,
        last=profile.last if profile else None,
        image_url=profile.image_url if profile else None,
        online=online,
        last_active_at=last_active,
        reads=int(reads or 0),
        comments=int(comments or 0),
        can_edit=is_self or is_admin,
        recent=items[:15],
    )


@router.post("/invite", response_model=InviteResult)
async def invite_by_email(
    payload: InviteCreate, session: SessionDep, user: CurrentUser
) -> InviteResult:
    """Send a friend request to an existing account identified by email."""
    email = payload.email.strip().lower()
    if "@" not in email:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid email")

    try:
        row = (
            await session.execute(
                text("select id from auth.users where lower(email) = :email"),
                {"email": email},
            )
        ).first()
    except SQLAlchemyError as exc:  # pragma: no cover - depends on DB role grants
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "email lookup is unavailable; add this friend by their user ID instead",
        ) from exc

    if row is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "No NewsWithFriends account uses that email yet — ask them to sign up first.",
        )

    target_id: uuid.UUID = row[0]
    if target_id == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "that email is your own account")

    existing = await _find_between(session, user.id, target_id)
    if existing is not None:
        if (
            existing.status == ConnectionStatus.pending
            and existing.second_id == user.id
        ):
            existing.status = ConnectionStatus.accepted
            await session.flush()
            return InviteResult(
                status="connected",
                user_id=target_id,
                message="You're now friends.",
            )
        if existing.status == ConnectionStatus.accepted:
            return InviteResult(
                status="connected", user_id=target_id, message="Already friends."
            )
        return InviteResult(
            status="requested",
            user_id=target_id,
            message="Friend request already pending.",
        )

    session.add(
        Connection(
            first_id=user.id,
            second_id=target_id,
            status=ConnectionStatus.pending,
        )
    )
    await session.flush()
    return InviteResult(
        status="requested", user_id=target_id, message="Friend request sent."
    )


@router.post("", response_model=ConnectionOut, status_code=status.HTTP_201_CREATED)
async def create_connection(
    payload: ConnectionCreate, session: SessionDep, user: CurrentUser
) -> Connection:
    if payload.target_user_id == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "cannot connect to yourself")

    existing = await _find_between(session, user.id, payload.target_user_id)
    if existing is not None:
        # If the other party requested first, treat this as acceptance.
        if (
            existing.status == ConnectionStatus.pending
            and existing.second_id == user.id
        ):
            existing.status = ConnectionStatus.accepted
            await session.flush()
            await session.refresh(existing)
        return existing

    connection = Connection(
        first_id=user.id,
        second_id=payload.target_user_id,
        status=ConnectionStatus.pending,
    )
    session.add(connection)
    await session.flush()
    await session.refresh(connection)
    return connection


@router.put("/{target_user_id}", response_model=ConnectionOut)
async def update_connection(
    target_user_id: uuid.UUID,
    payload: ConnectionUpdate,
    session: SessionDep,
    user: CurrentUser,
) -> Connection:
    connection = await _find_between(session, user.id, target_user_id)
    if connection is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "connection not found")
    connection.status = payload.status
    await session.flush()
    await session.refresh(connection)
    return connection


@router.delete("/{target_user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_connection(
    target_user_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> None:
    connection = await _find_between(session, user.id, target_user_id)
    if connection is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "connection not found")
    await session.delete(connection)
