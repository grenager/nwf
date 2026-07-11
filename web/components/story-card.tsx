"use client";

import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/toast";
import type { Story } from "@/lib/types";
import { useState } from "react";

interface StoryCardProps {
  story: Story;
  dense?: boolean;
  onChange?: (story: Story) => void;
}

export function StoryCard({ story, dense = false, onChange }: StoryCardProps) {
  const { notify } = useToast();
  const [read, setRead] = useState<boolean>(story.read);
  const [starred, setStarred] = useState<boolean>(story.starred);
  const [busy, setBusy] = useState<boolean>(false);

  async function toggleStar(): Promise<void> {
    if (busy) return;
    setBusy(true);
    const next: boolean = !starred;
    setStarred(next);
    try {
      if (next) await api.addStar(story.id);
      else await api.removeStar(story.id);
      onChange?.({ ...story, starred: next });
    } catch (err) {
      setStarred(!next);
      notify(err instanceof ApiError ? err.message : "Failed to update star", "error");
    } finally {
      setBusy(false);
    }
  }

  async function markReadAndOpen(): Promise<void> {
    if (!read) {
      setRead(true);
      try {
        await api.markRead(story.id, true);
        onChange?.({ ...story, read: true });
      } catch {
        // non-fatal
      }
    }
  }

  return (
    <article
      className={`group rounded-xl border border-slate-200 bg-white transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900 ${
        read ? "opacity-70" : ""
      }`}
    >
      <div className={`flex gap-4 ${dense ? "p-3" : "p-4"}`}>
        {story.image_url && !dense ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={story.image_url}
            alt=""
            className="h-20 w-28 shrink-0 rounded-lg object-cover"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <a
            href={story.article_url}
            target="_blank"
            rel="noreferrer noopener"
            onClick={markReadAndOpen}
            className="block font-semibold leading-snug text-slate-900 hover:text-brand-600 dark:text-slate-100"
          >
            {story.full_headline}
          </a>
          {!dense && story.summary ? (
            <p className="mt-1 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">
              {story.summary}
            </p>
          ) : null}
          <div className="mt-2 flex items-center gap-3 text-xs text-slate-400">
            {story.author_names.length > 0 ? (
              <span>{story.author_names.join(", ")}</span>
            ) : null}
            <span>{new Date(story.created_at).toLocaleDateString()}</span>
          </div>
        </div>
        <button
          onClick={toggleStar}
          disabled={busy}
          aria-label={starred ? "Unstar" : "Star"}
          className={`self-start text-xl transition ${
            starred ? "text-amber-400" : "text-slate-300 hover:text-amber-400"
          }`}
        >
          {starred ? "★" : "☆"}
        </button>
      </div>
    </article>
  );
}
