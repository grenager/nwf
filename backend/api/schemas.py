"""Pydantic v2 request/response schemas for the API."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from core.models import ConnectionStatus, NotificationKind, PostVisibility, StoryKind


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
    instant_email_opt_out: bool = False
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
    instant_email_opt_out: bool | None = None


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


class StoryReaderOut(BaseModel):
    """A reader avatar for a story, with the timestamp of their most recent
    read - lets the client show "reading now" (within the live window) vs.
    settled "read" styling for the same entry, without a second field."""

    user_id: uuid.UUID
    display_name: str
    image_url: str | None = None
    last_read_at: datetime


class FriendEngagementOut(BaseModel):
    """Counts of *friends* (accepted connections) who engaged with a story/event."""

    read: int = 0
    commented: int = 0
    # A few reader avatars (subset of `read`) for display.
    readers: list[StoryReaderOut] = Field(default_factory=list)


FofActionKind = Literal["commented", "reacted", "read"]


class FofReasonOut(BaseModel):
    """Why a post the viewer has no direct connection to appears in their feed."""

    friend_id: uuid.UUID
    friend_name: str
    friend_image_url: str | None = None
    action: FofActionKind
    acted_at: datetime


class StoryWithStatus(StoryOut):
    read: bool = False
    starred: bool = False
    dismissed: bool = False
    friend_reactors: list[FriendReactorOut] = Field(default_factory=list)
    engagement: FriendEngagementOut = Field(default_factory=FriendEngagementOut)
    # Most recent post about this story the viewer may see (search → detail link),
    # with enough of the conversation to recognise it in a result list.
    post_id: uuid.UUID | None = None
    post_author_name: str | None = None
    post_author_image_url: str | None = None
    post_take: str | None = None
    post_reply_count: int = 0


class FriendReactorOut(BaseModel):
    """A friend who reacted to a post or comment about this story."""

    user_id: uuid.UUID
    display_name: str


class StoryList(BaseModel):
    items: list[StoryWithStatus]
    total: int
    limit: int
    offset: int


class CommunityStatsOut(BaseModel):
    """Public aggregate counts for guest social proof."""

    member_count: int = 0
    discussing_count: int = 0
    conversation_count: int = 0


class StoryCreate(BaseModel):
    """User-submitted story we may have missed. Parsing is faked for now."""

    url: str = Field(min_length=4)
    kind: StoryKind = StoryKind.news
    title: str | None = None


# --- Story status actions -------------------------------------------------
class ReadMark(BaseModel):
    story_id: uuid.UUID
    read: bool = True


class ReadingPing(BaseModel):
    """Refresh the live 'reading now' timestamp. Fired on every open, unlike
    ReadMark which only matters on first-ever read."""

    story_id: uuid.UUID


class TypingPing(BaseModel):
    """Refresh the live 'typing' timestamp for a post's comment composer."""

    post_id: uuid.UUID


class PostTyperOut(BaseModel):
    """Someone currently typing on a post - already window-filtered server
    side, so unlike StoryReaderOut there's no timestamp for the client to
    reason about."""

    user_id: uuid.UUID
    display_name: str
    image_url: str | None = None


class StarMark(BaseModel):
    story_id: uuid.UUID


class DismissMark(BaseModel):
    story_id: uuid.UUID


