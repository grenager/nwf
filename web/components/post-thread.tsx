"use client";

import { applyReactionToggle } from "@/components/reaction-bar";
import { Avatar } from "@/components/avatar";
import { UserLink } from "@/components/user-link";
import { CommentAudienceModal } from "@/components/comment-audience-modal";
import { LikeButton } from "@/components/like-button";
import { MentionInput } from "@/components/mention-input";
import { MentionText } from "@/components/mention-text";
import { PostEngagementRow } from "@/components/post-engagement-row";
import { ShareAfterPostModal } from "@/components/share-after-post-modal";
import { useAuth } from "@/components/auth-provider";
import { useAuthGate } from "@/components/auth-gate";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { draftScopeKey } from "@/lib/drafts";
import { commentWasEdited } from "@/lib/comments";
import { relativeTime } from "@/lib/time";
import { usePersistedDraft } from "@/lib/use-persisted-draft";
import { useTypingIndicator } from "@/lib/use-typing-indicator";
import type { LiveStoryReader } from "@/lib/use-story-readers";
import type {
  Comment,
  Post,
  PostTyper,
  Profile,
  ReactionKind,
  UUID,
} from "@/lib/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/** Anchor id for a comment, so `?comment=<id>` can scroll to it. */
export function commentDomId(commentId: UUID): string {
  return `comment-${commentId}`;
}

function dispatchThreadSeen(postId: UUID): void {
  window.dispatchEvent(
    new CustomEvent("nwf:thread-seen", { detail: { postId } }),
  );
}

function profileName(me: Profile | null): string {
  if (!me) return "You";
  const full = [me.first, me.last].filter(Boolean).join(" ").trim();
  return full || "You";
}

function typingLabel(typers: PostTyper[]): string | null {
  if (typers.length === 0) return null;
  const names: string[] = typers.map((t) => t.display_name.split(/\s+/)[0] ?? t.display_name);
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others are typing…`;
}

/**
 * Names the thread above the comment list so the audience model reads as
 * private-by-default rather than a public comment section.
 */
function conversationTitle(post: Post, isAuthor: boolean): string {
  if (isAuthor) return "Your private conversation about this article";
  const firstName: string = post.author_name.trim().split(/\s+/)[0] ?? "";
  const owner: string = firstName === "" ? "This" : `${firstName}'s`;
  return `${owner} private conversation about this article`;
}

