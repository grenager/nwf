import type { FriendEngagement } from "@/lib/types";

interface EngagementSummaryProps {
  engagement: FriendEngagement;
  className?: string;
}

/**
 * Friend-scoped engagement (never global): how many of the user's friends
 * read, hearted, or commented on this story/event.
 */
export function EngagementSummary({
  engagement,
  className = "",
}: EngagementSummaryProps) {
  const { read, hearted, commented } = engagement;
  const total: number = read + hearted + commented;

  if (total === 0) {
    return (
      <p
        className={`text-[11px] text-slate-400 dark:text-slate-500 ${className}`}
      >
        No friend activity yet
      </p>
    );
  }

  const parts: string[] = [];
  if (read > 0) parts.push(`${read} read`);
  if (hearted > 0) parts.push(`${hearted} ♥`);
  if (commented > 0) {
    parts.push(`${commented} ${commented === 1 ? "comment" : "comments"}`);
  }

  return (
    <p
      className={`text-[11px] text-slate-500 dark:text-slate-400 ${className}`}
    >
      <span className="font-semibold text-slate-400 dark:text-slate-500">
        Friends:
      </span>{" "}
      {parts.join(" · ")}
    </p>
  );
}
