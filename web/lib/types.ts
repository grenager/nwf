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

export interface Story {
  id: UUID;
  article_url: string;
  source_id: UUID | null;
  full_headline: string;
  summary: string | null;
  full_text: string | null;
  section: string | null;
  type: string | null;
  image_url: string | null;
  author_names: string[];
  archived: boolean;
  last_scraped_at: string | null;
  created_at: string;
  updated_at: string;
  read: boolean;
  starred: boolean;
}

export interface StoryList {
  items: Story[];
  total: number;
  limit: number;
  offset: number;
}

export interface Comment {
  id: UUID;
  story_id: UUID;
  user_id: UUID;
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
