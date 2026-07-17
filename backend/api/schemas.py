"""Pydantic v2 request/response schemas for the API."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

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
    digest_opt_out: bool = False
    created_at: datetime
    updated_at: datetime


class PreferencesUpdate(BaseModel):
    first: str | None = None
    last: str | None = None
    phone: str | None = None
    image_url: str | None = None
    dense_mode: bool | None = None
    dark_mode: bool | None = None
    digest_opt_out: bool | None = None


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
    # A few reader avatars (subset of `read`) for display.
    readers: list[FriendMiniOut] = Field(default_factory=list)


class StoryWithStatus(StoryOut):
    read: bool = False
    starred: bool = False
    dismissed: bool = False
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


class RatingSet(BaseModel):
    """A half-star rating: 0.5 - 5.0 in 0.5 increments (Letterboxd-style)."""

    story_id: uuid.UUID
    rating: float = Field(ge=0.5, le=5.0)

    @field_validator("rating")
    @classmethod
    def _half_step(cls, value: float) -> float:
        if round(value * 2) != value * 2:
            raise ValueError("rating must be in 0.5 increments")
        return value


class UserSourcesUpdate(BaseModel):
    """Ordered list of source ids the user follows."""

    source_ids: list[uuid.UUID]


# --- Reactions (fixed set on posts and comments) --------------------------
REACTION_VALUES: frozenset[str] = frozenset(
    {"like", "love", "laugh", "insightful", "sad"}
)


class ReactionSummary(BaseModel):
    reaction: str
    count: int


class ReactionSet(BaseModel):
    """Body for PUT /posts|comments/{id}/reactions."""

    reaction: str

    @field_validator("reaction")
    @classmethod
    def _known_reaction(cls, value: str) -> str:
        if value not in REACTION_VALUES:
            raise ValueError(
                f"reaction must be one of: {', '.join(sorted(REACTION_VALUES))}"
            )
        return value


# --- Comments (replies under a post) --------------------------------------
class CommentOut(ORMModel):
    id: uuid.UUID
    story_id: uuid.UUID
    post_id: uuid.UUID | None = None
    parent_comment_id: uuid.UUID | None = None
    user_id: uuid.UUID
    author_name: str = "Friend"
    author_image_url: str | None = None
    text: str
    # The commenter's own half-star rating of the story (shown beside them).
    author_rating: float | None = None
    reactions: list[ReactionSummary] = Field(default_factory=list)
    my_reaction: str | None = None
    created_at: datetime
    updated_at: datetime


class CommentCreate(BaseModel):
    post_id: uuid.UUID
    text: str = Field(min_length=1, max_length=10_000)
    parent_comment_id: uuid.UUID | None = None


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
    """Share a story by id or URL, with optional take + visibility.

    When the client has already resolved a link preview (``POST /posts/preview``),
    pass the metadata fields so create skips a second scrape.
    """

    story_id: uuid.UUID | None = None
    url: str | None = None
    take: str | None = Field(default=None, max_length=2_000)
    # Article text the author pasted from a page they can read; shown as a
    # teaser + reader view. The author chooses to share their own copy.
    shared_text: str | None = Field(default=None, max_length=100_000)
    visibility: PostVisibility = PostVisibility.private
    kind: StoryKind = StoryKind.news
    title: str | None = None
    # Optional preview metadata — skips re-enrichment on create
    canonical_url: str | None = None
    full_headline: str | None = None
    summary: str | None = None
    image_url: str | None = None
    publisher: str | None = None
    platform: str | None = None


class PreviewCreate(BaseModel):
    """Request body for ``POST /posts/preview``."""

    url: str = Field(min_length=4)
    kind: StoryKind = StoryKind.news


class PreviewOut(BaseModel):
    """Card-shaped link preview used in the share composer."""

    canonical_url: str
    full_headline: str
    summary: str | None = None
    image_url: str | None = None
    source_name: str | None = None
    source_image_url: str | None = None
    kind: StoryKind
    publisher: str | None = None
    platform: str | None = None


class PostUpdate(BaseModel):
    """Edit a post's take, shared reader text and/or visibility (author only)."""

    take: str | None = Field(default=None, max_length=2_000)
    shared_text: str | None = Field(default=None, max_length=100_000)
    visibility: PostVisibility | None = None


