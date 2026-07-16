"""SQLAlchemy 2.0 ORM models mapping the Supabase-owned schema.

The schema is owned by the SQL migrations in ``supabase/migrations``; these
models mirror it for the application layer. We do not run ``create_all`` in
production.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    ARRAY,
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


class ConnectionStatus(enum.StrEnum):
    """Friend connection lifecycle states."""

    pending = "pending"
    accepted = "accepted"
    blocked = "blocked"


class InvitationStatus(enum.StrEnum):
    """Email invitation lifecycle for non-users."""

    pending = "pending"
    accepted = "accepted"
    revoked = "revoked"
    expired = "expired"


class SourceKind(enum.StrEnum):
    """Whether a source is a news outlet or an author-centric publication."""

    outlet = "outlet"
    author = "author"


class StoryKind(enum.StrEnum):
    """News event coverage vs contextual analysis."""

    news = "news"
    analysis = "analysis"


class PostVisibility(enum.StrEnum):
    """Audience for a post; private is FoF-of-participants, public is everyone."""

    private = "private"
    public = "public"


def _uuid_col(primary_key: bool = False) -> Mapped[uuid.UUID]:
    return mapped_column(
        PgUUID(as_uuid=True),
        primary_key=primary_key,
        server_default=func.gen_random_uuid() if primary_key else None,
    )


class Profile(Base):
    __tablename__ = "profiles"

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    first: Mapped[str | None] = mapped_column(Text, nullable=True)
    last: Mapped[str | None] = mapped_column(Text, nullable=True)
    phone: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    dense_mode: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    dark_mode: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_opened_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Source(Base):
    __tablename__ = "sources"

    id: Mapped[uuid.UUID] = _uuid_col(primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    homepage_url: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    rss_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    include_selector: Mapped[str | None] = mapped_column(Text, nullable=True)
    exclude_selector: Mapped[str | None] = mapped_column(Text, nullable=True)
    bias_score: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    last_scraped_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    tags: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default="{}"
    )
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    has_paywall: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    kind: Mapped[SourceKind] = mapped_column(
        Enum(SourceKind, name="source_kind", create_type=False),
        nullable=False,
        default=SourceKind.outlet,
    )
    prominence: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    stories: Mapped[list[Story]] = relationship(back_populates="source")


class UserSource(Base):
    __tablename__ = "user_sources"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    source_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("sources.id", ondelete="CASCADE"),
        primary_key=True,
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Story(Base):
    __tablename__ = "stories"

    id: Mapped[uuid.UUID] = _uuid_col(primary_key=True)
    article_url: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    source_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("sources.id", ondelete="SET NULL"),
        nullable=True,
    )
    full_headline: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    # OpenGraph/Substack-derived attribution (e.g. "Derek Thompson on Substack")
    # for stories not backed by a curated source we scrape directly.
    publisher: Mapped[str | None] = mapped_column(Text, nullable=True)
    section: Mapped[str | None] = mapped_column(Text, nullable=True)
    type: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    author_names: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default="{}"
    )
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    kind: Mapped[StoryKind] = mapped_column(
        Enum(StoryKind, name="story_kind", create_type=False),
        nullable=False,
        default=StoryKind.news,
    )
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1536), nullable=True)
    last_scraped_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    source: Mapped[Source | None] = relationship(back_populates="stories")
    posts: Mapped[list[Post]] = relationship(back_populates="story")


class Post(Base):
    """A user sharing an article with an optional take; the unified-feed unit."""

    __tablename__ = "posts"

    id: Mapped[uuid.UUID] = _uuid_col(primary_key=True)
    story_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("stories.id", ondelete="CASCADE"),
        nullable=False,
    )
    author_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    take: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Article text the author pasted from a page they can read (e.g. behind a
    # paywall). Rendered as a teaser + a reader view; we always link back.
    shared_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    visibility: Mapped[PostVisibility] = mapped_column(
        Enum(PostVisibility, name="post_visibility", create_type=False),
        nullable=False,
        default=PostVisibility.private,
    )
    last_activity_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    story: Mapped[Story] = relationship(back_populates="posts")
    comments: Mapped[list[Comment]] = relationship(back_populates="post")
    attachments: Mapped[list[Attachment]] = relationship(back_populates="post")


class PostParticipant(Base):
    """Authors + repliers; drives FoF visibility as a fast union."""

    __tablename__ = "post_participants"

    post_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("posts.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Attachment(Base):
    """A related article URL attached to a post (optionally tied to a reply)."""

    __tablename__ = "attachments"

    id: Mapped[uuid.UUID] = _uuid_col(primary_key=True)
    post_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("posts.id", ondelete="CASCADE"),
        nullable=False,
    )
    comment_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("comments.id", ondelete="SET NULL"),
        nullable=True,
    )
    article_url: Mapped[str] = mapped_column(Text, nullable=False)
    story_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("stories.id", ondelete="SET NULL"),
        nullable=True,
    )
    attached_by: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    post: Mapped[Post] = relationship(back_populates="attachments")


class StoryStatus(Base):
    """Per-user Log entry: read / star / one-line take on a story."""

    __tablename__ = "story_statuses"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    story_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("stories.id", ondelete="CASCADE"),
        primary_key=True,
    )
    read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    read_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    starred: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    dismissed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    dismissed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    take: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class StoryRating(Base):
    """A user's half-star (0.5-5) rating on a story; the feed engagement signal."""

    __tablename__ = "story_ratings"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    story_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("stories.id", ondelete="CASCADE"),
        primary_key=True,
    )
    rating: Mapped[float] = mapped_column(
        Numeric(2, 1, asdecimal=False), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Comment(Base):
    """A reply under a post (story_id kept denormalized for legacy queries).

    One level of nesting: ``parent_comment_id`` points at a top-level comment
    (itself having ``parent_comment_id IS NULL``). Deeper replies are flattened
    to the root by the API before insert; a DB trigger enforces the constraint.
    """

    __tablename__ = "comments"

    id: Mapped[uuid.UUID] = _uuid_col(primary_key=True)
    story_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("stories.id", ondelete="CASCADE"),
        nullable=False,
    )
    post_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("posts.id", ondelete="CASCADE"),
        nullable=True,
    )
    parent_comment_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("comments.id", ondelete="CASCADE"),
        nullable=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    post: Mapped[Post | None] = relationship(back_populates="comments")
    parent: Mapped[Comment | None] = relationship(
        remote_side="Comment.id",
        back_populates="children",
        foreign_keys=[parent_comment_id],
    )
    children: Mapped[list[Comment]] = relationship(
        back_populates="parent",
        foreign_keys=[parent_comment_id],
    )


