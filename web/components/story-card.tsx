"use client";

import { api } from "@/lib/api";
import { EngagementSummary } from "@/components/engagement-summary";
import { stripHtml } from "@/lib/html";
import { relativeTime } from "@/lib/time";
import type { Story, UUID } from "@/lib/types";
import { useEffect, useState } from "react";

interface StoryCardProps {
  story: Story;
  dense?: boolean;
  onChange?: (story: Story) => void;
  onOpen?: (storyId: UUID) => void;
  onDismiss?: (storyId: UUID) => void;
}

export function StoryCard({
  story,
  dense = false,
  onChange,
  onOpen,
  onDismiss,
}: StoryCardProps) {
  const [read, setRead] = useState<boolean>(story.read);

  useEffect(() => {
    if (story.read) setRead(true);
  }, [story.read]);

  function handleOpen(e: React.MouseEvent): void {
    if (onOpen) {
      e.preventDefault();
      setRead(true);
      onOpen(story.id);
      return;
    }
    if (!read) {
      setRead(true);
      void api.markRead(story.id, true).catch(() => undefined);
      onChange?.({ ...story, read: true });
    }
  }

  return (
    <article
      className={`group relative rounded-xl border border-slate-200 bg-white transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900 ${
        read ? "opacity-45 grayscale" : ""
      }`}
    >
      {onDismiss ? (
        <button
          type="button"
          onClick={() => onDismiss(story.id)}
          aria-label="Dismiss article"
          title="Dismiss"
          className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          ✕
        </button>
      ) : null}
      <div className={dense ? "p-3" : "p-4"}>
        {!dense && story.source_name ? (
          <div className="mb-2 flex items-center gap-2 pr-6">
            {story.source_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={story.source_image_url}
                alt={story.source_name}
                className="h-6 w-auto max-w-[180px] shrink-0 object-contain"
              />
            ) : (
              <span className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">
                {story.source_name}
              </span>
            )}
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
              onClick={handleOpen}
              className="block font-semibold leading-snug text-slate-900 hover:text-brand-600 dark:text-slate-100"
            >
              {story.full_headline}
            </a>
            {!dense && story.summary ? (
              <p className="mt-1 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">
                {stripHtml(story.summary).slice(0, 280)}
              </p>
            ) : null}
            <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
              {story.author_names.length > 0 ? (
                <span className="min-w-0 truncate">
                  {story.author_names.join(", ")}
                </span>
              ) : null}
              <span className="ml-auto shrink-0 whitespace-nowrap">
                {relativeTime(story.created_at)}
              </span>
            </div>
          </div>
        </div>
        {!dense ? (
          <div className="mt-3 border-t border-slate-100 pt-2 dark:border-slate-800">
            <EngagementSummary engagement={story.engagement} />
          </div>
        ) : null}
      </div>
    </article>
  );
}
