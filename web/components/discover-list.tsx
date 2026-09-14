"use client";

import { useAuth } from "@/components/auth-provider";
import { DiscoverCard } from "@/components/discover-card";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { Skeleton } from "@/components/skeleton";
import { api, ApiError } from "@/lib/api";
import type { DiscoverPayload } from "@/lib/types";
import { useAwayRefresh } from "@/lib/use-away-refresh";
import { useCallback, useEffect, useState } from "react";

interface DiscoverListProps {
  /** Rendered inside the guest landing page, which brings its own chrome. */
  embedded?: boolean;
}

/**
 * How the ranking window is described in the heading. A quiet platform
 * widens the window, and saying so is more honest than implying everything
 * on the page happened in the last day.
 */
function windowLabel(hours: number): string {
  if (hours <= 24) return "today";
  if (hours <= 72) return "the last few days";
  return "this week";
}

function DiscoverSkeleton() {
  return (
    <div className="space-y-6">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i}>
          <div className="border border-zinc-200 dark:border-zinc-800">
            <Skeleton className="h-44 w-full" />
            <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-2 h-5 w-3/4" />
            </div>
          </div>
          <Skeleton className="mt-2 h-3 w-40" />
        </div>
      ))}
    </div>
  );
}

/**
 * The Discover tab: the most active stories across the whole platform.
 *
 * The counterpart to Conversations. Where that feed is your friends talking,
 * this is everything being read and argued about right now — the reason to
 * open the app on a morning when none of your own friends has posted yet.
 */
export function DiscoverList({ embedded = false }: DiscoverListProps) {
  const { session, loading: authLoading } = useAuth();
  const isSignedIn: boolean = session !== null;
  const [data, setData] = useState<DiscoverPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (opts?: { silent?: boolean }): Promise<void> => {
      if (!opts?.silent) setLoading(true);
      try {
        const payload: DiscoverPayload = await api.getDiscover();
        setData(payload);
        setError(null);
      } catch (err) {
        setError(
          err instanceof ApiError ? err.message : "Couldn't load Discover",
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (authLoading) return;
    void load({ silent: data !== null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isSignedIn, load]);

  useAwayRefresh(() => {
    void load({ silent: true });
  });

  const heading = (
    <div className="flex items-baseline justify-between gap-3">
      <h1 className="font-serif text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Discover
      </h1>
      {data !== null && data.items.length > 0 ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Most discussed {windowLabel(data.window_hours)}
        </p>
      ) : null}
    </div>
  );

  let body: React.ReactNode;
  if (loading && data === null) {
    body = <DiscoverSkeleton />;
  } else if (error !== null && data === null) {
    body = (
      <div className="border border-zinc-200 p-6 text-center dark:border-zinc-800">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 text-sm font-semibold text-zinc-900 underline underline-offset-2 dark:text-zinc-50"
        >
          Try again
        </button>
      </div>
    );
  } else if (data === null || data.items.length === 0) {
    body = (
      <div className="border border-zinc-200 p-6 text-center dark:border-zinc-800">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          Nothing has taken off yet. Post a link and it starts here.
        </p>
      </div>
    );
  } else {
    body = (
      <div className="space-y-6">
        {data.items.map((card) => (
          <DiscoverCard
            key={card.story_id}
            card={card}
            canMarkRead={isSignedIn}
          />
        ))}
      </div>
    );
  }

  const content = (
    <div className={embedded ? "space-y-4" : "mx-auto max-w-2xl space-y-4 py-4"}>
      {heading}
      {body}
    </div>
  );

  // The pull gesture assumes the window is the scroller, which is only true
  // on the standalone tab — embedded in the landing page it would fight the
  // page's own layout.
  return embedded ? (
    content
  ) : (
    <PullToRefresh onRefresh={() => load({ silent: true })}>
      {content}
    </PullToRefresh>
  );
}
