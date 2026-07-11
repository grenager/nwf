"use client";

import { useAuth } from "@/components/auth-provider";
import { EngagementSummary } from "@/components/engagement-summary";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { stripHtml } from "@/lib/html";
import { relativeTime } from "@/lib/time";
import type { Comment, Story, UUID } from "@/lib/types";
import { useCallback, useEffect, useState } from "react";

interface StoryModalProps {
  storyId: UUID;
  onClose: () => void;
  onStatusChange?: (
    storyId: UUID,
    patch: { read?: boolean; starred?: boolean },
  ) => void;
}

function Avatar({ name, imageUrl }: { name: string; imageUrl: string | null }) {
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={imageUrl}
        alt=""
        className="h-7 w-7 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-200">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export function StoryModal({ storyId, onClose, onStatusChange }: StoryModalProps) {
  const { notify } = useToast();
  const { user } = useAuth();
  const [story, setStory] = useState<Story | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [starred, setStarred] = useState<boolean>(false);
  const [starBusy, setStarBusy] = useState<boolean>(false);

  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState<string>("");
  const [posting, setPosting] = useState<boolean>(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const markReadNow = useCallback((): void => {
    void api.markRead(storyId, true).catch(() => undefined);
    onStatusChange?.(storyId, { read: true });
  }, [storyId, onStatusChange]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const [detail, threadRaw] = await Promise.all([
          api.getStory(storyId),
          api.listComments(storyId).catch((): Comment[] => []),
        ]);
        if (cancelled) return;
        setStory(detail);
        setStarred(detail.starred);
        setComments(threadRaw);
        if (!detail.read) {
          markReadNow();
        }
      } catch (err) {
        if (!cancelled) {
          notify(
            err instanceof ApiError ? err.message : "Failed to load story",
            "error",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storyId, notify, markReadNow]);

  const toggleHeart = useCallback(async (): Promise<void> => {
    if (starBusy) return;
    setStarBusy(true);
    const next: boolean = !starred;
    setStarred(next);
    try {
      if (next) await api.addStar(storyId);
      else await api.removeStar(storyId);
      onStatusChange?.(storyId, { starred: next });
    } catch (err) {
      setStarred(!next);
      notify(
        err instanceof ApiError ? err.message : "Failed to update",
        "error",
      );
    } finally {
      setStarBusy(false);
    }
  }, [starBusy, starred, storyId, onStatusChange, notify]);

  async function submitComment(): Promise<void> {
    const text: string = draft.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      const created: Comment = await api.createComment(storyId, text);
      setComments((prev) => [...prev, created]);
      setDraft("");
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Failed to post comment",
        "error",
      );
    } finally {
      setPosting(false);
    }
  }

  async function removeComment(id: UUID): Promise<void> {
    const prev: Comment[] = comments;
    setComments((cs) => cs.filter((c) => c.id !== id));
    try {
      await api.deleteComment(id);
    } catch (err) {
      setComments(prev);
      notify(
        err instanceof ApiError ? err.message : "Failed to delete comment",
        "error",
      );
    }
  }

  const body: string = story
    ? stripHtml(story.full_text ?? story.summary ?? "")
    : "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="relative my-auto w-full max-w-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center bg-white/80 text-xl text-slate-500 hover:text-slate-900 dark:bg-slate-900/80 dark:hover:text-slate-100"
        >
          ✕
        </button>

        {loading || !story ? (
          <div className="p-10 text-center text-slate-400">Loading…</div>
        ) : (
          <div className="max-h-[85vh] overflow-y-auto">
            {story.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={story.image_url}
                alt=""
                className="h-56 w-full object-cover"
              />
            ) : null}

            <div className="p-6">
              <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                {story.source_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={story.source_image_url}
                    alt=""
                    className="h-5 w-5 shrink-0 rounded-full object-cover"
                  />
                ) : null}
                {story.source_name ? (
                  <span className="font-semibold text-slate-700 dark:text-slate-200">
                    {story.source_name}
                  </span>
                ) : null}
                <span aria-hidden>·</span>
                <span>{relativeTime(story.created_at)}</span>
              </div>

              <h2 className="mt-3 text-2xl font-bold leading-tight text-slate-900 dark:text-slate-100">
                {story.full_headline}
              </h2>

              {story.author_names.length > 0 ? (
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  By {story.author_names.join(", ")}
                </p>
              ) : null}

              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={() => void toggleHeart()}
                  disabled={starBusy}
                  aria-label={starred ? "Remove heart" : "Heart"}
                  className={`flex items-center gap-1.5 border px-3 py-1.5 text-sm font-semibold transition ${
                    starred
                      ? "border-red-500 bg-red-500 text-white"
                      : "border-slate-300 text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:text-slate-300"
                  }`}
                >
                  <span>{starred ? "♥" : "♡"}</span>
                  {starred ? "Hearted" : "Heart"}
                </button>
                <a
                  href={story.article_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:border-slate-400 dark:border-slate-700 dark:text-slate-300"
                >
                  Read at source ↗
                </a>
              </div>

              {body ? (
                <p className="mt-5 whitespace-pre-line text-[15px] leading-relaxed text-slate-700 dark:text-slate-300">
                  {body}
                </p>
              ) : null}

              <div className="mt-6 border-t border-slate-200 pt-3 dark:border-slate-800">
                <EngagementSummary engagement={story.engagement} />
              </div>

              <div className="mt-6 border-t border-slate-200 pt-5 dark:border-slate-800">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                  Friends&apos; comments
                </h3>

                <div className="mt-4 space-y-4">
                  {comments.length === 0 ? (
                    <p className="text-sm text-slate-400">
                      No comments yet from you or your friends.
                    </p>
                  ) : (
                    comments.map((c) => (
                      <div key={c.id} className="flex gap-3">
                        <Avatar
                          name={c.author_name}
                          imageUrl={c.author_image_url}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                              {c.author_name}
                            </span>
                            <span className="text-xs text-slate-400">
                              {relativeTime(c.created_at)}
                            </span>
                            {user && c.user_id === user.id ? (
                              <button
                                onClick={() => void removeComment(c.id)}
                                className="text-xs text-slate-400 hover:text-red-600"
                              >
                                Delete
                              </button>
                            ) : null}
                          </div>
                          <p className="mt-0.5 whitespace-pre-line text-sm text-slate-700 dark:text-slate-300">
                            {c.text}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="mt-5">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Add a comment for your friends…"
                    rows={3}
                    className="w-full resize-none border border-slate-300 bg-white p-3 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                  <div className="mt-2 flex justify-end">
                    <button
                      onClick={() => void submitComment()}
                      disabled={posting || draft.trim().length === 0}
                      className="bg-slate-900 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-40 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
                    >
                      {posting ? "Posting…" : "Post"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
