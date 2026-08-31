"""Friend-graph helpers shared by API routers."""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import HTTPException, status
from sqlalchemy import ColumnElement, Select, bindparam, exists, func, or_, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import Settings, get_settings
from core.models import (
    Comment,
    CommentReaction,
    Connection,
    ConnectionStatus,
    EmailSuppression,
    Invitation,
    InvitationStatus,
    Post,
    PostParticipant,
    PostReaction,
    PostVisibility,
    Profile,
    StoryStatus,
)

# Invitees never opted in, so nudge them at most once a day per invitation.
PENDING_INVITE_EMAIL_THROTTLE: timedelta = timedelta(hours=24)


@dataclass(frozen=True)
class ActivityEmailRecipient:
    """A user eligible to receive an instant activity email."""

    user_id: uuid.UUID
    email: str
    first: str | None
    unsubscribe_token: uuid.UUID


@dataclass(frozen=True)
class PendingInviteRecipient:
    """An invited address with no account yet, eligible for an activity nudge."""

    invitation_id: uuid.UUID
    email: str
    invite_token: str
    unsubscribe_token: uuid.UUID


async def email_for_user(
    session: AsyncSession, user_id: uuid.UUID
) -> str | None:
    """Look up auth.users.email for a profile id."""
    try:
        row = (
            await session.execute(
                text("select email from auth.users where id = :id"),
                {"id": user_id},
            )
        ).first()
    except SQLAlchemyError:
        return None
    if row is None or not row[0]:
        return None
    return str(row[0]).strip().lower()


async def suppressed_emails(
    session: AsyncSession, emails: Iterable[str]
) -> set[str]:
    """Subset of ``emails`` (lowercased) that has opted out of all email."""
    normalized: set[str] = {
        email.strip().lower() for email in emails if email and email.strip()
    }
    if not normalized:
        return set()
    rows = list(
        (
            await session.scalars(
                select(EmailSuppression.email).where(
                    EmailSuppression.email.in_(normalized)
                )
            )
        ).all()
    )
    return {str(row) for row in rows}


async def is_email_suppressed(session: AsyncSession, email: str | None) -> bool:
    """True when ``email`` has unsubscribed from everything."""
    if not email:
        return False
    return bool(await suppressed_emails(session, [email]))


async def emails_with_accounts(
    session: AsyncSession, emails: Iterable[str]
) -> set[str]:
    """Subset of ``emails`` (lowercased) that already has an account."""
    normalized: set[str] = {
        email.strip().lower() for email in emails if email and email.strip()
    }
    if not normalized:
        return set()
    stmt = text(
        "select lower(email) as email from auth.users where lower(email) in :emails"
    ).bindparams(bindparam("emails", expanding=True))
    try:
        rows = (
            await session.execute(stmt, {"emails": sorted(normalized)})
        ).all()
    except SQLAlchemyError:
        # Without the lookup we cannot tell invitees from members, so treat
        # everyone as a member: the member path already handles their email.
        return normalized
    return {str(row[0]) for row in rows if row[0]}


async def load_pending_invite_recipients(
    session: AsyncSession,
    *,
    inviter_id: uuid.UUID | None = None,
    post_id: uuid.UUID | None = None,
    now: datetime | None = None,
) -> list[PendingInviteRecipient]:
    """Load invited addresses that have not signed up yet.

    Scope with ``inviter_id`` (everyone that person invited) and/or ``post_id``
    (everyone invited to that conversation); at least one is required so this
    can never fan out to every invitee in the database. Only single-use email
    invitations qualify — reusable share links have no recipient to notify.
    Expired, suppressed, already-registered, and recently nudged addresses are
    skipped.
    """
    if inviter_id is None and post_id is None:
        raise ValueError("inviter_id or post_id is required")

    moment: datetime = now or datetime.now(UTC)
    stmt = select(Invitation).where(
        Invitation.status == InvitationStatus.pending,
        Invitation.reusable.is_(False),
        Invitation.invitee_email.is_not(None),
        or_(
            Invitation.expires_at.is_(None),
            Invitation.expires_at > moment,
        ),
        or_(
            Invitation.last_activity_email_at.is_(None),
            Invitation.last_activity_email_at
            < moment - PENDING_INVITE_EMAIL_THROTTLE,
        ),
    )
    if inviter_id is not None:
        stmt = stmt.where(Invitation.inviter_id == inviter_id)
    if post_id is not None:
        stmt = stmt.where(Invitation.post_id == post_id)

    invitations: list[Invitation] = list((await session.scalars(stmt)).all())
    if not invitations:
        return []

    candidates: dict[str, Invitation] = {}
    for invitation in invitations:
        email: str = (invitation.invitee_email or "").strip().lower()
        if email:
            candidates.setdefault(email, invitation)

    excluded: set[str] = await suppressed_emails(session, candidates)
    excluded |= await emails_with_accounts(session, candidates)

    return [
        PendingInviteRecipient(
            invitation_id=invitation.id,
            email=email,
            invite_token=invitation.token,
            unsubscribe_token=invitation.unsubscribe_token,
        )
        for email, invitation in candidates.items()
        if email not in excluded
    ]


