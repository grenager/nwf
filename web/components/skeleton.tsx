/** Shimmering placeholder block used while content loads. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`relative overflow-hidden bg-zinc-200 dark:bg-zinc-800 ${className}`}
    >
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-white/10" />
    </div>
  );
}

/** Placeholder for a single feed post (image, headline, meta, comment row). */
function FeedCardSkeleton() {
  return (
    <div className="space-y-3 py-7">
      {/* Author header + take */}
      <div className="flex items-start gap-2">
        <Skeleton className="h-7 w-7 shrink-0 rounded-[9999px]" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="mt-2 h-4 w-full" />
          <Skeleton className="mt-1.5 h-4 w-5/6" />
        </div>
      </div>
      {/* Link preview */}
      <div className="border border-zinc-200 dark:border-zinc-800">
        <Skeleton className="h-56 w-full" />
        <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-2 h-5 w-3/4" />
        </div>
      </div>
      {/* Engagement + composer */}
      <Skeleton className="h-4 w-32" />
      <div className="flex items-start gap-2">
        <Skeleton className="h-7 w-7 shrink-0 rounded-[9999px]" />
        <Skeleton className="h-8 flex-1" />
      </div>
    </div>
  );
}

/** Full feed loading state: a few shimmering post cards. */
export function FeedSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
      {Array.from({ length: count }).map((_, i) => (
        <FeedCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Loading state for a list of people (friends sidebar / friends page). */
export function UserListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-3">
          <Skeleton className="h-9 w-9 shrink-0 rounded-[9999px]" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="mt-1.5 h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}
