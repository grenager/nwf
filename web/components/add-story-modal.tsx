"use client";

import { useAuthGate } from "@/components/auth-gate";
import { StarPicker } from "@/components/star-rating";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { stripHtml } from "@/lib/html";
import type {
  Post,
  PostVisibility,
  PreviewCard,
  StoryKind,
} from "@/lib/types";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface AddStoryModalProps {
  onClose: () => void;
  onAdded?: (post: Post) => void;
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

export function AddStoryModal({ onClose, onAdded }: AddStoryModalProps) {
  const { notify } = useToast();
  const { requireAuth } = useAuthGate();
  const [url, setUrl] = useState<string>("");
  const [take, setTake] = useState<string>("");
  const [sharedText, setSharedText] = useState<string>("");
  const [kind, setKind] = useState<StoryKind>("news");
  const [visibility, setVisibility] = useState<PostVisibility>("private");
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
    // Keep the previous preview visible while a re-fetch runs (e.g. kind
    // toggle) so the panel doesn't flash empty.
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      void (async (): Promise<void> => {
        try {
          const card: PreviewCard = await api.previewUrl({
            url: trimmed,
            kind,
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
  }, [url, kind]);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!requireAuth("post")) return;
    const trimmed: string = url.trim();
    if (!trimmed || preview === null || previewLoading) return;
    setSaving(true);
    try {
      const post: Post = await api.createPost({
        url: trimmed,
        take: take.trim() || null,
        shared_text: sharedText.trim() || null,
        kind,
        visibility,
        canonical_url: preview.canonical_url,
        full_headline: preview.full_headline,
        summary: preview.summary,
        image_url: preview.image_url,
        publisher: preview.publisher,
        platform: preview.platform,
      });
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

  const canPost: boolean =
    preview !== null && !previewLoading && !saving && !!url.trim();
  const showPreviewPanel: boolean =
    previewLoading || preview !== null || previewError !== null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-24"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
            Share an article
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            ✕
          </button>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
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
            <textarea
              value={take}
              onChange={(e) => setTake(e.target.value)}
              rows={2}
              placeholder="What stood out?"
              className="resize-none border border-slate-300 bg-white px-3 py-2 text-sm outline-none dark:border-slate-700 dark:bg-slate-800"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Article text (optional)
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Behind a paywall? Paste the article text you can read so friends
              can read it here too. We always link back to{" "}
              {preview?.source_name ?? "the publisher"}. By pasting, you confirm
              you have access to this content and choose to share it.
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

          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Type
            </span>
            <div className="flex">
              {(["news", "analysis"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`flex-1 border px-3 py-2 text-sm font-medium capitalize transition ${
                    kind === k
                      ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                      : "border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  } ${k === "analysis" ? "-ml-px" : ""}`}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <span className="font-semibold">Visible to:</span>
            <select
              value={visibility}
              onChange={(e) =>
                setVisibility(e.target.value as PostVisibility)
              }
              className="border border-slate-300 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="private">friends</option>
              <option value="public">public</option>
            </select>
          </label>

          <div className="flex justify-end gap-2">
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
      </div>
    </div>,
    document.body,
  );
}
