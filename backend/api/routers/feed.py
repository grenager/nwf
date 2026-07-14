"""Unified feed: ranked visible posts grouped by story."""

from __future__ import annotations

import math
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from api.deps import OptionalUser, SessionDep
from api.friends import (
    StoryActivity,
    accepted_friend_ids,
    aggregate_engagement,
    display_name,
    friend_activity_by_story,
    friend_profiles_map,
    post_participant_ids,
    top_readers,
    visible_post_ids_for_viewer,
)
from api.routers.posts import serialize_post
from api.schemas import (
    FeedCardOut,
    FeedOut,
    FriendEngagementOut,
    FriendMiniOut,
)
from core.attribution import resolve_attribution
from core.config import get_settings
from core.models import (
    Comment,
    Post,
    PostParticipant,
    PostVisibility,
    Profile,
    Source,
    Story,
    StoryKind,
    StoryStatus,
)

router = APIRouter(prefix="/feed", tags=["feed"])

_NEWS_HALFLIFE_HOURS: float = 48.0
_ANALYSIS_HALFLIFE_HOURS: float = 14.0 * 24.0


def _decay(kind: StoryKind, age_hours: float) -> float:
    half = (
        _NEWS_HALFLIFE_HOURS
        if kind == StoryKind.news
        else _ANALYSIS_HALFLIFE_HOURS
    )
    return math.exp(-age_hours / half)


async def _touch_last_opened(
    session: SessionDep, user_id: uuid.UUID
) -> datetime | None:
    profile = await session.get(Profile, user_id)
    if profile is None:
        return None
    previous = profile.last_opened_at
    profile.last_opened_at = datetime.now(UTC)
    await session.commit()
    return previous


@router.get("", response_model=FeedOut)
async def get_feed(
    session: SessionDep,
    user: OptionalUser,
    limit: int = Query(default=40, le=100, ge=1),
) -> FeedOut:
    """Single ranked feed of visible posts, grouped one card per story."""
    settings = get_settings()
    viewer_id: uuid.UUID | None = user.id if user is not None else None
    new_since: datetime | None = None
    friends: list[uuid.UUID] = []

    if viewer_id is not None:
        new_since = await _touch_last_opened(session, viewer_id)
        friends = await accepted_friend_ids(session, viewer_id)

    post_ids = await visible_post_ids_for_viewer(
        session,
        viewer_id,
        friend_ids=friends if viewer_id is not None else None,
        limit=limit * 3,
        since_days=settings.inbox_candidate_days,
    )

    # Aggregate counts for guest empty-state honesty.
    aggregate_readers = int(
        (
            await session.scalar(
                select(func.count()).select_from(StoryStatus).where(
                    StoryStatus.read.is_(True)
                )
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

    if not post_ids:
        return FeedOut(
            items=[],
            caught_up_after=0,
            unread_count=0,
            aggregate_readers=aggregate_readers,
            aggregate_private_conversations=aggregate_private,
            new_since=new_since,
        )

    posts = list(
        (
            await session.scalars(select(Post).where(Post.id.in_(post_ids)))
        ).all()
    )
    posts_by_id: dict[uuid.UUID, Post] = {p.id: p for p in posts}

    # Preserve activity order from post_ids
    ordered_posts: list[Post] = [
        posts_by_id[pid] for pid in post_ids if pid in posts_by_id
    ]

    now = datetime.now(UTC)
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
                await session.scalars(select(Source).where(Source.id.in_(source_ids)))
            ).all()
        }

    # Viewer log state (ratings come from each serialized post below).
    status_by_story: dict[uuid.UUID, StoryStatus] = {}
    activity: dict[uuid.UUID, StoryActivity] = {}
    profiles: dict[uuid.UUID, Profile] = {}
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

    # Which posts have unread replies for the viewer (replies by others after
    # the viewer's last participation, simplified: any reply by non-viewer when
    # viewer is a participant).
    unread_post_ids: set[uuid.UUID] = set()
    if viewer_id is not None:
        participant_post_ids = set(
            (
                await session.scalars(
                    select(PostParticipant.post_id).where(
                        PostParticipant.user_id == viewer_id,
                        PostParticipant.post_id.in_(post_ids),
                    )
                )
            ).all()
        )
        if participant_post_ids:
            reply_rows = (
                await session.execute(
                    select(Comment.post_id, Comment.user_id).where(
                        Comment.post_id.in_(participant_post_ids),
                        Comment.user_id != viewer_id,
                    )
                )
            ).all()
            for pid, _uid in reply_rows:
                if pid is not None:
                    unread_post_ids.add(pid)

    # Score each post then group by story.
    scored: list[tuple[float, Post, bool]] = []
    for post in ordered_posts:
        story = stories.get(post.story_id)
        if story is None:
            continue
        age_hours = max(
            (now - post.last_activity_at).total_seconds() / 3600.0, 0.0
        )
        recency = _decay(story.kind, age_hours)
        unread_boost = 10.0 if post.id in unread_post_ids else 0.0
        friend_boost = 0.0
        if viewer_id is not None:
            participants = await post_participant_ids(session, post.id)
            friend_set = set(friends)
            friend_participants = sum(1 for p in participants if p in friend_set)
            friend_boost = min(friend_participants, 5) * 0.5
        score = recency + unread_boost + friend_boost
        scored.append((score, post, post.id in unread_post_ids))

    scored.sort(key=lambda t: t[0], reverse=True)

    # One card per post. We intentionally do NOT merge multiple posts about the
    # same article: if two people share the same link, they show as two posts.
    cards: list[FeedCardOut] = []
    unread_count = 0
    for score, post, is_unread in scored[:limit]:
        story = stories.get(post.story_id)
        if story is None:
            continue
        sid = post.story_id
        source = sources.get(story.source_id) if story.source_id else None
        if is_unread:
            unread_count += 1

        out = await serialize_post(
            session,
            post,
            viewer_id=viewer_id,
            include_replies=True,
            friend_ids=friends if viewer_id is not None else None,
        )
        out.unread_replies_for_viewer = is_unread

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
                score=score,
            )
        )

    # Caught-up boundary: unread / resurrected / recently-active cards first,
    # then the rest. A card is "fresh" when any of its posts saw activity since
    # the viewer previously opened the feed — this keeps your own just-shared
    # post (and new friend activity) above the line even though sharing marks
    # the story read. Guests (new_since is None) treat unread purely by state.
    def _is_fresh(card: FeedCardOut) -> bool:
        if new_since is None:
            return False
        return any(post.last_activity_at > new_since for post in card.posts)

    unread_cards: list[FeedCardOut] = []
    read_cards: list[FeedCardOut] = []
    for c in cards:
        fresh = (
            any(p.unread_replies_for_viewer for p in c.posts)
            or not c.read
            or _is_fresh(c)
        )
        (unread_cards if fresh else read_cards).append(c)
    ordered = unread_cards + read_cards
    caught_up_after = len(unread_cards)

    return FeedOut(
        items=ordered,
        caught_up_after=caught_up_after,
        unread_count=unread_count if viewer_id is not None else len(ordered),
        aggregate_readers=aggregate_readers,
        aggregate_private_conversations=aggregate_private,
        new_since=new_since,
    )
