"use client";

import { useAuthGate } from "@/components/auth-gate";
import { MentionInput } from "@/components/mention-input";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { stripHtml } from "@/lib/html";
import type { Post, PreviewCard } from "@/lib/types";
import { useEffect, useRef, useState } from "react";
import { ModalShell } from "@/components/modal-shell";

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
  const [paywalled, setPaywalled] = useState<boolean>(false);
  const [sharedText, setSharedText] = useState<string>("");
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
  }, [url]);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!requireAuth("post")) return;
    const trimmedUrl: string = url.trim();
    if (!take.trim() || !trimmedUrl || preview === null || previewLoading) {
      return;
    }
    setSaving(true);
    try {
      const post: Post = await api.createPost({
        url: trimmedUrl,
        take: take.trim(),
        shared_text: paywalled ? sharedText.trim() || null : null,
        kind: "news",
        canonical_url: preview.canonical_url,
        full_headline: preview.full_headline,
        summary: preview.summary,
        image_url: preview.image_url,
        publisher: preview.publisher,
        platform: preview.platform,
      });
      notify("Posted", "success");
      onAdded?.(post);
      onClose();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Failed to post", "error");
    } finally {
      setSaving(false);
    }
  }

  const canPost: boolean =
    !!take.trim() &&
    !!url.trim() &&
    preview !== null &&
    !previewLoading &&
    !saving;
  const showPreviewPanel: boolean =
    previewLoading || preview !== null || previewError !== null;

  return (
    <ModalShell
      onClose={onClose}
      mobile="fullscreen"
      label="Share an article"
      padded={false}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 p-5 pb-4 dark:border-slate-700">
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

      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Your take
            </span>
            <MentionInput
              value={take}
              onChange={setTake}
              rows={5}
              autoFocus
              placeholder="What stood out? Use @ to mention a friend"
            />
          </label>

          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                Article URL
              </span>
              <input
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/article"
                className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </label>

            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={paywalled}
                onChange={(e) => setPaywalled(e.target.checked)}
                className="h-3.5 w-3.5 shrink-0 accent-slate-900 dark:accent-slate-100"
              />
              Story may be paywalled
            </label>

            {paywalled ? (
              <div className="flex flex-col gap-1">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Use a gift article link where your publisher offers one — it
                  lets friends read the original. Otherwise, paste the article
                  text below.
                </p>
                <textarea
                  value={sharedText}
                  onChange={(e) => setSharedText(e.target.value)}
                  rows={5}
                  placeholder="Paste the article text here…"
                  className="resize-y border border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
                {sharedText.trim() ? (
                  <span className="text-[11px] text-slate-400">
                    {sharedText.trim().length.toLocaleString()} characters ·
                    shown as a reader view on your post
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

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
                <div className={previewLoading ? "relative opacity-70" : "relative"}>
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
                        {preview.source_name ?? hostFromUrl(preview.canonical_url)}
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
