"use client";

import { Avatar } from "@/components/avatar";
import { api } from "@/lib/api";
import { EngagementSummary } from "@/components/engagement-summary";
import { InboxCardActions } from "@/components/inbox-card-actions";
import { ReadBadge } from "@/components/read-badge";
import { SourceLogo } from "@/components/source-logo";
import { UserLink } from "@/components/user-link";
import { stripHtml } from "@/lib/html";
import { relativeTime } from "@/lib/time";
import type { Story, UUID } from "@/lib/types";
import { sourceHref } from "@/lib/url";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

interface StoryCardProps {
  story: Story;
  dense?: boolean;
  exiting?: boolean;
  archivedView?: boolean;
  /** Inbox semantics: a read story fades out. Wrong in search, where a story
   *  you have already read is the one you are looking for. */
  dimRead?: boolean;
  /** Friend read/star activity on the article — discovery-era chrome. */
  showEngagement?: boolean;
  onChange?: (story: Story) => void;
  onOpen?: (storyId: UUID) => void;
  onRead?: (storyId: UUID) => void;
  onDismiss?: (storyId: UUID) => void;
}

function replyLabel(count: number): string {
  if (count === 0) return "no replies yet";
  return `${count} ${count === 1 ? "reply" : "replies"}`;
}

export function StoryCard({
  story,
  dense = false,
  exiting = false,
  archivedView = false,
  dimRead = true,
  showEngagement = true,
  onChange,
  onOpen,
  onRead,
  onDismiss,
}: StoryCardProps) {
  const [read, setRead] = useState<boolean>(story.read);

  useEffect(() => {
    if (story.read) setRead(true);
  }, [story.read]);

  function handleMarkRead(): void {
    if (read) return;
    setRead(true);
    void api.markRead(story.id, true).catch(() => undefined);
    onChange?.({ ...story, read: true });
  }

  function handleOpen(e: React.MouseEvent): void {
    if (onOpen) {
      e.preventDefault();
      setRead(true);
      onOpen(story.id);
      return;
    }
    handleMarkRead();
  }

  const headlineClassName: string =
    "font-serif text-[1.05rem] font-semibold leading-snug tracking-tight text-zinc-900 hover:underline dark:text-zinc-50";

  const headline: ReactNode = story.post_id ? (
    <Link
      href={`/post/${story.post_id}`}
      scroll={false}
      onClick={() => handleMarkRead()}
      className={headlineClassName}
    >
      {story.full_headline}
    </Link>
  ) : (
    <a
      href={story.article_url}
      target="_blank"
      rel="noreferrer noopener"
      onClick={handleOpen}
      className={headlineClassName}
    >
      {story.full_headline}
    </a>
  );

  return (
    <article
      className={`group relative py-4 transition-opacity duration-300 ease-out ${
        exiting
          ? "pointer-events-none opacity-0"
          : read && dimRead
            ? "opacity-45"
            : "opacity-100"
      }`}
    >
      <div>
        {!dense && story.source_name ? (
          <div className="mb-1.5 flex items-center gap-2">
            {sourceHref(story.article_url) ? (
              <Link
                href={sourceHref(story.article_url) as string}
                title={story.source_name}
                className="flex min-w-0 items-center gap-2 transition hover:opacity-70"
              >
                <SourceLogo
                  src={story.source_image_url}
                  name={story.source_name}
                  imgClassName="h-5 w-auto max-w-[160px] shrink-0 object-contain"
                  fallbackClassName="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500"
                />
              </Link>
            ) : (
              <SourceLogo
                src={story.source_image_url}
                name={story.source_name}
                imgClassName="h-5 w-auto max-w-[160px] shrink-0 object-contain"
                fallbackClassName="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500"
              />
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
            {headline}
            {!dense && (story.post_take || story.summary) ? (
              <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                {story.post_take
                  ? story.post_take
                  : stripHtml(story.summary ?? "").slice(0, 280)}
              </p>
            ) : null}
            <div className="mt-1.5 flex items-center gap-2 text-[12px]">
              {story.post_author_name ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  {story.post_author_id ? (
                    <UserLink
                      userId={story.post_author_id}
                      title={story.post_author_name}
                    >
                      <Avatar
                        name={story.post_author_name}
                        imageUrl={story.post_author_image_url ?? null}
                        size="sm"
                      />
                    </UserLink>
                  ) : (
                    <Avatar
                      name={story.post_author_name}
                      imageUrl={story.post_author_image_url ?? null}
                      size="sm"
                    />
                  )}
                  {story.post_author_id ? (
                    <UserLink
                      userId={story.post_author_id}
                      className="min-w-0 truncate font-semibold text-zinc-900 hover:underline dark:text-zinc-100"
                    >
                      {story.post_author_name}
                    </UserLink>
                  ) : (
                    <span className="min-w-0 truncate font-semibold text-zinc-900 dark:text-zinc-100">
                      {story.post_author_name}
                    </span>
                  )}
                  {story.post_id ? (
                    <Link
                      href={`/post/${story.post_id}`}
                      scroll={false}
                      onClick={() => handleMarkRead()}
                      className="shrink-0 whitespace-nowrap text-zinc-500 hover:underline"
                    >
                      {replyLabel(story.post_reply_count ?? 0)}
                    </Link>
                  ) : (
                    <span className="shrink-0 whitespace-nowrap text-zinc-500">
                      {replyLabel(story.post_reply_count ?? 0)}
                    </span>
                  )}
                </span>
              ) : story.author_names.length > 0 ? (
                <span className="min-w-0 truncate font-semibold text-zinc-900 dark:text-zinc-100">
                  {story.author_names.join(", ")}
                </span>
              ) : null}
              <span className="ml-auto shrink-0 whitespace-nowrap text-zinc-500">
                {relativeTime(story.created_at)}
              </span>
            </div>
          </div>
        </div>
        {!dense && (showEngagement || archivedView || onRead || onDismiss) ? (
          <div className="mt-2.5 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1 overflow-hidden">
              {showEngagement ? (
                <EngagementSummary engagement={story.engagement} variant="inline" />
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2.5">
              {archivedView ? <ReadBadge read={read} /> : null}
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
