"""Pydantic v2 request/response schemas for the API."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from core.models import ConnectionStatus


class ORMModel(BaseModel):
    """Base for models read from ORM objects."""

    model_config = ConfigDict(from_attributes=True)


# --- Profiles / me --------------------------------------------------------
class ProfileOut(ORMModel):
    id: uuid.UUID
    first: str | None = None
    last: str | None = None
    phone: str | None = None
    image_url: str | None = None
    is_admin: bool
    dense_mode: bool
    dark_mode: bool
    created_at: datetime
    updated_at: datetime


class PreferencesUpdate(BaseModel):
    first: str | None = None
    last: str | None = None
    phone: str | None = None
    image_url: str | None = None
    dense_mode: bool | None = None
    dark_mode: bool | None = None


# --- Sources --------------------------------------------------------------
class SourceOut(ORMModel):
    id: uuid.UUID
    name: str
    homepage_url: str
    rss_url: str | None = None
    include_selector: str | None = None
    exclude_selector: str | None = None
    bias_score: float | None = None
    last_scraped_at: datetime | None = None
    tags: list[str]
    image_url: str | None = None
    has_paywall: bool
    created_at: datetime
    updated_at: datetime


class SourceCreate(BaseModel):
    name: str
    homepage_url: str
    rss_url: str | None = None
    include_selector: str | None = None
    exclude_selector: str | None = None
    bias_score: float | None = None
    tags: list[str] = Field(default_factory=list)
    image_url: str | None = None
    has_paywall: bool = False


class SourceUpdate(BaseModel):
    name: str | None = None
    homepage_url: str | None = None
    rss_url: str | None = None
    include_selector: str | None = None
    exclude_selector: str | None = None
    bias_score: float | None = None
    tags: list[str] | None = None
    image_url: str | None = None
    has_paywall: bool | None = None


# --- Stories --------------------------------------------------------------
class StoryOut(ORMModel):
    id: uuid.UUID
    article_url: str
    source_id: uuid.UUID | None = None
    full_headline: str
    summary: str | None = None
    full_text: str | None = None
    section: str | None = None
    type: str | None = None
    image_url: str | None = None
    author_names: list[str]
    archived: bool
    last_scraped_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class StoryWithStatus(StoryOut):
    read: bool = False
    starred: bool = False


class StoryList(BaseModel):
    items: list[StoryWithStatus]
    total: int
    limit: int
    offset: int


# --- Story status actions -------------------------------------------------
class ReadMark(BaseModel):
    story_id: uuid.UUID
    read: bool = True


class StarMark(BaseModel):
    story_id: uuid.UUID


class UserSourcesUpdate(BaseModel):
    """Ordered list of source ids the user follows."""

    source_ids: list[uuid.UUID]


# --- Comments -------------------------------------------------------------
class CommentOut(ORMModel):
    id: uuid.UUID
    story_id: uuid.UUID
    user_id: uuid.UUID
    text: str
    created_at: datetime
    updated_at: datetime


class CommentCreate(BaseModel):
    story_id: uuid.UUID
    text: str = Field(min_length=1, max_length=10_000)


class CommentUpdate(BaseModel):
    text: str = Field(min_length=1, max_length=10_000)


# --- Connections ----------------------------------------------------------
class ConnectionOut(ORMModel):
    id: uuid.UUID
    first_id: uuid.UUID
    second_id: uuid.UUID
    status: ConnectionStatus
    created_at: datetime
    updated_at: datetime


class ConnectionCreate(BaseModel):
    target_user_id: uuid.UUID


class ConnectionUpdate(BaseModel):
    status: ConnectionStatus
