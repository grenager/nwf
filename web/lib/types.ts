// API types mirroring the FastAPI Pydantic schemas.

export type UUID = string;

export interface Profile {
  id: UUID;
  first: string | null;
  last: string | null;
  phone: string | null;
  image_url: string | null;
  is_admin: boolean;
  dense_mode: boolean;
  dark_mode: boolean;
  created_at: string;
  updated_at: string;
}

export interface PreferencesUpdate {
  first?: string | null;
  last?: string | null;
  phone?: string | null;
  image_url?: string | null;
  dense_mode?: boolean | null;
  dark_mode?: boolean | null;
}

export type StoryKind = "news" | "analysis";
export type PostVisibility = "private" | "public";

export interface FriendStar {
  user_id: UUID;
  display_name: string;
}

export interface FriendMini {
  user_id: UUID;
  display_name: string;
  image_url: string | null;
}

export interface FriendEngagement {
  read: number;
  commented: number;
  readers: FriendMini[];
}

export interface Story {
  id: UUID;
  article_url: string;
  source_id: UUID | null;
  source_name: string | null;
  source_image_url: string | null;
  full_headline: string;
  summary: string | null;
  section: string | null;
  type: string | null;
  image_url: string | null;
  author_names: string[];
  kind: StoryKind;
  archived: boolean;
  last_scraped_at: string | null;
  created_at: string;
  updated_at: string;
  read: boolean;
  starred: boolean;
  dismissed: boolean;
  friend_stars?: FriendStar[];
  engagement: FriendEngagement;
}

export interface StoryList {
  items: Story[];
  total: number;
  limit: number;
  offset: number;
}

/** Fixed emoji reaction set for posts and comments. */
export const REACTIONS = [
  { kind: "like", emoji: "👍", label: "Like" },
  { kind: "love", emoji: "❤️", label: "Love" },
  { kind: "laugh", emoji: "😂", label: "Laugh" },
  { kind: "insightful", emoji: "💡", label: "Insightful" },
  { kind: "sad", emoji: "😢", label: "Sad" },
] as const;

export type ReactionKind = (typeof REACTIONS)[number]["kind"];

export interface ReactionSummary {
  reaction: ReactionKind;
  count: number;
}

export interface Comment {
  id: UUID;
  story_id: UUID;
  post_id: UUID | null;
  parent_comment_id: UUID | null;
  user_id: UUID;
  author_name: string;
  author_image_url: string | null;
  text: string;
  author_rating: number | null;
  reactions: ReactionSummary[];
  my_reaction: ReactionKind | null;
  created_at: string;
  updated_at: string;
}

export interface Attachment {
  id: UUID;
  post_id: UUID;
  comment_id: UUID | null;
  article_url: string;
  story_id: UUID | null;
  attached_by: UUID;
  created_at: string;
}

export interface Post {
  id: UUID;
  story_id: UUID;
  author_id: UUID;
  author_name: string;
  author_image_url: string | null;
  take: string | null;
  /** Article text the author pasted from the source page (reader view). */
  shared_text: string | null;
  visibility: PostVisibility;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
  full_headline: string;
  article_url: string;
  summary: string | null;
  image_url: string | null;
  source_name: string | null;
  source_image_url: string | null;
  kind: StoryKind;
  reply_count: number;
  participant_count: number;
  audience_label: string;
  replies: Comment[];
  attachments: Attachment[];
  author_rating: number | null;
  reactions: ReactionSummary[];
  my_reaction: ReactionKind | null;
  read: boolean;
  starred: boolean;
  my_rating: number | null;
  rating_avg: number | null;
  rating_count: number;
  my_take: string | null;
  engagement: FriendEngagement;
  readers: FriendMini[];
  unread_replies_for_viewer: boolean;
}

/** Live link preview returned by ``POST /posts/preview``. */
export interface PreviewCard {
  canonical_url: string;
  full_headline: string;
  summary: string | null;
  image_url: string | null;
  source_name: string | null;
  source_image_url: string | null;
  kind: StoryKind;
  publisher: string | null;
  platform: string | null;
}

export interface FeedCard {
  card_id: UUID;
  story_id: UUID;
  full_headline: string;
  article_url: string;
  summary: string | null;
  image_url: string | null;
  source_name: string | null;
  source_image_url: string | null;
  kind: StoryKind;
  read: boolean;
  starred: boolean;
  my_rating: number | null;
  rating_avg: number | null;
  rating_count: number;
  my_take: string | null;
  engagement: FriendEngagement;
  posts: Post[];
  score: number;
}

export interface FeedPayload {
  items: FeedCard[];
  caught_up_after: number;
  unread_count: number;
  aggregate_readers: number;
  aggregate_private_conversations: number;
  new_since: string | null;
}

export type ConnectionStatus = "pending" | "accepted" | "blocked";

export interface Connection {
  id: UUID;
  first_id: UUID;
  second_id: UUID;
  status: ConnectionStatus;
  created_at: string;
  updated_at: string;
}

export interface FriendSummary {
  user_id: UUID;
  display_name: string;
  image_url: string | null;
  online: boolean;
  last_active_at: string | null;
  last_activity: string | null;
}

export interface FriendsOverview {
  friends: FriendSummary[];
  total: number;
  online: number;
}

export type FriendActivityKind = "read" | "commented" | "rated";

export interface FriendActivityItem {
  kind: FriendActivityKind;
  story_id: UUID;
  headline: string;
  source_name: string | null;
  article_url: string;
  at: string;
  comment_text: string | null;
  rating: number | null;
}

export interface FriendProfile {
  user_id: UUID;
  display_name: string;
  first: string | null;
  last: string | null;
  image_url: string | null;
  online: boolean;
  last_active_at: string | null;
  reads: number;
  comments: number;
  ratings: number;
  can_edit: boolean;
  recent: FriendActivityItem[];
}

export interface ProfileEdit {
  first: string | null;
  last: string | null;
  phone: string | null;
  image_url: string | null;
}

export interface InviteResult {
  status: string;
  user_id: UUID | null;
  message: string;
}

export interface FriendRequest {
  user_id: UUID;
  display_name: string;
  image_url: string | null;
  mutual_count: number;
  created_at: string;
}

export interface FriendRequests {
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
}

export interface RecommendedFriend {
  user_id: UUID;
  display_name: string;
  image_url: string | null;
  mutual_count: number;
}

export interface InvitationCreateResult {
  status: string;
  user_id: UUID | null;
  invitation_id: UUID | null;
  invite_url: string | null;
  share_message: string;
  message: string;
  email_sent: boolean;
}

export interface InvitePreview {
  token: string;
  status: string;
  invitee_email: string | null;
  inviter_id: UUID;
  inviter_name: string;
  inviter_image_url: string | null;
  message: string | null;
  post_id: UUID | null;
  story_id: UUID | null;
  headline: string | null;
  article_url: string | null;
  image_url: string | null;
  publisher: string | null;
  take: string | null;
  become_friend: boolean;
  reply_count: number;
  reusable: boolean;
}

export interface InvitationAcceptResult {
  status: string;
  inviter_id: UUID;
  post_id: UUID | null;
  message: string;
  became_friend: boolean;
}