# --- Reactions (fixed set on posts and comments) --------------------------
REACTION_VALUES: frozenset[str] = frozenset(
    {"like", "love", "care", "haha", "wow", "sad", "angry"}
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


class PostReactorOut(BaseModel):
    """One person's reaction to a post, for the reactor-list modal."""

    user_id: uuid.UUID
    display_name: str
    image_url: str | None = None
    reaction: str
    reacted_at: datetime


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
    reactions: list[ReactionSummary] = Field(default_factory=list)
    my_reaction: str | None = None
    created_at: datetime
    updated_at: datetime


AudienceRelation = Literal[
    "author", "your_friend", "author_friend", "participant", "friend_of_participant"
]


class AudienceMemberOut(BaseModel):
    """One person who can already read a thread (the viewer is never listed)."""

    user_id: uuid.UUID
    display_name: str
    image_url: str | None = None
    relation: AudienceRelation


class PostAudienceOut(BaseModel):
    """Who can see replies on a post, for the "Who will see this?" explainer."""

    post_id: uuid.UUID
    visibility: PostVisibility
    viewer_is_author: bool
    author_id: uuid.UUID
    author_name: str
    people: list[AudienceMemberOut] = Field(default_factory=list)
    your_friend_count: int = 0
    author_friend_count: int = 0
    # Mean friend count among users who post or comment, for the "grow your
    # circle" nudge. Clients compare it against ``your_friend_count``.
    average_friend_count: float = 0.0


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
    """Share a story by id or URL, with optional take.

    When the client has already resolved a link preview (``POST /posts/preview``),
    pass the metadata fields so create skips a second scrape.
    """

    story_id: uuid.UUID | None = None
    url: str | None = None
    take: str | None = Field(default=None, max_length=2_000)
    # Article text the author pasted from a page they can read; shown as a
    # teaser + reader view. The author chooses to share their own copy.
    shared_text: str | None = Field(default=None, max_length=100_000)
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
    """Edit a post's take or shared reader text (author only)."""

    take: str | None = Field(default=None, max_length=2_000)
    shared_text: str | None = Field(default=None, max_length=100_000)


class PostOut(ORMModel):
    id: uuid.UUID
    story_id: uuid.UUID
    author_id: uuid.UUID
    author_name: str = "Friend"
    author_image_url: str | None = None
    take: str | None = None
    shared_text: str | None = None
    shared_text_truncated: bool = False
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
    reactions: list[ReactionSummary] = Field(default_factory=list)
    my_reaction: str | None = None
    # Per-viewer log state on the underlying story
    read: bool = False
    starred: bool = False
    my_take: str | None = None
    engagement: FriendEngagementOut = Field(default_factory=FriendEngagementOut)
    readers: list[StoryReaderOut] = Field(default_factory=list)
    unread_replies_for_viewer: bool = False
    # Replies after the viewer's per-thread read cursor (excludes own).
    unread_reply_count: int = 0
    last_seen_at: datetime | None = None


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
    my_take: str | None = None
    engagement: FriendEngagementOut = Field(default_factory=FriendEngagementOut)
    posts: list[PostOut] = Field(default_factory=list)
    score: float = 0.0
    unread_reply_count: int = 0
    # Set only when the viewer has no other path to this post (not the author,
    # not a direct friend of the author, not already a participant) - explains
    # why a stranger's post is showing up, via the friend who engaged with it.
    fof_reason: FofReasonOut | None = None


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
    # Friends plus outstanding requests/invitations, against the account cap.
    slots_used: int = 0
    friend_limit: int = 0


class FriendActivityItem(BaseModel):
    kind: str  # "read" | "commented" | "reacted"
    story_id: uuid.UUID
    # The post the viewer can open for this story; None when none is visible.
    post_id: uuid.UUID | None = None
    # Present when kind == "commented" and the comment lives on ``post_id``,
    # so the detail page can scroll straight to it.
    comment_id: uuid.UUID | None = None
    headline: str
    source_name: str | None = None
    article_url: str
    at: datetime
    comment_text: str | None = None
    # Present when kind == "reacted": which emoji reaction was given.
    reaction: str | None = None


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
    reactions: int = 0
    can_edit: bool = False
    # True when the viewer and this user are accepted friends (always False
    # for your own profile — there's no "remove friend" on yourself).
    is_friend: bool = False
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
    # Display name parsed from a "Name <email>" entry, used to greet by name.
    invitee_name: str | None = Field(default=None, max_length=200)


class InvitationCreateResult(BaseModel):
    status: str  # "connected" | "requested" | "invited" | "suppressed"
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
    image_url: str | None = None
    last_active_at: datetime | None = None
    friends: list[AdminFriendRef] = Field(default_factory=list)


class AdminFriendshipCreate(BaseModel):
    user_a: uuid.UUID
    user_b: uuid.UUID


class AdminUserCreate(BaseModel):
    email: str
    first: str | None = None
    last: str | None = None


# --- Conversations --------------------------------------------------------
class ConversationOut(BaseModel):
    """A thread the viewer participates in, sorted by latest reply activity."""

    post_id: uuid.UUID
    story_id: uuid.UUID
    full_headline: str
    article_url: str
    source_name: str | None = None
    source_image_url: str | None = None
    image_url: str | None = None
    author_id: uuid.UUID
    author_name: str
    author_image_url: str | None = None
    reply_count: int = 0
    unread_count: int = 0
    last_seen_at: datetime | None = None
    latest_reply_at: datetime
    latest_reply_text: str | None = None
    latest_reply_author_name: str | None = None
    latest_reply_author_image_url: str | None = None


class ConversationList(BaseModel):
    items: list[ConversationOut]
    threads_with_unread: int = 0


# --- Notifications (Alerts) -----------------------------------------------
class NotificationOut(BaseModel):
    id: uuid.UUID
    kind: NotificationKind
    actor_id: uuid.UUID
    actor_name: str
    actor_image_url: str | None = None
    post_id: uuid.UUID | None = None
    comment_id: uuid.UUID | None = None
    story_id: uuid.UUID | None = None
    full_headline: str | None = None
    comment_snippet: str | None = None
    read_at: datetime | None = None
    created_at: datetime


class NotificationList(BaseModel):
    items: list[NotificationOut]
    unread_count: int = 0


class NotificationsReadRequest(BaseModel):
    notification_ids: list[uuid.UUID] | None = None
