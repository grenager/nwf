"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase";
import type {
  Attachment,
  Comment,
  Connection,
  ConnectionStatus,
  FeedPayload,
  FriendProfile,
  FriendRequests,
  FriendsOverview,
  InvitationAcceptResult,
  InvitationCreateResult,
  InvitePreview,
  InviteResult,
  Post,
  PostVisibility,
  PreferencesUpdate,
  PreviewCard,
  Profile,
  ProfileEdit,
  RecommendedFriend,
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

  // --- stories ---
  getRecommended: (): Promise<StoryList> =>
    request<StoryList>("/stories/recommended"),
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
  previewUrl: (payload: {
    url: string;
    kind?: StoryKind;
  }): Promise<PreviewCard> =>
    request<PreviewCard>("/posts/preview", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  createPost: (payload: {
    story_id?: UUID;
    url?: string;
    take?: string | null;
    visibility?: PostVisibility;
    kind?: StoryKind;
    title?: string;
    canonical_url?: string;
    full_headline?: string;
    summary?: string | null;
    image_url?: string | null;
    publisher?: string | null;
    platform?: string | null;
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
  getConnectionRequests: (): Promise<FriendRequests> =>
    request<FriendRequests>("/connections/requests"),
  getRecommendedFriends: (): Promise<RecommendedFriend[]> =>
    request<RecommendedFriend[]>("/connections/recommended"),
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

  // --- invitations (email / magic-link) ---
  createInvitation: (payload: {
    email?: string | null;
    post_id?: UUID | null;
    message?: string | null;
    become_friend?: boolean;
  }): Promise<InvitationCreateResult> =>
    request<InvitationCreateResult>("/invitations", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getInvitePreview: (token: string): Promise<InvitePreview> =>
    request<InvitePreview>(`/invitations/${encodeURIComponent(token)}`),
  getInvitePost: (token: string): Promise<Post> =>
    request<Post>(`/invitations/${encodeURIComponent(token)}/post`),
  acceptInvite: (
    token: string,
    addFriend?: boolean | null,
  ): Promise<InvitationAcceptResult> =>
    request<InvitationAcceptResult>(
      `/invitations/${encodeURIComponent(token)}/accept`,
      {
        method: "POST",
        body: JSON.stringify(
          addFriend === undefined ? {} : { add_friend: addFriend },
        ),
      },
    ),
};
