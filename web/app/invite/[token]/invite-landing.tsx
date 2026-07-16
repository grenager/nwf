"use client";

import { ArticleCard } from "@/components/article-card";
import { useAuth } from "@/components/auth-provider";
import { useAuthGate } from "@/components/auth-gate";
import { ReaderBody } from "@/components/reader-body";
import { RatingInput, StarsDisplay } from "@/components/star-rating";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { relativeTime } from "@/lib/time";
import type { InvitePreview, Post, Profile } from "@/lib/types";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

function Avatar({
  name,
  imageUrl,
  size = "sm",
}: {
  name: string;
  imageUrl: string | null;
  size?: "sm" | "lg";
}) {
  const dims: string = size === "lg" ? "h-10 w-10" : "h-7 w-7";
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={imageUrl}
        alt=""
        className={`${dims} shrink-0 rounded-[9999px] object-cover`}
      />
    );
  }
  return (
    <span
      className={`${dims} flex shrink-0 items-center justify-center rounded-[9999px] bg-zinc-200 text-sm font-bold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-200`}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

interface InviteLandingClientProps {
  token: string;
}

export function InviteLandingClient({ token }: InviteLandingClientProps) {
  const { session, user } = useAuth();
  const { requireAuth } = useAuthGate();
  const { notify } = useToast();
  const autoAcceptStarted = useRef<boolean>(false);

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [post, setPost] = useState<Post | null>(null);
  const [me, setMe] = useState<Profile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<boolean>(false);
  const [joined, setJoined] = useState<boolean>(false);
  const [friendPromptDismissed, setFriendPromptDismissed] =
    useState<boolean>(false);
  const [draft, setDraft] = useState<string>("");
  const [posting, setPosting] = useState<boolean>(false);

  const load = useCallback(async (): Promise<void> => {
    if (!token) {
      setError("Invalid invitation link");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [previewData, postData] = await Promise.all([
        api.getInvitePreview(token),
        api.getInvitePost(token).catch(() => null),
      ]);
      setPreview(previewData);
      setPost(postData);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Invitation not found",
      );
      setPreview(null);
      setPost(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!session) {
      setMe(null);
      return;
    }
    void api
      .getMe()
      .then((profile) => setMe(profile))
      .catch(() => setMe(null));
  }, [session]);

  const isGuest: boolean = session === null;
  const isOwnInvite: boolean =
    user != null && preview != null && user.id === preview.inviter_id;
  const canParticipate: boolean = !isGuest && (joined || isOwnInvite);

  const accept = useCallback(
    async (addFriend: boolean): Promise<boolean> => {
      if (!token || accepting) return false;
      setAccepting(true);
      try {
        await api.getMe().catch(() => undefined);
        const result = await api.acceptInvite(token, addFriend);
        if (result.became_friend || result.status === "already_accepted") {
          setJoined(true);
          notify(result.message, "success");
          // Refresh post so ratings/my state reflect the authenticated viewer.
          const refreshed = await api.getInvitePost(token).catch(() => null);
          if (refreshed) setPost(refreshed);
          return true;
        }
        notify(result.message, "info");
        return false;
      } catch (err) {
        notify(
          err instanceof ApiError ? err.message : "Could not accept invite",
          "error",
        );
        autoAcceptStarted.current = false;
        return false;
      } finally {
        setAccepting(false);
      }
    },
    [accepting, notify, token],
  );

  // Auto-friend when the share was created with become_friend.
  useEffect(() => {
    if (!session || !preview || preview.status === "revoked") return;
    if (preview.status === "expired") return;
    if (!preview.become_friend) return;
    if (user != null && user.id === preview.inviter_id) return;
    if (joined || autoAcceptStarted.current) return;
    autoAcceptStarted.current = true;
    void accept(true);
  }, [session, preview, user, joined, accept]);

  const showFriendPrompt: boolean =
    !isGuest &&
    !joined &&
    !isOwnInvite &&
    preview != null &&
    !preview.become_friend &&
    !friendPromptDismissed &&
    preview.status !== "revoked" &&
    preview.status !== "expired";

  async function reply(): Promise<void> {
    if (!requireAuth("reply")) return;
    if (!canParticipate && !joined) {
      if (preview && !preview.become_friend) {
        setFriendPromptDismissed(false);
        notify(`Add ${preview.inviter_name} as a friend to join`, "info");
      }
      return;
    }
    if (!post) return;
    const text = draft.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      const created = await api.createComment(post.id, text);
      setPost({
        ...post,
        replies: [...post.replies, created],
        reply_count: post.reply_count + 1,
      });
      setDraft("");
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Failed to reply", "error");
    } finally {
      setPosting(false);
    }
  }

  function handleRateAttempt(value: number | null): void {
    if (!requireAuth("rate this article")) return;
    if (!canParticipate && !joined) {
      if (preview && !preview.become_friend) {
        setFriendPromptDismissed(false);
        notify(`Add ${preview.inviter_name} as a friend to join`, "info");
      }
      return;
    }
    if (!post) return;
    setPost({ ...post, my_rating: value });
  }

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6">
        <p className="text-sm text-zinc-500">Loading invitation…</p>
      </main>
    );
  }

  if (error || !preview) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6">
        <h1 className="font-serif text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Invitation unavailable
        </h1>
        <p className="mt-2 text-sm text-zinc-500">{error ?? "Not found"}</p>
        <Link
          href="/signin"
          className="mt-6 text-sm font-semibold text-zinc-900 underline dark:text-zinc-100"
        >
          Sign in
        </Link>
      </main>
    );
  }

  const signInHref: string = `/signin?next=${encodeURIComponent(`/invite/${token}`)}${
    preview.invitee_email
      ? `&email=${encodeURIComponent(preview.invitee_email)}`
      : ""
  }`;

  const articleUrl: string | null = post?.article_url ?? preview.article_url;
  const headline: string | null = post?.full_headline ?? preview.headline;
  const imageUrl: string | null = post?.image_url ?? preview.image_url;
  const sourceName: string | null = post?.source_name ?? preview.publisher;
  const summary: string | null = post?.summary ?? null;

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-6 sm:px-6">
      <div className="mb-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
          Shared with you
        </p>
        <h1 className="mt-1 font-serif text-lg font-semibold leading-snug text-zinc-900 dark:text-zinc-50 sm:text-xl">
          {preview.inviter_name} wanted to discuss this with you
        </h1>
        {preview.message ? (
          <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-300">
            {preview.message}
          </p>
        ) : null}
      </div>

      {articleUrl && headline ? (
        <div className="mb-8">
          <ArticleCard
            articleUrl={articleUrl}
            headline={headline}
            summary={post?.shared_text?.trim() ? null : summary}
            imageUrl={imageUrl}
            sourceName={sourceName}
            imageHeightClassName="h-56 sm:h-64"
            summaryClampClassName="line-clamp-3"
          />
        </div>
      ) : null}

      {post?.shared_text && post.shared_text.trim() ? (
        <div className="mb-8 border-l-2 border-zinc-200 pl-4 dark:border-zinc-800">
          <ReaderBody
            sharedText={post.shared_text}
            articleUrl={post.article_url}
            sourceName={sourceName}
            authorName={post.author_name}
          />
        </div>
      ) : null}

      {showFriendPrompt ? (
        <div className="mb-6 border border-brand-200 bg-brand-50 p-4 dark:border-brand-900 dark:bg-brand-950">
          <p className="text-sm text-zinc-800 dark:text-zinc-100">
            Add <strong>{preview.inviter_name}</strong> as a friend to join this
            conversation?
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={accepting}
              onClick={() => void accept(true)}
              className="bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {accepting ? "Connecting…" : "Add friend & join"}
            </button>
            <button
              type="button"
              onClick={() => setFriendPromptDismissed(true)}
              className="border border-zinc-300 px-4 py-2 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
            >
              Not now
            </button>
          </div>
        </div>
      ) : null}

      {joined ? (
        <div className="mb-6 border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
          You&apos;re connected with {preview.inviter_name}. Jump in below — or{" "}
          <Link href="/" className="font-semibold underline">
            go to your feed
          </Link>
          .
        </div>
      ) : null}

      {post ? (
        <section className="space-y-4">
          <div className="flex items-start gap-3">
            <Avatar
              name={post.author_name}
              imageUrl={post.author_image_url}
              size="lg"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {post.author_name}
                </span>
                {post.author_rating != null ? (
                  <StarsDisplay value={post.author_rating} size="xs" />
                ) : null}
                <span className="text-xs text-zinc-400">
                  {relativeTime(post.created_at)}
                </span>
              </div>
              {post.take ? (
                <p className="mt-0.5 whitespace-pre-line text-sm leading-snug text-zinc-700 dark:text-zinc-300">
                  {post.take}
                </p>
              ) : (
                <p className="mt-0.5 text-sm italic text-zinc-400">shared this</p>
              )}
            </div>
          </div>

          {post.replies.map((r) => (
            <div key={r.id} className="flex items-start gap-2 pl-2 sm:pl-4">
              <Avatar name={r.author_name} imageUrl={r.author_image_url} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                    {r.author_name}
                  </span>
                  {r.author_rating != null ? (
                    <StarsDisplay value={r.author_rating} size="xs" />
                  ) : null}
                  <span className="text-zinc-400">
                    {relativeTime(r.created_at)}
                  </span>
                </div>
                <p className="whitespace-pre-line text-sm leading-snug text-zinc-700 dark:text-zinc-300">
                  {r.text}
                </p>
              </div>
            </div>
          ))}

          {post.replies.length === 0 && preview.reply_count === 0 ? (
            <p className="text-sm text-zinc-400">No replies yet — be the first.</p>
          ) : null}

          <div className="flex items-start gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-900">
            <Avatar
              name={
                me
                  ? [me.first, me.last].filter(Boolean).join(" ").trim() || "You"
                  : "You"
              }
              imageUrl={me?.image_url ?? null}
            />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-zinc-500">
                  Your rating
                </span>
                {isGuest || !canParticipate ? (
                  <button
                    type="button"
                    onClick={() => handleRateAttempt(null)}
                    className="text-xs text-zinc-400 underline"
                  >
                    Rate
                  </button>
                ) : (
                  <RatingInput
                    storyId={post.story_id}
                    value={post.my_rating}
                    onChange={(value) => {
                      setPost({ ...post, my_rating: value });
                    }}
                  />
                )}
              </div>
              <div className="flex gap-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onFocus={() => {
                    if (!requireAuth("reply")) return;
                  }}
                  onClick={() => {
                    if (isGuest) {
                      requireAuth("reply");
                    } else if (!canParticipate && preview && !preview.become_friend) {
                      setFriendPromptDismissed(false);
                      notify(
                        `Add ${preview.inviter_name} as a friend to join`,
                        "info",
                      );
                    }
                  }}
                  placeholder={
                    isGuest
                      ? "Sign up to reply…"
                      : !canParticipate
                        ? "Add friend to reply…"
                        : "Reply…"
                  }
                  readOnly={isGuest || !canParticipate}
                  className="min-w-0 flex-1 rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void reply();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => void reply()}
                  disabled={posting || !draft.trim() || !canParticipate}
                  className="shrink-0 rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  Reply
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <p className="text-sm text-zinc-500">
          This invitation doesn&apos;t include a conversation yet.
        </p>
      )}

      {isGuest ? (
        <>
          <section className="mt-10 border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
              New here?
            </p>
            <h3 className="mt-1 font-serif text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              What is NewsWithFriends?
            </h3>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              It&apos;s a calmer way to read the news — with the people you
              trust, not strangers or algorithms.
            </p>
            <ul className="mt-3 space-y-1.5 text-sm text-zinc-600 dark:text-zinc-300">
              <li className="flex gap-2">
                <span aria-hidden="true">·</span>
                <span>Share articles and your take with friends.</span>
              </li>
              <li className="flex gap-2">
                <span aria-hidden="true">·</span>
                <span>Discuss and rate stories together in one place.</span>
              </li>
              <li className="flex gap-2">
                <span aria-hidden="true">·</span>
                <span>See what people you trust are actually reading.</span>
              </li>
            </ul>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Link
                href={signInHref}
                className="bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
              >
                Create free account
              </Link>
              <a
                href="/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold text-zinc-700 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
              >
                Explore the feed first
              </a>
            </div>
            <p className="mt-3 text-xs text-zinc-400">
              No password — just a magic link. Exploring opens in a new tab so
              you don&apos;t lose {preview.inviter_name}&apos;s conversation.
            </p>
          </section>

          <p className="mt-8 text-center text-xs text-zinc-400">
            Already on NewsWithFriends?{" "}
            <Link href={signInHref} className="underline">
              Sign in
            </Link>
          </p>
        </>
      ) : null}
    </main>
  );
}
