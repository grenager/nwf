interface ReadBadgeProps {
  read: boolean;
}

export function ReadBadge({ read }: ReadBadgeProps): React.ReactNode {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${
        read
          ? "text-zinc-400 dark:text-zinc-500"
          : "text-sky-600 dark:text-sky-400"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          read ? "bg-zinc-300 dark:bg-zinc-600" : "bg-sky-500"
        }`}
        aria-hidden
      />
      {read ? "Read" : "Unread"}
    </span>
  );
}
