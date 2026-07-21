"use client";

import { applyReactionToggle } from "@/components/reaction-bar";
import { MentionInput } from "@/components/mention-input";
import { MentionText } from "@/components/mention-text";
import { RatingInput, StarsDisplay } from "@/components/star-rating";
import { useAuth } from "@/components/auth-provider";
import { useAuthGate } from "@/components/auth-gate";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { relativeTime } from "@/lib/time";
import type { Comment, Post, Profile, PostVisibility, UUID } from "@/lib/types";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

function profileName(me: Profile | null): string {
  if (!me) return "You";
  const full = [me.first, me.last].filter(Boolean).join(" ").trim();
  return full || "You";
}

export function Avatar({
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

export function PostThread({
  post,
  me,
  preview,
  storyId,
  myRating,
  onRate,
  onPostChange,
  onDelete,
  onInvite,
  markSeenOnMount = false,
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
  /** Stamp the read cursor only when the thread is actually opened (detail page). */
  markSeenOnMount?: boolean;
}) {
  const { user, session } = useAuth();
  const { requireAuth } = useAuthGate();
  const { notify } = useToast();
  const isGuest: boolean = session === null;
  const [draft, setDraft] = useState<string>("");
  const [posting, setPosting] = useState<boolean>(false);
  const [attachUrl, setAttachUrl] = useState<string>("");
  const [showAttach, setShowAttach] = useState<boolean>(false);
  const [composerActive, setComposerActive] = useState<boolean>(false);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<boolean>(false);
  const [editDraft, setEditDraft] = useState<string>(post.take ?? "");
  const [editSharedDraft, setEditSharedDraft] = useState<string>(
    post.shared_text ?? "",
  );
  const [savingEdit, setSavingEdit] = useState<boolean>(false);
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [reacting, setReacting] = useState<boolean>(false);
  const [seenBoundary, setSeenBoundary] = useState<string | null>(
    post.last_seen_at ?? null,
  );
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const markedSeenRef = useRef<boolean>(false);

  const isAuthor: boolean = user != null && user.id === post.author_id;

  // Stamp the per-thread read cursor when the signed-in viewer opens this thread
  // (detail page only — not every feed card mount).
  useEffect(() => {
    if (!markSeenOnMount || !user || markedSeenRef.current) return;
    markedSeenRef.current = true;
    const previous: string | null = post.last_seen_at ?? null;
    setSeenBoundary(previous);
    void api.markThreadSeen(post.id).then(() => {
      onPostChange({
        ...post,
        last_seen_at: new Date().toISOString(),
        unread_reply_count: 0,
        unread_replies_for_viewer: false,
      });
    }).catch(() => undefined);
    // Only stamp once per mount for this post.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markSeenOnMount, user?.id, post.id]);

  const { tops, childrenByParent } = useMemo(() => {
    const topsLocal: Comment[] = [];
    const kids: Map<UUID, Comment[]> = new Map();
    for (const r of post.replies) {
      if (r.parent_comment_id == null) {
        topsLocal.push(r);
      } else {
        const list: Comment[] = kids.get(r.parent_comment_id) ?? [];
        list.push(r);
        kids.set(r.parent_comment_id, list);
      }
    }
    return { tops: topsLocal, childrenByParent: kids };
  }, [post.replies]);

  const firstUnreadTopId: UUID | null = useMemo(() => {
    if (!user) return null;
    // No prior cursor and nothing flagged unread — skip the divider.
    if (seenBoundary === null && post.unread_reply_count <= 0) return null;
    const boundaryMs: number | null =
      seenBoundary !== null ? Date.parse(seenBoundary) : null;
    for (const top of tops) {
      const topIsUnread: boolean =
        top.user_id !== user.id &&
        (boundaryMs === null || Date.parse(top.created_at) > boundaryMs);
      if (topIsUnread) return top.id;
      const kids: Comment[] = childrenByParent.get(top.id) ?? [];
      for (const child of kids) {
        const childUnread: boolean =
          child.user_id !== user.id &&
          (boundaryMs === null || Date.parse(child.created_at) > boundaryMs);
        if (childUnread) return top.id;
      }
    }
    return null;
  }, [
    user,
    seenBoundary,
    post.unread_reply_count,
    tops,
    childrenByParent,
  ]);

  function startReplyTo(comment: Comment): void {
    setReplyTo(comment);
    setComposerActive(true);
    composerRef.current?.focus();
  }

  async function toggleCommentLike(comment: Comment): Promise<void> {
    if (!requireAuth("like a comment")) return;
    if (reacting) return;
    const optimistic = applyReactionToggle(
      comment.reactions ?? [],
      comment.my_reaction ?? null,
      "like",
    );
    const patched: Comment = {
      ...comment,
      reactions: optimistic.reactions,
      my_reaction: optimistic.my_reaction,
    };
    onPostChange({
      ...post,
      replies: post.replies.map((r) => (r.id === comment.id ? patched : r)),
    });
    setReacting(true);
    try {
      const updated: Comment =
        optimistic.my_reaction === null
          ? await api.clearCommentReaction(comment.id)
          : await api.reactToComment(comment.id, "like");
      onPostChange({
        ...post,
        replies: post.replies.map((r) => (r.id === comment.id ? updated : r)),
      });
    } catch (err) {
      onPostChange(post);
      notify(err instanceof ApiError ? err.message : "Failed to like", "error");
    } finally {
      setReacting(false);
    }
  }

  async function saveEdit(): Promise<void> {
    const text: string = editDraft.trim();
    const shared: string = editSharedDraft.trim();
    setSavingEdit(true);
    try {
      const updated: Post = await api.updatePost(post.id, {
        take: text || null,
        shared_text: shared || null,
      });
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
      const created = await api.createComment(
        post.id,
        text,
        replyTo?.id ?? null,
      );
      onPostChange({
        ...post,
        replies: [...post.replies, created],
        reply_count: post.reply_count + 1,
        participant_count: post.participant_count + 1,
      });
      setDraft("");
      setReplyTo(null);
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
    <div className="flex items-start gap-2">
      <Avatar name={post.author_name} imageUrl={post.author_image_url} />
      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <div className="mb-2 flex items-start gap-2">
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
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                aria-label="Share this conversation"
                title="Share"
                onClick={() => {
                  if (!requireAuth("share this conversation")) return;
                  onInvite();
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-semibold text-zinc-800 hover:border-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:border-zinc-500 dark:hover:bg-zinc-900"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5"
                  aria-hidden="true"
                >
                  <path d="M12 3v11" />
                  <path d="M8.5 6.5 12 3l3.5 3.5" />
                  <path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
                </svg>
                Share
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
                            setEditSharedDraft(post.shared_text ?? "");
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
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                  Your take
                </span>
                <MentionInput
                  value={editDraft}
                  onChange={setEditDraft}
                  rows={2}
                  autoFocus
                  placeholder="Your take…"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                  Article text
                </span>
                <textarea
                  value={editSharedDraft}
                  onChange={(e) => setEditSharedDraft(e.target.value)}
                  rows={5}
                  placeholder="Paste the article text here…"
                  className="w-full resize-y border border-zinc-300 bg-white p-2 text-sm leading-relaxed outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950"
                />
              </label>
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
                    setEditSharedDraft(post.shared_text ?? "");
                  }}
                  className="border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : post.take ? (
            <MentionText
              text={post.take}
              className="-mt-0.5 block whitespace-pre-line text-sm leading-snug text-zinc-700 dark:text-zinc-300"
            />
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

        {isGuest ? (
          post.reply_count > 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {post.reply_count}{" "}
              {post.reply_count === 1 ? "comment" : "comments"}.{" "}
              <Link
                href="/signin"
                className="font-semibold text-brand-600 hover:underline dark:text-brand-400"
              >
                Sign in to join the conversation.
              </Link>
            </p>
          ) : null
        ) : (
          tops.map((r) => {
            const kids: Comment[] = childrenByParent.get(r.id) ?? [];
            return (
              <Fragment key={r.id}>
                {firstUnreadTopId === r.id ? (
                  <div className="my-2 flex items-center gap-3">
                    <div className="h-px flex-1 bg-brand-200 dark:bg-brand-900" />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand-600 dark:text-brand-400">
                      New replies
                    </span>
                    <div className="h-px flex-1 bg-brand-200 dark:bg-brand-900" />
                  </div>
                ) : null}
                <div className="space-y-2">
                  <CommentRow
                    comment={r}
                    userId={user?.id ?? null}
                    reacting={reacting}
                    onReply={() => startReplyTo(r)}
                    onLike={() => void toggleCommentLike(r)}
                    onDelete={() => {
                      void api.deleteComment(r.id).then(() => {
                        const childIds = new Set(
                          (childrenByParent.get(r.id) ?? []).map((c) => c.id),
                        );
                        onPostChange({
                          ...post,
                          replies: post.replies.filter(
                            (x) => x.id !== r.id && !childIds.has(x.id),
                          ),
                          reply_count: Math.max(
                            0,
                            post.reply_count - 1 - childIds.size,
                          ),
                        });
                      });
                    }}
                  />
                  {kids.length > 0 ? (
                    <div className="ml-6 space-y-2 border-l border-zinc-200 pl-3 dark:border-zinc-700">
                      {kids.map((child) => (
                        <CommentRow
                          key={child.id}
                          comment={child}
                          userId={user?.id ?? null}
                          reacting={reacting}
                          onReply={() => startReplyTo(child)}
                          onLike={() => void toggleCommentLike(child)}
                          onDelete={() => {
                            void api.deleteComment(child.id).then(() => {
                              onPostChange({
                                ...post,
                                replies: post.replies.filter(
                                  (x) => x.id !== child.id,
                                ),
                                reply_count: Math.max(0, post.reply_count - 1),
                              });
                            });
                          }}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              </Fragment>
            );
          })
        )}

      {isGuest ? null : (
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
              {replyTo ? (
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <span>
                    Replying to{" "}
                    <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                      {replyTo.author_name}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setReplyTo(null)}
                    className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
              <div className="flex items-end gap-2">
                <div
                  className="nwf-mentions--grow min-w-0 flex-1"
                  onFocus={() => setComposerActive(true)}
                >
                  <MentionInput
                    inputRef={composerRef}
                    value={draft}
                    onChange={setDraft}
                    rows={1}
                    placeholder={
                      replyTo
                        ? `Reply to ${replyTo.author_name}…`
                        : "Reply…"
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void reply();
                      }
                    }}
                  />
                </div>
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
      )}
      </div>
    </div>
  );
}

function CommentRow({
  comment,
  userId,
  reacting,
  onReply,
  onLike,
  onDelete,
}: {
  comment: Comment;
  userId: UUID | null;
  reacting: boolean;
  onReply: () => void;
  onLike: () => void;
  onDelete: () => void;
}) {
  const liked: boolean = comment.my_reaction === "like";
  const likeCount: number =
    comment.reactions.find((r) => r.reaction === "like")?.count ?? 0;

  return (
    <div className="flex items-start gap-2">
      <Avatar name={comment.author_name} imageUrl={comment.author_image_url} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-zinc-800 dark:text-zinc-200">
            {comment.author_name}
          </span>
          {comment.author_rating != null ? (
            <StarsDisplay value={comment.author_rating} size="xs" />
          ) : null}
          <span className="text-zinc-400">
            {relativeTime(comment.created_at)}
          </span>
        </div>
        <MentionText
          text={comment.text}
          className="-mt-0.5 block whitespace-pre-line text-sm leading-snug text-zinc-700 dark:text-zinc-300"
        />
        <div className="mt-0.5 flex items-center gap-3 text-xs">
          <button
            type="button"
            disabled={reacting}
            onClick={onLike}
            aria-pressed={liked}
            className={`disabled:opacity-40 ${
              liked
                ? "font-semibold text-zinc-800 dark:text-zinc-100"
                : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            }`}
          >
            Like{likeCount > 0 ? ` · ${likeCount}` : ""}
          </button>
          <button
            type="button"
            onClick={onReply}
            className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            Reply
          </button>
          {userId !== null && comment.user_id === userId ? (
            <button
              type="button"
              onClick={onDelete}
              className="text-zinc-400 hover:text-red-600"
            >
              Delete
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
