"""Posts: share an article with an optional take; replies live underneath."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from api.activity_mail import notify_friends_of_new_post
from api.deps import CurrentUser, OptionalUser, SessionDep
from api.friends import (
    accepted_friend_ids,
    aggregate_engagement,
    audience_label,
    average_friend_count_for_active_users,
    can_see_post,
    display_name,
    friend_activity_by_story,
    friend_ids_for_users,
    friend_profiles_map,
    post_participant_ids,
    top_readers,
)
from api.reactions import (
    delete_post_reaction,
    load_comment_reactions,
    load_post_reactions,
    upsert_post_reaction,
)
from api.schemas import (
    AttachmentOut,
    AudienceMemberOut,
    AudienceRelation,
    CommentOut,
    FriendEngagementOut,
    PostAudienceOut,
    PostCreate,
    PostOut,
    PostReactorOut,
    PostTyperOut,
    PostUpdate,
    PreviewCreate,
    PreviewOut,
    ReactionSet,
    ReactionSummary,
    StoryReaderOut,
    TypingPing,
)
from core.attribution import resolve_attribution
from core.classify import classify_story_kind
from core.config import get_settings
from core.enrich import (
    UrlMetadata,
    fetch_url_metadata,
    hosts_match,
    registrable_host,
)
from core.mentions import resolve_mentioned_friend_ids
from core.models import (
    Attachment,
    Comment,
    NotificationKind,
    Post,
    PostMention,
    PostParticipant,
    PostReaction,
    PostRead,
    PostTyping,
    PostVisibility,
    Profile,
    Source,
    SourceKind,
    Story,
    StoryKind,
    StoryStatus,
)
from core.notifications import create_notification, delete_reaction_notification

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


def _is_hostlike(headline: str, url: str) -> bool:
    """True when the headline is just the site host (no real title yet)."""
    text = headline.strip().lower()
    if not text:
        return True
    host = registrable_host(url)
    return host is not None and text in {host, f"www.{host}"}


def _has_html(text: str | None) -> bool:
    """True when a stored string still carries HTML markup (aggregator junk)."""
    return text is not None and "<" in text and ">" in text


def _looks_unenriched(story: Story) -> bool:
    """A story we likely created from a bare URL without page metadata."""
    missing_meta = (
        story.source_id is None
        and story.image_url is None
        and story.summary is None
    )
    return (
        missing_meta
        or _is_hostlike(story.full_headline, story.article_url)
        or _has_html(story.summary)
    )


async def _story_by_url(session: SessionDep, url: str) -> Story | None:
    result: Story | None = await session.scalar(
        select(Story).where(Story.article_url == url)
    )
    return result


async def _ensure_story(
    session: SessionDep,
    *,
    story_id: uuid.UUID | None,
    url: str | None,
    title: str | None,
    kind: StoryKind,
    metadata: UrlMetadata | None = None,
    publisher_override: str | None = None,
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

    existing = await _story_by_url(session, clean_url)
    if existing is not None and not _looks_unenriched(existing):
        return existing

    # Prefer client-supplied preview metadata (from POST /posts/preview) so
    # create doesn't re-scrape. Fall back to a fresh fetch for legacy callers.
    if metadata is None:
        metadata = await fetch_url_metadata(clean_url)
    canonical: str = (metadata.canonical_url or "").strip() or clean_url

    # The canonical article may already exist as its own story (e.g. scraped
    # from its RSS feed). Prefer it so a shared redirect wrapper doesn't create
    # a duplicate detached from the real, source-backed story.
    target: Story | None = existing
    if canonical != clean_url:
        canonical_story = await _story_by_url(session, canonical)
        if canonical_story is not None and (
            existing is None or canonical_story.id != existing.id
        ):
            return canonical_story

    source = await _match_source_for_url(session, canonical)
    source_kind: SourceKind = source.kind if source is not None else SourceKind.outlet
    resolved_kind = classify_story_kind(canonical, None, source_kind)
    if kind != StoryKind.news:
        resolved_kind = kind

    provided_title = (title or "").strip()
    headline = (
        provided_title
        or (metadata.title or "").strip()
        or _headline_from_url(canonical)
    )
    publisher = (publisher_override or "").strip() or metadata.publisher_label(
        canonical
    )

    if target is not None:
        if provided_title or _is_hostlike(target.full_headline, target.article_url):
            target.full_headline = headline
        # Replace an empty summary, or one still carrying aggregator HTML (e.g.
        # a Hacker News "<a ...>Comments</a>" blurb), with the real description.
        if metadata.description and (
            not target.summary or _has_html(target.summary)
        ):
            target.summary = metadata.description
        if not target.image_url and metadata.image_url:
            target.image_url = metadata.image_url
        if publisher and not target.publisher:
            target.publisher = publisher
        if target.source_id is None and source is not None:
            target.source_id = source.id
        # Only trust classification when a known source backed it.
        if source is not None:
            target.kind = resolved_kind
        # Upgrade the stored URL to the canonical article when it is free.
        if (
            canonical != target.article_url
            and await _story_by_url(session, canonical) is None
        ):
            target.article_url = canonical
        await session.flush()
        return target

    story = Story(
        article_url=canonical,
        source_id=source.id if source is not None else None,
        full_headline=headline,
        summary=metadata.description,
        image_url=metadata.image_url,
        publisher=publisher,
        kind=resolved_kind,
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


async def _sync_post_mentions(session: SessionDep, post: Post) -> None:
    """Replace a post's mention rows from its take; grant mentioned friends access.

    Only accepted friends of the author are recorded (self and non-friends are
    ignored). Each mentioned friend becomes a participant so they can see the
    post even when it is private.
    """
    friends = await accepted_friend_ids(session, post.author_id)
    mentioned: list[uuid.UUID] = resolve_mentioned_friend_ids(
        post.take, allowed_ids=friends, exclude_id=post.author_id
    )
    previous_ids: set[uuid.UUID] = set(
        (
            await session.scalars(
                select(PostMention.mentioned_user_id).where(
                    PostMention.post_id == post.id
                )
            )
        ).all()
    )
    await session.execute(
        delete(PostMention).where(PostMention.post_id == post.id)
    )
    for mentioned_id in mentioned:
        session.add(
            PostMention(post_id=post.id, mentioned_user_id=mentioned_id)
        )
        await _add_participant(session, post.id, mentioned_id)
        # Only alert newly mentioned friends (edits shouldn't re-ping).
        if mentioned_id not in previous_ids:
            await create_notification(
                session,
                recipient_id=mentioned_id,
                actor_id=post.author_id,
                kind=NotificationKind.mention,
                post_id=post.id,
                story_id=post.story_id,
            )


def _comment_out(
    comment: Comment,
    author: Profile | None,
    *,
    reactions: list[ReactionSummary] | None = None,
    my_reaction: str | None = None,
) -> CommentOut:
    return CommentOut(
        id=comment.id,
        story_id=comment.story_id,
        post_id=comment.post_id,
        parent_comment_id=comment.parent_comment_id,
        user_id=comment.user_id,
        author_name=display_name(author) if author else "Friend",
        author_image_url=author.image_url if author else None,
        text=comment.text,
        reactions=reactions if reactions is not None else [],
        my_reaction=my_reaction,
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
    force_replies: bool = False,
) -> PostOut:
    """Build a PostOut with story teaser, replies, attachments, engagement.

    When ``force_replies`` is True (token-scoped invite preview), reply bodies
    are returned even for unauthenticated viewers.
    """
    story = await session.get(Story, post.story_id)
    if story is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "story not found")
    author = await session.get(Profile, post.author_id)
    source = (
        await session.get(Source, story.source_id) if story.source_id else None
    )
    source_name, source_image_url = resolve_attribution(
        article_url=story.article_url,
        source_name=source.name if source else None,
        source_homepage_url=source.homepage_url if source else None,
        source_image_url=source.image_url if source else None,
        publisher=story.publisher,
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
        # Guests (unless force_replies) get counts without reaction detail.
        show_reply_bodies: bool = viewer_id is not None or force_replies
        comment_rx = (
            await load_comment_reactions(
                session, [c.id for c, _ in rows], viewer_id
            )
            if show_reply_bodies
            else {}
        )
        replies = [
            _comment_out(
                c,
                a,
                reactions=comment_rx.get(c.id, ([], None))[0],
                my_reaction=comment_rx.get(c.id, ([], None))[1],
            )
            for c, a in rows
        ]

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
    engagement = FriendEngagementOut()
    readers: list[StoryReaderOut] = []
    unread_replies = False
    friends: list[uuid.UUID] = []

    if viewer_id is not None:
        status_row = await session.get(
            StoryStatus, {"user_id": viewer_id, "story_id": story.id}
        )
        if status_row is not None:
            read = bool(status_row.read)
            starred = bool(status_row.starred)
            my_take = status_row.take
        friends = (
            friend_ids
            if friend_ids is not None
            else await accepted_friend_ids(session, viewer_id)
        )
        # Self-inclusive: the "reading now"/"read" avatar stack shows the
        # viewer's own entry too, as confirmation their open registered.
        activity = await friend_activity_by_story(
            session, viewer_id, [story.id], friend_ids=[*friends, viewer_id]
        )
        read_map, commented_n = aggregate_engagement(activity, [story.id])
        profiles = await friend_profiles_map(
            session, viewer_id, friend_ids=friends, include_self=True
        )
        readers = [
            StoryReaderOut(
                user_id=p.id,
                display_name=display_name(p),
                image_url=p.image_url,
                last_read_at=read_at,
            )
            for p, read_at in top_readers(read_map, profiles)
        ]
        engagement = FriendEngagementOut(
            read=len(read_map),
            commented=commented_n,
            readers=readers,
        )

    # Per-thread read cursor → unread reply count (only for threads you're in).
    unread_reply_count = 0
    last_seen_at: datetime | None = None
    if viewer_id is not None and (
        viewer_id in participants or post.author_id == viewer_id
    ):
        cursor = await session.get(
            PostRead, {"user_id": viewer_id, "post_id": post.id}
        )
        if cursor is not None:
            last_seen_at = cursor.last_seen_at
        for reply in replies:
            if reply.user_id == viewer_id:
                continue
            if last_seen_at is None or reply.created_at > last_seen_at:
                unread_reply_count += 1
        unread_replies = unread_reply_count > 0

    show_bodies: bool = viewer_id is not None or force_replies
    post_rx = await load_post_reactions(session, [post.id], viewer_id)
    post_reactions, my_post_reaction = post_rx.get(post.id, ([], None))
    if not show_bodies:
        my_post_reaction = None

    return PostOut(
        id=post.id,
        story_id=post.story_id,
        author_id=post.author_id,
        author_name=display_name(author) if author else "Friend",
        author_image_url=author.image_url if author else None,
        take=post.take,
        shared_text=post.shared_text,
        quote=post.quote,
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
        reply_count=len(replies),
        participant_count=participant_count,
        audience_label=audience_label(post.visibility, participant_count),
        # Guests get the count only; reply content is gated behind auth
        # unless force_replies (token-scoped invite preview).
        replies=replies if show_bodies else [],
        attachments=attachment_outs,
        reactions=post_reactions,
        my_reaction=my_post_reaction,
        read=read,
        starred=starred,
        my_take=my_take,
        engagement=engagement,
        readers=readers,
        unread_replies_for_viewer=unread_replies,
        unread_reply_count=unread_reply_count,
        last_seen_at=last_seen_at,
    )


@router.post("/preview", response_model=PreviewOut)
async def preview_url(
    payload: PreviewCreate, session: SessionDep, user: CurrentUser
) -> PreviewOut:
    """Resolve OpenGraph metadata for a URL without creating a post.

    Used by the share composer to show a live preview before the user posts.
    Returns 422 when the page yields no usable metadata so the client can
    block posting rather than creating a bare-host card.
    """
    del user  # auth required; value unused
    clean_url: str = payload.url.strip()
    parsed = urlparse(clean_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Couldn't load a preview for this link",
        )

    metadata = await fetch_url_metadata(clean_url)
    has_usable: bool = bool(
        metadata.title or metadata.description or metadata.image_url
    )
    if not has_usable:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Couldn't load a preview for this link",
        )

    canonical: str = (metadata.canonical_url or "").strip() or clean_url
    source = await _match_source_for_url(session, canonical)
    source_kind: SourceKind = (
        source.kind if source is not None else SourceKind.outlet
    )
    resolved_kind = classify_story_kind(canonical, None, source_kind)
    if payload.kind != StoryKind.news:
        resolved_kind = payload.kind

    headline = (metadata.title or "").strip() or _headline_from_url(canonical)
    publisher = metadata.publisher_label(canonical)
    source_name, source_image_url = resolve_attribution(
        article_url=canonical,
        source_name=source.name if source else None,
        source_homepage_url=source.homepage_url if source else None,
        source_image_url=source.image_url if source else None,
        publisher=publisher,
    )
    return PreviewOut(
        canonical_url=canonical,
        full_headline=headline,
        summary=metadata.description,
        image_url=metadata.image_url,
        source_name=source_name,
        source_image_url=source_image_url,
        kind=resolved_kind,
        publisher=publisher,
        platform=metadata.platform,
    )


@router.post("", response_model=PostOut, status_code=status.HTTP_201_CREATED)
async def create_post(
    payload: PostCreate, session: SessionDep, user: CurrentUser
) -> PostOut:
    preview_meta: UrlMetadata | None = None
    has_preview: bool = bool(
        (payload.full_headline or "").strip()
        or (payload.canonical_url or "").strip()
        or (payload.image_url or "").strip()
        or (payload.summary or "").strip()
    )
    if has_preview:
        preview_meta = UrlMetadata(
            title=(payload.full_headline or payload.title or "").strip() or None,
            description=(payload.summary or "").strip() or None,
            image_url=(payload.image_url or "").strip() or None,
            site_name=(payload.publisher or "").strip() or None,
            canonical_url=(payload.canonical_url or "").strip() or None,
            platform=(payload.platform or "").strip() or None,
        )
    story = await _ensure_story(
        session,
        story_id=payload.story_id,
        url=payload.url,
        title=payload.full_headline or payload.title,
        kind=payload.kind,
        metadata=preview_meta,
        publisher_override=payload.publisher,
    )
    post = Post(
        story_id=story.id,
        author_id=user.id,
        take=(payload.take or "").strip() or None,
        shared_text=(payload.shared_text or "").strip() or None,
        quote=(payload.quote or "").strip() or None,
        visibility=PostVisibility.private,
        last_activity_at=datetime.now(UTC),
    )
    session.add(post)
    await session.flush()
    await _add_participant(session, post.id, user.id)
    await _sync_post_mentions(session, post)

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
    author = await session.get(Profile, user.id)
    if author is not None:
        await notify_friends_of_new_post(
            session, post=post, story=story, author=author
        )
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


_RELATION_ORDER: dict[AudienceRelation, int] = {
    "author": 0,
    "your_friend": 1,
    "author_friend": 2,
    "participant": 3,
    "friend_of_participant": 4,
}


@router.get("/{post_id}/audience", response_model=PostAudienceOut)
async def get_post_audience(
    post_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> PostAudienceOut:
    """Everyone who can already read this thread, grouped by how they got access.

    Mirrors ``can_see_post``: participants plus friends of any participant. The
    viewer is omitted from ``people`` since their own access is implicit.
    """
    post = await session.get(Post, post_id)
    if post is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "post not found")
    if not await can_see_post(session, user.id, post):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not permitted")

    participants: set[uuid.UUID] = set(
        await post_participant_ids(session, post.id)
    )
    participants.add(post.author_id)
    participants.add(user.id)

    friends_by_user = await friend_ids_for_users(session, participants)
    viewer_friends: set[uuid.UUID] = friends_by_user.get(user.id, set())
    author_friends: set[uuid.UUID] = friends_by_user.get(post.author_id, set())

    audience: set[uuid.UUID] = set(participants)
    for participant_id in participants:
        audience |= friends_by_user.get(participant_id, set())
    audience.discard(user.id)

    profiles: dict[uuid.UUID, Profile] = {}
    if audience:
        rows = await session.scalars(
            select(Profile).where(Profile.id.in_(audience))
        )
        profiles = {p.id: p for p in rows.all()}

    def relation_for(candidate_id: uuid.UUID) -> AudienceRelation:
        if candidate_id == post.author_id:
            return "author"
        if candidate_id in viewer_friends:
            return "your_friend"
        if candidate_id in author_friends:
            return "author_friend"
        if candidate_id in participants:
            return "participant"
        return "friend_of_participant"

    people: list[AudienceMemberOut] = []
    for candidate_id in audience:
        profile = profiles.get(candidate_id)
        if profile is None:
            continue
        people.append(
            AudienceMemberOut(
                user_id=candidate_id,
                display_name=display_name(profile),
                image_url=profile.image_url,
                relation=relation_for(candidate_id),
            )
        )
    people.sort(key=lambda p: (_RELATION_ORDER[p.relation], p.display_name))

    author_profile = await session.get(Profile, post.author_id)
    return PostAudienceOut(
        post_id=post.id,
        visibility=post.visibility,
        viewer_is_author=post.author_id == user.id,
        author_id=post.author_id,
        author_name=(
            display_name(author_profile) if author_profile is not None else "Friend"
        ),
        people=people,
        your_friend_count=len(viewer_friends),
        author_friend_count=len(author_friends),
        average_friend_count=await average_friend_count_for_active_users(session),
    )


@router.post("/{post_id}/typing-ping", status_code=status.HTTP_204_NO_CONTENT)
async def ping_typing(
    post_id: uuid.UUID, payload: TypingPing, session: SessionDep, user: CurrentUser
) -> None:
    """Refresh the live 'typing' timestamp - fired on a throttled keystroke,
    left to expire rather than cleared on blur/send."""
    if payload.post_id != post_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "post_id mismatch")
    post = await session.get(Post, post_id)
    if post is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "post not found")
    if not await can_see_post(session, user.id, post):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not permitted")

    stmt = (
        pg_insert(PostTyping)
        .values(post_id=post_id, user_id=user.id, updated_at=func.now())
        .on_conflict_do_update(
            index_elements=[PostTyping.post_id, PostTyping.user_id],
            set_={"updated_at": func.now()},
        )
    )
    await session.execute(stmt)


@router.get("/{post_id}/typers", response_model=list[PostTyperOut])
async def get_typers(
    post_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> list[PostTyperOut]:
    """Everyone else currently typing on this post's comments."""
    post = await session.get(Post, post_id)
    if post is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "post not found")
    if not await can_see_post(session, user.id, post):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not permitted")

    cutoff = datetime.now(UTC) - timedelta(
        seconds=get_settings().typing_indicator_window_seconds
    )
    profiles = (
        await session.scalars(
            select(Profile)
            .join(PostTyping, PostTyping.user_id == Profile.id)
            .where(
                PostTyping.post_id == post_id,
                PostTyping.user_id != user.id,
                PostTyping.updated_at > cutoff,
            )
        )
    ).all()
    return [
        PostTyperOut(user_id=p.id, display_name=display_name(p), image_url=p.image_url)
        for p in profiles
    ]


