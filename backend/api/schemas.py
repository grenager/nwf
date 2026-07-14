"""Pydantic v2 request/response schemas for the API."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from core.models import ConnectionStatus, PostVisibility, StoryKind


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


class RatingSet(BaseModel):
    story_id: uuid.UUID
    rating: int = Field(ge=1, le=5)


class UserSourcesUpdate(BaseModel):
    """Ordered list of source ids the user follows."""

    source_ids: list[uuid.UUID]


# --- Comments (replies under a post) --------------------------------------
class CommentOut(ORMModel):
    id: uuid.UUID
    story_id: uuid.UUID
    post_id: uuid.UUID | None = None
    user_id: uuid.UUID
    author_name: str = "Friend"
    author_image_url: str | None = None
    text: str
    created_at: datetime
    updated_at: datetime


class CommentCreate(BaseModel):
    post_id: uuid.UUID
    text: str = Field(min_length=1, max_length=10_000)


class CommentUpdate(BaseModel):
    text: str = Field(min_length=1, max_length=10_000)


# --- Posts ----------------------------------------------------------------
class AttachmentOut(ORMModel):
    id: uuid.UUID
    post_id: uuid.UUID
    comment_id: uuid.UUID | None = None
    article_url: str
    story_id: uuid.UUID | None = None
    attached_by: uuid.UUID
    created_at: datetime


class AttachmentCreate(BaseModel):
    post_id: uuid.UUID
    article_url: str = Field(min_length=4)
    comment_id: uuid.UUID | None = None


class PostCreate(BaseModel):
    """Share a story by id or URL, with optional take + visibility."""

    story_id: uuid.UUID | None = None
    url: str | None = None
    take: str | None = Field(default=None, max_length=2_000)
    visibility: PostVisibility = PostVisibility.private
    kind: StoryKind = StoryKind.news
    title: str | None = None


class PostUpdate(BaseModel):
    """Edit a post's take and/or visibility (author only)."""

    take: str | None = Field(default=None, max_length=2_000)
    visibility: PostVisibility | None = None


class PostOut(ORMModel):
    id: uuid.UUID
    story_id: uuid.UUID
    author_id: uuid.UUID
    author_name: str = "Friend"
    author_image_url: str | None = None
    take: str | None = None
    visibility: PostVisibility
    last_activity_at: datetime
    created_at: datetime
    updated_at: datetime
    # Story teaser
    full_headline: str = ""
    article_url: str = ""
    summary: str | None = None
    image_url: str | None = None
    source_name: str | None = None
    source_image_url: str | None = None
    kind: StoryKind = StoryKind.news
    # Social
    reply_count: int = 0
    participant_count: int = 0
    audience_label: str = "visible to friends"
    replies: list[CommentOut] = Field(default_factory=list)
    attachments: list[AttachmentOut] = Field(default_factory=list)
    # Per-viewer log state on the underlying story
    read: bool = False
    starred: bool = False
    my_reaction: str | None = None
    my_rating: int | None = None
    friend_rating_avg: float | None = None
    friend_rating_count: int = 0
    my_take: str | None = None
    engagement: FriendEngagementOut = Field(default_factory=FriendEngagementOut)
    readers: list[FriendMiniOut] = Field(default_factory=list)
    unread_replies_for_viewer: bool = False


class FeedCardOut(BaseModel):
    """One card per story, with one or more posts about that story."""

    story_id: uuid.UUID
    full_headline: str
    article_url: str
    summary: str | None = None
    image_url: str | None = None
    source_name: str | None = None
    source_image_url: str | None = None
    kind: StoryKind = StoryKind.news
    read: bool = False
    starred: bool = False
    my_reaction: str | None = None
    my_rating: int | None = None
    friend_rating_avg: float | None = None
    friend_rating_count: int = 0
    my_take: str | None = None
    engagement: FriendEngagementOut = Field(default_factory=FriendEngagementOut)
    posts: list[PostOut] = Field(default_factory=list)
    score: float = 0.0


class FeedOut(BaseModel):
    """Unified feed payload."""

    items: list[FeedCardOut]
    caught_up_after: int
    unread_count: int
    aggregate_readers: int = 0
    aggregate_private_conversations: int = 0
    new_since: datetime | None = None


class TakeMark(BaseModel):
    story_id: uuid.UUID
    take: str | None = Field(default=None, max_length=2_000)


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