class PostOut(ORMModel):
    id: uuid.UUID
    story_id: uuid.UUID
    author_id: uuid.UUID
    author_name: str = "Friend"
    author_image_url: str | None = None
    take: str | None = None
    shared_text: str | None = None
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
    # The post author's own half-star rating (shown beside their take).
    author_rating: float | None = None
    reactions: list[ReactionSummary] = Field(default_factory=list)
    my_reaction: str | None = None
    # Per-viewer log state on the underlying story
    read: bool = False
    starred: bool = False
    my_rating: float | None = None
    # Aggregate over everyone the viewer can see who rated (friends + self).
    rating_avg: float | None = None
    rating_count: int = 0
    my_take: str | None = None
    engagement: FriendEngagementOut = Field(default_factory=FriendEngagementOut)
    readers: list[FriendMiniOut] = Field(default_factory=list)
    unread_replies_for_viewer: bool = False


class FeedCardOut(BaseModel):
    """One card per post. Two posts about the same article are two cards."""

    card_id: uuid.UUID
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
    my_rating: float | None = None
    rating_avg: float | None = None
    rating_count: int = 0
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
    # Human label for the friend's most recent social action, e.g.
    # "rated a story", "added a comment", "posted a story".
    last_activity: str | None = None


class FriendsOverviewOut(BaseModel):
    friends: list[FriendSummaryOut]
    total: int
    online: int


class FriendActivityItem(BaseModel):
    kind: str  # "read" | "commented" | "rated"
    story_id: uuid.UUID
    headline: str
    source_name: str | None = None
    article_url: str
    at: datetime
    comment_text: str | None = None
    # Present when kind == "rated": the half-star rating (0.5 - 5).
    rating: float | None = None


class FriendProfileOut(BaseModel):
    user_id: uuid.UUID
    display_name: str
    first: str | None = None
    last: str | None = None
    image_url: str | None = None
    online: bool = False
    last_active_at: datetime | None = None
    reads: int = 0
    comments: int = 0
    ratings: int = 0
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


# --- Friend requests / recommendations -----------------------------------
class FriendRequestOut(BaseModel):
    user_id: uuid.UUID
    display_name: str
    image_url: str | None = None
    mutual_count: int = 0
    created_at: datetime


class FriendRequestsOut(BaseModel):
    incoming: list[FriendRequestOut]
    outgoing: list[FriendRequestOut]


class RecommendedFriendOut(BaseModel):
    user_id: uuid.UUID
    display_name: str
    image_url: str | None = None
    mutual_count: int = 0


# --- Email invitations / share links --------------------------------------
class InvitationCreate(BaseModel):
    """Create an email invite or an open reusable share link.

    Omit ``email`` (or pass null/empty) to mint a reusable share link for
    messaging apps. Pass ``email`` for the classic single-use email invite.
    """

    email: str | None = Field(default=None, max_length=320)
    post_id: uuid.UUID | None = None
    message: str | None = Field(default=None, max_length=2_000)
    become_friend: bool = False


class InvitationCreateResult(BaseModel):
    status: str  # "connected" | "requested" | "invited"
    user_id: uuid.UUID | None = None
    invitation_id: uuid.UUID | None = None
    invite_url: str | None = None
    share_message: str
    message: str
    email_sent: bool = False


class InvitePreviewOut(BaseModel):
    token: str
    status: str
    invitee_email: str | None = None
    inviter_id: uuid.UUID
    inviter_name: str
    inviter_image_url: str | None = None
    message: str | None = None
    post_id: uuid.UUID | None = None
    story_id: uuid.UUID | None = None
    headline: str | None = None
    article_url: str | None = None
    image_url: str | None = None
    publisher: str | None = None
    take: str | None = None
    become_friend: bool = False
    reply_count: int = 0
    reusable: bool = False


class InvitationAcceptRequest(BaseModel):
    """Optional body for accepting a share link.

    When the invitation was not created with ``become_friend``, the recipient
    must pass ``add_friend=true`` to friend the inviter and join the thread.
    """

    add_friend: bool | None = None


class InvitationAcceptResult(BaseModel):
    status: str  # "accepted" | "already_friends" | "already_accepted" | "view_only"
    inviter_id: uuid.UUID
    post_id: uuid.UUID | None = None
    message: str
    became_friend: bool = False


# --- Admin ----------------------------------------------------------------
class AdminFriendRef(BaseModel):
    user_id: uuid.UUID
    display_name: str


class AdminUserOut(BaseModel):
    id: uuid.UUID
    first: str | None = None
    last: str | None = None
    email: str | None = None
    last_active_at: datetime | None = None
    friends: list[AdminFriendRef] = Field(default_factory=list)


class AdminFriendshipCreate(BaseModel):
    user_a: uuid.UUID
    user_b: uuid.UUID


class AdminUserCreate(BaseModel):
    email: str
    first: str | None = None
    last: str | None = None
