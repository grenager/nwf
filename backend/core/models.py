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


class SourceKind(enum.StrEnum):
    """Whether a source is a news outlet or an author-centric publication."""

    outlet = "outlet"
    author = "author"


class StoryKind(enum.StrEnum):
    """News event coverage vs contextual analysis."""

    news = "news"
    analysis = "analysis"


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
    full_text: Mapped[str | None] = mapped_column(Text, nullable=True)
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
    events: Mapped[list[Event]] = relationship(
        secondary="story_events", back_populates="stories"
    )


class Event(Base):
    __tablename__ = "events"

    id: Mapped[uuid.UUID] = _uuid_col(primary_key=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    centroid: Mapped[list[float] | None] = mapped_column(Vector(1536), nullable=True)
    origin_story_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("stories.id", ondelete="SET NULL"),
        nullable=True,
    )
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    saga_id: Mapped[uuid.UUID | None] = mapped_column(PgUUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    stories: Mapped[list[Story]] = relationship(
        secondary="story_events", back_populates="events"
    )


class StoryEvent(Base):
    __tablename__ = "story_events"

    story_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("stories.id", ondelete="CASCADE"),
        primary_key=True,
    )
    event_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("events.id", ondelete="CASCADE"),
        primary_key=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class StoryStatus(Base):
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
    starred: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class StoryReaction(Base):
    __tablename__ = "story_reactions"

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
    reaction: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[uuid.UUID] = _uuid_col(primary_key=True)
    story_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("stories.id", ondelete="CASCADE"),
        nullable=False,
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