@router.patch("/{post_id}", response_model=PostOut)
async def update_post(
    post_id: uuid.UUID,
    payload: PostUpdate,
    session: SessionDep,
    user: CurrentUser,
) -> PostOut:
    post = await session.get(Post, post_id)
    if post is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "post not found")
    if post.author_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not the author")

    fields = payload.model_fields_set
    if "take" in fields:
        new_take: str | None = (payload.take or "").strip() or None
        post.take = new_take
        # Keep the mirrored Log take in sync so ambient presence matches.
        status_row = await session.get(
            StoryStatus, {"user_id": user.id, "story_id": post.story_id}
        )
        if status_row is not None:
            status_row.take = new_take
        await _sync_post_mentions(session, post)
    if "shared_text" in fields:
        post.shared_text = (payload.shared_text or "").strip() or None
    if "quote" in fields:
        post.quote = (payload.quote or "").strip() or None
    post.updated_at = datetime.now(UTC)
    await session.flush()
    await session.refresh(post)
    return await serialize_post(session, post, viewer_id=user.id)


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


@router.put("/{post_id}/reactions", response_model=PostOut)
async def set_post_reaction(
    post_id: uuid.UUID,
    payload: ReactionSet,
    session: SessionDep,
    user: CurrentUser,
) -> PostOut:
    post = await session.get(Post, post_id)
    if post is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "post not found")
    if not await can_see_post(session, user.id, post):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not permitted")
    await upsert_post_reaction(
        session,
        user_id=user.id,
        post_id=post.id,
        reaction=payload.reaction,
    )
    await create_notification(
        session,
        recipient_id=post.author_id,
        actor_id=user.id,
        kind=NotificationKind.post_reaction,
        post_id=post.id,
        story_id=post.story_id,
    )
    await session.flush()
    return await serialize_post(session, post, viewer_id=user.id)


