"use client";

import { useState } from "react";

import { UserLink } from "@/components/user-link";
import type { FriendEngagement, StoryReader } from "@/lib/types";

/** A reader with `isLive` known (from `useStoryReaders`); plain `StoryReader`
 * entries (e.g. search-result cards not wired to live updates) render as
 * settled - `isLive` defaults to false rather than being required. */
type DisplayReader = StoryReader & { isLive?: boolean };

interface EngagementSummaryProps {
  engagement: FriendEngagement;
  className?: string;
  scope?: "friends" | "global";
  /**
   * "spread" = full-width row (detail views).
   * "inline" = compact left-aligned row that only takes needed width, so it can
   * share a line with action buttons without colliding.
   */
  variant?: "spread" | "inline";
}

/** Just the avatar stack - no summary sentence. Tap an avatar for its name
 * (a hover title doesn't work on touch), then tap the name to open that
 * person; the overflow count gets its own plain "+N" circle rather than
 * trailing text. */
function ReaderAvatars({
  readers,
  read,
}: {
  readers: DisplayReader[];
  read: number;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const shown: DisplayReader[] = readers.slice(0, 3);
  const others: number = read - shown.length;

  return (
    <span className="flex -space-x-2">
      {shown.map((r) => (
        <span key={r.user_id} className="relative">
          <button
            type="button"
            onClick={() =>
              setRevealed((prev) => (prev === r.user_id ? null : r.user_id))
            }
            className="block"
          >
            {r.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={r.image_url}
                alt={r.display_name}
                className={`h-7 w-7 rounded-[9999px] object-cover ring-2 ring-white dark:ring-slate-900 ${
                  r.isLive ? "animate-pulse ring-emerald-400 dark:ring-emerald-400" : ""
                }`}
              />
            ) : (
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-[9999px] bg-slate-300 text-[11px] font-bold text-slate-700 ring-2 ring-white dark:bg-slate-600 dark:text-slate-100 dark:ring-slate-900 ${
                  r.isLive ? "animate-pulse ring-emerald-400 dark:ring-emerald-400" : ""
                }`}
              >
                {r.display_name.charAt(0).toUpperCase()}
              </span>
            )}
          </button>
          {revealed === r.user_id ? (
            <UserLink
              userId={r.user_id}
              className="absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-900 px-2 py-1 text-[11px] font-medium text-white shadow-lg hover:underline dark:bg-zinc-100 dark:text-zinc-900"
            >
              {r.display_name}
              {r.isLive ? " · reading now" : ""}
            </UserLink>
          ) : null}
        </span>
      ))}
      {others > 0 ? (
        <span
          title={`${others} more`}
          className="flex h-7 w-7 items-center justify-center rounded-[9999px] bg-slate-200 text-[10px] font-bold text-slate-600 ring-2 ring-white dark:bg-slate-700 dark:text-slate-300 dark:ring-slate-900"
        >
          +{others}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Friend-scoped engagement (never global): reads on the left, comments on the
 * right. Reactions are shown separately by the card's reaction bar.
 */
export function EngagementSummary({
  engagement,
  className = "",
  scope = "friends",
  variant = "spread",
}: EngagementSummaryProps) {
  const { read, commented, readers } = engagement;
  const total: number = read + commented;
  const emptyLabel: string =
    scope === "global" ? "No activity yet" : "No friend activity yet";

  if (variant === "inline") {
    if (total === 0) {
      return (
        <p
          className={`truncate text-[11px] text-zinc-400 dark:text-zinc-500 ${className}`}
        >
          {emptyLabel}
        </p>
      );
    }
    return (
      <div
        className={`flex items-center gap-3 text-[11px] text-zinc-500 dark:text-zinc-400 ${className}`}
      >
        {read > 0 ? (
          scope === "global" ? (
            <span>{read} read</span>
          ) : (
            <ReaderAvatars readers={readers} read={read} />
          )
        ) : null}
        {commented > 0 ? (
          <span>
            {commented} {commented === 1 ? "comment" : "comments"}
          </span>
        ) : null}
      </div>
    );
  }

  if (total === 0) {
    return (
      <p
        className={`text-[11px] text-slate-400 dark:text-slate-500 ${className}`}
      >
        {emptyLabel}
      </p>
    );
  }

  return (
    <div
      className={`flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 ${className}`}
    >
      <span>
        {read > 0 ? (
          scope === "global" ? (
            `${read} read`
          ) : (
            <ReaderAvatars readers={readers} read={read} />
          )
        ) : (
          "0 read"
        )}
      </span>
      <span>
        {commented} {commented === 1 ? "comment" : "comments"}
      </span>
    </div>
  );
}
