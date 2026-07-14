"use client";

import { useAuth } from "@/components/auth-provider";
import { useAuthGate } from "@/components/auth-gate";
import { EngagementSummary } from "@/components/engagement-summary";
import { SourceLogo } from "@/components/source-logo";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { stripHtml } from "@/lib/html";
import { relativeTime } from "@/lib/time";
import type { Comment, Story, UUID } from "@/lib/types";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

interface StoryModalProps {
  storyId: UUID;
  onClose: () => void;
  onStatusChange?: (storyId: UUID, patch: { read?: boolean }) => void;
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
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9999px] bg-slate-200 text-xs font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-200">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

const BLUR_PLACEHOLDERS: string[] = [
  "Really interesting take on how this affects the region.",
  "Worth reading the full piece — the data section is eye-opening.",
  "Curious what everyone thinks about the policy angle here.",
  "This lines up with what I heard on the ground last month.",
  "Good context compared to last week's coverage.",
];

function BlurredCommentRow({ index }: { index: number }) {
  const placeholder: string =
    BLUR_PLACEHOLDERS[index % BLUR_PLACEHOLDERS.length] ?? BLUR_PLACEHOLDERS[0];
  return (
    <div className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9999px] bg-slate-200 text-xs font-bold text-slate-500 dark:bg-slate-700">
        ?
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="select-none text-sm font-semibold text-slate-400 blur-sm">
            Reader
          </span>
          <span className="text-xs text-slate-300">·</span>
        </div>
        <p className="mt-0.5 select-none text-sm text-slate-600 blur-md dark:text-slate-400">
          {placeholder}
        </p>
      </div>
    </div>
  );
}

