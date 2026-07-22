"""Comments are replies under a post; maintain post_participants on insert.

Supports one level of nesting via ``parent_comment_id`` (deeper replies are
flattened to the top-level ancestor) and emoji reactions on comments.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import Row, delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from api.activity_mail import notify_comment_activity
from api.deps import CurrentUser, SessionDep
from api.friends import (
    accepted_friend_ids,
    can_see_post,
    display_name,
    ratings_for_users_by_story,
)
from api.reactions import (
    delete_comment_reaction,
    load_comment_reactions,
    upsert_comment_reaction,
)
from api.schemas import (
    CommentCreate,
    CommentOut,
    CommentUpdate,
    ReactionSet,
    ReactionSummary,
)
from core.mentions import resolve_mentioned_friend_ids
from core.models import (
    Comment,
    CommentMention,
    NotificationKind,
    Post,
    PostParticipant,
    Profile,
    Story,
)
from core.notifications import create_notification, delete_reaction_notification

router = APIRouter(prefix="/comments", tags=["comments"])


def _to_out(
    comment: Comment,
    author: Profile | None,
    rating: float | None = None,
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
        author_rating=rating,
        reactions=reactions if reactions is not None else [],
        my_reaction=my_reaction,
        created_at=comment.created_at,
        updated_at=comment.updated_at,
    )


async def _single_rating(
    session: SessionDep, user_id: uuid.UUID, story_id: uuid.UUID
) -> float | None:
    """The commenter's own half-star rating of the story, if any."""
    return (
        await ratings_for_users_by_story(session, [story_id], [user_id])
    ).get(story_id, {}).get(user_id)


async def _rated_outs(
    session: SessionDep,
    rows: Sequence[Row[tuple[Comment, Profile]]],
    ratings: dict[uuid.UUID, dict[uuid.UUID, float]],
    viewer_id: uuid.UUID | None,
) -> list[CommentOut]:
    reaction_map = await load_comment_reactions(
        session, [c.id for c, _ in rows], viewer_id
    )
    outs: list[CommentOut] = []
    for c, a in rows:
        summaries, mine = reaction_map.get(c.id, ([], None))
        outs.append(
            _to_out(
                c,
                a,
                ratings.get(c.story_id, {}).get(c.user_id),
                reactions=summaries,
                my_reaction=mine,
            )
        )
    return outs


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


async def _sync_comment_mentions(
    session: SessionDep, comment: Comment
) -> None:
    """Replace a comment's mention rows; grant mentioned friends post access.

    Only accepted friends of the commenter are recorded. Each mentioned friend
    becomes a post participant so they can see the private thread.
    """
    friends = await accepted_friend_ids(session, comment.user_id)
    mentioned: list[uuid.UUID] = resolve_mentioned_friend_ids(
        comment.text, allowed_ids=friends, exclude_id=comment.user_id
    )
    previous_ids: set[uuid.UUID] = set(
        (
            await session.scalars(
                select(CommentMention.mentioned_user_id).where(
                    CommentMention.comment_id == comment.id
                )
            )
        ).all()
    )
    await session.execute(
        delete(CommentMention).where(CommentMention.comment_id == comment.id)
    )
    for mentioned_id in mentioned:
        session.add(
            CommentMention(
                comment_id=comment.id, mentioned_user_id=mentioned_id
            )
        )
        if comment.post_id is not None:
            await _add_participant(session, comment.post_id, mentioned_id)
        # Only alert newly mentioned friends (edits shouldn't re-ping).
        if mentioned_id not in previous_ids:
            await create_notification(
                session,
                recipient_id=mentioned_id,
                actor_id=comment.user_id,
                kind=NotificationKind.mention,
                post_id=comment.post_id,
                comment_id=comment.id,
                story_id=comment.story_id,
            )


