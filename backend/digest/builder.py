"""Build a per-user activity digest from posts, comments, and reactions."""

from __future__ import annotations

import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.friends import accepted_friend_ids
from core.models import Comment, Post, PostReaction, Profile, Source, Story
from digest.copy import (
    first_name,
    phrase_comments_on_your_post,
    phrase_friend_post,
    phrase_reactions_on_your_post,
    phrase_reply_to_comment,
)

# Lower number = higher priority in the email.
PRIORITY_REPLY = 1
PRIORITY_COMMENT_ON_YOURS = 2
PRIORITY_REACTION_ON_YOURS = 3
PRIORITY_FRIEND_POST_ENGAGED = 4
PRIORITY_FRIEND_POST = 5

MAX_LINES_DEFAULT: int = 6


@dataclass(frozen=True)
class DigestLine:
    """One bullet in the digest email."""

    text: str
    post_id: uuid.UUID | None
    priority: int
    headline: str | None = None
    image_url: str | None = None
    source_label: str | None = None
    actor_image_urls: tuple[str, ...] = ()


@dataclass
class UserDigest:
    """Digest payload ready to render into an email."""

    profile: Profile
    email: str
    lines: list[DigestLine] = field(default_factory=list)
    total_new: int = 0


def _story_meta(story: Story | None) -> tuple[str | None, str | None, str | None]:
    """Return (headline, image_url, source_label) for a story."""
    if story is None:
        return None, None, None
    source_label: str | None = None
    source: Source | None = story.source
    if source is not None and source.name and source.name.strip():
        source_label = source.name.strip()
    elif story.publisher and story.publisher.strip():
        source_label = story.publisher.strip()
    return story.full_headline, story.image_url, source_label


def _avatar_urls(
    profiles: dict[uuid.UUID, Profile],
    user_ids: list[uuid.UUID],
    *,
    max_avatars: int = 3,
) -> tuple[str, ...]:
    """Unique profile image URLs for actors, preserving order."""
    seen: set[uuid.UUID] = set()
    urls: list[str] = []
    for uid in user_ids:
        if uid in seen:
            continue
        seen.add(uid)
        profile: Profile | None = profiles.get(uid)
        if profile is None:
            continue
        url: str | None = profile.image_url
        if url and url.strip():
            urls.append(url.strip())
        if len(urls) >= max_avatars:
            break
    return tuple(urls)


async def _load_profiles(
    session: AsyncSession, user_ids: set[uuid.UUID]
) -> dict[uuid.UUID, Profile]:
    if not user_ids:
        return {}
    rows = await session.scalars(select(Profile).where(Profile.id.in_(user_ids)))
    return {p.id: p for p in rows.all()}


