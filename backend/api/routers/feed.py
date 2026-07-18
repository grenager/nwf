"""Unified feed: chronological visible posts (newest-posted first).

The feed endpoint is read-heavy and latency-critical, so it deliberately avoids
the per-post ``serialize_post`` helper (which fires ~10 queries each). Instead it
loads every candidate's related rows in a handful of batched ``IN (...)`` queries
and assembles the ``PostOut`` payloads in memory.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Query, Response
from sqlalchemy import func, select

from api.deps import OptionalUser, SessionDep
from api.friends import (
    StoryActivity,
    accepted_friend_ids,
    aggregate_engagement,
    audience_label,
    display_name,
    friend_activity_by_story,
    friend_profiles_map,
    ratings_for_users_by_story,
    top_readers,
    visible_post_ids_for_viewer,
)
from api.reactions import load_comment_reactions, load_post_reactions
from api.schemas import (
    AttachmentOut,
    CommentOut,
    FeedCardOut,
    FeedOut,
    FriendEngagementOut,
    FriendMiniOut,
    PostOut,
    ReactionSummary,
)
from core.attribution import resolve_attribution
from core.config import get_settings
from core.models import (
    Attachment,
    Comment,
    Post,
    PostParticipant,
    PostRead,
    PostVisibility,
    Profile,
    Source,
    Story,
    StoryStatus,
)

router = APIRouter(prefix="/feed", tags=["feed"])

# Guests get the same public payload; let the CDN/edge serve repeat loads.
_GUEST_CACHE_CONTROL: str = "public, s-maxage=30, stale-while-revalidate=300"


async def _touch_last_opened(
    session: SessionDep, user_id: uuid.UUID
) -> datetime | None:
    """Stamp the viewer's last_opened_at, returning the previous value.

    The update is left pending so it is flushed by the request-scoped commit in
    ``get_session`` rather than costing an extra synchronous round-trip here.
    """
    profile = await session.get(Profile, user_id)
    if profile is None:
        return None
    previous = profile.last_opened_at
    profile.last_opened_at = datetime.now(UTC)
    return previous


async def _participants_by_post(
    session: SessionDep, post_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[uuid.UUID]]:
    """Map post_id -> participant user ids in a single query."""
    if not post_ids:
        return {}
    rows = (
        await session.execute(
            select(PostParticipant.post_id, PostParticipant.user_id).where(
                PostParticipant.post_id.in_(post_ids)
            )
        )
    ).all()
    out: dict[uuid.UUID, list[uuid.UUID]] = {}
    for post_id, user_id in rows:
        out.setdefault(post_id, []).append(user_id)
    return out


async def _unread_reply_counts(
    session: SessionDep,
    viewer_id: uuid.UUID,
    post_ids: list[uuid.UUID],
    *,
    participant_post_ids: set[uuid.UUID],
) -> tuple[dict[uuid.UUID, int], dict[uuid.UUID, datetime]]:
    """Per-post unread reply counts and last_seen_at for the viewer.

    Only computed for threads the viewer authored or participates in.
    Unread = comments by someone else after the viewer's ``post_reads`` cursor.
    Posts with no cursor treat every non-own reply as unread.
    """
    if not post_ids:
        return {}, {}
    tracked: list[uuid.UUID] = [
        pid for pid in post_ids if pid in participant_post_ids
    ]
    if not tracked:
        return {}, {}
    seen_rows = (
        await session.execute(
            select(PostRead.post_id, PostRead.last_seen_at).where(
                PostRead.user_id == viewer_id,
                PostRead.post_id.in_(tracked),
            )
        )
    ).all()
    last_seen: dict[uuid.UUID, datetime] = {
        post_id: seen_at for post_id, seen_at in seen_rows
    }
    reply_rows = (
        await session.execute(
            select(Comment.post_id, Comment.created_at).where(
                Comment.post_id.in_(tracked),
                Comment.user_id != viewer_id,
            )
        )
    ).all()
    counts: dict[uuid.UUID, int] = {pid: 0 for pid in tracked}
    for post_id, created_at in reply_rows:
        if post_id is None:
            continue
        cursor = last_seen.get(post_id)
        if cursor is None or created_at > cursor:
            counts[post_id] = counts.get(post_id, 0) + 1
    return counts, last_seen


async def _build_post_outs(
    session: SessionDep,
    posts: list[Post],
    *,
    viewer_id: uuid.UUID | None,
    friends: list[uuid.UUID],
    stories: dict[uuid.UUID, Story],
    sources: dict[uuid.UUID, Source],
    participants_by_post: dict[uuid.UUID, list[uuid.UUID]],
    status_by_story: dict[uuid.UUID, StoryStatus],
    activity: dict[uuid.UUID, StoryActivity],
    friend_profiles: dict[uuid.UUID, Profile],
    unread_reply_counts: dict[uuid.UUID, int],
    last_seen_by_post: dict[uuid.UUID, datetime],
) -> dict[uuid.UUID, PostOut]:
    """Serialize a batch of posts into PostOut, using batched queries.

    Reproduces ``posts.serialize_post`` output field-for-field, but shares one
    query per relation (replies, reactions, attachments, ratings, profiles)
    across the whole batch instead of one per post.
    """
    if not posts:
        return {}

    post_ids: list[uuid.UUID] = [p.id for p in posts]
    story_ids: list[uuid.UUID] = list({p.story_id for p in posts})
    show_bodies: bool = viewer_id is not None
    friend_set: set[uuid.UUID] = set(friends)

    # Replies (+ their authors) for every post, ordered oldest-first.
    reply_rows = (
        await session.execute(
            select(Comment, Profile)
            .join(Profile, Profile.id == Comment.user_id)
            .where(Comment.post_id.in_(post_ids))
            .order_by(Comment.created_at.asc())
        )
    ).all()
    replies_by_post: dict[uuid.UUID, list[tuple[Comment, Profile]]] = {}
    comment_ids: list[uuid.UUID] = []
    reply_user_ids_by_story: dict[uuid.UUID, set[uuid.UUID]] = {}
    for comment, author in reply_rows:
        if comment.post_id is None:
            continue
        replies_by_post.setdefault(comment.post_id, []).append((comment, author))
        comment_ids.append(comment.id)
        reply_user_ids_by_story.setdefault(comment.story_id, set()).add(
            comment.user_id
        )

    comment_rx: dict[uuid.UUID, tuple[list[ReactionSummary], str | None]] = (
        await load_comment_reactions(session, comment_ids, viewer_id)
        if show_bodies
        else {}
    )
    post_rx = await load_post_reactions(session, post_ids, viewer_id)

    # Attachments for every post, ordered oldest-first.
    attachment_rows = list(
        (
            await session.scalars(
                select(Attachment)
                .where(Attachment.post_id.in_(post_ids))
                .order_by(Attachment.created_at.asc())
            )
        ).all()
    )
    attachments_by_post: dict[uuid.UUID, list[AttachmentOut]] = {}
    for attachment in attachment_rows:
        attachments_by_post.setdefault(attachment.post_id, []).append(
            AttachmentOut.model_validate(attachment)
        )

    # Author profiles (reply authors already loaded above via the join).
    author_ids: set[uuid.UUID] = {p.author_id for p in posts}
    author_profiles: dict[uuid.UUID, Profile] = {}
    if author_ids:
        author_profiles = {
            profile.id: profile
            for profile in (
                await session.scalars(
                    select(Profile).where(Profile.id.in_(author_ids))
                )
            ).all()
        }

    # Ratings for anyone who could show a rating on these stories.
    rater_ids: set[uuid.UUID] = set(friends) | author_ids
    for users in reply_user_ids_by_story.values():
        rater_ids |= users
    if viewer_id is not None:
        rater_ids.add(viewer_id)
    ratings_by_story = await ratings_for_users_by_story(
        session, story_ids, rater_ids
    )

    out_by_post: dict[uuid.UUID, PostOut] = {}
    for post in posts:
        story = stories.get(post.story_id)
        if story is None:
            continue
        source = sources.get(story.source_id) if story.source_id else None
        source_name, source_image_url = resolve_attribution(
            article_url=story.article_url,
            source_name=source.name if source else None,
            source_homepage_url=source.homepage_url if source else None,
            source_image_url=source.image_url if source else None,
            publisher=story.publisher,
        )
        participants = participants_by_post.get(post.id, [])
        participant_count = len(participants) or 1

        reply_pairs = replies_by_post.get(post.id, [])

        # Per-post rating map: only raters relevant to *this* post's story.
        story_ratings = ratings_by_story.get(story.id, {})
        post_rater_ids: set[uuid.UUID] = (
            {post.author_id}
            | {c.user_id for c, _ in reply_pairs}
            | friend_set
        )
        if viewer_id is not None:
            post_rater_ids.add(viewer_id)
        ratings_map: dict[uuid.UUID, float] = {
            uid: rating
            for uid, rating in story_ratings.items()
            if uid in post_rater_ids
        }

        replies: list[CommentOut] = []
        for comment, author in reply_pairs:
            reactions, my_reaction = comment_rx.get(comment.id, ([], None))
            replies.append(
                CommentOut(
                    id=comment.id,
                    story_id=comment.story_id,
                    post_id=comment.post_id,
                    parent_comment_id=comment.parent_comment_id,
                    user_id=comment.user_id,
                    author_name=display_name(author) if author else "Friend",
                    author_image_url=author.image_url if author else None,
                    text=comment.text,
                    author_rating=ratings_map.get(comment.user_id),
                    reactions=reactions,
                    my_reaction=my_reaction,
                    created_at=comment.created_at,
                    updated_at=comment.updated_at,
                )
            )

        read = False
        starred = False
        my_take: str | None = None
        status_row = status_by_story.get(story.id)
        if status_row is not None:
            read = bool(status_row.read)
            starred = bool(status_row.starred)
            my_take = status_row.take

        engagement = FriendEngagementOut()
        readers: list[FriendMiniOut] = []
        if viewer_id is not None:
            read_ids, commented_n = aggregate_engagement(activity, [story.id])
            readers = [
                FriendMiniOut(
                    user_id=p.id,
                    display_name=display_name(p),
                    image_url=p.image_url,
                )
                for p in top_readers(read_ids, friend_profiles)
            ]
            engagement = FriendEngagementOut(
                read=len(read_ids),
                commented=commented_n,
                readers=readers,
            )

        author_rating = ratings_map.get(post.author_id)
        my_rating = ratings_map.get(viewer_id) if viewer_id is not None else None
        rating_avg: float | None = None
        rating_count = 0
        if ratings_map:
            rating_avg = sum(ratings_map.values()) / len(ratings_map)
            rating_count = len(ratings_map)

        post_reactions, my_post_reaction = post_rx.get(post.id, ([], None))
        if not show_bodies:
            my_post_reaction = None

        author = author_profiles.get(post.author_id)
        unread_n = unread_reply_counts.get(post.id, 0)
        out_by_post[post.id] = PostOut(
            id=post.id,
            story_id=post.story_id,
            author_id=post.author_id,
            author_name=display_name(author) if author else "Friend",
            author_image_url=author.image_url if author else None,
            take=post.take,
            shared_text=post.shared_text,
            visibility=post.visibility,
            last_activity_at=post.last_activity_at,
            created_at=post.created_at,
            updated_at=post.updated_at,
            full_headline=story.full_headline,
            article_url=story.article_url,
            summary=story.summary,
            image_url=story.image_url,
            source_name=source_name,
            source_image_url=source_image_url,
            kind=story.kind,
            reply_count=len(reply_pairs),
            participant_count=participant_count,
            audience_label=audience_label(post.visibility, participant_count),
            replies=replies if show_bodies else [],
            attachments=attachments_by_post.get(post.id, []),
            author_rating=author_rating,
            reactions=post_reactions,
            my_reaction=my_post_reaction,
            read=read,
            starred=starred,
            my_rating=my_rating,
            rating_avg=rating_avg,
            rating_count=rating_count,
            my_take=my_take,
            engagement=engagement,
            readers=readers,
            unread_replies_for_viewer=unread_n > 0,
            unread_reply_count=unread_n,
            last_seen_at=last_seen_by_post.get(post.id),
        )

    return out_by_post


async def _empty_feed(
    session: SessionDep, new_since: datetime | None
) -> FeedOut:
    """Empty-state payload with the aggregate counts the empty state shows."""
    aggregate_readers = int(
        (
            await session.scalar(
                select(func.count())
                .select_from(StoryStatus)
                .where(StoryStatus.read.is_(True))
            )
        )
        or 0
    )
    aggregate_private = int(
        (
            await session.scalar(
                select(func.count())
                .select_from(Post)
                .where(Post.visibility == PostVisibility.private)
            )
        )
        or 0
    )
    return FeedOut(
        items=[],
        caught_up_after=0,
        unread_count=0,
        aggregate_readers=aggregate_readers,
        aggregate_private_conversations=aggregate_private,
        new_since=new_since,
    )


@router.get("", response_model=FeedOut)
async def get_feed(
    session: SessionDep,
    user: OptionalUser,
    response: Response,
    limit: int = Query(default=40, le=100, ge=1),
) -> FeedOut:
    """Chronological feed of visible posts, newest-posted first."""
    settings = get_settings()
    viewer_id: uuid.UUID | None = user.id if user is not None else None
    new_since: datetime | None = None
    friends: list[uuid.UUID] = []

    if viewer_id is None:
        # Public payload — let the edge cache serve repeat guest loads.
        response.headers["Cache-Control"] = _GUEST_CACHE_CONTROL
    else:
        new_since = await _touch_last_opened(session, viewer_id)
        friends = await accepted_friend_ids(session, viewer_id)

    post_ids = await visible_post_ids_for_viewer(
        session,
        viewer_id,
        friend_ids=friends if viewer_id is not None else None,
        limit=limit,
        since_days=settings.inbox_candidate_days,
    )

    # Aggregate counts are only rendered by the empty state, so only pay for
    # the full-table COUNT(*)s when the feed is actually empty.
    if not post_ids:
        return await _empty_feed(session, new_since)

    participants_by_post = await _participants_by_post(session, post_ids)

    posts = list(
        (
            await session.scalars(select(Post).where(Post.id.in_(post_ids)))
        ).all()
    )
    posts_by_id: dict[uuid.UUID, Post] = {p.id: p for p in posts}

    # Preserve created_at order from post_ids (newest first).
    ordered_posts: list[Post] = [
        posts_by_id[pid] for pid in post_ids if pid in posts_by_id
    ]

    story_ids = list({p.story_id for p in ordered_posts})
    stories: dict[uuid.UUID, Story] = {
        s.id: s
        for s in (
            await session.scalars(select(Story).where(Story.id.in_(story_ids)))
        ).all()
    }
    source_ids = {s.source_id for s in stories.values() if s.source_id}
    sources: dict[uuid.UUID, Source] = {}
    if source_ids:
        sources = {
            s.id: s
            for s in (
                await session.scalars(
                    select(Source).where(Source.id.in_(source_ids))
                )
            ).all()
        }

    # Viewer log state (ratings come from each serialized post below).
    status_by_story: dict[uuid.UUID, StoryStatus] = {}
    activity: dict[uuid.UUID, StoryActivity] = {}
    profiles: dict[uuid.UUID, Profile] = {}
    unread_reply_counts: dict[uuid.UUID, int] = {}
    last_seen_by_post: dict[uuid.UUID, datetime] = {}
    if viewer_id is not None and story_ids:
        status_rows = (
            await session.scalars(
                select(StoryStatus).where(
                    StoryStatus.user_id == viewer_id,
                    StoryStatus.story_id.in_(story_ids),
                )
            )
        ).all()
        status_by_story = {r.story_id: r for r in status_rows}
        activity = await friend_activity_by_story(
            session, viewer_id, story_ids, friend_ids=friends
        )
        profiles = await friend_profiles_map(
            session, viewer_id, friend_ids=friends
        )
        participant_post_ids: set[uuid.UUID] = {
            pid
            for pid, users in participants_by_post.items()
            if viewer_id in users
        } | {
            p.id for p in ordered_posts if p.author_id == viewer_id
        }
        unread_reply_counts, last_seen_by_post = await _unread_reply_counts(
            session,
            viewer_id,
            [p.id for p in ordered_posts],
            participant_post_ids=participant_post_ids,
        )

    post_outs = await _build_post_outs(
        session,
        ordered_posts,
        viewer_id=viewer_id,
        friends=friends,
        stories=stories,
        sources=sources,
        participants_by_post=participants_by_post,
        status_by_story=status_by_story,
        activity=activity,
        friend_profiles=profiles,
        unread_reply_counts=unread_reply_counts,
        last_seen_by_post=last_seen_by_post,
    )

    # One card per post. We intentionally do NOT merge multiple posts about the
    # same article: if two people share the same link, they show as two posts.
    cards: list[FeedCardOut] = []
    for post in ordered_posts:
        story = stories.get(post.story_id)
        if story is None:
            continue
        out = post_outs.get(post.id)
        if out is None:
            continue
        sid = post.story_id
        source = sources.get(story.source_id) if story.source_id else None

        status_row = status_by_story.get(sid)
        read = bool(status_row.read) if status_row else False
        starred = bool(status_row.starred) if status_row else False
        my_take = status_row.take if status_row else None

        engagement = FriendEngagementOut()
        if viewer_id is not None:
            read_ids, commented_n = aggregate_engagement(activity, [sid])
            engagement = FriendEngagementOut(
                read=len(read_ids),
                commented=commented_n,
                readers=[
                    FriendMiniOut(
                        user_id=p.id,
                        display_name=display_name(p),
                        image_url=p.image_url,
                    )
                    for p in top_readers(read_ids, profiles)
                ],
            )

        source_name, source_image_url = resolve_attribution(
            article_url=story.article_url,
            source_name=source.name if source else None,
            source_homepage_url=source.homepage_url if source else None,
            source_image_url=source.image_url if source else None,
            publisher=story.publisher,
        )
        cards.append(
            FeedCardOut(
                card_id=post.id,
                story_id=sid,
                full_headline=story.full_headline,
                article_url=story.article_url,
                summary=story.summary,
                image_url=story.image_url,
                source_name=source_name,
                source_image_url=source_image_url,
                kind=story.kind,
                read=read,
                starred=starred,
                my_rating=out.my_rating,
                rating_avg=out.rating_avg,
                rating_count=out.rating_count,
                my_take=my_take,
                engagement=engagement,
                posts=[out],
                score=0.0,
                unread_reply_count=out.unread_reply_count,
            )
        )

    return FeedOut(
        items=cards,
        caught_up_after=0,
        unread_count=sum(1 for c in cards if c.unread_reply_count > 0),
        aggregate_readers=0,
        aggregate_private_conversations=0,
        new_since=new_since,
    )
