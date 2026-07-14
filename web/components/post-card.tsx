"use client";

import { EngagementSummary } from "@/components/engagement-summary";
import { InviteToConversationModal } from "@/components/invite-to-conversation-modal";
import { RatingInput, StarsDisplay } from "@/components/star-rating";
import { useAuth } from "@/components/auth-provider";
import { useAuthGate } from "@/components/auth-gate";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { stripHtml } from "@/lib/html";
import { relativeTime } from "@/lib/time";
import type {
  FeedCard,
  Post,
  Profile,
  PostVisibility,
  UUID,
} from "@/lib/types";
import { useState, type ReactNode } from "react";

interface PostCardProps {
  card: FeedCard;
  me: Profile | null;
  onCardChange: (card: FeedCard) => void;
}

function profileName(me: Profile | null): string {
  if (!me) return "You";
  const full = [me.first, me.last].filter(Boolean).join(" ").trim();
  return full || "You";
}

function hostFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return url;
  }
}

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

function PostThread({
  post,
  me,
  preview,
  storyId,
  myRating,
  onRate,
  onPostChange,
  onDelete,
  onInvite,
}: {
  post: Post;
  me: Profile | null;
  preview?: ReactNode;
  storyId: UUID;
  myRating: number | null;
  onRate: (value: number | null) => void;
  onPostChange: (post: Post) => void;
  onDelete: () => void;
  onInvite: () => void;
}) {
  const { user } = useAuth();
  const { requireAuth } = useAuthGate();
  const { notify } = useToast();
  const [draft, setDraft] = useState<string>("");
  const [posting, setPosting] = useState<boolean>(false);
  const [attachUrl, setAttachUrl] = useState<string>("");
  const [showAttach, setShowAttach] = useState<boolean>(false);
  const [composerActive, setComposerActive] = useState<boolean>(false);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<boolean>(false);
  const [editDraft, setEditDraft] = useState<string>(post.take ?? "");
  const [savingEdit, setSavingEdit] = useState<boolean>(false);

  const isAuthor: boolean = user != null && user.id === post.author_id;

  async function saveEdit(): Promise<void> {
    const text = editDraft.trim();
    setSavingEdit(true);
    try {
      const updated = await api.updatePost(post.id, { take: text || null });
      onPostChange(updated);
      setEditing(false);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Failed to save", "error");
    } finally {
      setSavingEdit(false);
    }
  }

  async function toggleVisibility(): Promise<void> {
    const next: PostVisibility =
      post.visibility === "public" ? "private" : "public";
    setMenuOpen(false);
    try {
      const updated = await api.updatePost(post.id, { visibility: next });
      onPostChange(updated);
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Failed to update visibility",
        "error",
      );
    }
  }

  async function remove(): Promise<void> {
    setMenuOpen(false);
    if (!window.confirm("Delete this post?")) return;
    try {
      await api.deletePost(post.id);
      onDelete();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Failed to delete", "error");
    }
  }

  async function reply(): Promise<void> {
    if (!requireAuth("reply")) return;
    const text = draft.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      const created = await api.createComment(post.id, text);
      onPostChange({
        ...post,
        replies: [...post.replies, created],
        reply_count: post.reply_count + 1,
        participant_count: post.participant_count + 1,
      });
      setDraft("");
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Failed to reply", "error");
    } finally {
      setPosting(false);
    }
  }

  async function attach(): Promise<void> {
    if (!requireAuth("attach a link")) return;
    const url = attachUrl.trim();
    if (!url) return;
    try {
      const created = await api.createAttachment(post.id, url);
      onPostChange({
        ...post,
        attachments: [...post.attachments, created],
      });
      setAttachUrl("");
      setShowAttach(false);
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Failed to attach link",
        "error",
      );
    }
  }

  const showComposerActions: boolean = composerActive || draft.trim().length > 0;

  return (
    <div className="flex items-start gap-3">
      <Avatar
        name={post.author_name}
        imageUrl={post.author_image_url}
        size="lg"
      />
      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <div className="flex items-start gap-2">
            <div className="flex flex-1 flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {post.author_name}
              </span>
              {post.author_rating != null ? (
                <StarsDisplay value={post.author_rating} size="xs" />
              ) : null}
              <span className="text-xs text-zinc-400">
                {relativeTime(post.created_at)}
              </span>
              {post.visibility === "public" ? (
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  Public
                </span>
              ) : null}
              {post.unread_replies_for_viewer ? (
                <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                  new replies
                </span>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                aria-label="Invite a friend to this conversation"
                title="Share"
                onClick={() => {
                  if (!requireAuth("invite friends")) return;
                  onInvite();
                }}
                className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <path d="M12 3v11" />
                  <path d="M8.5 6.5 12 3l3.5 3.5" />
                  <path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
                </svg>
              </button>
              {isAuthor ? (
                <div className="relative">
                  <button
                    type="button"
                    aria-label="Post options"
                    onClick={() => setMenuOpen((v) => !v)}
                    className="rounded px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
                  >
                    ⋯
                  </button>
                  {menuOpen ? (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setMenuOpen(false)}
                      />
                      <div className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-md border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                        <button
                          type="button"
                          onClick={() => {
                            setEditDraft(post.take ?? "");
                            setEditing(true);
                            setMenuOpen(false);
                          }}
                          className="block w-full px-3 py-1.5 text-left text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void toggleVisibility()}
                          className="block w-full px-3 py-1.5 text-left text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        >
                          {post.visibility === "public"
                            ? "Make private"
                            : "Make public"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove()}
                          className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                        >
                          Delete post
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          {editing ? (
            <div className="mt-1 space-y-2">
              <textarea
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                rows={2}
                autoFocus
                className="w-full resize-none border border-zinc-300 bg-white p-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void saveEdit()}
                  disabled={savingEdit}
                  className="bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {savingEdit ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setEditDraft(post.take ?? "");
                  }}
                  className="border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : post.take ? (
            <p className="-mt-0.5 whitespace-pre-line text-sm leading-snug text-zinc-700 dark:text-zinc-300">
              {post.take}
            </p>
          ) : (
            <p className="-mt-0.5 text-sm italic leading-snug text-zinc-400">
              shared this
            </p>
          )}

          {post.attachments.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {post.attachments.map((a) => (
                <li key={a.id}>
                  <a
                    href={a.article_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
                  >
                    ↗ attached: {a.article_url}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {preview ? <div className="space-y-3">{preview}</div> : null}

        {post.replies.map((r) => (
        <div key={r.id} className="flex items-start gap-2">
          <Avatar name={r.author_name} imageUrl={r.author_image_url} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                {r.author_name}
              </span>
              {r.author_rating != null ? (
                <StarsDisplay value={r.author_rating} size="xs" />
              ) : null}
              <span className="text-zinc-400">
                {relativeTime(r.created_at)}
              </span>
              {user && r.user_id === user.id ? (
                <button
                  type="button"
                  onClick={() => {
                    void api.deleteComment(r.id).then(() => {
                      onPostChange({
                        ...post,
                        replies: post.replies.filter((x) => x.id !== r.id),
                        reply_count: Math.max(0, post.reply_count - 1),
                      });
                    });
                  }}
                  className="text-zinc-400 hover:text-red-600"
                >
                  Delete
                </button>
              ) : null}
            </div>
            <p className="-mt-0.5 whitespace-pre-line text-sm leading-snug text-zinc-700 dark:text-zinc-300">
              {r.text}
            </p>
          </div>
        </div>
      ))}

      <div
        className="flex items-start gap-2"
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setComposerActive(false);
          }
        }}
      >
        <Avatar name={profileName(me)} imageUrl={me?.image_url ?? null} />
        <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Your rating
                </span>
                <RatingInput
                  storyId={storyId}
                  value={myRating}
                  onChange={onRate}
                />
              </div>
              <div className="flex gap-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onFocus={() => setComposerActive(true)}
                  placeholder="Reply…"
                  className="min-w-0 flex-1 rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void reply();
                    }
                  }}
                />
                {showComposerActions ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void reply()}
                      disabled={posting || !draft.trim()}
                      className="shrink-0 rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                    >
                      Reply
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAttach((v) => !v)}
                      className="shrink-0 rounded-full border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
                      title="Attach a related link"
                    >
                      Attach
                    </button>
                  </>
                ) : null}
              </div>
              {showAttach && showComposerActions ? (
                <div className="flex gap-2">
                  <input
                    value={attachUrl}
                    onChange={(e) => setAttachUrl(e.target.value)}
                    onFocus={() => setComposerActive(true)}
                    placeholder="https://… related article"
                    className="min-w-0 flex-1 rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none dark:border-zinc-700 dark:bg-zinc-950"
                  />
                  <button
                    type="button"
                    onClick={() => void attach()}
                    className="shrink-0 rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
                  >
                    Add
                  </button>
                </div>
              ) : null}
            </div>
          </div>
      </div>
    </div>
  );
}

