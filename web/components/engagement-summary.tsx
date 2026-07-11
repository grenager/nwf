import { REACTIONS } from "@/lib/reactions";
import type { FriendEngagement, FriendMini } from "@/lib/types";

interface EngagementSummaryProps {
  engagement: FriendEngagement;
  className?: string;
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

  if (total === 0) {
    return (
      <p
        className={`text-[11px] text-slate-400 dark:text-slate-500 ${className}`}
      >
        No friend activity yet
      </p>
    );
  }

  return (
    <div
      className={`grid grid-cols-3 items-center text-[11px] text-slate-500 dark:text-slate-400 ${className}`}
    >
      <span className="justify-self-start">
        {read > 0 ? (
          <ReaderAvatars readers={readers} read={read} />
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
              <span className="text-sm leading-none">{r.emoji}</span>
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