@router.delete("/{post_id}/reactions", response_model=PostOut)
async def clear_post_reaction(
    post_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> PostOut:
    post = await session.get(Post, post_id)
    if post is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "post not found")
    if not await can_see_post(session, user.id, post):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not permitted")
    await delete_post_reaction(session, user_id=user.id, post_id=post.id)
    await delete_reaction_notification(
        session,
        recipient_id=post.author_id,
        actor_id=user.id,
        kind=NotificationKind.post_reaction,
        post_id=post.id,
    )
    await session.flush()
    return await serialize_post(session, post, viewer_id=user.id)


@router.get("/{post_id}/reactions", response_model=list[PostReactorOut])
async def list_post_reactors(
    post_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> list[PostReactorOut]:
    """Everyone who has reacted to this post, most-recent-first."""
    post = await session.get(Post, post_id)
    if post is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "post not found")
    if not await can_see_post(session, user.id, post):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not permitted")
    rows = (
        await session.execute(
            select(PostReaction, Profile)
            .join(Profile, Profile.id == PostReaction.user_id)
            .where(PostReaction.post_id == post_id)
            .order_by(PostReaction.updated_at.desc())
        )
    ).all()
    return [
        PostReactorOut(
            user_id=profile.id,
            display_name=display_name(profile),
            image_url=profile.image_url,
            reaction=reaction_row.reaction,
            reacted_at=reaction_row.updated_at,
        )
        for reaction_row, profile in rows
    ]