export function PostCard({ card, me, onCardChange }: PostCardProps) {
  const { user } = useAuth();
  const [inviteOpen, setInviteOpen] = useState<boolean>(false);

  const engagement = card.engagement;
  const hasEngagement: boolean =
    engagement.read > 0 || engagement.commented > 0;
  const post: Post | undefined = card.posts[0];

  function markReadOnOpen(): void {
    if (!user || card.read) return;
    onCardChange({ ...card, read: true });
    void api.markRead(card.story_id, true).catch(() => undefined);
  }

  function onPostChange(updated: Post): void {
    onCardChange({
      ...card,
      posts: card.posts.map((p) => (p.id === updated.id ? updated : p)),
    });
  }

  // Rating my own story updates my_rating + the visible aggregate, and (if I'm
  // the author) the stars shown beside my take. Recomputed from current card so
  // it works for both setting and clearing.
  function handleRate(next: number | null): void {
    if (!post) return;
    const old: number | null = card.my_rating;
    let count: number = card.rating_count;
    let sum: number = (card.rating_avg ?? 0) * count;
    if (old === null && next !== null) {
      count += 1;
      sum += next;
    } else if (old !== null && next === null) {
      count -= 1;
      sum -= old;
    } else if (old !== null && next !== null) {
      sum += next - old;
    }
    const isAuthor: boolean = user != null && user.id === post.author_id;
    onCardChange({
      ...card,
      my_rating: next,
      rating_avg: count > 0 ? sum / count : null,
      rating_count: count,
      posts: card.posts.map((p) =>
        p.id === post.id
          ? {
              ...p,
              my_rating: next,
              author_rating: isAuthor ? next : p.author_rating,
            }
          : p,
      ),
    });
  }

  if (!post) return null;

  const hasAggregate: boolean =
    card.rating_count > 0 && card.rating_avg !== null;

  // Substack-style link preview: full-width image, then a bordered footer with
  // the source (logo + name) and the headline. Followed by the engagement row.
  const preview: ReactNode = (
    <>
      <a
        href={card.article_url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={markReadOnOpen}
        className="group block border border-zinc-200 dark:border-zinc-800"
      >
        {card.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card.image_url}
            alt=""
            className="h-56 w-full object-cover"
          />
        ) : null}
        <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
          <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            {card.source_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={card.source_image_url}
                alt=""
                className="h-4 w-4 shrink-0 object-cover"
              />
            ) : null}
            <span className="truncate">
              {card.source_name ?? hostFromUrl(card.article_url)}
            </span>
          </div>
          <h3 className="mt-1 font-serif text-lg font-semibold leading-snug tracking-tight text-zinc-900 group-hover:underline dark:text-zinc-50">
            {card.full_headline}
          </h3>
          {card.summary ? (
            <p className="mt-1 line-clamp-2 text-sm text-zinc-500 dark:text-zinc-400">
              {stripHtml(card.summary)}
            </p>
          ) : null}
        </div>
      </a>

      {/* Aggregate rating + friend engagement. */}
      {hasAggregate || hasEngagement ? (
        <div className="flex items-center justify-between gap-3">
          {hasAggregate && card.rating_avg !== null ? (
            <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              <StarsDisplay value={card.rating_avg} size="sm" />
              <span>
                {card.rating_avg.toFixed(1)} · {card.rating_count} rating
                {card.rating_count === 1 ? "" : "s"}
              </span>
            </div>
          ) : (
            <span />
          )}
          {hasEngagement ? (
            <EngagementSummary engagement={engagement} variant="inline" />
          ) : null}
        </div>
      ) : null}
    </>
  );

  return (
    <article className="py-7">
      <PostThread
        post={post}
        me={me}
        preview={preview}
        storyId={card.story_id}
        myRating={card.my_rating}
        onRate={handleRate}
        onPostChange={onPostChange}
        onDelete={() => onCardChange({ ...card, posts: [] })}
        onInvite={() => setInviteOpen(true)}
      />
      {inviteOpen ? (
        <InviteToConversationModal
          postId={post.id}
          headline={card.full_headline}
          articleUrl={card.article_url}
          imageUrl={card.image_url}
          sourceName={card.source_name}
          take={post.take}
          onClose={() => setInviteOpen(false)}
        />
      ) : null}
    </article>
  );
}
