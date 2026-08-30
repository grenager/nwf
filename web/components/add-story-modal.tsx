"use client";

import { useAuthGate } from "@/components/auth-gate";
import { MentionInput } from "@/components/mention-input";
import { SourceLogo } from "@/components/source-logo";
import { StarPicker } from "@/components/star-rating";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { stripHtml } from "@/lib/html";
import type { Post, PreviewCard, Story } from "@/lib/types";
import { useEffect, useRef, useState } from "react";
import { ModalShell } from "@/components/modal-shell";

interface AddStoryModalProps {
  onClose: () => void;
  onAdded?: (post: Post) => void;
  /** When set, skip URL entry and post from this existing story. */
  story?: Story | null;
}

const PREVIEW_DEBOUNCE_MS: number = 500;

function isHttpUrl(value: string): boolean {
  try {
    const parsed: URL = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function AddStoryModal({ onClose, onAdded, story }: AddStoryModalProps) {
  const { notify } = useToast();
  const { requireAuth } = useAuthGate();
  const fromStory: boolean = story !== null && story !== undefined;
  const [url, setUrl] = useState<string>(story?.article_url ?? "");
  const [take, setTake] = useState<string>("");
  const [sharedText, setSharedText] = useState<string>("");
  const [rating, setRating] = useState<number | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [preview, setPreview] = useState<PreviewCard | null>(null);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewRequestId = useRef<number>(0);

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

  useEffect(() => {
    if (fromStory) return;

    const trimmed: string = url.trim();
    if (!trimmed || !isHttpUrl(trimmed)) {
      previewRequestId.current += 1;
      setPreview(null);
      setPreviewLoading(false);
      setPreviewError(null);
      return;
    }

    const requestId: number = ++previewRequestId.current;
    setPreviewLoading(true);
    setPreviewError(null);
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      void (async (): Promise<void> => {
        try {
          const card: PreviewCard = await api.previewUrl({
            url: trimmed,
            kind: "news",
          });
          if (requestId !== previewRequestId.current) return;
          setPreview(card);
          setPreviewError(null);
        } catch (err) {
          if (requestId !== previewRequestId.current) return;
          setPreview(null);
          setPreviewError(
            err instanceof ApiError
              ? err.message
              : "Couldn't load a preview for this link",
          );
        } finally {
          if (requestId === previewRequestId.current) {
            setPreviewLoading(false);
          }
        }
      })();
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [url, fromStory]);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!requireAuth("post")) return;
    setSaving(true);
    try {
      let post: Post;
      if (fromStory && story) {
        post = await api.createPost({
          story_id: story.id,
          take: take.trim() || null,
          shared_text: sharedText.trim() || null,
        });
      } else {
        const trimmed: string = url.trim();
        if (!trimmed || preview === null || previewLoading) return;
        post = await api.createPost({
          url: trimmed,
          take: take.trim() || null,
          shared_text: sharedText.trim() || null,
          kind: "news",
          canonical_url: preview.canonical_url,
          full_headline: preview.full_headline,
          summary: preview.summary,
          image_url: preview.image_url,
          publisher: preview.publisher,
          platform: preview.platform,
        });
      }
      if (rating !== null) {
        await api
          .setRating(post.story_id, rating)
          .catch(() => undefined);
        post.my_rating = rating;
        post.author_rating = rating;
      }
      notify("Posted", "success");
      onAdded?.(post);
      onClose();
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Failed to post",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  const canPost: boolean = fromStory
    ? !saving
    : preview !== null && !previewLoading && !saving && !!url.trim();
  const showPreviewPanel: boolean =
    !fromStory &&
    (previewLoading || preview !== null || previewError !== null);

  return (
    <ModalShell
      onClose={onClose}
      mobile="fullscreen"
      label={fromStory ? "Start a private conversation" : "Share an article"}
      padded={false}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 p-5 pb-4 dark:border-slate-700">
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
          {fromStory ? "Start a private conversation" : "Share an article"}
        </h2>
        <button
          onClick={onClose}
          aria-label="Close"
          className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        >
          ✕
        </button>
      </div>

      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
        {fromStory && story ? (
          <div className="overflow-hidden border border-slate-200 dark:border-slate-700">
            {story.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={story.image_url}
                alt=""
                className="h-36 w-full object-cover"
              />
            ) : null}
            <div className="border-t border-slate-200 p-3 dark:border-slate-700">
              <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <SourceLogo
                  src={story.source_image_url}
                  name={story.source_name ?? hostFromUrl(story.article_url)}
                  imgClassName="h-4 w-auto max-w-[120px] shrink-0 object-contain"
                  fallbackClassName="truncate"
                />
              </div>
              <h3 className="mt-1 font-serif text-base font-semibold leading-snug tracking-tight text-slate-900 dark:text-slate-50">
                {story.full_headline}
              </h3>
              {story.summary ? (
                <p className="mt-1 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">
                  {stripHtml(story.summary)}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Article URL
            </span>
            <input
              type="url"
              required
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/article"
              className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </label>
        )}

        {showPreviewPanel ? (
          <div className="overflow-hidden border border-slate-200 dark:border-slate-700">
            {previewLoading && preview === null ? (
              <div className="animate-pulse space-y-0">
                <div className="h-36 bg-slate-200 dark:bg-slate-800" />
                <div className="space-y-2 border-t border-slate-200 p-3 dark:border-slate-700">
                  <div className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-800" />
                  <div className="h-4 w-4/5 rounded bg-slate-200 dark:bg-slate-800" />
                  <div className="h-3 w-full rounded bg-slate-200 dark:bg-slate-800" />
                  <p className="pt-1 text-xs text-slate-500 dark:text-slate-400">
                    Loading preview…
                  </p>
                </div>
              </div>
            ) : null}

            {preview !== null ? (
              <div
                className={
                  previewLoading ? "relative opacity-70" : "relative"
                }
              >
                {preview.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={preview.image_url}
                    alt=""
                    className="h-36 w-full object-cover"
                  />
                ) : null}
                <div className="border-t border-slate-200 p-3 dark:border-slate-700">
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                    {preview.source_image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={preview.source_image_url}
                        alt=""
                        className="h-4 w-4 shrink-0 object-cover"
                      />
                    ) : null}
                    <span className="truncate">
                      {preview.source_name ??
                        hostFromUrl(preview.canonical_url)}
                    </span>
                  </div>
                  <h3 className="mt-1 font-serif text-base font-semibold leading-snug tracking-tight text-slate-900 dark:text-slate-50">
                    {preview.full_headline}
                  </h3>
                  {preview.summary ? (
                    <p className="mt-1 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">
                      {stripHtml(preview.summary)}
                    </p>
                  ) : null}
                  {previewLoading ? (
                    <p className="mt-2 text-xs text-slate-400">
                      Refreshing preview…
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {previewError !== null && !previewLoading ? (
              <div className="p-3 text-sm text-red-600 dark:text-red-400">
                {previewError}
              </div>
            ) : null}
          </div>
        ) : null}

        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            One-line take (optional)
          </span>
          <MentionInput
            value={take}
            onChange={setTake}
            rows={2}
            placeholder="What stood out? Use @ to mention a friend"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Article text (optional)
          </span>
          <textarea
            value={sharedText}
            onChange={(e) => setSharedText(e.target.value)}
            rows={5}
            placeholder="Paste the article text here…"
            className="resize-y border border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-800"
          />
          {sharedText.trim() ? (
            <span className="text-[11px] text-slate-400">
              {sharedText.trim().length.toLocaleString()} characters · shown
              as a reader view on your post
            </span>
          ) : null}
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Your rating (optional)
          </span>
          <div className="flex items-center gap-2">
            <StarPicker value={rating} onChange={setRating} />
            {rating !== null ? (
              <span className="text-[11px] text-slate-400">
                {rating.toFixed(1)}
              </span>
            ) : null}
          </div>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          Only your friends will see this.
        </p>
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-t border-slate-200 p-5 pt-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-5 dark:border-slate-700">
        <button
          type="button"
          onClick={onClose}
          className="border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canPost}
          className="bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          {saving ? "Posting…" : "Post"}
        </button>
      </div>
      </form>
    </ModalShell>
  );
}
