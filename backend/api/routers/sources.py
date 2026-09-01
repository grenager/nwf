"""Source pages: every visible conversation about articles from one publication.

Keyed by the article *host*, not by a ``sources`` row. Attribution only
sometimes resolves to a curated :class:`~core.models.Source` (see
``core.attribution``) — Substack newsletters and one-off links fall back to a
publisher label or the bare host — so the host is the only identity every
article reliably has, and the one the web app can derive from an article URL
without an extra field on every payload.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from api.deps import OptionalUser, SessionDep
from api.friends import (
    accepted_friend_ids,
    display_name,
    visible_post_ids_for_viewer,
)
from api.schemas import SourceOut, SourcePostOut
from core.attribution import resolve_attribution
from core.enrich import registrable_host
from core.models import Comment, Post, Profile, Source, Story

router = APIRouter(prefix="/sources", tags=["sources"])

# A source page is a back catalogue, not a feed — look past the feed's recent
# window so an outlet you read last month still has a page worth visiting.
_LOOKBACK_DAYS: int = 3650

# How many of the viewer's visible posts to scan for a host match.
_CANDIDATE_CAP: int = 500


def normalize_host(host: str) -> str:
    """Lowercase, strip ``www.`` — the same shape ``registrable_host`` returns."""
    cleaned: str = host.strip().lower()
    return cleaned[4:] if cleaned.startswith("www.") else cleaned


async def _reply_counts(
    session: SessionDep, post_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    if not post_ids:
        return {}
    rows = (
        await session.execute(
            select(Comment.post_id, func.count(Comment.id))
            .where(Comment.post_id.in_(post_ids))
            .group_by(Comment.post_id)
        )
    ).all()
    return {post_id: total for post_id, total in rows if post_id is not None}


@router.get("/{host}", response_model=SourceOut)
async def get_source(
    host: str,
    session: SessionDep,
    user: OptionalUser,
    limit: int = Query(default=50, le=200, ge=1),
) -> SourceOut:
    """The publication behind ``host``, plus the conversations the viewer can see.

    An unknown host is not an error: it renders as an empty page named after
    the host itself, the same way a source with no visible posts yet does.
    """
    wanted: str = normalize_host(host)
    if user is None or not wanted:
        return SourceOut(host=wanted, name=wanted or "Unknown source")

    # Host lives inside `stories.article_url`, so there is nothing to filter on
    # in SQL without a LIKE that would misfire on subdomains and paths. Pull the
    # viewer's visible posts and match hosts here instead — the cap keeps that
    # bounded, at the cost of truncating a very prolific viewer's back catalogue.
    friends: list[uuid.UUID] = await accepted_friend_ids(session, user.id)
    candidate_ids: list[uuid.UUID] = await visible_post_ids_for_viewer(
        session,
        user.id,
        friend_ids=friends,
        limit=_CANDIDATE_CAP,
        since_days=_LOOKBACK_DAYS,
    )
    if not candidate_ids:
        return SourceOut(host=wanted, name=wanted)

    rows = (
        await session.execute(
            select(Post, Story, Profile, Source)
            .join(Story, Story.id == Post.story_id)
            .join(Profile, Profile.id == Post.author_id)
            .outerjoin(Source, Source.id == Story.source_id)
            .where(Post.id.in_(candidate_ids))
            .order_by(Post.created_at.desc())
        )
    ).all()

    matched = [
        (post, story, author, source)
        for post, story, author, source in rows
        if registrable_host(story.article_url) == wanted
    ]
    if not matched:
        return SourceOut(host=wanted, name=wanted)

    # Identity comes from whichever matched story carries the richest
    # attribution: prefer one with a logo, then any resolved name.
    name: str = wanted
    image_url: str | None = None
    homepage_url: str | None = None
    for _post, story, _author, source in matched:
        resolved_name, resolved_image = resolve_attribution(
            article_url=story.article_url,
            source_name=source.name if source else None,
            source_homepage_url=source.homepage_url if source else None,
            source_image_url=source.image_url if source else None,
            publisher=story.publisher,
        )
        if resolved_name and name == wanted:
            name = resolved_name
        if resolved_image and image_url is None:
            image_url = resolved_image
            name = resolved_name or name
        if source is not None and homepage_url is None:
            homepage_url = source.homepage_url
        if image_url is not None and homepage_url is not None:
            break

    shown = matched[:limit]
    counts = await _reply_counts(session, [post.id for post, _, _, _ in shown])

    return SourceOut(
        host=wanted,
        name=name,
        image_url=image_url,
        homepage_url=homepage_url,
        post_count=len(matched),
        posts=[
            SourcePostOut(
                post_id=post.id,
                story_id=story.id,
                full_headline=story.full_headline,
                article_url=story.article_url,
                summary=story.summary,
                image_url=story.image_url,
                author_id=author.id,
                author_name=display_name(author),
                author_image_url=author.image_url,
                take=post.take,
                reply_count=counts.get(post.id, 0),
                created_at=post.created_at,
                last_activity_at=post.last_activity_at,
            )
            for post, story, author, _source in shown
        ],
    )


__all__ = ["router"]
