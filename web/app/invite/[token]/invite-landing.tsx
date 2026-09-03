"use client";

import { ArticleCard } from "@/components/article-card";
import { Avatar } from "@/components/avatar";
import { useAuth } from "@/components/auth-provider";
import { BrandLink } from "@/components/brand-mark";
import { useAuthGate } from "@/components/auth-gate";
import { CommentAudienceModal } from "@/components/comment-audience-modal";
import { MentionText } from "@/components/mention-text";
import { ReaderBody } from "@/components/reader-body";
import { applyReactionToggle, ReactionBar } from "@/components/reaction-bar";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { draftScopeKey } from "@/lib/drafts";
import { relativeTime } from "@/lib/time";
import { usePersistedDraft } from "@/lib/use-persisted-draft";
import type { InvitePreview, Post, Profile, ReactionKind } from "@/lib/types";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

function InviteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3 sm:px-6">
        <BrandLink
          className="text-zinc-900 dark:text-zinc-50"
          markClassName="h-6 w-6"
          showWordmark={false}
        />
        <Link
          href="/"
          className="text-sm font-medium text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Home
        </Link>
      </div>
    </header>
  );
}

interface InviteLandingClientProps {
  token: string;
}

/** Cap reply textarea growth at ~6 lines (1.375rem line-height × 6 ≈ 9rem). */
const REPLY_MAX_HEIGHT_PX: number = 144;

