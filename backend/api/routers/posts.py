"""Posts: share an article with an optional take; replies live underneath."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from api.deps import CurrentUser, OptionalUser, SessionDep
from api.friends import (
    accepted_friend_ids,
    aggregate_engagement,
    audience_label,
    can_see_post,
    display_name,
    friend_activity_by_story,
    friend_profiles_map,
    my_reactions_by_story,
    post_participant_ids,
    top_readers,
)
from api.schemas import (
    AttachmentOut,
    CommentOut,
    FriendEngagementOut,
    FriendMiniOut,
    PostCreate,
    PostOut,
)
from core.classify import classify_story_kind
from core.enrich import fetch_url_metadata, hosts_match, registrable_host
from core.models import (
    Attachment,
    Comment,
    Post,
    PostParticipant,
    Profile,
    Source,
    SourceKind,
    Story,
    StoryKind,
    StoryStatus,
)

router = APIRouter(prefix="/posts", tags=["posts"])


def _headline_from_url(url: str) -> str:
    parsed = urlparse(url)
    path: str = parsed.path.rstrip("/")
    slug: str = path.rsplit("/", 1)[-1] if path else ""
    slug = slug.rsplit(".", 1)[0]
    words: list[str] = [w for w in slug.replace("_", "-").split("-") if w]
    if not words or all(w.isdigit() for w in words):
        return parsed.netloc or url
    return " ".join(w.capitalize() for w in words)


async def _match_source_for_url(session: SessionDep, url: str) -> Source | None:
    """Find a curated source whose homepage host matches the article URL."""
    story_host = registrable_host(url)
    if story_host is None:
        return None
    sources = list((await session.scalars(select(Source))).all())
    for source in sources:
        if hosts_match(story_host, registrable_host(source.homepage_url)):
            return source
    return None


async def _ensure_story(
    session: SessionDep,
    *,
    story_id: uuid.UUID | None,
    url: str | None,
    title: str | None,
    kind: StoryKind,
) -> Story:
    if story_id is not None:
        story = await session.get(Story, story_id)
        if story is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "story not found")
        return story
    if not url or not url.strip():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "story_id or url is required"
        )
    clean_url: str = url.strip()
    existing = await session.scalar(select(Story).where(Story.article_url == clean_url))
    if existing is not None:
        return existing

    # Enrich from the page's metadata and match a known source by domain.
    metadata = await fetch_url_metadata(clean_url)
    source = await _match_source_for_url(session, clean_url)
    source_kind: SourceKind = source.kind if source is not None else SourceKind.outlet
    resolved_kind = classify_story_kind(clean_url, None, source_kind)

    provided_title = (title or "").strip()
    headline = (
        provided_title
        or (metadata.title or "").strip()
        or _headline_from_url(clean_url)
    )
    story = Story(
        article_url=clean_url,
        source_id=source.id if source is not None else None,
        full_headline=headline,
        summary=metadata.description,
        image_url=metadata.image_url,
        kind=resolved_kind if kind == StoryKind.news else kind,
    )
    session.add(story)
    await session.flush()
    return story


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


def _comment_out(comment: Comment, author: Profile | None) -> CommentOut:
    return CommentOut(
        id=comment.id,
        story_id=comment.story_id,
        post_id=comment.post_id,
        user_id=comment.user_id,
        author_name=display_name(author) if author else "Friend",
        author_image_url=author.image_url if author else None,
        text=comment.text,
        created_at=comment.created_at,
        updated_at=comment.updated_at,
    )


async def serialize_post(
    session: SessionDep,
    post: Post,
    *,
    viewer_id: uuid.UUID | None,
    include_replies: bool = True,
    friend_ids: list[uuid.UUID] | None = None,
) -> PostOut:
    """Build a PostOut with story teaser, replies, attachments, engagement."""
    story = await session.get(Story, post.story_id)
    if story is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "story not found")
    author = await session.get(Profile, post.author_id)
    source = (
        await session.get(Source, story.source_id) if story.source_id else None
    )
    participants = await post_participant_ids(session, post.id)
    participant_count = len(participants) or 1

    replies: list[CommentOut] = []
    if include_replies:
        rows = (
            await session.execute(
                select(Comment, Profile)
                .join(Profile, Profile.id == Comment.user_id)
                .where(Comment.post_id == post.id)
                .order_by(Comment.created_at.asc())
            )
        ).all()
        replies = [_comment_out(c, a) for c, a in rows]

    attachments = list(
        (
            await session.scalars(
                select(Attachment)
                .where(Attachment.post_id == post.id)
                .order_by(Attachment.created_at.asc())
            )
        ).all()
    )
    attachment_outs = [
        AttachmentOut.model_validate(a) for a in attachments
    ]

    read = False
    starred = False
    my_take: str | None = None
    my_reaction: str | None = None
    engagement = FriendEngagementOut()
    readers: list[FriendMiniOut] = []
    unread_replies = False

    if viewer_id is not None:
        status_row = await session.get(
            StoryStatus, {"user_id": viewer_id, "story_id": story.id}
        )
        if status_row is not None:
            read = bool(status_row.read)
            starred = bool(status_row.starred)
            my_take = status_row.take
        reactions = await my_reactions_by_story(session, viewer_id, [story.id])
        my_reaction = reactions.get(story.id)
        friends = (
            friend_ids
            if friend_ids is not None
            else await accepted_friend_ids(session, viewer_id)
        )
        activity = await friend_activity_by_story(
            session, viewer_id, [story.id], friend_ids=friends
        )
        read_ids, commented_n, reaction_counts = aggregate_engagement(
            activity, [story.id]
        )
        profiles = await friend_profiles_map(
            session, viewer_id, friend_ids=friends
        )
        readers = [
            FriendMiniOut(
                user_id=p.id, display_name=display_name(p), image_url=p.image_url
            )
            for p in top_readers(read_ids, profiles)
        ]
        engagement = FriendEngagementOut(
            read=len(read_ids),
            commented=commented_n,
            reactions=reaction_counts,
            readers=readers,
        )
        # Unread replies: any reply after the viewer's last_opened on this post
        # simplification — any reply from someone else counts as unread until
        # the viewer has interacted; feed.py applies a stricter rule.
        if viewer_id in participants or post.author_id == viewer_id:
            unread_replies = any(r.user_id != viewer_id for r in replies)

    return PostOut(
        id=post.id,
        story_id=post.story_id,
        author_id=post.author_id,
        author_name=display_name(author) if author else "Friend",
        author_image_url=author.image_url if author else None,
        take=post.take,
        visibility=post.visibility,
        last_activity_at=post.last_activity_at,
        created_at=post.created_at,
        updated_at=post.updated_at,
        full_headline=story.full_headline,
        article_url=story.article_url,
        summary=story.summary,
        image_url=story.image_url,
        source_name=source.name if source else None,
        source_image_url=source.image_url if source else None,
        kind=story.kind,
        reply_count=len(replies),
        participant_count=participant_count,
        audience_label=audience_label(post.visibility, participant_count),
        replies=replies,
        attachments=attachment_outs,
        read=read,
        starred=starred,
        my_reaction=my_reaction,
        my_take=my_take,
        engagement=engagement,
        readers=readers,
        unread_replies_for_viewer=unread_replies,
    )


@router.post("", response_model=PostOut, status_code=status.HTTP_201_CREATED)
async def create_post(
    payload: PostCreate, session: SessionDep, user: CurrentUser
) -> PostOut:
    story = await _ensure_story(
        session,
        story_id=payload.story_id,
        url=payload.url,
        title=payload.title,
        kind=payload.kind,
    )
    post = Post(
        story_id=story.id,
        author_id=user.id,
        take=(payload.take or "").strip() or None,
        visibility=payload.visibility,
        last_activity_at=datetime.now(UTC),
    )
    session.add(post)
    await session.flush()
    await _add_participant(session, post.id, user.id)

    # Writing a take also logs the story as read.
    read_stmt = (
        pg_insert(StoryStatus)
        .values(
            user_id=user.id,
            story_id=story.id,
            read=True,
            read_at=func.now(),
            take=post.take,
        )
        .on_conflict_do_update(
            index_elements=[StoryStatus.user_id, StoryStatus.story_id],
            set_={
                "read": True,
                "read_at": func.now(),
                "take": post.take,
                "updated_at": func.now(),
            },
        )
    )
    await session.execute(read_stmt)
    await session.refresh(post)
    return await serialize_post(session, post, viewer_id=user.id)


@router.get("", response_model=list[PostOut])
async def list_my_posts(
    session: SessionDep,
    user: CurrentUser,
    limit: int = Query(default=50, le=100, ge=1),
) -> list[PostOut]:
    posts = list(
        (
            await session.scalars(
                select(Post)
                .where(Post.author_id == user.id)
                .order_by(Post.created_at.desc())
                .limit(limit)
            )
        ).all()
    )
    return [
        await serialize_post(session, p, viewer_id=user.id, include_replies=False)
        for p in posts
    ]


@router.get("/{post_id}", response_model=PostOut)
async def get_post(
    post_id: uuid.UUID, session: SessionDep, user: OptionalUser
) -> PostOut:
    post = await session.get(Post, post_id)
    if post is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "post not found")
    viewer_id: uuid.UUID | None = user.id if user is not None else None
    if not await can_see_post(session, viewer_id, post):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not permitted")
    return await serialize_post(session, post, viewer_id=viewer_id)


@router.delete("/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_post(
    post_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> None:
    post = await session.get(Post, post_id)
    if post is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "post not found")
    if post.author_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not the author")
    await session.delete(post)
