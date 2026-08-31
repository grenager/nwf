import type { ReactionKind } from "@/lib/types";
import type { ReactNode } from "react";

/**
 * Hand-drawn, matching the stroke recipe already used for the app's other
 * line icons (e.g. the Share icon in post-thread.tsx): 24x24 viewBox,
 * 1.75 stroke, rounded joins, no fill. Monotone by default — callers color
 * it via `currentColor` (a text color class on the wrapper) rather than
 * baking color into the icon itself.
 */
const GLYPHS: Record<ReactionKind, ReactNode> = {
  like: (
    <>
      <rect x="3" y="10.2" width="3.6" height="9.6" rx="1.2" />
      <path d="M7.6 10.2 11 4.3a1.7 1.7 0 0 1 3.1.95v4.1h4.4a2 2 0 0 1 1.96 2.4l-1.15 6.5A2 2 0 0 1 17.35 19.8H10.6a3 3 0 0 1-3-3v-6.6z" />
    </>
  ),
  love: (
    <path d="M12 20.2s-7.3-4.5-9.5-8.8A5 5 0 0 1 12 6.1a5 5 0 0 1 9.5 5.3c-2.2 4.3-9.5 8.8-9.5 8.8z" />
  ),
  care: (
    <>
      <path d="M12 12.6s-3.2-2-4.2-3.9A2.3 2.3 0 0 1 12 6.4a2.3 2.3 0 0 1 4.2 2.3c-1 1.9-4.2 3.9-4.2 3.9z" />
      <path d="M3.6 16.2c1.7 3.1 4.9 5.2 8.4 5.2s6.7-2.1 8.4-5.2" />
    </>
  ),
  haha: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 9.6c.55-1 1.65-1 2.2 0" />
      <path d="M13.8 9.6c.55-1 1.65-1 2.2 0" />
      <path d="M7.3 14.1c1.1 2.6 2.9 3.7 4.7 3.7s3.6-1.1 4.7-3.7" />
    </>
  ),
  wow: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="8.7" cy="10.1" r="0.95" fill="currentColor" stroke="none" />
      <circle cx="15.3" cy="10.1" r="0.95" fill="currentColor" stroke="none" />
      <circle cx="12" cy="15.6" r="1.9" />
    </>
  ),
  sad: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 10.2h1.6" />
      <path d="M14.4 10.2H16" />
      <path d="M8.2 16.3c1-1.5 2.4-2.1 3.8-2.1s2.8.6 3.8 2.1" />
      <path d="M16.3 12.9c.65.95.95 1.7.95 2.3a1 1 0 1 1-2 0c0-.6.35-1.35 1.05-2.3z" />
    </>
  ),
  angry: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M7.4 9.7l2.5 1.15" />
      <path d="M16.6 9.7l-2.5 1.15" />
      <path d="M8.6 16.2h6.8" />
    </>
  ),
};

/** Per-kind accent color, shared by anywhere a reaction needs to read at a
 * glance (the Like button's picker, the post engagement row's summary). */
export const REACTION_ACCENT: Record<ReactionKind, string> = {
  like: "text-blue-600 dark:text-blue-400",
  love: "text-red-600 dark:text-red-400",
  care: "text-pink-600 dark:text-pink-400",
  haha: "text-yellow-600 dark:text-yellow-400",
  wow: "text-purple-600 dark:text-purple-400",
  sad: "text-amber-600 dark:text-amber-400",
  angry: "text-orange-600 dark:text-orange-400",
};

export function ReactionIcon({
  kind,
  className = "h-[1em] w-[1em]",
}: {
  kind: ReactionKind;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {GLYPHS[kind]}
    </svg>
  );
}