async def pending_connection_ids(
    session: AsyncSession, requester_id: uuid.UUID
) -> list[uuid.UUID]:
    """Users ``requester_id`` sent a still-unanswered friend request to."""
    rows = list(
        (
            await session.scalars(
                select(Connection.second_id).where(
                    Connection.status == ConnectionStatus.pending,
                    Connection.first_id == requester_id,
                )
            )
        ).all()
    )
    return [row for row in rows if row != requester_id]


async def load_activity_email_recipients(
    session: AsyncSession,
    user_ids: Iterable[uuid.UUID],
) -> list[ActivityEmailRecipient]:
    """Load email + profile fields for users who can receive instant emails.

    Skips ids with no email and profiles with ``instant_email_opt_out``.
    """
    ids: list[uuid.UUID] = list({uid for uid in user_ids})
    if not ids:
        return []

    profiles = list(
        (
            await session.scalars(select(Profile).where(Profile.id.in_(ids)))
        ).all()
    )
    by_id: dict[uuid.UUID, Profile] = {p.id: p for p in profiles}

    recipients: list[ActivityEmailRecipient] = []
    for user_id in ids:
        profile = by_id.get(user_id)
        if profile is None or profile.instant_email_opt_out:
            continue
        email = await email_for_user(session, user_id)
        if not email:
            continue
        recipients.append(
            ActivityEmailRecipient(
                user_id=user_id,
                email=email,
                first=profile.first,
                unsubscribe_token=profile.unsubscribe_token,
            )
        )
    return recipients


@dataclass
class StoryActivity:
    """Friend user-ids who read/commented on a single story.

    ``read`` maps to the reader's most-recent read timestamp (last_read_at,
    falling back to read_at for rows predating that column) rather than being
    a bare set, so avatar displays can show the most recent readers first and
    distinguish a just-now read from an old one.
    """

    read: dict[uuid.UUID, datetime] = field(default_factory=dict)
    commented: set[uuid.UUID] = field(default_factory=set)


async def global_activity_by_story(
    session: AsyncSession,
    story_ids: list[uuid.UUID],
) -> dict[uuid.UUID, StoryActivity]:
    """Map story_id -> global read/comment activity (all users)."""
    if not story_ids:
        return {}

    activity: dict[uuid.UUID, StoryActivity] = {}

    status_rows = (
        await session.execute(
            select(
                StoryStatus.story_id,
                StoryStatus.user_id,
                func.coalesce(StoryStatus.last_read_at, StoryStatus.read_at),
            ).where(
                StoryStatus.story_id.in_(story_ids),
                # read=True catches historical rows predating last_read_at;
                # last_read_at catches a fresh reading-ping that lands before
                # the separate /me/read call flips `read` (no ordering
                # guarantee between the two independent requests).
                or_(
                    StoryStatus.read.is_(True),
                    StoryStatus.last_read_at.is_not(None),
                ),
            )
        )
    ).all()
    for story_id, user_id, read_at in status_rows:
        entry = activity.setdefault(story_id, StoryActivity())
        if read_at is not None:
            entry.read[user_id] = read_at

    comment_rows = (
        await session.execute(
            select(Comment.story_id, Comment.user_id).where(
                Comment.story_id.in_(story_ids)
            )
        )
    ).all()
    for story_id, user_id in comment_rows:
        activity.setdefault(story_id, StoryActivity()).commented.add(user_id)

    return activity


