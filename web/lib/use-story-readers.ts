"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "@/lib/api";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import type { Profile, StoryReader, UUID } from "@/lib/types";

// Keep in sync with backend/core/config.py's reading_now_window_minutes.
const READING_NOW_WINDOW_MS = 12 * 60 * 1000;
const REFETCH_DEBOUNCE_MS = 400;
const LIVE_RECOMPUTE_INTERVAL_MS = 15_000;

export interface LiveStoryReader extends StoryReader {
  /** Within the live window since `last_read_at` - never causes removal. */
  isLive: boolean;
}

function isWithinWindow(lastReadAt: string, now: number): boolean {
  return now - new Date(lastReadAt).getTime() < READING_NOW_WINDOW_MS;
}

function selfDisplayName(me: Profile): string {
  return [me.first, me.last].filter(Boolean).join(" ").trim() || "You";
}

/**
 * Live "reading now" + settled "read" avatars for a single story.
 *
 * Supabase Realtime is used only as a doorbell: any `story_statuses` change
 * for this story triggers a debounced REST refetch of the profile-joined
 * snapshot, rather than diffing raw postgres_changes payloads client-side. A
 * separate interval ages live entries into their settled state - readers are
 * never removed from the list, only their `isLive` flag changes.
 */
export function useStoryReaders(
  storyId: UUID,
  initial: StoryReader[],
): { readers: LiveStoryReader[]; ping: (self: Profile) => void } {
  const [readers, setReaders] = useState<StoryReader[]>(initial);
  const [now, setNow] = useState<number>(() => Date.now());
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Seed once per story. Later updates come from Realtime/ping, not props,
  // so a self-ping or live refetch is never clobbered by a parent re-render
  // (e.g. the feed card re-rendering after a rating change).
  const seededStoryId = useRef<UUID | null>(null);
  useEffect(() => {
    if (seededStoryId.current !== storyId) {
      seededStoryId.current = storyId;
      setReaders(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId]);

  const refetch = useCallback((): void => {
    api
      .getStoryReaders(storyId)
      .then(setReaders)
      .catch(() => undefined);
  }, [storyId]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`story-readers-${storyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "story_statuses",
          filter: `story_id=eq.${storyId}`,
        },
        () => {
          if (refetchTimer.current) clearTimeout(refetchTimer.current);
          refetchTimer.current = setTimeout(refetch, REFETCH_DEBOUNCE_MS);
        },
      )
      .subscribe();
    return () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [storyId, refetch]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), LIVE_RECOMPUTE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const ping = useCallback(
    (self: Profile): void => {
      // Optimistic self-feedback: the viewer's own avatar appears instantly,
      // as confirmation their open registered, without waiting on a round trip.
      const pingedAt = new Date().toISOString();
      setReaders((prev) => [
        {
          user_id: self.id,
          display_name: selfDisplayName(self),
          image_url: self.image_url,
          last_read_at: pingedAt,
        },
        ...prev.filter((r) => r.user_id !== self.id),
      ]);
      void api.pingReading(storyId).catch(() => undefined);
    },
    [storyId],
  );

  const live: LiveStoryReader[] = useMemo(
    () =>
      readers.map((r) => ({ ...r, isLive: isWithinWindow(r.last_read_at, now) })),
    [readers, now],
  );

  return { readers: live, ping };
}
