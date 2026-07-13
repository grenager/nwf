// API types mirroring the FastAPI Pydantic schemas.
// Regenerate from OpenAPI with `npm run gen:api` (see README) once the API is running.

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

export interface Source {
  id: UUID;
  name: string;
  homepage_url: string;
  rss_url: string | null;
  include_selector: string | null;
  exclude_selector: string | null;
  bias_score: number | null;
  last_scraped_at: string | null;
  tags: string[];
  image_url: string | null;
  has_paywall: boolean;
  created_at: string;
  updated_at: string;
}

export type StoryKind = "news" | "analysis";

export interface FriendStar {
  user_id: UUID;
  display_name: string;
}

export type ReactionKind =
  | "thumbsup"
  | "heart"
  | "laugh"
  | "wow"
  | "sad"
  | "angry";

export interface FriendMini {
  user_id: UUID;
  display_name: string;
  image_url: string | null;
}

export interface FriendEngagement {
  read: number;
  commented: number;
  reactions: Partial<Record<ReactionKind, number>>;
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
  full_text: string | null;
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
  my_reaction: ReactionKind | null;
  friend_stars?: FriendStar[];
  engagement: FriendEngagement;
}

export interface StoryList {
  items: Story[];
  total: number;
  limit: number;
  offset: number;
}

export interface SourceInput {
  name: string | null;
  homepage_url: string | null;
  rss_url: string | null;
  image_url: string | null;
  has_paywall: boolean;
}

export interface SourceStatus {
  id: UUID;
  name: string;
  rss_url: string | null;
  has_rss: boolean;
  last_scraped_at: string | null;
  story_count: number;
  newest_story_at: string | null;
}

export interface Comment {
  id: UUID;
  story_id: UUID;
  user_id: UUID;
  author_name: string;
  author_image_url: string | null;
  text: string;
  created_at: string;
  updated_at: string;
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
  last_source_name: string | null;
}

export interface FriendsOverview {
  friends: FriendSummary[];
  total: number;
  online: number;
}

export type FriendActivityKind = "read" | "commented" | ReactionKind;

export interface FriendActivityItem {
  kind: FriendActivityKind;
  story_id: UUID;
  headline: string;
  source_name: string | null;
  article_url: string;
  at: string;
  comment_text: string | null;
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
  hearts: number;
  comments: number;
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

export interface EventCoverage {
  story_id: UUID;
  source_id: UUID | null;
  source_name: string;
  bias_score: number | null;
  prominence: number;
  image_url: string | null;
  story_image_url: string | null;
  full_headline: string;
  summary: string | null;
  article_url: string;
  read: boolean;
  starred: boolean;
}

export interface EventSummary {
  id: UUID;
  title: string;
  first_seen_at: string;
  outlet_count: number;
  story_count: number;
  is_scoop: boolean;
  source_names: string[];
  coverage: EventCoverage[];
  friend_stars: FriendStar[];
  engagement: FriendEngagement;
  read: boolean;
  dismissed: boolean;
}

export interface EventList {
  items: EventSummary[];
  total: number;
}

export interface TodayPayload {
  events: EventList;
  analysis: StoryList;
  friend_pick_count: number;
  new_since: string | null;
}