async def friend_slots_used(
    session: AsyncSession, user_id: uuid.UUID, *, now: datetime | None = None
) -> int:
    """How many of a user's friend slots are taken.

    Counts accepted friends, friend requests the user sent that are still
    unanswered, and unexpired email invitations they sent. Outstanding requests
    and invitations count so the limit constrains outbound email rather than
    just the final friend list; incoming requests do not, so nobody else can
    fill up your account.
    """
    moment: datetime = now or datetime.now(UTC)
    connections: int | None = await session.scalar(
        select(func.count())
        .select_from(Connection)
        .where(
            or_(
                Connection.status == ConnectionStatus.accepted,
                (Connection.status == ConnectionStatus.pending)
                & (Connection.first_id == user_id),
            ),
            or_(
                Connection.first_id == user_id,
                Connection.second_id == user_id,
            ),
        )
    )
    invitations: int | None = await session.scalar(
        select(func.count())
        .select_from(Invitation)
        .where(
            Invitation.inviter_id == user_id,
            Invitation.status == InvitationStatus.pending,
            Invitation.reusable.is_(False),
            Invitation.invitee_email.is_not(None),
            or_(
                Invitation.expires_at.is_(None),
                Invitation.expires_at > moment,
            ),
        )
    )
    return int(connections or 0) + int(invitations or 0)


async def ensure_friend_capacity(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    settings: Settings | None = None,
) -> None:
    """Raise 409 when a user has no friend slot left."""
    cfg: Settings = settings or get_settings()
    used: int = await friend_slots_used(session, user_id)
    if used < cfg.max_friends:
        return
    raise HTTPException(
        status.HTTP_409_CONFLICT,
        f"You've reached the {cfg.max_friends}-friend limit. Remove a friend "
        f"or cancel a pending invite to make room.",
    )


async def accepted_friend_ids(session: AsyncSession, user_id: uuid.UUID) -> list[uuid.UUID]:
    """Return user ids of accepted connections (excluding self)."""
    rows = (
        await session.execute(
            select(Connection.first_id, Connection.second_id).where(
                Connection.status == ConnectionStatus.accepted,
                or_(Connection.first_id == user_id, Connection.second_id == user_id),
            )
        )
    ).all()
    friends: set[uuid.UUID] = set()
    for first_id, second_id in rows:
        other = second_id if first_id == user_id else first_id
        friends.add(other)
    return list(friends)


async def average_friend_count_for_active_users(session: AsyncSession) -> float:
    """Mean accepted-friend count among users who have posted or commented.

    Powers the "the average active user has N friends" nudge, so "active" is
    deliberately engagement-based rather than every signed-up profile — a long
    tail of empty accounts would drag the number toward zero and make the
    comparison meaningless.
    """
    active = (
        select(Post.author_id.label("user_id"))
        .union(select(Comment.user_id.label("user_id")))
        .subquery()
    )
    accepted_edges = (
        select(Connection.first_id.label("user_id"))
        .where(Connection.status == ConnectionStatus.accepted)
        .union_all(
            select(Connection.second_id.label("user_id")).where(
                Connection.status == ConnectionStatus.accepted
            )
        )
        .subquery()
    )
    per_user = (
        select(
            accepted_edges.c.user_id,
            func.count().label("friend_count"),
        )
        .group_by(accepted_edges.c.user_id)
        .subquery()
    )
    stmt = select(
        func.coalesce(func.avg(func.coalesce(per_user.c.friend_count, 0)), 0.0)
    ).select_from(
        active.outerjoin(per_user, per_user.c.user_id == active.c.user_id)
    )
    average = await session.scalar(stmt)
    return float(average) if average is not None else 0.0


