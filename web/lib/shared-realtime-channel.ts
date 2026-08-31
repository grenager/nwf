"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase";
import type { RealtimeChannel, RealtimePostgresChangesFilter } from "@supabase/supabase-js";

type PostgresChangesConfig = RealtimePostgresChangesFilter<"*">;

interface ChannelEntry {
  channel: RealtimeChannel;
  listeners: Set<() => void>;
}

const registry = new Map<string, ChannelEntry>();

/**
 * Subscribe to a `postgres_changes` topic shared across every caller using
 * the same `topic` name.
 *
 * Two components can end up watching the same row at once — e.g. a feed
 * card and the intercepted post-detail modal both mount for the same
 * post/story when "view all comments" opens it on top of the feed. Each
 * would otherwise call `supabase.channel(topic).on(...).subscribe()`
 * independently, but Supabase's client reuses one underlying channel object
 * per topic name: the second caller's `.on("postgres_changes", ...)` throws
 * ("cannot add postgres_changes callbacks ... after subscribe()") because
 * the first caller already subscribed it. Callers here share one real
 * channel per topic instead, ref-counted so it's only torn down once
 * nobody's listening anymore. All callers for a given topic are assumed to
 * want the same `config` (true for every current caller, since the filter
 * is derived from the id baked into the topic name itself).
 *
 * Returns an unsubscribe function; call it from the caller's effect cleanup.
 */
export function subscribeSharedChannel(
  topic: string,
  config: PostgresChangesConfig,
  onChange: () => void,
): () => void {
  let entry: ChannelEntry | undefined = registry.get(topic);
  if (!entry) {
    const supabase = getSupabaseBrowserClient();
    const listeners = new Set<() => void>();
    const channel: RealtimeChannel = supabase
      .channel(topic)
      .on(
        "postgres_changes",
        config,
        () => {
          for (const listener of listeners) listener();
        },
      )
      .subscribe();
    entry = { channel, listeners };
    registry.set(topic, entry);
  }
  entry.listeners.add(onChange);

  return () => {
    const current: ChannelEntry | undefined = registry.get(topic);
    if (!current) return;
    current.listeners.delete(onChange);
    if (current.listeners.size === 0) {
      registry.delete(topic);
      void getSupabaseBrowserClient().removeChannel(current.channel);
    }
  };
}