async def build_user_digest(
    session: AsyncSession,
    profile: Profile,
    email: str,
    since: datetime,
    *,
    max_lines: int = MAX_LINES_DEFAULT,
) -> UserDigest | None:
    """Assemble ranked digest lines for one user, or None if nothing new."""
    viewer_id: uuid.UUID = profile.id
    friends: list[uuid.UUID] = await accepted_friend_ids(session, viewer_id)
    friend_set: set[uuid.UUID] = set(friends)

    lines: list[DigestLine] = []
    actor_ids: set[uuid.UUID] = set()

    # --- Replies to the viewer's comments ---------------------------------
    my_comment_ids: list[uuid.UUID] = list(
        (await session.scalars(select(Comment.id).where(Comment.user_id == viewer_id))).all()
    )
    replies: list[Comment] = []
    if my_comment_ids:
        replies = list(
            (
                await session.scalars(
                    select(Comment)
                    .where(
                        Comment.parent_comment_id.in_(my_comment_ids),
                        Comment.user_id != viewer_id,
                        Comment.created_at > since,
                    )
                    .options(
                        selectinload(Comment.post)
                        .selectinload(Post.story)
                        .selectinload(Story.source)
                    )
                    .order_by(Comment.created_at.desc())
                )
            ).all()
        )

    reply_by_post: dict[uuid.UUID, list[Comment]] = defaultdict(list)
    for reply in replies:
        if reply.post_id is not None:
            reply_by_post[reply.post_id].append(reply)
            actor_ids.add(reply.user_id)

    # --- Comments on the viewer's posts -----------------------------------
    my_posts: list[Post] = list(
        (
            await session.scalars(
                select(Post)
                .where(Post.author_id == viewer_id)
                .options(selectinload(Post.story).selectinload(Story.source))
            )
        ).all()
    )
    my_post_ids: list[uuid.UUID] = [p.id for p in my_posts]
    my_post_by_id: dict[uuid.UUID, Post] = {p.id: p for p in my_posts}

    comments_on_mine: list[Comment] = []
    if my_post_ids:
        comments_on_mine = list(
            (
                await session.scalars(
                    select(Comment)
                    .where(
                        Comment.post_id.in_(my_post_ids),
                        Comment.user_id != viewer_id,
                        Comment.created_at > since,
                        Comment.parent_comment_id.is_(None),
                    )
                    .order_by(Comment.created_at.desc())
                )
            ).all()
        )
    comments_by_post: dict[uuid.UUID, list[Comment]] = defaultdict(list)
    for comment in comments_on_mine:
        if comment.post_id is not None:
            comments_by_post[comment.post_id].append(comment)
            actor_ids.add(comment.user_id)

    # --- Reactions on the viewer's posts ----------------------------------
    post_reactions: list[PostReaction] = []
    if my_post_ids:
        post_reactions = list(
            (
                await session.scalars(
                    select(PostReaction).where(
                        PostReaction.post_id.in_(my_post_ids),
                        PostReaction.user_id != viewer_id,
                        PostReaction.created_at > since,
                    )
                )
            ).all()
        )
    reactions_by_post: dict[uuid.UUID, list[PostReaction]] = defaultdict(list)
    for reaction in post_reactions:
        reactions_by_post[reaction.post_id].append(reaction)
        actor_ids.add(reaction.user_id)

    # --- New friend posts -------------------------------------------------
    friend_posts: list[Post] = []
    if friends:
        friend_posts = list(
            (
                await session.scalars(
                    select(Post)
                    .where(
                        Post.author_id.in_(friends),
                        Post.created_at > since,
                    )
                    .options(selectinload(Post.story).selectinload(Story.source))
                    .order_by(Post.created_at.desc())
                    .limit(40)
                )
            ).all()
        )
    friend_post_ids: list[uuid.UUID] = [p.id for p in friend_posts]
    friend_post_by_id: dict[uuid.UUID, Post] = {p.id: p for p in friend_posts}
    for post in friend_posts:
        actor_ids.add(post.author_id)

    friend_comments_by_post: dict[uuid.UUID, list[Comment]] = defaultdict(list)
    friend_reactions_by_post: dict[uuid.UUID, list[PostReaction]] = defaultdict(list)
    if friend_post_ids:
        for comment in (
            await session.scalars(
                select(Comment).where(
                    Comment.post_id.in_(friend_post_ids),
                    Comment.user_id != viewer_id,
                    Comment.created_at > since,
                )
            )
        ).all():
            if comment.post_id is None:
                continue
            author_id: uuid.UUID = friend_post_by_id[comment.post_id].author_id
            if comment.user_id != author_id and comment.user_id in friend_set:
                friend_comments_by_post[comment.post_id].append(comment)
                actor_ids.add(comment.user_id)

        for reaction in (
            await session.scalars(
                select(PostReaction).where(
                    PostReaction.post_id.in_(friend_post_ids),
                    PostReaction.user_id != viewer_id,
                    PostReaction.created_at > since,
                )
            )
        ).all():
            author_id = friend_post_by_id[reaction.post_id].author_id
            if reaction.user_id != author_id and reaction.user_id in friend_set:
                friend_reactions_by_post[reaction.post_id].append(reaction)
                actor_ids.add(reaction.user_id)

    profiles: dict[uuid.UUID, Profile] = await _load_profiles(session, actor_ids)

    def _name(uid: uuid.UUID) -> str:
        actor: Profile | None = profiles.get(uid)
        return first_name(actor.first if actor is not None else None)

    for post_id, reply_list in reply_by_post.items():
        actor_ids_ordered: list[uuid.UUID] = [r.user_id for r in reply_list]
        names: list[str] = [_name(uid) for uid in actor_ids_ordered]
        post_obj: Post | None = reply_list[0].post if reply_list else None
        headline, image, source_label = _story_meta(
            post_obj.story if post_obj is not None else None
        )
        lines.append(
            DigestLine(
                text=phrase_reply_to_comment(names),
                post_id=post_id,
                priority=PRIORITY_REPLY,
                headline=headline,
                image_url=image,
                source_label=source_label,
                actor_image_urls=_avatar_urls(profiles, actor_ids_ordered),
            )
        )

    for post_id, comment_list in comments_by_post.items():
        actor_ids_ordered = [c.user_id for c in comment_list]
        names = [_name(uid) for uid in actor_ids_ordered]
        post_obj = my_post_by_id.get(post_id)
        headline, image, source_label = _story_meta(
            post_obj.story if post_obj is not None else None
        )
        lines.append(
            DigestLine(
                text=phrase_comments_on_your_post(names),
                post_id=post_id,
                priority=PRIORITY_COMMENT_ON_YOURS,
                headline=headline,
                image_url=image,
                source_label=source_label,
                actor_image_urls=_avatar_urls(profiles, actor_ids_ordered),
            )
        )

    for post_id, reaction_list in reactions_by_post.items():
        actor_ids_ordered = [r.user_id for r in reaction_list]
        names = [_name(uid) for uid in actor_ids_ordered]
        post_obj = my_post_by_id.get(post_id)
        headline, image, source_label = _story_meta(
            post_obj.story if post_obj is not None else None
        )
        lines.append(
            DigestLine(
                text=phrase_reactions_on_your_post(len(reaction_list), names=names),
                post_id=post_id,
                priority=PRIORITY_REACTION_ON_YOURS,
                headline=headline,
                image_url=image,
                source_label=source_label,
                actor_image_urls=_avatar_urls(profiles, actor_ids_ordered),
            )
        )

    for post in friend_posts:
        author_profile: Profile | None = profiles.get(post.author_id)
        author: str = first_name(author_profile.first if author_profile is not None else None)
        comment_count: int = len(
            {c.user_id for c in friend_comments_by_post.get(post.id, [])}
        )
        reaction_count: int = len(
            {r.user_id for r in friend_reactions_by_post.get(post.id, [])}
        )
        engaged: bool = comment_count > 0 or reaction_count > 0
        headline, image, source_label = _story_meta(post.story)
        # Author first, then friends who engaged.
        engagers: list[uuid.UUID] = [
            c.user_id for c in friend_comments_by_post.get(post.id, [])
        ] + [r.user_id for r in friend_reactions_by_post.get(post.id, [])]
        lines.append(
            DigestLine(
                text=phrase_friend_post(
                    author,
                    friend_comment_count=comment_count,
                    friend_reaction_count=reaction_count,
                ),
                post_id=post.id,
                priority=(
                    PRIORITY_FRIEND_POST_ENGAGED if engaged else PRIORITY_FRIEND_POST
                ),
                headline=headline,
                image_url=image,
                source_label=source_label,
                actor_image_urls=_avatar_urls(profiles, [post.author_id, *engagers]),
            )
        )

    if not lines:
        return None

    lines.sort(key=lambda line: (line.priority, line.text))
    total_new: int = len(lines)
    capped: list[DigestLine] = lines[:max_lines]
    overflow: int = total_new - len(capped)
    if overflow > 0:
        capped.append(
            DigestLine(
                text=(
                    f"+{overflow} more update{'s' if overflow != 1 else ''} "
                    f"in your feed"
                ),
                post_id=None,
                priority=99,
            )
        )

    return UserDigest(
        profile=profile,
        email=email,
        lines=capped,
        total_new=total_new,
    )