async def friend_ids_for_users(
    session: AsyncSession, user_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, set[uuid.UUID]]:
    """Map each given user id -> ids of their accepted friends, in one query."""
    ids: list[uuid.UUID] = list({uid for uid in user_ids})
    if not ids:
        return {}
    rows = (
        await session.execute(
            select(Connection.first_id, Connection.second_id).where(
                Connection.status == ConnectionStatus.accepted,
                or_(
                    Connection.first_id.in_(ids),
                    Connection.second_id.in_(ids),
                ),
            )
        )
    ).all()
    wanted: set[uuid.UUID] = set(ids)
    result: dict[uuid.UUID, set[uuid.UUID]] = {uid: set() for uid in ids}
    for first_id, second_id in rows:
        if first_id in wanted:
            result[first_id].add(second_id)
        if second_id in wanted:
            result[second_id].add(first_id)
    return result


async def friend_reactors_by_story(
    session: AsyncSession,
    user_id: uuid.UUID,
    story_ids: list[uuid.UUID],
    *,
    friend_ids: list[uuid.UUID] | None = None,
) -> dict[uuid.UUID, list[Profile]]:
    """Map story_id -> profiles of friends who reacted to a post or comment
    about it (post_reactions joined via Post, comment_reactions via Comment)."""
    if not story_ids:
        return {}

    friends: list[uuid.UUID] = (
        friend_ids
        if friend_ids is not None
        else await accepted_friend_ids(session, user_id)
    )
    if not friends:
        return {}

    result: dict[uuid.UUID, dict[uuid.UUID, Profile]] = {}

    post_rows = (
        await session.execute(
            select(Post.story_id, Profile)
            .join(PostReaction, PostReaction.post_id == Post.id)
            .join(Profile, Profile.id == PostReaction.user_id)
            .where(
                Post.story_id.in_(story_ids),
                PostReaction.user_id.in_(friends),
            )
        )
    ).all()
    for story_id, profile in post_rows:
        result.setdefault(story_id, {})[profile.id] = profile

    comment_rows = (
        await session.execute(
            select(Comment.story_id, Profile)
            .join(CommentReaction, CommentReaction.comment_id == Comment.id)
            .join(Profile, Profile.id == CommentReaction.user_id)
            .where(
                Comment.story_id.in_(story_ids),
                CommentReaction.user_id.in_(friends),
            )
        )
    ).all()
    for story_id, profile in comment_rows:
        result.setdefault(story_id, {})[profile.id] = profile

    return {story_id: list(profiles.values()) for story_id, profiles in result.items()}


async def friend_activity_by_story(
    session: AsyncSession,
    user_id: uuid.UUID,
    story_ids: list[uuid.UUID],
    *,
    friend_ids: list[uuid.UUID] | None = None,
) -> dict[uuid.UUID, StoryActivity]:
    """Map story_id -> which friends read/commented on it.

    Only accounts in ``friend_ids`` (or the caller's accepted connections, if
    not given) are counted; the current user is excluded by default so counts
    reflect *friends'* engagement. Pass ``friend_ids=[*friends, user_id]`` for
    a self-inclusive result (e.g. "reading now" avatars) - self-exclusion is
    caller-controlled, not hardcoded here.
    """
    if not story_ids:
        return {}

    friends: list[uuid.UUID] = (
        friend_ids
        if friend_ids is not None
        else await accepted_friend_ids(session, user_id)
    )
    if not friends:
        return {}

    activity: dict[uuid.UUID, StoryActivity] = {}

    status_rows = (
        await session.execute(
            select(
                StoryStatus.story_id,
                StoryStatus.user_id,
                func.coalesce(StoryStatus.last_read_at, StoryStatus.read_at),
            ).where(
                StoryStatus.story_id.in_(story_ids),
                StoryStatus.user_id.in_(friends),
                or_(
                    StoryStatus.read.is_(True),
                    StoryStatus.last_read_at.is_not(None),
                ),
            )
        )
    ).all()
    for story_id, friend_id, read_at in status_rows:
        entry = activity.setdefault(story_id, StoryActivity())
        if read_at is not None:
            entry.read[friend_id] = read_at

    comment_rows = (
        await session.execute(
            select(Comment.story_id, Comment.user_id).where(
                Comment.story_id.in_(story_ids),
                Comment.user_id.in_(friends),
            )
        )
    ).all()
    for story_id, friend_id in comment_rows:
        activity.setdefault(story_id, StoryActivity()).commented.add(friend_id)

    return activity


