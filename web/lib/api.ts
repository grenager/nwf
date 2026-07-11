"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase";
import type {
  Comment,
  Connection,
  ConnectionStatus,
  PreferencesUpdate,
  Profile,
  Source,
  SourceStatus,
  Story,
  StoryList,
  UUID,
} from "@/lib/types";

const API_URL: string = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token: string | undefined = session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(await authHeader()),
    ...((init.headers as Record<string, string>) ?? {}),
  };

  const resp: Response = await fetch(`${API_URL}${path}`, { ...init, headers });

  if (!resp.ok) {
    let detail = resp.statusText;
    try {
      const body: unknown = await resp.json();
      if (body && typeof body === "object" && "detail" in body) {
        detail = String((body as { detail: unknown }).detail);
      }
    } catch {
      // non-JSON error body; keep statusText.
    }
    throw new ApiError(resp.status, detail);
  }

  if (resp.status === 204) {
    return undefined as T;
  }
  return (await resp.json()) as T;
}

export const api = {
  // --- me ---
  getMe: (): Promise<Profile> => request<Profile>("/me"),
  updatePreferences: (body: PreferencesUpdate): Promise<Profile> =>
    request<Profile>("/me/preferences", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  getMySources: (): Promise<Source[]> => request<Source[]>("/me/sources"),
  setMySources: (sourceIds: UUID[]): Promise<Source[]> =>
    request<Source[]>("/me/sources", {
      method: "PUT",
      body: JSON.stringify({ source_ids: sourceIds }),
    }),
  markRead: (storyId: UUID, read = true): Promise<void> =>
    request<void>("/me/read", {
      method: "POST",
      body: JSON.stringify({ story_id: storyId, read }),
    }),
  addStar: (storyId: UUID): Promise<void> =>
    request<void>("/me/stars", {
      method: "POST",
      body: JSON.stringify({ story_id: storyId }),
    }),
  removeStar: (storyId: UUID): Promise<void> =>
    request<void>(`/me/stars/${storyId}`, { method: "DELETE" }),
  getStarred: (): Promise<StoryList> => request<StoryList>("/me/starred"),

  // --- sources ---
  listSources: (): Promise<Source[]> => request<Source[]>("/sources"),
  searchSources: (q: string): Promise<Source[]> =>
    request<Source[]>(`/sources/search?q=${encodeURIComponent(q)}`),

  // --- admin ---
  getSourcesStatus: (): Promise<SourceStatus[]> =>
    request<SourceStatus[]>("/sources/status"),
  scrapeSource: (id: UUID): Promise<{ status: string; ingested: string }> =>
    request<{ status: string; ingested: string }>(`/sources/${id}/scrape`, {
      method: "POST",
    }),

  // --- stories ---
  getRecommended: (): Promise<StoryList> =>
    request<StoryList>("/stories/recommended"),
  searchStories: (q: string): Promise<StoryList> =>
    request<StoryList>(`/stories/search?q=${encodeURIComponent(q)}`),
  getStory: (id: UUID): Promise<Story> => request<Story>(`/stories/${id}`),

  // --- comments ---
  listComments: (storyId?: UUID): Promise<Comment[]> =>
    request<Comment[]>(
      storyId ? `/comments?story_id=${storyId}` : "/comments",
    ),
  createComment: (storyId: UUID, text: string): Promise<Comment> =>
    request<Comment>("/comments", {
      method: "POST",
      body: JSON.stringify({ story_id: storyId, text }),
    }),
  deleteComment: (id: UUID): Promise<void> =>
    request<void>(`/comments/${id}`, { method: "DELETE" }),

  // --- connections ---
  listConnections: (): Promise<Connection[]> =>
    request<Connection[]>("/connections"),
  createConnection: (targetUserId: UUID): Promise<Connection> =>
    request<Connection>("/connections", {
      method: "POST",
      body: JSON.stringify({ target_user_id: targetUserId }),
    }),
  updateConnection: (
    targetUserId: UUID,
    status: ConnectionStatus,
  ): Promise<Connection> =>
    request<Connection>(`/connections/${targetUserId}`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    }),
  deleteConnection: (targetUserId: UUID): Promise<void> =>
    request<void>(`/connections/${targetUserId}`, { method: "DELETE" }),
};
