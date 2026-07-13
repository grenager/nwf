"use client";

import { api } from "@/lib/api";
import { EngagementSummary } from "@/components/engagement-summary";
import { InboxCardActions } from "@/components/inbox-card-actions";
import { stripHtml } from "@/lib/html";
import { relativeTime } from "@/lib/time";
import type { Story, UUID } from "@/lib/types";
import { useEffect, useState } from "react";

interface StoryCardProps {
  story: Story;
  dense?: boolean;
  exiting?: boolean;
  archivedView?: boolean;
  onChange?: (story: Story) => void;
  onOpen?: (storyId: UUID) => void;
  onRead?: (storyId: UUID) => void;
  onDismiss?: (storyId: UUID) => void;
}

export function StoryCard({
  story,
  dense = false,
  exiting = false,
  archivedView = false,
  onChange,
  onOpen,
  onRead,
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
      className={`group relative py-4 transition-opacity duration-300 ease-out ${
        exiting
          ? "pointer-events-none opacity-0"
          : read
            ? "opacity-45"
            : "opacity-100"
      }`}
    >
      <div>
        {!dense && story.source_name ? (
          <div className="mb-1.5 flex items-center gap-2">
            {story.source_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={story.source_image_url}
                alt={story.source_name}
                className="h-5 w-auto max-w-[160px] shrink-0 object-contain"
              />
            ) : (
              <span className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
                {story.source_name}
              </span>
            )}
          </div>
        ) : null}
        <div className={dense ? "" : "flex gap-3"}>
          {story.image_url && !dense ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={story.image_url}
              alt=""
              className="h-20 w-20 shrink-0 object-cover"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <a
              href={story.article_url}
              target="_blank"
              rel="noreferrer noopener"
              onClick={handleOpen}
              className="font-serif text-[1.05rem] font-semibold leading-snug tracking-tight text-zinc-900 hover:underline dark:text-zinc-50"
            >
              {story.full_headline}
            </a>
            {!dense && story.summary ? (
              <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                {stripHtml(story.summary).slice(0, 280)}
              </p>
            ) : null}
            <div className="mt-1.5 flex items-center gap-2 text-[11px] text-zinc-400">
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
          <div className="mt-2.5 flex items-end justify-between gap-3">
            <div className="min-w-0 flex-1">
              <EngagementSummary engagement={story.engagement} />
            </div>
            <InboxCardActions
              read={read}
              onRead={
                archivedView || !onRead
                  ? undefined
                  : () => {
                      setRead(true);
                      onRead(story.id);
                    }
              }
              onArchive={onDismiss ? () => onDismiss(story.id) : undefined}
              archiveLabel={archivedView ? "Restore" : "Archive"}
            />
          </div>
        ) : onRead || onDismiss ? (
          <div className="mt-2 flex justify-end">
            <InboxCardActions
              read={read}
              onRead={
                archivedView || !onRead
                  ? undefined
                  : () => {
                      setRead(true);
                      onRead(story.id);
                    }
              }
              onArchive={onDismiss ? () => onDismiss(story.id) : undefined}
              archiveLabel={archivedView ? "Restore" : "Archive"}
            />
          </div>
        ) : null}
      </div>
    </article>
  );
}