def aggregate_engagement(
    activity: dict[uuid.UUID, StoryActivity],
    story_ids: Iterable[uuid.UUID],
) -> tuple[dict[uuid.UUID, datetime], int]:
    """Distinct friend readers (with most-recent read timestamp) and comment
    count across the given stories."""
    read: dict[uuid.UUID, datetime] = {}
    commented: set[uuid.UUID] = set()
    for sid in story_ids:
        entry = activity.get(sid)
        if entry is None:
            continue
        for uid, read_at in entry.read.items():
            existing = read.get(uid)
            if existing is None or read_at > existing:
                read[uid] = read_at
        commented |= entry.commented
    return read, len(commented)


async def friend_profiles_map(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    friend_ids: list[uuid.UUID] | None = None,
    include_self: bool = False,
) -> dict[uuid.UUID, Profile]:
    """Map friend user-id -> Profile for all accepted connections.

    ``include_self`` also includes ``user_id``'s own profile - for callers
    building a self-inclusive display (e.g. "reading now" avatars) that would
    otherwise silently drop the viewer's own entry since they're not in their
    own friend list.
    """
    friends: list[uuid.UUID] = (
        friend_ids
        if friend_ids is not None
        else await accepted_friend_ids(session, user_id)
    )
    ids: list[uuid.UUID] = [*friends, user_id] if include_self else friends
    if not ids:
        return {}
    rows = await session.scalars(select(Profile).where(Profile.id.in_(ids)))
    return {p.id: p for p in rows.all()}


FofActionKind = Literal["commented", "reacted", "read"]

# Tie-break priority when a post has actions from multiple friends at the same
# timestamp; primary sort is always most-recent-first.
_FOF_ACTION_PRIORITY: dict[FofActionKind, int] = {
    "commented": 0,  # most effortful/notable
    "reacted": 1,
    "read": 2,  # lightest signal
}


@dataclass(frozen=True)
class FofAction:
    """A direct friend's engagement that explains why a post is visible."""

    friend_id: uuid.UUID
    kind: FofActionKind
    acted_at: datetime


async def fof_attribution_by_post(
    session: AsyncSession,
    posts: list[Post],
    *,
    friend_ids: Sequence[uuid.UUID],
) -> dict[uuid.UUID, FofAction]:
    """Most-recent (tie-break: most notable) friend action that explains why
    each of `posts` is visible to the viewer.

    Callers should pre-filter `posts` to ones the viewer has no other path to
    (not the author, not a direct friend of the author, not a participant) -
    that's the only case that needs explaining, and the only case this is
    cheap to run for.
    """
    if not posts or not friend_ids:
        return {}

    post_ids = [p.id for p in posts]
    story_to_posts: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for p in posts:
        story_to_posts[p.story_id].append(p.id)
    story_ids = list(story_to_posts)

    candidates: dict[uuid.UUID, list[FofAction]] = defaultdict(list)

    comment_rows = (
        await session.execute(
            select(Comment.post_id, Comment.user_id, Comment.created_at).where(
                Comment.post_id.in_(post_ids), Comment.user_id.in_(friend_ids)
            )
        )
    ).all()
    for post_id, uid, ts in comment_rows:
        candidates[post_id].append(FofAction(uid, "commented", ts))

    reaction_rows = (
        await session.execute(
            select(
                PostReaction.post_id, PostReaction.user_id, PostReaction.updated_at
            ).where(
                PostReaction.post_id.in_(post_ids),
                PostReaction.user_id.in_(friend_ids),
            )
        )
    ).all()
    for post_id, uid, ts in reaction_rows:
        candidates[post_id].append(FofAction(uid, "reacted", ts))

    read_rows = (
        await session.execute(
            select(
                StoryStatus.story_id,
                StoryStatus.user_id,
                func.coalesce(StoryStatus.read_at, StoryStatus.updated_at),
            ).where(
                StoryStatus.story_id.in_(story_ids),
                StoryStatus.read.is_(True),
                StoryStatus.user_id.in_(friend_ids),
            )
        )
    ).all()
    for story_id, uid, ts in read_rows:
        for post_id in story_to_posts[story_id]:
            candidates[post_id].append(FofAction(uid, "read", ts))

    best: dict[uuid.UUID, FofAction] = {}
    for post_id, actions in candidates.items():
        actions.sort(key=lambda a: (a.acted_at, -_FOF_ACTION_PRIORITY[a.kind]))
        best[post_id] = actions[-1]
    return best


