"use client";

import { useAuthGate } from "@/components/auth-gate";
import { ReactorsModal } from "@/components/reactors-modal";
import { ReadersModal } from "@/components/readers-modal";
import type { LiveStoryReader } from "@/lib/use-story-readers";
import { REACTIONS, type Post } from "@/lib/types";
import Link from "next/link";
import { useState } from "react";

interface PostEngagementRowProps {
  post: Post;
  readers: LiveStoryReader[];
  compact: boolean;
}

/** Stacked reader avatars, no per-avatar tooltip — the whole cluster opens
 * the readers modal instead. */
function ReaderAvatarStack({ readers }: { readers: LiveStoryReader[] }) {
  const shown: LiveStoryReader[] = readers.slice(0, 3);
  return (
    <span className="flex -space-x-2">
      {shown.map((r) => (
        <span key={r.user_id} className="relative">
          {r.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={r.image_url}
              alt=""
              className={`h-6 w-6 rounded-[9999px] object-cover ring-2 ring-white dark:ring-zinc-950 ${
                r.isLive ? "ring-emerald-400 dark:ring-emerald-400" : ""
              }`}
            />
          ) : (
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-[9999px] bg-zinc-300 text-[10px] font-bold text-zinc-700 ring-2 ring-white dark:bg-zinc-600 dark:text-zinc-100 dark:ring-zinc-950 ${
                r.isLive ? "ring-emerald-400 dark:ring-emerald-400" : ""
              }`}
            >
              {r.display_name.charAt(0).toUpperCase()}
            </span>
          )}
        </span>
      ))}
    </span>
  );
}

/**
 * Three-way engagement summary: readers, reactions, comments — sharing the
 * row roughly in thirds. Readers and reactions open a list modal; comments
 * links to the post the same way the old "view all comments" link did.
 */
export function PostEngagementRow({ post, readers, compact }: PostEngagementRowProps) {
  const { requireAuth } = useAuthGate();
  const [modal, setModal] = useState<"readers" | "reactors" | null>(null);

  const readCount: number = post.engagement.read;
  const hasReaders: boolean = readCount > 0;
  const hasReactions: boolean = post.reactions.length > 0;

  function openReaders(): void {
    if (!requireAuth("see who read this")) return;
    setModal("readers");
  }

  function openReactors(): void {
    if (!requireAuth("see who reacted")) return;
    setModal("reactors");
  }

  return (
    <div className="flex items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400">
      <span className="flex-1">
        {hasReaders ? (
          <button
            type="button"
            onClick={openReaders}
            className="flex items-center gap-1.5 hover:underline"
          >
            <ReaderAvatarStack readers={readers} />
            <span>{readCount}</span>
          </button>
        ) : null}
      </span>

      <span className="flex flex-1 justify-center">
        {hasReactions ? (
          <button
            type="button"
            onClick={openReactors}
            className="flex items-center gap-1.5 hover:underline"
          >
            {post.reactions.map((r) => {
              const known = REACTIONS.find((k) => k.kind === r.reaction);
              return (
                <span key={r.reaction}>
                  {known?.emoji ?? r.reaction}
                  {r.count}
                </span>
              );
            })}
          </button>
        ) : null}
      </span>

      <span className="flex flex-1 justify-end">
        {compact ? (
          <Link
            href={`/post/${post.id}`}
            scroll={false}
            className="hover:underline"
          >
            {post.reply_count} {post.reply_count === 1 ? "comment" : "comments"}
          </Link>
        ) : (
          <span>
            {post.reply_count} {post.reply_count === 1 ? "comment" : "comments"}
          </span>
        )}
      </span>

      {modal === "readers" ? (
        <ReadersModal readers={readers} onClose={() => setModal(null)} />
      ) : null}
      {modal === "reactors" ? (
        <ReactorsModal postId={post.id} onClose={() => setModal(null)} />
      ) : null}
    </div>
  );
}