async def _resolve_parent_id(
    session: SessionDep,
    *,
    post_id: uuid.UUID,
    parent_comment_id: uuid.UUID | None,
) -> uuid.UUID | None:
    """Validate parent and flatten to a top-level comment (depth ≤ 1)."""
    if parent_comment_id is None:
        return None
    parent = await session.get(Comment, parent_comment_id)
    if parent is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "parent comment not found")
    if parent.post_id != post_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "parent comment must belong to the same post",
        )
    # Flatten: reply-to-a-child becomes a sibling under the root.
    if parent.parent_comment_id is not None:
        return parent.parent_comment_id
    return parent.id


@router.get("", response_model=list[CommentOut])
async def list_comments(
    session: SessionDep,
    user: CurrentUser,
    post_id: uuid.UUID | None = Query(default=None),
    story_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=100, le=500, ge=1),
    offset: int = Query(default=0, ge=0),
) -> list[CommentOut]:
    if post_id is None and story_id is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "post_id or story_id is required"
        )

    if post_id is not None:
        post = await session.get(Post, post_id)
        if post is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "post not found")
        if not await can_see_post(session, user.id, post):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "not permitted")
        stmt = (
            select(Comment, Profile)
            .join(Profile, Profile.id == Comment.user_id)
            .where(Comment.post_id == post_id)
            .order_by(Comment.created_at.asc())
            .limit(limit)
            .offset(offset)
        )
        rows = (await session.execute(stmt)).all()
        ratings = await ratings_for_users_by_story(
            session, [post.story_id], {c.user_id for c, _ in rows}
        )
        return await _rated_outs(session, rows, ratings, user.id)

    # story_id path: return replies on posts about that story that the viewer can see
    assert story_id is not None
    posts = list(
        (
            await session.scalars(select(Post).where(Post.story_id == story_id))
        ).all()
    )
    visible_ids: list[uuid.UUID] = []
    for post in posts:
        if await can_see_post(session, user.id, post):
            visible_ids.append(post.id)
    if not visible_ids:
        return []
    stmt = (
        select(Comment, Profile)
        .join(Profile, Profile.id == Comment.user_id)
        .where(Comment.post_id.in_(visible_ids))
        .order_by(Comment.created_at.asc())
        .limit(limit)
        .offset(offset)
    )
    rows = (await session.execute(stmt)).all()
    ratings = await ratings_for_users_by_story(
        session, [story_id], {c.user_id for c, _ in rows}
    )
    return await _rated_outs(session, rows, ratings, user.id)


@router.post("", response_model=CommentOut, status_code=status.HTTP_201_CREATED)
async def create_comment(
    payload: CommentCreate, session: SessionDep, user: CurrentUser
) -> CommentOut:
    post = await session.get(Post, payload.post_id)
    if post is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "post not found")
    if not await can_see_post(session, user.id, post):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not permitted")

    parent_id = await _resolve_parent_id(
        session, post_id=post.id, parent_comment_id=payload.parent_comment_id
    )

    comment = Comment(
        story_id=post.story_id,
        post_id=post.id,
        parent_comment_id=parent_id,
        user_id=user.id,
        text=payload.text,
    )
    session.add(comment)
    await session.flush()
    await _add_participant(session, post.id, user.id)
    await _sync_comment_mentions(session, comment)
    post.last_activity_at = datetime.now(UTC)
    await session.refresh(comment)
    author = await session.get(Profile, user.id)
    story = await session.get(Story, post.story_id)
    parent_author_id: uuid.UUID | None = None
    if parent_id is not None:
        parent = await session.get(Comment, parent_id)
        if parent is not None:
            parent_author_id = parent.user_id
    if author is not None and story is not None:
        await notify_comment_activity(
            session,
            post=post,
            story=story,
            comment_text=comment.text,
            commenter=author,
            parent_author_id=parent_author_id,
        )
    rating = await _single_rating(session, user.id, comment.story_id)
    return _to_out(comment, author, rating)


