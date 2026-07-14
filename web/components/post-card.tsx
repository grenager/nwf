"use client";

import { EngagementSummary } from "@/components/engagement-summary";
import { SourceLogo } from "@/components/source-logo";
import { StarRating } from "@/components/star-rating";
import { useAuth } from "@/components/auth-provider";
import { useAuthGate } from "@/components/auth-gate";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { relativeTime } from "@/lib/time";
import type { FeedCard, Post, PostVisibility } from "@/lib/types";
import { useState } from "react";

interface PostCardProps {
  card: FeedCard;
  onCardChange: (card: FeedCard) => void;
}

function hostFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return url;
  }
}

function Avatar({ name, imageUrl }: { name: string; imageUrl: string | null }) {
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={imageUrl}
        alt=""
        className="h-7 w-7 shrink-0 rounded-[9999px] object-cover"
      />
    );
  }
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9999px] bg-zinc-200 text-xs font-bold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-200">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function PostThread({
  post,
  onPostChange,
  onDelete,
}: {
  post: Post;
  onPostChange: (post: Post) => void;
  onDelete: () => void;
}) {
  const { user } = useAuth();
  const { requireAuth } = useAuthGate();
  const { notify } = useToast();
  const [draft, setDraft] = useState<string>("");
  const [posting, setPosting] = useState<boolean>(false);
  const [attachUrl, setAttachUrl] = useState<string>("");
  const [showAttach, setShowAttach] = useState<boolean>(false);
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

  return (
    <div className="mt-3 border-l-2 border-zinc-200 pl-3 dark:border-zinc-700">
      <div className="flex items-start gap-2">
        <Avatar name={post.author_name} imageUrl={post.author_image_url} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="flex flex-1 flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {post.author_name}
              </span>
              <span className="text-xs text-zinc-400">
                {relativeTime(post.created_at)}
              </span>
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                {post.audience_label}
              </span>
              {post.unread_replies_for_viewer ? (
                <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                  new replies
                </span>
              ) : null}
            </div>
            {isAuthor ? (
              <div className="relative shrink-0">
                <button
                  type="button"
                  aria-label="Post options"
                  onClick={() => setMenuOpen((v) => !v)}
                  className="-mr-1 rounded px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
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
            <p className="mt-1 whitespace-pre-line text-sm text-zinc-700 dark:text-zinc-300">
              {post.take}
            </p>
          ) : (
            <p className="mt-1 text-sm italic text-zinc-400">shared this</p>
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

          <div className="mt-2 space-y-2">
            {post.replies.map((r) => (
              <div key={r.id} className="flex gap-2">
                <Avatar name={r.author_name} imageUrl={r.author_image_url} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                      {r.author_name}
                    </span>
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
                  <p className="whitespace-pre-line text-sm text-zinc-700 dark:text-zinc-300">
                    {r.text}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-2 flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Reply…"
                className="min-w-0 flex-1 border border-zinc-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950"
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
                disabled={posting || !draft.trim()}
                className="bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
              >
                Reply
              </button>
              <button
                type="button"
                onClick={() => setShowAttach((v) => !v)}
                className="border border-zinc-300 px-2 py-1.5 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
                title="Attach a related link"
              >
                Attach
              </button>
            </div>
            {showAttach ? (
              <div className="flex gap-2">
                <input
                  value={attachUrl}
                  onChange={(e) => setAttachUrl(e.target.value)}
                  placeholder="https://… related article"
                  className="min-w-0 flex-1 border border-zinc-300 bg-white px-2 py-1.5 text-sm outline-none dark:border-zinc-700 dark:bg-zinc-950"
                />
                <button
                  type="button"
                  onClick={() => void attach()}
                  className="bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
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

export function PostCard({ card, onCardChange }: PostCardProps) {
  const { user } = useAuth();

  const engagement = card.engagement;
  const hasEngagement: boolean =
    engagement.read > 0 || engagement.commented > 0;

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

  return (
    <article className="border-b border-zinc-200 py-4 dark:border-zinc-800">
      {/* Link preview: image, journal, headline, summary — click to read. */}
      <a
        href={card.article_url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={markReadOnOpen}
        className="block w-full overflow-hidden rounded-lg border border-zinc-200 transition hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
      >
        {card.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card.image_url}
            alt=""
            className="h-52 w-full border-b border-zinc-200 object-cover dark:border-zinc-800"
          />
        ) : null}
        <div className="p-3">
          <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
            {card.source_name ?? hostFromUrl(card.article_url)}
          </span>
          <h3 className="mt-0.5 font-serif text-lg font-semibold leading-snug tracking-tight text-zinc-900 dark:text-zinc-50">
            {card.full_headline}
          </h3>
          {card.summary ? (
            <p className="mt-1 line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">
              {card.summary}
            </p>
          ) : null}
        </div>
      </a>

      {/* Kind label + source logo, moved beneath the preview. */}
      <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
        <span
          className={`rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide ${
            card.kind === "news"
              ? "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300"
              : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
          }`}
        >
          {card.kind}
        </span>
        {card.source_image_url ? (
          <SourceLogo
            src={card.source_image_url}
            name={card.source_name}
            imgClassName="h-4 w-auto max-w-[120px] object-contain"
            fallbackClassName="font-medium"
          />
        ) : null}
      </div>

      {/* Single engagement: 1-5 star rating with friend average. */}
      <div className="mt-2">
        <StarRating
          storyId={card.story_id}
          value={card.my_rating}
          friendAvg={card.friend_rating_avg}
          friendCount={card.friend_rating_count}
          onChange={(next) => onCardChange({ ...card, my_rating: next })}
        />
      </div>

      {hasEngagement ? (
        <div className="mt-2">
          <EngagementSummary engagement={engagement} variant="inline" />
        </div>
      ) : null}

      {card.posts.map((post) => (
        <PostThread
          key={post.id}
          post={post}
          onPostChange={onPostChange}
          onDelete={() =>
            onCardChange({
              ...card,
              posts: card.posts.filter((p) => p.id !== post.id),
            })
          }
        />
      ))}
    </article>
  );
}