export function InviteLandingClient({ token }: InviteLandingClientProps) {
  const { session, user, loading: authLoading } = useAuth();
  const { requireAuth } = useAuthGate();
  const { notify } = useToast();
  const autoAcceptStarted = useRef<boolean>(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [post, setPost] = useState<Post | null>(null);
  const [me, setMe] = useState<Profile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<boolean>(false);
  const [joined, setJoined] = useState<boolean>(false);
  const [friendPromptDismissed, setFriendPromptDismissed] =
    useState<boolean>(false);
  // Safety net: if a predicted auto-accept doesn't actually redirect (e.g.
  // the inviter's friend list is full), fall back to the full landing page
  // instead of leaving the visitor stuck on the "Joining…" state.
  const [autoAcceptFallback, setAutoAcceptFallback] = useState<boolean>(false);
  const {
    text: draft,
    setText: setDraft,
    clear: clearDraft,
  } = usePersistedDraft(
    draftScopeKey({ kind: "invite", token }, user?.id ?? null),
  );
  const [posting, setPosting] = useState<boolean>(false);
  const [audienceOpen, setAudienceOpen] = useState<boolean>(false);

  // Height tracks the text itself so a restored draft opens at its real size.
  useEffect(() => {
    const el: HTMLTextAreaElement | null = composerRef.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, REPLY_MAX_HEIGHT_PX)}px`;
  }, [draft]);

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
          // No toast here: this is either an invisible auto-accept (about to
          // hard-navigate away) or the visitor was already friends/already
          // redeemed this link, so "You're now friends" would be misleading.
          const destination: string =
            result.post_id !== null ? `/post/${result.post_id}` : "/";
          // A soft client-side transition here lands on /post/[id], which
          // sits under a layout with an @modal parallel slot this page has
          // never rendered — Next 15 can 404 instead of falling back to
          // that slot's default.tsx. A full navigation sidesteps it.
          window.location.href = destination;
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

  // True when this visit is going to silently friend the inviter (or is
  // already friends / already redeemed this link) and hard-navigate to the
  // post — email invites and reusable share links that opted into
  // friendship. Shared by the effect below and the render decision so they
  // can never drift out of sync.
  const willAutoAccept: boolean =
    session != null &&
    preview != null &&
    preview.status !== "revoked" &&
    preview.status !== "expired" &&
    (!preview.reusable || preview.become_friend) &&
    !isOwnInvite &&
    !autoAcceptFallback;

  useEffect(() => {
    if (authLoading || !willAutoAccept) return;
    if (joined || autoAcceptStarted.current) return;
    autoAcceptStarted.current = true;
    void accept(true).then((redirected) => {
      if (!redirected) setAutoAcceptFallback(true);
    });
  }, [authLoading, willAutoAccept, joined, accept]);

  const showFriendPrompt: boolean =
    !isGuest &&
    !joined &&
    !isOwnInvite &&
    preview != null &&
    preview.reusable &&
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
      clearDraft();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Failed to reply", "error");
    } finally {
      setPosting(false);
    }
  }

  async function togglePostReaction(reaction: ReactionKind): Promise<void> {
    if (!requireAuth("react to this article")) return;
    if (!canParticipate && !joined) {
      if (preview && !preview.become_friend) {
        setFriendPromptDismissed(false);
        notify(`Add ${preview.inviter_name} as a friend to join`, "info");
      }
      return;
    }
    if (!post) return;
    const optimistic = applyReactionToggle(
      post.reactions ?? [],
      post.my_reaction ?? null,
      reaction,
    );
    const previous: Post = post;
    setPost({
      ...post,
      reactions: optimistic.reactions,
      my_reaction: optimistic.my_reaction,
    });
    try {
      const updated: Post =
        optimistic.my_reaction === null
          ? await api.clearPostReaction(post.id)
          : await api.reactToPost(post.id, reaction);
      setPost(updated);
    } catch (err) {
      setPost(previous);
      notify(err instanceof ApiError ? err.message : "Failed to react", "error");
    }
  }

  if (authLoading || loading) {
    return (
      <>
        <InviteHeader />
        <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6">
          <p className="text-sm text-zinc-500">Loading invitation…</p>
        </main>
      </>
    );
  }

  if (error || !preview) {
    return (
      <>
        <InviteHeader />
        <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6">
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
      </>
    );
  }

  if (willAutoAccept) {
    // This visit is going to be friended-and-redirected (or is already
    // joined) without any choice to make here — skip painting the full
    // landing page (article, replies, composer) it's about to leave.
    return (
      <>
        <InviteHeader />
        <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6">
          <p className="text-sm text-zinc-500">Joining the conversation…</p>
        </main>
      </>
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
    <>
      <InviteHeader />
      <main className="mx-auto min-h-dvh max-w-2xl overflow-x-hidden px-4 pb-[calc(env(safe-area-inset-bottom)+3rem)] pt-6 sm:px-6">
      {/* A standalone invite has no article behind it, so "discuss this" would
          be pointing at nothing. */}
      <div className="mb-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
          {headline ? "Shared with you" : "You're invited"}
        </p>
        <h1 className="mt-1 font-serif text-lg font-semibold leading-snug text-zinc-900 dark:text-zinc-50 sm:text-xl">
          {headline
            ? `${preview.inviter_name} wanted to discuss this with you`
            : `${preview.inviter_name} invited you to NewsWithFriends`}
        </h1>
        {!headline ? (
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
            A quiet place to read the news and talk about it with a handful of
            friends — no feeds full of strangers.
          </p>
        ) : null}
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
            quote={post?.quote}
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
        <div className="mb-6 border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
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
                <span className="text-xs text-zinc-400">
                  {relativeTime(post.created_at)}
                </span>
              </div>
              {post.take ? (
                <MentionText
                  text={post.take}
                  className="mt-0.5 block whitespace-pre-line text-sm leading-snug text-zinc-700 dark:text-zinc-300"
                />
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
                  <span className="text-zinc-400">
                    {relativeTime(r.created_at)}
                  </span>
                </div>
                <MentionText
                  text={r.text}
                  className="block whitespace-pre-line text-sm leading-snug text-zinc-700 dark:text-zinc-300"
                />
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
                  Your reaction
                </span>
                {isGuest || !canParticipate ? (
                  <button
                    type="button"
                    onClick={() => void togglePostReaction("like")}
                    className="text-xs text-zinc-400 underline"
                  >
                    React
                  </button>
                ) : (
                  <ReactionBar
                    reactions={post.reactions}
                    myReaction={post.my_reaction}
                    onToggle={(reaction) => void togglePostReaction(reaction)}
                  />
                )}
              </div>
              <div className="flex items-end gap-2">
                <textarea
                  ref={composerRef}
                  rows={1}
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
                  className="min-w-0 flex-1 resize-none overflow-y-auto rounded-2xl border border-zinc-300 bg-white px-3 py-1.5 text-base outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 sm:text-sm"
                  style={{ maxHeight: REPLY_MAX_HEIGHT_PX }}
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
              {isGuest ? null : (
                <button
                  type="button"
                  onClick={() => setAudienceOpen(true)}
                  className="text-left text-xs text-zinc-400 underline decoration-dotted underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  Who will see this?
                </button>
              )}
            </div>
          </div>
          {audienceOpen ? (
            <CommentAudienceModal
              postId={post.id}
              onClose={() => setAudienceOpen(false)}
            />
          ) : null}
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
    </>
  );
}