def top_readers(
    read: dict[uuid.UUID, datetime],
    profiles: dict[uuid.UUID, Profile],
    limit: int = 3,
) -> list[tuple[Profile, datetime]]:
    """Return up to `limit` (profile, last_read_at) pairs, most recent first."""
    ranked = sorted(read.items(), key=lambda item: item[1], reverse=True)
    out: list[tuple[Profile, datetime]] = []
    for rid, read_at in ranked:
        profile = profiles.get(rid)
        if profile is None:
            continue
        out.append((profile, read_at))
        if len(out) >= limit:
            break
    return out


def display_name(profile: Profile) -> str:
    if profile.first and profile.last:
        return f"{profile.first} {profile.last}"
    if profile.first:
        return profile.first
    return "Friend"


async def post_participant_ids(
    session: AsyncSession, post_id: uuid.UUID
) -> list[uuid.UUID]:
    """User ids who author or reply on a post."""
    rows = await session.scalars(
        select(PostParticipant.user_id).where(PostParticipant.post_id == post_id)
    )
    return list(rows.all())


def _fof_engagement_clause(user_ids: Iterable[uuid.UUID]) -> ColumnElement[bool]:
    """True when any of `user_ids` engaged with Post (via post_participants /
    post_reactions) or its Story (via story_statuses.read).

    Story-level engagement (reading) unlocks every Post tied to that
    story_id, not just one - a friend reading an article is vouching for the
    article, not for any one person's take on it, and there's often no single
    post to narrow to (e.g. a friend who read but never posted or replied).
    Post-level engagement (replying, reacting) stays scoped to that one post.
    Uses EXISTS (a semi-join) rather than outerjoin so combining engagement
    types doesn't fan out result rows.
    """
    ids = list(user_ids)
    return or_(
        exists().where(
            PostParticipant.post_id == Post.id,
            PostParticipant.user_id.in_(ids),
        ),
        exists().where(
            PostReaction.post_id == Post.id,
            PostReaction.user_id.in_(ids),
        ),
        exists().where(
            StoryStatus.story_id == Post.story_id,
            StoryStatus.read.is_(True),
            StoryStatus.user_id.in_(ids),
        ),
    )


async def can_see_post(
    session: AsyncSession,
    viewer_id: uuid.UUID | None,
    post: Post,
    *,
    friend_ids: list[uuid.UUID] | None = None,
    participant_ids: list[uuid.UUID] | None = None,
) -> bool:
    """True if viewer may see the post (author, participant, or a direct
    friend engaged with the post/its story - reply, reaction, or marking the
    story read)."""
    if viewer_id is None:
        return False
    if post.author_id == viewer_id:
        return True
    participants: list[uuid.UUID] = (
        participant_ids
        if participant_ids is not None
        else await post_participant_ids(session, post.id)
    )
    if viewer_id in participants:
        return True
    friends: list[uuid.UUID] = (
        friend_ids
        if friend_ids is not None
        else await accepted_friend_ids(session, viewer_id)
    )
    friend_set = set(friends)
    if any(pid in friend_set for pid in participants):
        return True
    if not friends:
        return False
    stmt = select(
        or_(
            exists().where(
                PostReaction.post_id == post.id,
                PostReaction.user_id.in_(friends),
            ),
            exists().where(
                StoryStatus.story_id == post.story_id,
                StoryStatus.read.is_(True),
                StoryStatus.user_id.in_(friends),
            ),
        )
    )
    return bool(await session.scalar(stmt))


def audience_label(visibility: PostVisibility, participant_count: int) -> str:
    """Human-readable audience for the composer / card chrome."""
    if participant_count <= 1:
        return "visible to friends"
    return f"visible to friends of {participant_count} participants"