export function PostThread({
  post,
  me,
  preview,
  readers,
  onPostChange,
  onDelete,
  onInvite,
  markSeenOnMount = false,
  focusUnread = false,
  focusCommentId = null,
  startEditing = false,
  maxTopLevelComments,
  compact = false,
}: {
  post: Post;
  me: Profile | null;
  preview?: ReactNode;
  /** Live reader list for this post's story, from the parent's own
   * useStoryReaders() call — not fetched again here. */
  readers: LiveStoryReader[];
  onPostChange: (post: Post) => void;
  onDelete: () => void;
  onInvite: () => void;
  /** Stamp the read cursor only when the thread is actually opened (detail page). */
  markSeenOnMount?: boolean;
  /** Scroll the "New replies" divider into view once (from ?focus=unread). */
  focusUnread?: boolean;
  /** Scroll to and highlight one comment (from ?comment=<id>). */
  focusCommentId?: UUID | null;
  /** Open the author's post editor straight away (from ?edit=1), so the feed's
   * Edit action lands on a focused text field rather than a read-only page. */
  startEditing?: boolean;
  /** Cap top-level comments shown (feed preview). Nested replies stay attached. */
  maxTopLevelComments?: number;
  /** Hide the reaction row and attach affordances (feed preview). */
  compact?: boolean;
}) {
  const router = useRouter();
  const { user, session } = useAuth();
  const { requireAuth } = useAuthGate();
  const { notify } = useToast();
  const isGuest: boolean = session === null;
  const draftKey: string = draftScopeKey(
    { kind: "post", postId: post.id },
    user?.id ?? null,
  );
  const {
    text: draft,
    parentCommentId: draftParentId,
    setText: setDraft,
    setParentCommentId: setDraftParentId,
    clear: clearDraft,
  } = usePersistedDraft(isGuest ? null : draftKey);
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
  const [reacting, setReacting] = useState<boolean>(false);
  const [postReacting, setPostReacting] = useState<boolean>(false);
  const [seenBoundary, setSeenBoundary] = useState<string | null>(
    post.last_seen_at ?? null,
  );
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const editTakeRef = useRef<HTMLTextAreaElement | null>(null);
  const startedEditRef = useRef<boolean>(false);
  const markedSeenRef = useRef<boolean>(false);
  const unreadDividerRef = useRef<HTMLDivElement | null>(null);
  const scrolledUnreadRef = useRef<boolean>(false);
  const scrolledCommentRef = useRef<UUID | null>(null);
  const [audienceOpen, setAudienceOpen] = useState<boolean>(false);
  const [shareAfterReply, setShareAfterReply] = useState<boolean>(false);
  const { typers, notifyTyping } = useTypingIndicator(post.id);

  const isAuthor: boolean = user != null && user.id === post.author_id;
  const isPreviewMode: boolean =
    compact || (maxTopLevelComments !== undefined && maxTopLevelComments > 0);

  async function togglePostReaction(reaction: ReactionKind): Promise<void> {
    if (!requireAuth("react to this")) return;
    if (postReacting) return;
    const optimistic = applyReactionToggle(
      post.reactions ?? [],
      post.my_reaction ?? null,
      reaction,
    );
    const previous: Post = post;
    onPostChange({
      ...post,
      reactions: optimistic.reactions,
      my_reaction: optimistic.my_reaction,
    });
    setPostReacting(true);
    try {
      const updated: Post =
        optimistic.my_reaction === null
          ? await api.clearPostReaction(post.id)
          : await api.reactToPost(post.id, reaction);
      onPostChange(updated);
    } catch (err) {
      onPostChange(previous);
      notify(err instanceof ApiError ? err.message : "Failed to react", "error");
    } finally {
      setPostReacting(false);
    }
  }

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

  // Derived from the persisted draft so a restored draft also restores its reply
  // target, and a target deleted in the meantime falls back to a top-level reply.
  const replyTo: Comment | null = useMemo(() => {
    if (draftParentId === null) return null;
    return post.replies.find((r) => r.id === draftParentId) ?? null;
  }, [draftParentId, post.replies]);

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

  const visibleTops: Comment[] = useMemo(() => {
    if (maxTopLevelComments === undefined || maxTopLevelComments <= 0) {
      return tops;
    }
    if (tops.length <= maxTopLevelComments) return tops;
    return tops.slice(-maxTopLevelComments);
  }, [tops, maxTopLevelComments]);

  const displayedReplyCount: number = useMemo(() => {
    let count: number = 0;
    for (const top of visibleTops) {
      count += 1 + (childrenByParent.get(top.id)?.length ?? 0);
    }
    return count;
  }, [visibleTops, childrenByParent]);

  const showViewAllComments: boolean =
    maxTopLevelComments !== undefined &&
    maxTopLevelComments > 0 &&
    post.reply_count > displayedReplyCount;

  useEffect(() => {
    if (!focusUnread || firstUnreadTopId === null || scrolledUnreadRef.current) {
      return;
    }
    scrolledUnreadRef.current = true;
    requestAnimationFrame(() => {
      unreadDividerRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }, [focusUnread, firstUnreadTopId]);

  // Land on the comment that produced the link (profile activity, notifications).
  useEffect(() => {
    if (focusCommentId === null || scrolledCommentRef.current === focusCommentId) {
      return;
    }
    const target: HTMLElement | null = document.getElementById(
      commentDomId(focusCommentId),
    );
    if (target === null) return;
    scrolledCommentRef.current = focusCommentId;
    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [focusCommentId, post.replies]);

  function startReplyTo(comment: Comment): void {
    setDraftParentId(comment.id);
    setComposerActive(true);
    composerRef.current?.focus();
  }

  function focusComposer(): void {
    if (!requireAuth("comment")) return;
    setComposerActive(true);
    requestAnimationFrame(() => {
      composerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      composerRef.current?.focus();
    });
  }

  async function toggleCommentReaction(
    comment: Comment,
    reaction: ReactionKind,
  ): Promise<void> {
    if (!requireAuth("react to a comment")) return;
    if (reacting) return;
    const optimistic = applyReactionToggle(
      comment.reactions ?? [],
      comment.my_reaction ?? null,
      reaction,
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
          : await api.reactToComment(comment.id, reaction);
      onPostChange({
        ...post,
        replies: post.replies.map((r) => (r.id === comment.id ? updated : r)),
      });
    } catch (err) {
      onPostChange(post);
      notify(err instanceof ApiError ? err.message : "Failed to react", "error");
    } finally {
      setReacting(false);
    }
  }

  function beginEdit(): void {
    setEditDraft(post.take ?? "");
    setEditSharedDraft(post.shared_text ?? "");
    setEditing(true);
  }

  // Editing is meant to be typed into immediately: drop the caret at the end of
  // the existing take and bring the field into view.
  useEffect(() => {
    if (!editing) return;
    requestAnimationFrame(() => {
      const field: HTMLTextAreaElement | null = editTakeRef.current;
      if (field === null) return;
      field.focus();
      const end: number = field.value.length;
      field.setSelectionRange(end, end);
      field.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [editing]);

  // Arriving from the feed's Edit action (?edit=1) opens the editor once the
  // viewer is known to be the author — `user` can hydrate after mount.
  useEffect(() => {
    if (!startEditing || startedEditRef.current) return;
    if (!isAuthor || isPreviewMode) return;
    startedEditRef.current = true;
    beginEdit();
    // The ref guards a single open per mount; beginEdit only reads the post.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startEditing, isAuthor, isPreviewMode]);

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

  function replaceComment(updated: Comment): void {
    onPostChange({
      ...post,
      replies: post.replies.map((r) => (r.id === updated.id ? updated : r)),
    });
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
      const nowIso: string = new Date().toISOString();
      onPostChange({
        ...post,
        replies: [...post.replies, created],
        reply_count: post.reply_count + 1,
        participant_count: post.participant_count + 1,
        last_seen_at: nowIso,
        unread_reply_count: 0,
        unread_replies_for_viewer: false,
      });
      clearDraft();
      setShareAfterReply(true);
      void api.markThreadSeen(post.id).then(() => {
        dispatchThreadSeen(post.id);
      }).catch(() => undefined);
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
      <UserLink userId={post.author_id} title={post.author_name}>
        <Avatar name={post.author_name} imageUrl={post.author_image_url} />
      </UserLink>
      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <div className="mb-2 flex items-start gap-2">
            <div className="flex flex-1 flex-wrap items-center gap-2 text-sm">
              <UserLink
                userId={post.author_id}
                className="font-semibold text-zinc-900 hover:underline dark:text-zinc-100"
              >
                {post.author_name}
              </UserLink>
              {/* The timestamp is the thread's permalink, the way it is
                  everywhere else that shows one. */}
              <Link
                href={`/post/${post.id}`}
                scroll={false}
                className="text-xs text-zinc-400 hover:underline"
              >
                {relativeTime(post.created_at)}
              </Link>
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
                            setMenuOpen(false);
                            // The feed preview shows a trimmed thread, so edit
                            // happens on the full post — ?edit=1 opens it
                            // focused there instead of on a read-only view.
                            if (isPreviewMode) {
                              router.push(`/post/${post.id}?edit=1`);
                              return;
                            }
                            beginEdit();
                          }}
                          className="block w-full px-3 py-1.5 text-left text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        >
                          Edit
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
                  inputRef={editTakeRef}
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
                    className="text-xs font-medium text-zinc-900 hover:underline dark:text-zinc-100"
                  >
                    ↗ attached: {a.article_url}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {preview ? <div className="space-y-3">{preview}</div> : null}

        <div className="flex items-center border-y border-zinc-100 dark:border-zinc-800">
          <LikeButton
            myReaction={post.my_reaction}
            onToggle={(reaction) => void togglePostReaction(reaction)}
            disabled={postReacting}
          />
          <button
            type="button"
            onClick={focusComposer}
            className="flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-[1.1em] w-[1.1em]"
              aria-hidden="true"
            >
              <rect x="3.5" y="4.5" width="17" height="12" rx="3" />
              <path d="M7 16.5v3.5l4-3.5" />
            </svg>
            <span>Comment</span>
          </button>
        </div>

        <PostEngagementRow post={post} readers={readers} compact={compact} />

        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
          {conversationTitle(post, isAuthor)}
        </p>

        {isGuest ? (
          post.reply_count > 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {post.reply_count}{" "}
              {post.reply_count === 1 ? "comment" : "comments"}.{" "}
              <Link
                href="/signin"
                className="font-semibold text-zinc-900 hover:underline dark:text-zinc-100"
              >
                Sign in to join the conversation.
              </Link>
            </p>
          ) : null
        ) : (
          <>
          {showViewAllComments ? (
            <Link
              href={`/post/${post.id}`}
              scroll={false}
              className="inline-block text-xs font-semibold text-zinc-900 hover:underline dark:text-zinc-100"
            >
              View all {post.reply_count}{" "}
              {post.reply_count === 1 ? "comment" : "comments"}
            </Link>
          ) : null}
          {visibleTops.map((r) => {
            const kids: Comment[] = childrenByParent.get(r.id) ?? [];
            return (
              <Fragment key={r.id}>
                {firstUnreadTopId === r.id ? (
                  <div
                    ref={unreadDividerRef}
                    className="my-2 flex items-center gap-3"
                  >
                    <div className="h-px flex-1 bg-zinc-300 dark:bg-zinc-700" />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-900 dark:text-zinc-100">
                      New replies
                    </span>
                    <div className="h-px flex-1 bg-zinc-300 dark:bg-zinc-700" />
                  </div>
                ) : null}
                <div className="space-y-2">
                  <CommentRow
                    comment={r}
                    userId={user?.id ?? null}
                    anchored={!isPreviewMode}
                    highlighted={focusCommentId === r.id}
                    reacting={reacting}
                    onReply={() => startReplyTo(r)}
                    onReact={(reaction) => void toggleCommentReaction(r, reaction)}
                    onEdit={replaceComment}
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
                          anchored={!isPreviewMode}
                          highlighted={focusCommentId === child.id}
                          reacting={reacting}
                          onReply={() => startReplyTo(child)}
                          onReact={(reaction) => void toggleCommentReaction(child, reaction)}
                          onEdit={replaceComment}
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
          })}
          </>
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
                    onClick={() => setDraftParentId(null)}
                    className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
              {typingLabel(typers) ? (
                <p className="text-xs italic text-zinc-400 dark:text-zinc-500">
                  {typingLabel(typers)}
                </p>
              ) : null}
              <div className="flex items-end gap-2">
                <div
                  className="nwf-mentions--grow min-w-0 flex-1"
                  onFocus={() => setComposerActive(true)}
                >
                  <MentionInput
                    inputRef={composerRef}
                    value={draft}
                    onChange={(text) => {
                      setDraft(text);
                      notifyTyping();
                    }}
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
                    {!compact ? (
                      <button
                        type="button"
                        onClick={() => setShowAttach((v) => !v)}
                        className="shrink-0 rounded-full border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
                        title="Attach a related link"
                      >
                        Attach
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setAudienceOpen(true)}
                className="text-left text-xs text-zinc-400 underline decoration-dotted underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                Who will see this?
              </button>
              {!compact && showAttach && showComposerActions ? (
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
      {audienceOpen ? (
        <CommentAudienceModal
          postId={post.id}
          onClose={() => setAudienceOpen(false)}
        />
      ) : null}
      {shareAfterReply ? (
        <ShareAfterPostModal
          postId={post.id}
          kind="comment"
          onClose={() => setShareAfterReply(false)}
        />
      ) : null}
      </div>
    </div>
  );
}

function CommentRow({
  comment,
  userId,
  reacting,
  anchored = false,
  highlighted = false,
  onReply,
  onReact,
  onEdit,
  onDelete,
}: {
  comment: Comment;
  userId: UUID | null;
  reacting: boolean;
  /** Carry the `#comment-<id>` anchor (full thread only, to keep ids unique). */
  anchored?: boolean;
  /** Tint the row when it is the comment the link pointed at. */
  highlighted?: boolean;
  onReply: () => void;
  onReact: (reaction: ReactionKind) => void;
  onEdit: (updated: Comment) => void;
  onDelete: () => void;
}) {
  const { notify } = useToast();
  const [editing, setEditing] = useState<boolean>(false);
  const [editDraft, setEditDraft] = useState<string>(comment.text);
  const [savingEdit, setSavingEdit] = useState<boolean>(false);

  const isAuthor: boolean = userId !== null && comment.user_id === userId;
  const edited: boolean = commentWasEdited(comment);

  function startEdit(): void {
    setEditDraft(comment.text);
    setEditing(true);
  }

  function cancelEdit(): void {
    setEditDraft(comment.text);
    setEditing(false);
  }

  async function saveEdit(): Promise<void> {
    const text: string = editDraft.trim();
    if (!text || savingEdit) return;
    if (text === comment.text) {
      setEditing(false);
      return;
    }
    setSavingEdit(true);
    try {
      const updated = await api.updateComment(comment.id, text);
      onEdit(updated);
      setEditing(false);
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Failed to update comment",
        "error",
      );
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <div
      id={anchored ? commentDomId(comment.id) : undefined}
      className={`flex items-start gap-2 scroll-mt-24 ${
        highlighted ? "-mx-2 bg-zinc-100 px-2 py-1 dark:bg-zinc-800" : ""
      }`}
    >
      <UserLink userId={comment.user_id} title={comment.author_name}>
        <Avatar name={comment.author_name} imageUrl={comment.author_image_url} />
      </UserLink>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <UserLink
            userId={comment.user_id}
            className="font-semibold text-zinc-800 hover:underline dark:text-zinc-200"
          >
            {comment.author_name}
          </UserLink>
          {comment.post_id ? (
            <Link
              href={`/post/${comment.post_id}?comment=${comment.id}`}
              scroll={false}
              className="text-zinc-400 hover:underline"
            >
              {relativeTime(comment.created_at)}
            </Link>
          ) : (
            <span className="text-zinc-400">
              {relativeTime(comment.created_at)}
            </span>
          )}
          {edited ? (
            <span className="text-zinc-400">· edited</span>
          ) : null}
        </div>
        {editing ? (
          <div className="mt-1 space-y-2">
            <MentionInput
              value={editDraft}
              onChange={setEditDraft}
              rows={2}
              autoFocus
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void saveEdit()}
                disabled={savingEdit || !editDraft.trim()}
                className="bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
              >
                {savingEdit ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                disabled={savingEdit}
                className="border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <MentionText
            text={comment.text}
            className="-mt-0.5 block whitespace-pre-line text-sm leading-snug text-zinc-700 dark:text-zinc-300"
          />
        )}
        {editing ? null : (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <LikeButton
              variant="link"
              myReaction={comment.my_reaction}
              onToggle={onReact}
              disabled={reacting}
              reactionCount={(comment.reactions ?? []).reduce((sum, r) => sum + r.count, 0)}
            />
            <button
              type="button"
              onClick={onReply}
              className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              Reply
            </button>
            {isAuthor ? (
              <>
                <button
                  type="button"
                  onClick={startEdit}
                  className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  className="text-zinc-400 hover:text-red-600"
                >
                  Delete
                </button>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
