import { ReactionIcon } from "@/components/reaction-icon";
import { REACTIONS } from "@/lib/reactions";
import type { FriendEngagement, FriendMini } from "@/lib/types";

interface EngagementSummaryProps {
  engagement: FriendEngagement;
  className?: string;
  scope?: "friends" | "global";
  /**
   * "spread" = full-width 3-column grid (detail views).
   * "inline" = compact left-aligned row that only takes needed width, so it can
   * share a line with action buttons without colliding.
   */
  variant?: "spread" | "inline";
}

function ReaderAvatars({
  readers,
  read,
}: {
  readers: FriendMini[];
  read: number;
}) {
  const shown: FriendMini[] = readers.slice(0, 3);
  const others: number = read - shown.length;
  return (
    <span className="flex items-center gap-1.5">
      <span className="flex -space-x-2">
        {shown.map((r) =>
          r.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={r.user_id}
              src={r.image_url}
              alt={r.display_name}
              title={r.display_name}
              className="h-5 w-5 rounded-[9999px] object-cover ring-2 ring-white dark:ring-slate-900"
            />
          ) : (
            <span
              key={r.user_id}
              title={r.display_name}
              className="flex h-5 w-5 items-center justify-center rounded-[9999px] bg-slate-300 text-[9px] font-bold text-slate-700 ring-2 ring-white dark:bg-slate-600 dark:text-slate-100 dark:ring-slate-900"
            >
              {r.display_name.charAt(0).toUpperCase()}
            </span>
          ),
        )}
      </span>
      <span>{others > 0 ? `+ ${others} others` : `${read} read`}</span>
    </span>
  );
}

/**
 * Friend-scoped engagement (never global), in three columns:
 *   left: reads · middle: reactions (emoji + count) · right: comments.
 */
export function EngagementSummary({
  engagement,
  className = "",
  scope = "friends",
  variant = "spread",
}: EngagementSummaryProps) {
  const { read, commented, reactions, readers } = engagement;
  const reactionEntries = REACTIONS.map((meta) => ({
    ...meta,
    count: reactions[meta.kind] ?? 0,
  })).filter((r) => r.count > 0);

  const reactionTotal: number = reactionEntries.reduce(
    (sum, r) => sum + r.count,
    0,
  );
  const total: number = read + commented + reactionTotal;
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
        {reactionEntries.map((r) => (
          <span key={r.kind} className="flex items-center gap-0.5" title={r.label}>
            <ReactionIcon kind={r.kind} className="h-3.5 w-3.5" />
            <span>{r.count}</span>
          </span>
        ))}
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
      className={`grid grid-cols-3 items-center text-[11px] text-slate-500 dark:text-slate-400 ${className}`}
    >
      <span className="justify-self-start">
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
      <span className="flex items-center justify-center gap-2">
        {reactionEntries.length === 0 ? (
          <span className="text-slate-300 dark:text-slate-600">—</span>
        ) : (
          reactionEntries.map((r) => (
            <span key={r.kind} className="flex items-center gap-0.5" title={r.label}>
              <ReactionIcon kind={r.kind} className="h-3.5 w-3.5" />
              <span>{r.count}</span>
            </span>
          ))
        )}
      </span>
      <span className="justify-self-end">
        {commented} {commented === 1 ? "comment" : "comments"}
      </span>
    </div>
  );
}
