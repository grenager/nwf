"use client";

interface InboxCardActionsProps {
  read: boolean;
  onRead?: () => void;
  onArchive?: () => void;
  archiveLabel?: string;
}

export function InboxCardActions({
  read,
  onRead,
  onArchive,
  archiveLabel = "Archive",
}: InboxCardActionsProps) {
  if (!onRead && !onArchive) return null;

  return (
    <div className="flex shrink-0 items-center gap-2 text-[11px] uppercase tracking-[0.08em]">
      {onRead ? (
        <button
          type="button"
          disabled={read}
          onClick={(e) => {
            e.stopPropagation();
            onRead();
          }}
          className="text-zinc-500 transition hover:text-zinc-900 disabled:cursor-default disabled:text-zinc-300 dark:hover:text-zinc-100 dark:disabled:text-zinc-600"
        >
          Read
        </button>
      ) : null}
      {onRead && onArchive ? (
        <span className="text-zinc-300" aria-hidden>
          |
        </span>
      ) : null}
      {onArchive ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onArchive();
          }}
          className="text-zinc-500 transition hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          {archiveLabel}
        </button>
      ) : null}
    </div>
  );
}
