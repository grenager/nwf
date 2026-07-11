"use client";

import { api, ApiError } from "@/lib/api";
import { FriendStars } from "@/components/friend-stars";
import { useToast } from "@/components/toast";
import { stripHtml } from "@/lib/html";
import { relativeTime } from "@/lib/time";
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
      <div className={dense ? "p-3" : "p-4"}>
        {!dense && story.source_name ? (
          <div className="mb-2 flex items-center gap-2">
            {story.source_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={story.source_image_url}
                alt=""
                className="h-5 w-5 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[10px] font-bold text-brand-700">
                {story.source_name.charAt(0)}
              </span>
            )}
            <span className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">
              {story.source_name}
            </span>
          </div>
        ) : null}
        <div className="flex gap-4">
          {story.image_url && !dense ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={story.image_url}
              alt=""
              className="h-24 w-24 shrink-0 rounded-lg object-cover"
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
                {stripHtml(story.summary).slice(0, 280)}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
              {story.friend_stars && story.friend_stars.length > 0 ? (
                <FriendStars stars={story.friend_stars} />
              ) : null}
              {story.author_names.length > 0 ? (
                <span>{story.author_names.join(", ")}</span>
              ) : null}
              <span>{relativeTime(story.created_at)}</span>
            </div>
          </div>
          <button
            onClick={toggleStar}
            disabled={busy}
            aria-label={starred ? "Unstar" : "Star"}
            className={`self-start text-xl transition ${
              starred
                ? "text-slate-900 dark:text-slate-100"
                : "text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
            }`}
          >
            {starred ? "★" : "☆"}
          </button>
        </div>
      </div>
    </article>
  );
}