@router.get("/{comment_id}", response_model=CommentOut)
async def get_comment(
    comment_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> CommentOut:
    comment = await session.get(Comment, comment_id)
    if comment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "comment not found")
    if comment.post_id is not None:
        post = await session.get(Post, comment.post_id)
        if post is None or not await can_see_post(session, user.id, post):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "not permitted")
    elif comment.user_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not permitted")
    author = await session.get(Profile, comment.user_id)
    rating = await _single_rating(session, comment.user_id, comment.story_id)
    reaction_map = await load_comment_reactions(session, [comment.id], user.id)
    summaries, mine = reaction_map.get(comment.id, ([], None))
    return _to_out(
        comment, author, rating, reactions=summaries, my_reaction=mine
    )


@router.put("/{comment_id}", response_model=CommentOut)
async def update_comment(
    comment_id: uuid.UUID,
    payload: CommentUpdate,
    session: SessionDep,
    user: CurrentUser,
) -> CommentOut:
    comment = await session.get(Comment, comment_id)
    if comment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "comment not found")
    if comment.user_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not the author")
    comment.text = payload.text
    await session.flush()
    await _sync_comment_mentions(session, comment)
    await session.refresh(comment)
    author = await session.get(Profile, comment.user_id)
    rating = await _single_rating(session, comment.user_id, comment.story_id)
    reaction_map = await load_comment_reactions(session, [comment.id], user.id)
    summaries, mine = reaction_map.get(comment.id, ([], None))
    return _to_out(
        comment, author, rating, reactions=summaries, my_reaction=mine
    )


@router.delete("/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(
    comment_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> None:
    comment = await session.get(Comment, comment_id)
    if comment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "comment not found")
    if comment.user_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not the author")
    await session.delete(comment)


@router.put("/{comment_id}/reactions", response_model=CommentOut)
async def set_comment_reaction(
    comment_id: uuid.UUID,
    payload: ReactionSet,
    session: SessionDep,
    user: CurrentUser,
) -> CommentOut:
    comment = await session.get(Comment, comment_id)
    if comment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "comment not found")
    if comment.post_id is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not permitted")
    post = await session.get(Post, comment.post_id)
    if post is None or not await can_see_post(session, user.id, post):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not permitted")

    await upsert_comment_reaction(
        session,
        user_id=user.id,
        comment_id=comment.id,
        reaction=payload.reaction,
    )
    await create_notification(
        session,
        recipient_id=comment.user_id,
        actor_id=user.id,
        kind=NotificationKind.comment_reaction,
        post_id=comment.post_id,
        comment_id=comment.id,
        story_id=comment.story_id,
    )
    await session.flush()
    author = await session.get(Profile, comment.user_id)
    rating = await _single_rating(session, comment.user_id, comment.story_id)
    reaction_map = await load_comment_reactions(session, [comment.id], user.id)
    summaries, mine = reaction_map.get(comment.id, ([], None))
    return _to_out(
        comment, author, rating, reactions=summaries, my_reaction=mine
    )


@router.delete("/{comment_id}/reactions", response_model=CommentOut)
async def clear_comment_reaction(
    comment_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> CommentOut:
    comment = await session.get(Comment, comment_id)
    if comment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "comment not found")
    if comment.post_id is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not permitted")
    post = await session.get(Post, comment.post_id)
    if post is None or not await can_see_post(session, user.id, post):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not permitted")

    await delete_comment_reaction(
        session, user_id=user.id, comment_id=comment.id
    )
    await delete_reaction_notification(
        session,
        recipient_id=comment.user_id,
        actor_id=user.id,
        kind=NotificationKind.comment_reaction,
        comment_id=comment.id,
    )
    await session.flush()
    author = await session.get(Profile, comment.user_id)
    rating = await _single_rating(session, comment.user_id, comment.story_id)
    reaction_map = await load_comment_reactions(session, [comment.id], user.id)
    summaries, mine = reaction_map.get(comment.id, ([], None))
    return _to_out(
        comment, author, rating, reactions=summaries, my_reaction=mine
    )