class CommentReaction(Base):
    """Fixed-set emoji reaction on a comment (one per user)."""

    __tablename__ = "comment_reactions"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    comment_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("comments.id", ondelete="CASCADE"),
        primary_key=True,
    )
    reaction: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class PostReaction(Base):
    """Fixed-set emoji reaction on a post (one per user)."""

    __tablename__ = "post_reactions"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    post_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("posts.id", ondelete="CASCADE"),
        primary_key=True,
    )
    reaction: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Connection(Base):
    __tablename__ = "connections"
    __table_args__ = (
        UniqueConstraint("first_id", "second_id", name="connections_first_second_key"),
        CheckConstraint("first_id <> second_id", name="connections_distinct_check"),
    )

    id: Mapped[uuid.UUID] = _uuid_col(primary_key=True)
    first_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    second_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    status: Mapped[ConnectionStatus] = mapped_column(
        Enum(ConnectionStatus, name="connection_status", create_type=False),
        nullable=False,
        default=ConnectionStatus.pending,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Invitation(Base):
    __tablename__ = "invitations"

    id: Mapped[uuid.UUID] = _uuid_col(primary_key=True)
    token: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    inviter_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Null for open/reusable share links (no targeted recipient).
    invitee_email: Mapped[str | None] = mapped_column(Text, nullable=True)
    post_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("posts.id", ondelete="SET NULL"),
        nullable=True,
    )
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    become_friend: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    reusable: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    status: Mapped[InvitationStatus] = mapped_column(
        Enum(InvitationStatus, name="invitation_status", create_type=False),
        nullable=False,
        default=InvitationStatus.pending,
    )
    accepted_user_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    accepted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class InvitationRedemption(Base):
    """One row per user who redeemed a reusable share link."""

    __tablename__ = "invitation_redemptions"
    __table_args__ = (
        UniqueConstraint(
            "invitation_id",
            "user_id",
            name="invitation_redemptions_invitation_id_user_id_key",
        ),
    )

    id: Mapped[uuid.UUID] = _uuid_col(primary_key=True)
    invitation_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("invitations.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    became_friend: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
