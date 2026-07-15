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
    FriendRequestOut,
    FriendRequestsOut,
    FriendsOverviewOut,
    FriendSummaryOut,
    InviteCreate,
    InviteResult,
    RecommendedFriendOut,
)
from core.models import (
    Comment,
    Connection,
    ConnectionStatus,
    Post,
    Profile,
    Source,
    Story,
    StoryRating,
    StoryStatus,
)

router = APIRouter(prefix="/connections", tags=["connections"])

# No presence system exists; treat "online" as any engagement within this window.
_ONLINE_WINDOW = timedelta(minutes=5)
_RECOMMENDED_LIMIT = 12


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


async def _all_connection_partner_ids(
    session: SessionDep, user_id: uuid.UUID
) -> set[uuid.UUID]:
    """Partners of any status (pending/accepted/blocked)."""
    rows = (
        await session.execute(
            select(Connection.first_id, Connection.second_id).where(
                or_(Connection.first_id == user_id, Connection.second_id == user_id)
            )
        )
    ).all()
    partners: set[uuid.UUID] = set()
    for first_id, second_id in rows:
        partners.add(second_id if first_id == user_id else first_id)
    return partners


async def _mutual_counts(
    session: SessionDep, user_id: uuid.UUID, other_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    """Number of accepted friends shared between ``user_id`` and each other."""
    if not other_ids:
        return {}
    my_friends = set(await accepted_friend_ids(session, user_id))
    if not my_friends:
        return {oid: 0 for oid in other_ids}

    counts: dict[uuid.UUID, int] = {oid: 0 for oid in other_ids}
    for oid in other_ids:
        their = set(await accepted_friend_ids(session, oid))
        counts[oid] = len(my_friends & their)
    return counts


@router.get("", response_model=list[ConnectionOut])
async def list_connections(
    session: SessionDep, user: CurrentUser
) -> list[Connection]:
    stmt = select(Connection).where(
        or_(Connection.first_id == user.id, Connection.second_id == user.id)
    )
    return list((await session.scalars(stmt)).all())


@router.get("/requests", response_model=FriendRequestsOut)
async def list_friend_requests(
    session: SessionDep, user: CurrentUser
) -> FriendRequestsOut:
    """Pending inbound and outbound friend requests with mutual counts."""
    pending = list(
        (
            await session.scalars(
                select(Connection).where(
                    Connection.status == ConnectionStatus.pending,
                    or_(Connection.first_id == user.id, Connection.second_id == user.id),
                )
            )
        ).all()
    )
    incoming_ids: list[uuid.UUID] = []
    outgoing_ids: list[uuid.UUID] = []
    incoming_created: dict[uuid.UUID, datetime] = {}
    outgoing_created: dict[uuid.UUID, datetime] = {}
    for conn in pending:
        if conn.second_id == user.id:
            incoming_ids.append(conn.first_id)
            incoming_created[conn.first_id] = conn.created_at
        elif conn.first_id == user.id:
            outgoing_ids.append(conn.second_id)
            outgoing_created[conn.second_id] = conn.created_at

    all_ids: list[uuid.UUID] = list(dict.fromkeys([*incoming_ids, *outgoing_ids]))
    profiles: dict[uuid.UUID, Profile] = {}
    if all_ids:
        profiles = {
            p.id: p
            for p in (
                await session.scalars(select(Profile).where(Profile.id.in_(all_ids)))
            ).all()
        }
    mutuals = await _mutual_counts(session, user.id, all_ids)

    def _row(uid: uuid.UUID, created: datetime) -> FriendRequestOut:
        profile = profiles.get(uid)
        return FriendRequestOut(
            user_id=uid,
            display_name=display_name(profile) if profile else "Friend",
            image_url=profile.image_url if profile else None,
            mutual_count=mutuals.get(uid, 0),
            created_at=created,
        )

    incoming = sorted(
        [_row(uid, incoming_created[uid]) for uid in incoming_ids],
        key=lambda r: r.created_at,
        reverse=True,
    )
    outgoing = sorted(
        [_row(uid, outgoing_created[uid]) for uid in outgoing_ids],
        key=lambda r: r.created_at,
        reverse=True,
    )
    return FriendRequestsOut(incoming=incoming, outgoing=outgoing)


@router.get("/recommended", response_model=list[RecommendedFriendOut])
async def list_recommended_friends(
    session: SessionDep, user: CurrentUser
) -> list[RecommendedFriendOut]:
    """Friends-of-friends ranked by mutual-friend count."""
    my_friends = await accepted_friend_ids(session, user.id)
    if not my_friends:
        return []

    already = await _all_connection_partner_ids(session, user.id)
    already.add(user.id)

    # Gather FoF via accepted edges of my friends.
    fof_rows = (
        await session.execute(
            select(Connection.first_id, Connection.second_id).where(
                Connection.status == ConnectionStatus.accepted,
                or_(
                    Connection.first_id.in_(my_friends),
                    Connection.second_id.in_(my_friends),
                ),
            )
        )
    ).all()

    mutual_tally: dict[uuid.UUID, int] = {}
    friend_set = set(my_friends)
    for first_id, second_id in fof_rows:
        # For each edge touching a friend, the other endpoint is a FoF candidate
        # (unless it's me or already connected).
        for a, b in ((first_id, second_id), (second_id, first_id)):
            if a not in friend_set:
                continue
            if b in already:
                continue
            mutual_tally[b] = mutual_tally.get(b, 0) + 1

    if not mutual_tally:
        return []

    ranked = sorted(mutual_tally.items(), key=lambda kv: (-kv[1], str(kv[0])))[
        :_RECOMMENDED_LIMIT
    ]
    candidate_ids = [uid for uid, _count in ranked]
    profiles: dict[uuid.UUID, Profile] = {
        p.id: p
        for p in (
            await session.scalars(select(Profile).where(Profile.id.in_(candidate_ids)))
        ).all()
    }
    results: list[RecommendedFriendOut] = []
    for uid, count in ranked:
        profile = profiles.get(uid)
        results.append(
            RecommendedFriendOut(
                user_id=uid,
                display_name=display_name(profile) if profile else "Friend",
                image_url=profile.image_url if profile else None,
                mutual_count=count,
            )
        )
    return results


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
    rating_last: dict[uuid.UUID, datetime] = dict(
        (
            await session.execute(
                select(StoryRating.user_id, func.max(StoryRating.updated_at))
                .where(StoryRating.user_id.in_(friend_ids))
                .group_by(StoryRating.user_id)
            )
        )
        .tuples()
        .all()
    )
    post_last: dict[uuid.UUID, datetime] = dict(
        (
            await session.execute(
                select(Post.author_id, func.max(Post.created_at))
                .where(Post.author_id.in_(friend_ids))
                .group_by(Post.author_id)
            )
        )
        .tuples()
        .all()
    )
    # Ambient reads — count toward online/last_active, not the subtitle.
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

    def _activity_label(fid: uuid.UUID) -> str | None:
        events: list[tuple[datetime, str]] = []
        if (at := post_last.get(fid)) is not None:
            events.append((at, "posted a story"))
        if (at := comment_last.get(fid)) is not None:
            events.append((at, "added a comment"))
        if (at := rating_last.get(fid)) is not None:
            events.append((at, "rated a story"))
        if not events:
            return None
        events.sort(key=lambda e: e[0], reverse=True)
        return events[0][1]

    now = datetime.now(UTC)
    summaries: list[FriendSummaryOut] = []
    for fid in friend_ids:
        profile = profiles.get(fid)
        candidates = [
            t
            for t in (
                status_last.get(fid),
                comment_last.get(fid),
                rating_last.get(fid),
                post_last.get(fid),
            )
            if t is not None
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
                last_activity=_activity_label(fid),
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
    ratings = await session.scalar(
        select(func.count())
        .select_from(StoryRating)
        .where(StoryRating.user_id == friend_id)
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

    rating_rows = (
        await session.execute(
            select(StoryRating, Story, Source)
            .join(Story, Story.id == StoryRating.story_id)
            .outerjoin(Source, Source.id == Story.source_id)
            .where(StoryRating.user_id == friend_id)
            .order_by(StoryRating.updated_at.desc())
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
    for rating_row, story, source in rating_rows:
        items.append(
            FriendActivityItem(
                kind="rated",
                story_id=story.id,
                headline=story.full_headline,
                source_name=source.name if source else None,
                article_url=story.article_url,
                at=rating_row.updated_at,
                rating=float(rating_row.rating),
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
        ratings=int(ratings or 0),
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
