"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase";
import type {
  Attachment,
  Comment,
  Connection,
  ConnectionStatus,
  FeedPayload,
  FriendProfile,
  FriendsOverview,
  InviteResult,
  Post,
  PostVisibility,
  PreferencesUpdate,
  Profile,
  ProfileEdit,
  Source,
  SourceInput,
  SourceStatus,
  Story,
  StoryKind,
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
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
  setTake: (storyId: UUID, take: string | null): Promise<void> =>
    request<void>("/me/take", {
      method: "POST",
      body: JSON.stringify({ story_id: storyId, take }),
    }),
  dismissStory: (storyId: UUID): Promise<void> =>
    request<void>("/me/dismiss", {
      method: "POST",
      body: JSON.stringify({ story_id: storyId }),
    }),
  undismissStory: (storyId: UUID): Promise<void> =>
    request<void>(`/me/dismiss/${storyId}`, { method: "DELETE" }),
  addStar: (storyId: UUID): Promise<void> =>
    request<void>("/me/stars", {
      method: "POST",
      body: JSON.stringify({ story_id: storyId }),
    }),
  removeStar: (storyId: UUID): Promise<void> =>
    request<void>(`/me/stars/${storyId}`, { method: "DELETE" }),
  getStarred: (): Promise<StoryList> => request<StoryList>("/me/starred"),
  setRating: (storyId: UUID, rating: number): Promise<void> =>
    request<void>("/me/ratings", {
      method: "PUT",
      body: JSON.stringify({ story_id: storyId, rating }),
    }),
  clearRating: (storyId: UUID): Promise<void> =>
    request<void>(`/me/ratings/${storyId}`, { method: "DELETE" }),

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
  getSource: (id: UUID): Promise<Source> => request<Source>(`/sources/${id}`),
  createSource: (payload: SourceInput): Promise<Source> =>
    request<Source>("/sources", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateSource: (id: UUID, payload: SourceInput): Promise<Source> =>
    request<Source>(`/sources/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  // --- stories ---
  getRecommended: (): Promise<StoryList> =>
    request<StoryList>("/stories/recommended"),
  getStoriesBySource: (perSource = 6): Promise<StoryList> =>
    request<StoryList>(`/stories/by-source?per_source=${perSource}`),
  searchStories: (q: string): Promise<StoryList> =>
    request<StoryList>(`/stories/search?q=${encodeURIComponent(q)}`),
  titleSearchStories: (q: string): Promise<StoryList> =>
    request<StoryList>(`/stories/title-search?q=${encodeURIComponent(q)}`),
  addStory: (url: string, kind: StoryKind): Promise<Story> =>
    request<Story>("/stories", {
      method: "POST",
      body: JSON.stringify({ url, kind }),
    }),
  getStory: (id: UUID): Promise<Story> => request<Story>(`/stories/${id}`),

  // --- feed / posts ---
  getFeed: (): Promise<FeedPayload> => request<FeedPayload>("/feed"),
  getPost: (id: UUID): Promise<Post> => request<Post>(`/posts/${id}`),
  createPost: (payload: {
    story_id?: UUID;
    url?: string;
    take?: string | null;
    visibility?: PostVisibility;
    kind?: StoryKind;
    title?: string;
  }): Promise<Post> =>
    request<Post>("/posts", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updatePost: (
    id: UUID,
    payload: { take?: string | null; visibility?: PostVisibility },
  ): Promise<Post> =>
    request<Post>(`/posts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deletePost: (id: UUID): Promise<void> =>
    request<void>(`/posts/${id}`, { method: "DELETE" }),

  // --- comments (replies) ---
  listComments: (opts?: { postId?: UUID; storyId?: UUID }): Promise<Comment[]> => {
    const params = new URLSearchParams();
    if (opts?.postId) params.set("post_id", opts.postId);
    if (opts?.storyId) params.set("story_id", opts.storyId);
    const qs = params.toString();
    return request<Comment[]>(qs ? `/comments?${qs}` : "/comments");
  },
  createComment: (postId: UUID, text: string): Promise<Comment> =>
    request<Comment>("/comments", {
      method: "POST",
      body: JSON.stringify({ post_id: postId, text }),
    }),
  deleteComment: (id: UUID): Promise<void> =>
    request<void>(`/comments/${id}`, { method: "DELETE" }),

  // --- attachments ---
  createAttachment: (
    postId: UUID,
    articleUrl: string,
    commentId?: UUID,
  ): Promise<Attachment> =>
    request<Attachment>("/attachments", {
      method: "POST",
      body: JSON.stringify({
        post_id: postId,
        article_url: articleUrl,
        comment_id: commentId ?? null,
      }),
    }),
  deleteAttachment: (id: UUID): Promise<void> =>
    request<void>(`/attachments/${id}`, { method: "DELETE" }),

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

  // --- friends (activity views) ---
  getFriends: (): Promise<FriendsOverview> =>
    request<FriendsOverview>("/connections/friends"),
  getFriendProfile: (friendId: UUID): Promise<FriendProfile> =>
    request<FriendProfile>(`/connections/friends/${friendId}`),
  updateProfile: (userId: UUID, payload: ProfileEdit): Promise<Profile> =>
    request<Profile>(`/profiles/${userId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  inviteFriend: (email: string): Promise<InviteResult> =>
    request<InviteResult>("/connections/invite", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
};
