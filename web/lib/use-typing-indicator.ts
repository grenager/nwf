"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import type { PostTyper, UUID } from "@/lib/types";

// Keep in sync with backend/core/config.py's typing_indicator_window_seconds.
const TYPING_THROTTLE_MS = 15_000;
const REFETCH_DEBOUNCE_MS = 400;
// A ping just refreshes a timestamp - nothing tells other clients when
// typing stops, so poll to notice a typer going stale even with no new write.
const POLL_INTERVAL_MS = 20_000;

/**
 * Who else is currently typing on a post's comments - same ping-and-expire
 * mechanism as `useStoryReaders` (a Realtime doorbell triggers a REST
 * refetch of the already window-filtered, self-excluding snapshot), not
 * Presence channels. Simpler than reading-now: the server only ever returns
 * active typers, so there's no live/settled state to compute client-side.
 */
export function useTypingIndicator(
  postId: UUID,
): { typers: PostTyper[]; notifyTyping: () => void } {
  const [typers, setTypers] = useState<PostTyper[]>([]);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPingedAt = useRef<number>(0);

  const refetch = useCallback((): void => {
    api
      .getTypers(postId)
      .then(setTypers)
      .catch(() => undefined);
  }, [postId]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`post-typing-${postId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "post_typing",
          filter: `post_id=eq.${postId}`,
        },
        () => {
          if (refetchTimer.current) clearTimeout(refetchTimer.current);
          refetchTimer.current = setTimeout(refetch, REFETCH_DEBOUNCE_MS);
        },
      )
      .subscribe();
    const poll = setInterval(refetch, POLL_INTERVAL_MS);
    return () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [postId, refetch]);

  const notifyTyping = useCallback((): void => {
    const now = Date.now();
    if (now - lastPingedAt.current < TYPING_THROTTLE_MS) return;
    lastPingedAt.current = now;
    void api.pingTyping(postId).catch(() => undefined);
  }, [postId]);

  return { typers, notifyTyping };
}