export function StoryModal({ storyId, onClose, onStatusChange }: StoryModalProps) {
  const { notify } = useToast();
  const { session, user } = useAuth();
  const { requireAuth } = useAuthGate();
  const isGuest: boolean = !session;
  const [story, setStory] = useState<Story | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState<string>("");
  const [posting, setPosting] = useState<boolean>(false);
  const commentRef = useRef<HTMLTextAreaElement | null>(null);

  const [bodyExpanded, setBodyExpanded] = useState<boolean>(false);
  const [bodyOverflows, setBodyOverflows] = useState<boolean>(false);
  const bodyRef = useRef<HTMLParagraphElement | null>(null);

  async function share(): Promise<void> {
    if (!story) return;
    const url: string = story.article_url;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: story.full_headline, url });
        return;
      } catch {
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      notify("Link copied to clipboard", "success");
    } catch {
      notify("Could not copy link", "error");
    }
  }

  function focusComment(): void {
    if (!requireAuth("comment on stories")) return;
    const el = commentRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.focus();
  }

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
    if (isGuest) return;
    void api.markRead(storyId, true).catch(() => undefined);
    onStatusChange?.(storyId, { read: true });
  }, [isGuest, storyId, onStatusChange]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setBodyExpanded(false);
    void (async () => {
      try {
        const detail: Story = await api.getStory(storyId);
        if (cancelled) return;
        setStory(detail);

        if (isGuest) {
          setComments([]);
        } else {
          const threadRaw: Comment[] = await api
            .listComments({ storyId })
            .catch((): Comment[] => []);
          if (!cancelled) setComments(threadRaw);
          if (!detail.read) {
            markReadNow();
          }
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
  }, [storyId, notify, markReadNow, isGuest]);

  async function submitComment(): Promise<void> {
    if (!requireAuth("comment on stories")) return;
    const text: string = draft.trim();
    if (!text || posting || !story) return;
    setPosting(true);
    try {
      // Starting a conversation = posting on this story with the take as body.
      const createdPost = await api.createPost({
        story_id: storyId,
        take: text,
        visibility: "private",
        kind: story.kind,
      });
      // Surface the take as a pseudo-comment in the modal list.
      setComments((prev) => [
        ...prev,
        {
          id: createdPost.id,
          story_id: storyId,
          post_id: createdPost.id,
          user_id: createdPost.author_id,
          author_name: createdPost.author_name,
          author_image_url: createdPost.author_image_url,
          text,
          created_at: createdPost.created_at,
          updated_at: createdPost.updated_at,
        },
      ]);
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

  // Detect whether the clamped body actually spills past 5 lines so the
  // more/less toggle only appears when there is hidden text to reveal.
  useEffect(() => {
    const el: HTMLParagraphElement | null = bodyRef.current;
    if (!el || bodyExpanded) return;
    setBodyOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [body, loading, bodyExpanded]);

  const blurredCount: number = story
    ? Math.min(Math.max(story.engagement.commented, 1), 5)
    : 0;

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
                className="h-72 w-full object-cover"
              />
            ) : null}

            <div className="p-6">
              <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                <SourceLogo
                  src={story.source_image_url}
                  name={story.source_name}
                  imgClassName="h-6 w-auto max-w-[180px] shrink-0 object-contain"
                  fallbackClassName="font-semibold text-slate-700 dark:text-slate-200"
                />
                <span aria-hidden>·</span>
                <span>{relativeTime(story.created_at)}</span>
              </div>

              <h2 className="mt-3 font-serif text-2xl font-semibold leading-tight tracking-tight text-slate-900 dark:text-slate-100">
                {story.full_headline}
              </h2>

              {story.author_names.length > 0 ? (
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                  By {story.author_names.join(", ")}
                </p>
              ) : null}

              <a
                href={story.article_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-1.5 bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
              >
                {story.source_name ? `Read on ${story.source_name}` : "Read at source"}{" "}
                ↗
              </a>

              {body ? (
                <div className="mt-4">
                  <p
                    ref={bodyRef}
                    className={`whitespace-pre-line text-[15px] leading-relaxed text-slate-700 dark:text-slate-300 ${
                      bodyExpanded ? "" : "line-clamp-5"
                    }`}
                  >
                    {body}
                  </p>
                  {bodyOverflows ? (
                    <button
                      onClick={() => setBodyExpanded((v) => !v)}
                      className="mt-1 text-sm font-semibold text-brand-600 transition hover:underline dark:text-brand-400"
                    >
                      {bodyExpanded ? "Show less" : "Show more"}
                    </button>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-5 pb-2">
                <EngagementSummary
                  engagement={story.engagement}
                  scope={isGuest ? "global" : "friends"}
                />
              </div>

              <div className="grid grid-cols-2 border-y border-slate-200 dark:border-slate-800">
                <button
                  onClick={() => void share()}
                  className="flex items-center justify-center gap-1.5 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <span className="text-base">↗</span>
                  Share
                </button>
                <button
                  onClick={focusComment}
                  className="flex items-center justify-center gap-1.5 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <span className="text-base">💬</span>
                  Comment
                </button>
              </div>

              <div className="mt-5">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                  {isGuest ? "Comments" : "Friends' comments"}
                </h3>

                {isGuest ? (
                  <div className="relative mt-4">
                    <div className="space-y-4" aria-hidden>
                      {Array.from({ length: blurredCount }, (_, i) => (
                        <BlurredCommentRow key={i} index={i} />
                      ))}
                    </div>
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-white/60 to-white dark:via-slate-900/60 dark:to-slate-900" />
                    <div className="relative mt-4 border border-slate-200 bg-slate-50 p-4 text-center dark:border-slate-800 dark:bg-slate-950">
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {story.engagement.commented > 0
                          ? `${story.engagement.commented} ${
                              story.engagement.commented === 1
                                ? "comment"
                                : "comments"
                            } on this story`
                          : "Join the conversation"}
                      </p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Create a free account and verify your email to read and
                        post comments.
                      </p>
                      <Link
                        href="/signin"
                        className="mt-3 inline-block bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
                      >
                        Create free account
                      </Link>
                    </div>
                  </div>
                ) : (
                  <>
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
                        ref={commentRef}
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
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