async def visible_post_ids_for_viewer(
    session: AsyncSession,
    viewer_id: uuid.UUID | None,
    *,
    friend_ids: list[uuid.UUID] | None = None,
    limit: int = 100,
    since_days: int = 14,
    min_results: int = 0,
    max_since_days: int | None = None,
) -> list[uuid.UUID]:
    """Candidate post ids the viewer may see, newest-posted first.

    Authenticated users see private posts where they are the author or a
    direct friend engaged with the post or its story (participant, reaction,
    or reading). Guests see nothing.
    Sorted by ``created_at`` so a new reply - or a friend's later engagement -
    does not bump a post to the top.

    ``since_days`` keeps the common case cheap by only scanning recent posts. If
    that window yields fewer than ``min_results`` posts, the lookback widens to
    ``max_since_days`` (``None`` for no cutoff) so a quiet week still produces a
    full feed instead of a near-empty one. Note this windows on the post's own
    ``created_at``, not on when a friend engaged with it - a friend engaging
    with a post outside the lookback window does not resurrect it.
    """
    if viewer_id is None:
        return []

    friends: list[uuid.UUID] = (
        friend_ids
        if friend_ids is not None
        else await accepted_friend_ids(session, viewer_id)
    )

    def query(since: datetime | None) -> Select[tuple[uuid.UUID]]:
        participant_filter = [viewer_id, *friends]
        stmt = select(Post.id).where(
            or_(
                Post.author_id == viewer_id,
                _fof_engagement_clause(participant_filter),
            ),
        )
        if since is not None:
            stmt = stmt.where(Post.created_at >= since)
        return stmt.order_by(Post.created_at.desc()).limit(limit)

    now = datetime.now(UTC)
    recent = await session.scalars(query(now - timedelta(days=since_days)))
    post_ids: list[uuid.UUID] = list(recent.all())

    wanted: int = min(min_results, limit)
    if len(post_ids) >= wanted or (
        max_since_days is not None and max_since_days <= since_days
    ):
        return post_ids

    # Widen the window. The result is a superset in the same order, so it simply
    # replaces the recent-only pass.
    wider: datetime | None = (
        now - timedelta(days=max_since_days)
        if max_since_days is not None
        else None
    )
    return list((await session.scalars(query(wider))).all())


async def viewer_visible_post_ids(
    session: AsyncSession,
    viewer_id: uuid.UUID,
    post_ids: list[uuid.UUID],
    *,
    friend_ids: list[uuid.UUID] | None = None,
) -> set[uuid.UUID]:
    """Subset of ``post_ids`` the viewer is allowed to open."""
    if not post_ids:
        return set()

    friends: list[uuid.UUID] = (
        friend_ids
        if friend_ids is not None
        else await accepted_friend_ids(session, viewer_id)
    )
    participant_filter: list[uuid.UUID] = [viewer_id, *friends]
    rows = await session.scalars(
        select(Post.id).where(
            Post.id.in_(post_ids),
            or_(
                Post.author_id == viewer_id,
                _fof_engagement_clause(participant_filter),
            ),
        )
    )
    return set(rows.all())


async def primary_post_ids_by_story(
    session: AsyncSession,
    viewer_id: uuid.UUID,
    story_ids: list[uuid.UUID],
    *,
    friend_ids: list[uuid.UUID] | None = None,
) -> dict[uuid.UUID, uuid.UUID]:
    """Most recent viewer-visible post id per story (for search → detail links)."""
    if not story_ids:
        return {}

    friends: list[uuid.UUID] = (
        friend_ids
        if friend_ids is not None
        else await accepted_friend_ids(session, viewer_id)
    )
    participant_filter: list[uuid.UUID] = [viewer_id, *friends]
    rows = (
        await session.execute(
            select(Post.id, Post.story_id, Post.created_at)
            .where(
                Post.story_id.in_(story_ids),
                or_(
                    Post.author_id == viewer_id,
                    _fof_engagement_clause(participant_filter),
                ),
            )
            .order_by(Post.created_at.desc())
        )
    ).all()

    result: dict[uuid.UUID, uuid.UUID] = {}
    for post_id, story_id, _created_at in rows:
        if story_id not in result:
            result[story_id] = post_id
    return result
