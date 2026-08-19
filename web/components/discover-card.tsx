"use client";

import { SourceLogo } from "@/components/source-logo";
import { stripHtml } from "@/lib/html";
import { relativeTime } from "@/lib/time";
import type { Story, StoryDiscussion } from "@/lib/types";

interface DiscoverCardProps {
  story: Story;
  onStartConversation: (story: Story) => void;
  onSignIn?: () => void;
  isGuest: boolean;
}

function discussingLabel(count: number): string {
  if (count === 1) return "1 person discussing privately";
  return `${count} people discussing privately`;
}

function activityTimestamp(story: Story): string | null {
  const discussion: StoryDiscussion | null | undefined = story.discussion;
  if (discussion?.last_comment_at) {
    const when: string = relativeTime(discussion.last_comment_at);
    if (when === "") return null;
    return when === "just now" ? "Commented just now" : `Commented ${when}`;
  }
  const age: string = relativeTime(story.created_at);
  return age === "" ? null : age;
}

function DiscussionProof({ discussion }: { discussion: StoryDiscussion }) {
  if (discussion.people_count <= 0) return null;

  return (
    <div className="mt-2 flex items-center gap-2 text-[12px] text-zinc-500 dark:text-zinc-400">
      {discussion.avatar_urls.length > 0 ? (
        <span className="flex -space-x-2">
          {discussion.avatar_urls.map((url) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={url}
              src={url}
              alt=""
              className="h-5 w-5 rounded-[9999px] object-cover ring-2 ring-white dark:ring-zinc-950"
            />
          ))}
        </span>
      ) : null}
      <span>{discussingLabel(discussion.people_count)}</span>
    </div>
  );
}

export function DiscoverCard({
  story,
  onStartConversation,
  onSignIn,
  isGuest,
}: DiscoverCardProps) {
  function handleStart(): void {
    if (isGuest) {
      onSignIn?.();
      return;
    }
    onStartConversation(story);
  }

  const timestamp: string | null = activityTimestamp(story);

  return (
    <article className="border-t border-zinc-200 py-5 first:border-t-0 dark:border-zinc-800">
      {story.source_name ? (
        <div className="mb-1.5 flex items-center gap-2">
          <SourceLogo
            src={story.source_image_url}
            name={story.source_name}
            imgClassName="h-5 w-auto max-w-[160px] shrink-0 object-contain"
            fallbackClassName="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500"
          />
        </div>
      ) : null}
      <div className="flex gap-3">
        {story.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={story.image_url}
            alt=""
            className="h-20 w-20 shrink-0 object-cover"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-[1.05rem] font-semibold leading-snug tracking-tight text-zinc-900 dark:text-zinc-50">
            {story.full_headline}
          </h3>
          {story.summary ? (
            <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-400">
              {stripHtml(story.summary).slice(0, 280)}
            </p>
          ) : null}
          {timestamp ? (
            <p className="mt-1.5 text-[12px] text-zinc-500">{timestamp}</p>
          ) : null}
          {story.discussion ? (
            <DiscussionProof discussion={story.discussion} />
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleStart}
          className="bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          {isGuest ? "Sign in to discuss privately" : "Start a private conversation"}
        </button>
        <a
          href={story.article_url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-sm font-semibold text-zinc-500 hover:text-zinc-800 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          Read article
        </a>
      </div>
    </article>
  );
}
