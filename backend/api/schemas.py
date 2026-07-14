"""Pydantic v2 request/response schemas for the API."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from core.models import ConnectionStatus, StoryKind


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


class SourceStatus(BaseModel):
    """Per-source scraper progress (admin view)."""

    id: uuid.UUID
    name: str
    rss_url: str | None = None
    has_rss: bool
    image_url: str | None = None
    last_scraped_at: datetime | None = None
    story_count: int
    newest_story_at: datetime | None = None


class SourceCreate(BaseModel):
    # name/homepage are inferred from the RSS feed when omitted; supply an
    # rss_url, or provide name + homepage_url manually for feed-less sources.
    name: str | None = None
    homepage_url: str | None = None
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
    source_name: str | None = None
    source_image_url: str | None = None
    full_headline: str
    summary: str | None = None
    full_text: str | None = None
    section: str | None = None
    type: str | None = None
    image_url: str | None = None
    author_names: list[str]
    kind: StoryKind = StoryKind.news
    archived: bool
    last_scraped_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class FriendMiniOut(BaseModel):
    user_id: uuid.UUID
    display_name: str
    image_url: str | None = None


class FriendEngagementOut(BaseModel):
    """Counts of *friends* (accepted connections) who engaged with a story/event."""

    read: int = 0
    commented: int = 0
    reactions: dict[str, int] = Field(default_factory=dict)
    # A few reader avatars (subset of `read`) for display.
    readers: list[FriendMiniOut] = Field(default_factory=list)


class StoryWithStatus(StoryOut):
    read: bool = False
    starred: bool = False
    dismissed: bool = False
    my_reaction: str | None = None
    friend_stars: list[FriendStarOut] = Field(default_factory=list)
    engagement: FriendEngagementOut = Field(default_factory=FriendEngagementOut)


class FriendStarOut(BaseModel):
    user_id: uuid.UUID
    display_name: str


class StoryList(BaseModel):
    items: list[StoryWithStatus]
    total: int
    limit: int
    offset: int


class StoryCreate(BaseModel):
    """User-submitted story we may have missed. Parsing is faked for now."""

    url: str = Field(min_length=4)
    kind: StoryKind = StoryKind.news
    title: str | None = None


# --- Story status actions -------------------------------------------------
class ReadMark(BaseModel):
    story_id: uuid.UUID
    read: bool = True


class StarMark(BaseModel):
    story_id: uuid.UUID


class DismissMark(BaseModel):
    story_id: uuid.UUID


class ReactionSet(BaseModel):
    story_id: uuid.UUID
    reaction: str


class UserSourcesUpdate(BaseModel):
    """Ordered list of source ids the user follows."""

    source_ids: list[uuid.UUID]


# --- Comments -------------------------------------------------------------
class CommentOut(ORMModel):
    id: uuid.UUID
    story_id: uuid.UUID
    user_id: uuid.UUID
    author_name: str = "Friend"
    author_image_url: str | None = None
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


# --- Friends (activity-oriented views) ------------------------------------
class FriendSummaryOut(BaseModel):
    user_id: uuid.UUID
    display_name: str
    image_url: str | None = None
    online: bool = False
    last_active_at: datetime | None = None
    last_source_name: str | None = None


class FriendsOverviewOut(BaseModel):
    friends: list[FriendSummaryOut]
    total: int
    online: int


class FriendActivityItem(BaseModel):
    kind: str  # "read" | "hearted" | "commented"
    story_id: uuid.UUID
    headline: str
    source_name: str | None = None
    article_url: str
    at: datetime
    comment_text: str | None = None


class FriendProfileOut(BaseModel):
    user_id: uuid.UUID
    display_name: str
    first: str | None = None
    last: str | None = None
    image_url: str | None = None
    online: bool = False
    last_active_at: datetime | None = None
    reads: int = 0
    hearts: int = 0
    comments: int = 0
    can_edit: bool = False
    recent: list[FriendActivityItem] = Field(default_factory=list)


class ProfileEdit(BaseModel):
    first: str | None = None
    last: str | None = None
    phone: str | None = None
    image_url: str | None = None


class InviteCreate(BaseModel):
    email: str = Field(min_length=3, max_length=320)


class InviteResult(BaseModel):
    status: str  # "connected" | "requested"
    user_id: uuid.UUID | None = None
    message: str


# --- Events (news clusters) -----------------------------------------------
class EventCoverageOut(BaseModel):
    story_id: uuid.UUID
    source_id: uuid.UUID | None = None
    source_name: str
    bias_score: float | None = None
    prominence: int = 0
    image_url: str | None = None
    story_image_url: str | None = None
    full_headline: str
    summary: str | None = None
    article_url: str
    read: bool = False
    starred: bool = False


class EventSummaryOut(BaseModel):
    id: uuid.UUID
    title: str
    first_seen_at: datetime
    outlet_count: int
    story_count: int
    is_scoop: bool
    source_names: list[str] = Field(default_factory=list)
    coverage: list[EventCoverageOut] = Field(default_factory=list)
    friend_stars: list[FriendStarOut] = Field(default_factory=list)
    engagement: FriendEngagementOut = Field(default_factory=FriendEngagementOut)
    read: bool = False
    dismissed: bool = False


class EventDetailOut(EventSummaryOut):
    """Full event with all coverage rows."""


class EventList(BaseModel):
    items: list[EventSummaryOut]
    total: int


class TodayOut(BaseModel):
    """Combined Today screen payload."""

    events: EventList
    analysis: StoryList
    friend_pick_count: int
    new_since: datetime | None = None
