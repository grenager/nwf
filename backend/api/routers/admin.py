"""Admin-only endpoints: list users and seed friendships."""

from __future__ import annotations

import asyncio
import uuid
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import Select, func, or_, select, text
from sqlalchemy.exc import SQLAlchemyError

from api.deps import AdminUser, SessionDep, SettingsDep
from api.friends import identify
from api.schemas import (
    AdminFriendRef,
    AdminFriendshipCreate,
    AdminUserCreate,
    AdminUserOut,
    ConnectionOut,
    FunnelStage,
    InviteFanout,
    InviteFunnelOut,
    InviteLinkFunnel,
    InvitePersonFunnel,
)
from core.models import (
    Comment,
    CommentReaction,
    Connection,
    ConnectionStatus,
    Invitation,
    InvitationRedemption,
    InvitationShareOutcome,
    Post,
    PostReaction,
    Profile,
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
    post_reaction_last: dict[uuid.UUID, datetime] = dict(
        (
            await session.execute(
                select(
                    PostReaction.user_id, func.max(PostReaction.updated_at)
                ).group_by(PostReaction.user_id)
            )
        )
        .tuples()
        .all()
    )
    comment_reaction_last: dict[uuid.UUID, datetime] = dict(
        (
            await session.execute(
                select(
                    CommentReaction.user_id, func.max(CommentReaction.updated_at)
                ).group_by(CommentReaction.user_id)
            )
        )
        .tuples()
        .all()
    )
    reaction_last: dict[uuid.UUID, datetime] = {
        uid: max(
            t
            for t in (post_reaction_last.get(uid), comment_reaction_last.get(uid))
            if t is not None
        )
        for uid in set(post_reaction_last) | set(comment_reaction_last)
    }
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
                reaction_last.get(profile.id),
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
                    display_name=await identify(session, friend_profile),
                )
            )
        friend_refs.sort(key=lambda f: f.display_name.lower())
        out.append(
            AdminUserOut(
                id=profile.id,
                first=profile.first,
                last=profile.last,
                email=emails.get(profile.id),
                image_url=profile.image_url,
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
        image_url=profile.image_url,
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


# --- Invite funnel ---------------------------------------------------------

# How long after joining someone still counts as having "become an inviter".
_INVITER_WINDOW = timedelta(days=14)
# A joiner who opened the app again at least this long after signing up came
# back deliberately, rather than just finishing their first session.
_RETURN_GAP = timedelta(days=1)


def _stage(
    key: str,
    label: str,
    count: int,
    base: tuple[str, int] | None,
    note: str | None = None,
) -> FunnelStage:
    """One funnel row.

    ``base`` is the (label, count) the rate is a share of -- passed explicitly
    rather than assumed to be the row above, because several stages convert
    from the same earlier step rather than from each other.
    """
    rate: float | None = None
    rate_of: str | None = None
    if base is not None and base[1] > 0:
        rate = round(count / base[1], 4)
        rate_of = base[0]
    return FunnelStage(
        key=key, label=label, count=count, rate=rate, rate_of=rate_of, note=note
    )


@router.get("/invite-funnel", response_model=InviteFunnelOut)
async def invite_funnel(
    session: SessionDep,
    _admin: AdminUser,
    days: int | None = None,
) -> InviteFunnelOut:
    """How invitations turn into people, and people into inviters.

    Deliberately two funnels rather than one. A reusable share link is opened
    and redeemed by many people, so counting "signups" per invitation row
    would understate reach; anything downstream of an open is therefore
    denominated on opens and redemptions instead.

    What this cannot show: who a link was sent to, how many people, or through
    which app. The OS share tray tells the page nothing. ``unknown_fate``
    counts the resulting blind spot honestly rather than scoring those links
    as failures.
    """
    since: datetime | None = None
    if days is not None and days > 0:
        since = datetime.now(UTC) - timedelta(days=days)

    def _scoped(stmt: Select[Any]) -> Select[Any]:
        """Limit a query to the reporting window, when one was asked for."""
        return stmt.where(Invitation.created_at >= since) if since else stmt

    def _tracked(stmt: Select[Any]) -> Select[Any]:
        """Window, and only links whose counters were actually recorded.

        Invitations predating the reach counters carry zeros that mean "not
        measured". Counting them would understate every rate and, worse,
        report links as never opened that plainly were.
        """
        return _scoped(stmt).where(Invitation.instrumented.is_(True))

    # --- link funnel: one row per invitation -----------------------------
    created: int = int(
        await session.scalar(
            _tracked(select(func.count()).select_from(Invitation))
        )
        or 0
    )
    all_links: int = int(
        await session.scalar(
            _scoped(select(func.count()).select_from(Invitation))
        )
        or 0
    )
    pre_tracking: int = int(
        await session.scalar(
            _scoped(
                select(func.count())
                .select_from(Invitation)
                .where(Invitation.instrumented.is_(False))
            )
        )
        or 0
    )
    handed_off: int = int(
        await session.scalar(
            _tracked(
                select(func.count())
                .select_from(Invitation)
                .where(
                    Invitation.share_outcome.in_(
                        [
                            InvitationShareOutcome.shared,
                            InvitationShareOutcome.copied,
                        ]
                    )
                )
            )
        )
        or 0
    )
    previewed: int = int(
        await session.scalar(
            _tracked(
                select(func.count())
                .select_from(Invitation)
                .where(Invitation.preview_fetch_count > 0)
            )
        )
        or 0
    )
    opened_links: int = int(
        await session.scalar(
            _tracked(
                select(func.count())
                .select_from(Invitation)
                .where(Invitation.open_count > 0)
            )
        )
        or 0
    )

    # Joiners per invitation, counting both redemption rows (reusable links)
    # and the legacy single-use accepted_user_id. Instrumented links only:
    # drawing this from a wider population than the stages above it let
    # "brought in at least one person" exceed "opened by a human".
    redemption_rows = (
        (
            await session.execute(
                _scoped(
                    select(
                        InvitationRedemption.invitation_id,
                        func.count(InvitationRedemption.user_id),
                    )
                    .join(
                        Invitation,
                        Invitation.id == InvitationRedemption.invitation_id,
                    )
                    .group_by(InvitationRedemption.invitation_id)
                )
            )
        ).all()
    )
    redemption_counts: dict[uuid.UUID, int] = {
        row[0]: int(row[1]) for row in redemption_rows
    }
    legacy_accepted = set(
        (
            await session.scalars(
                _scoped(
                    select(Invitation.id).where(
                        Invitation.accepted_user_id.is_not(None)
                    )
                )
            )
        ).all()
    )
    joiners_by_link: dict[uuid.UUID, int] = defaultdict(int)
    for invitation_id, count in redemption_counts.items():
        joiners_by_link[invitation_id] += int(count)
    for invitation_id in legacy_accepted:
        if invitation_id not in redemption_counts:
            joiners_by_link[invitation_id] += 1

    links_with_joiner: int = sum(1 for n in joiners_by_link.values() if n > 0)

    share_outcome_rows = (
        await session.execute(
            _scoped(
                select(Invitation.share_outcome, func.count())
                .where(Invitation.share_outcome.is_not(None))
                .group_by(Invitation.share_outcome)
            )
        )
    ).all()
    share_outcomes: dict[str, int] = {
        outcome.value: int(count) for outcome, count in share_outcome_rows if outcome
    }

    total_opens: int = int(
        await session.scalar(
            _tracked(select(func.coalesce(func.sum(Invitation.open_count), 0)))
        )
        or 0
    )
    created_base: tuple[str, int] = ("links created", created)
    link_stages: list[FunnelStage] = [
        _stage("created", "Links created", created, None),
        _stage(
            "handed_off",
            "Handed off (shared or copied)",
            handed_off,
            created_base,
            note=(
                "The inviter completed the OS share sheet or fell back to "
                "copying, rather than backing out."
            ),
        ),
        _stage(
            "previewed",
            "Rendered a preview somewhere",
            previewed,
            created_base,
            note=(
                "Weak signal: messaging apps fetch previews when a link is "
                "pasted, but ordinary visits render too and crawlers inflate it."
            ),
        ),
        _stage("opened", "Opened by a human", opened_links, created_base),
        _stage(
            "opens",
            "Opens in total",
            total_opens,
            None,
            note="Opens, not openers: one person opening twice counts twice.",
        ),
    ]

    # --- outcomes: knowable for every invite, from real records ----------
    # Who arrived through an invite, and whose invite it was. The inviter is
    # carried along so "became a friend" can be checked against the actual
    # connection rather than inferred.
    redeemed_pairs = (
        await session.execute(
            _scoped(
                select(InvitationRedemption.user_id, Invitation.inviter_id).join(
                    Invitation,
                    Invitation.id == InvitationRedemption.invitation_id,
                )
            )
        )
    ).all()
    accepted_pairs = (
        await session.execute(
            _scoped(
                select(Invitation.accepted_user_id, Invitation.inviter_id).where(
                    Invitation.accepted_user_id.is_not(None)
                )
            )
        )
    ).all()
    inviters_by_joiner: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
    for joiner_id, inviter_id in list(redeemed_pairs) + list(accepted_pairs):
        if joiner_id is not None:
            inviters_by_joiner[joiner_id].add(inviter_id)
    unique_joiners: set[uuid.UUID] = set(inviters_by_joiner)

    # Distinct *people*, not redemption rows. Counting rows let one person
    # who redeemed several links register several times, which produced a
    # "became a friend" number larger than "created an account" -- a
    # conversion rate over 100%, which is impossible by construction.
    #
    # Ground truth is the connection itself rather than the redemption's
    # became_friend flag: legacy email invites friend the invitee without
    # writing a redemption row at all, so the flag undercounts them.
    befriended_ids: set[uuid.UUID] = set()
    if unique_joiners:
        joiner_list = list(unique_joiners)
        rows = (
            await session.execute(
                select(Connection.first_id, Connection.second_id).where(
                    Connection.status == ConnectionStatus.accepted,
                    or_(
                        Connection.first_id.in_(joiner_list),
                        Connection.second_id.in_(joiner_list),
                    ),
                )
            )
        ).all()
        for first_id, second_id in rows:
            for a, b in ((first_id, second_id), (second_id, first_id)):
                if a in unique_joiners and b in inviters_by_joiner.get(a, set()):
                    befriended_ids.add(a)
    befriended: int = len(befriended_ids)

    active_ids: set[uuid.UUID] = set()
    returned_ids: set[uuid.UUID] = set()
    if unique_joiners:
        ids = list(unique_joiners)
        posted = set(
            (
                await session.scalars(
                    select(Post.author_id).where(Post.author_id.in_(ids))
                )
            ).all()
        )
        commented = set(
            (
                await session.scalars(
                    select(Comment.user_id).where(Comment.user_id.in_(ids))
                )
            ).all()
        )
        active_ids = posted | commented

        returned_profile_rows = (
            await session.execute(
                select(Profile.id).where(
                    Profile.id.in_(ids),
                    Profile.last_opened_at.is_not(None),
                    Profile.last_opened_at >= Profile.created_at + _RETURN_GAP,
                )
            )
        ).all()
        returned_ids = {row[0] for row in returned_profile_rows}

    joined_base: tuple[str, int] = ("accounts created", len(unique_joiners))
    person_stages: list[FunnelStage] = [
        _stage(
            "links_with_joiner",
            "Links that brought in at least one person",
            links_with_joiner,
            ("all links", all_links),
        ),
        _stage(
            "joined",
            "Created an account",
            len(unique_joiners),
            None,
            note=(
                "Distinct people. Known for every invite ever sent, because "
                "it comes from the redemption records rather than the reach "
                "counters."
            ),
        ),
        _stage("friended", "Became a friend", befriended, joined_base),
        _stage("active", "Posted or commented", len(active_ids), joined_base),
        _stage(
            "returned",
            "Came back a day or more later",
            len(returned_ids),
            joined_base,
        ),
    ]

    # --- fan-out ----------------------------------------------------------
    # An outcome, so it spans every link rather than the instrumented ones:
    # drawn from the narrower population it read as zero while the table
    # above it reported links that had plainly brought people in.
    buckets: dict[str, int] = {"0": 0, "1": 0, "2": 0, "3+": 0}
    all_link_ids = set(
        (await session.scalars(_scoped(select(Invitation.id)))).all()
    )
    for link_id in all_link_ids:
        n = joiners_by_link.get(link_id, 0)
        key = "3+" if n >= 3 else str(n)
        buckets[key] += 1
    # Averaged over the links that actually brought someone in. Averaging over
    # all links would mostly measure how many were never sent, which is the
    # question this stat is not trying to answer.
    total_joiners = sum(joiners_by_link.get(link_id, 0) for link_id in all_link_ids)
    mean_joiners = (
        round(total_joiners / links_with_joiner, 2) if links_with_joiner else 0.0
    )

    # --- do arrivals become inviters? -------------------------------------
    arrivals_who_invited: int = 0
    if unique_joiners:
        joined_at_rows = (
            await session.execute(
                select(Profile.id, Profile.created_at).where(
                    Profile.id.in_(list(unique_joiners))
                )
            )
        ).all()
        joined_at: dict[uuid.UUID, datetime] = {
            r[0]: r[1] for r in joined_at_rows
        }
        inviter_rows = (
            await session.execute(
                select(Invitation.inviter_id, func.min(Invitation.created_at))
                .where(Invitation.inviter_id.in_(list(unique_joiners)))
                .group_by(Invitation.inviter_id)
            )
        ).all()
        for inviter_id, first_invite_at in inviter_rows:
            started = joined_at.get(inviter_id)
            if started is None or first_invite_at is None:
                continue
            if first_invite_at - started <= _INVITER_WINDOW:
                arrivals_who_invited += 1

    return InviteFunnelOut(
        generated_at=datetime.now(UTC),
        since=since,
        link_funnel=InviteLinkFunnel(
            stages=link_stages,
            unknown_fate=created - opened_links,
            share_outcomes=share_outcomes,
            pre_tracking=pre_tracking,
        ),
        person_funnel=InvitePersonFunnel(stages=person_stages),
        fanout=InviteFanout(
            links_with_joiners=buckets,
            mean_joiners_per_converting_link=mean_joiners,
        ),
        arrivals=len(unique_joiners),
        arrivals_who_invited=arrivals_who_invited,
        arrivals_who_invited_rate=(
            round(arrivals_who_invited / len(unique_joiners), 4)
            if unique_joiners
            else None
        ),
    )
