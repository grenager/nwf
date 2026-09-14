"use client";

import { Avatar } from "@/components/avatar";
import { openingCommentText } from "@/lib/comments";
import { relativeTime } from "@/lib/time";
import { stripHtml } from "@/lib/html";
import type { FeedCard } from "@/lib/types";
import Link from "next/link";

/**
 * One conversation about a story, as a summary row.
 *
 * The story page already shows the article at the top, so a row deliberately
 * repeats none of it: no image, no headline, no source. What distinguishes
 * one conversation from another is who is in it and what they said, so that
 * is all a row carries. Tapping it opens the thread, which is where replying
 * happens — a summary is for choosing, not for joining.
 */
export function StoryConversationRow({ card }: { card: FeedCard }) {
  const post = card.posts[0];
  if (!post) return null;

  const unread: number = post.unread_reply_count ?? 0;
  const latest = post.replies.length
    ? post.replies[post.replies.length - 1]
    : null;
  const opening: string =
    openingCommentText(post)?.trim() || "shared this";

  // Everyone visible in the thread, author first, deduped: the quickest read
  // on "which of my circles is this".
  const faces: { name: string; imageUrl: string | null }[] = [];
  const seen = new Set<string>();
  for (const person of [
    { name: post.author_name, imageUrl: post.author_image_url },
    ...post.replies.map((r) => ({
      name: r.author_name,
      imageUrl: r.author_image_url,
    })),
  ]) {
    if (seen.has(person.name)) continue;
    seen.add(person.name);
    faces.push(person);
  }
  const shownFaces = faces.slice(0, 4);
  const moreFaces: number = Math.max(
    post.participant_count - shownFaces.length,
    faces.length - shownFaces.length,
  );

  return (
    <Link
      href={`/post/${post.id}`}
      scroll={false}
      className={`flex items-start gap-3 border-b border-zinc-200 px-1 py-4 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900 ${
        unread > 0 ? "bg-emerald-50/40 dark:bg-emerald-950/20" : ""
      }`}
    >
      <Avatar
        name={post.author_name}
        imageUrl={post.author_image_url}
        size="lg"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 text-sm text-zinc-900 dark:text-zinc-50">
            <span className="font-semibold">{post.author_name}</span>
            <span className="text-zinc-400"> · {relativeTime(post.created_at)}</span>
          </p>
          {unread > 0 ? (
            <span className="shrink-0 rounded-[9999px] bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">
              {unread} new
            </span>
          ) : null}
        </div>

        <p className="mt-0.5 line-clamp-2 text-sm text-zinc-700 [overflow-wrap:anywhere] dark:text-zinc-300">
          {stripHtml(opening)}
        </p>

        {latest !== null ? (
          <p className="mt-1 line-clamp-1 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="font-medium">{latest.author_name}</span>
            {": "}
            {stripHtml(latest.text)}
          </p>
        ) : null}

        <div className="mt-2 flex items-center gap-2">
          <span className="flex -space-x-2">
            {shownFaces.map((f) => (
              <span
                key={f.name}
                className="ring-2 ring-white dark:ring-zinc-950"
              >
                <Avatar name={f.name} imageUrl={f.imageUrl} size="sm" />
              </span>
            ))}
            {moreFaces > 0 ? (
              <span className="flex h-7 w-7 items-center justify-center rounded-[9999px] bg-zinc-200 text-[10px] font-semibold text-zinc-600 ring-2 ring-white dark:bg-zinc-700 dark:text-zinc-200 dark:ring-zinc-950">
                +{moreFaces}
              </span>
            ) : null}
          </span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {post.reply_count === 0
              ? "No replies yet"
              : `${post.reply_count} ${post.reply_count === 1 ? "reply" : "replies"}`}
            {post.reply_count > 0
              ? ` · ${relativeTime(post.last_activity_at)}`
              : ""}
          </span>
        </div>
      </div>
    </Link>
  );
}
