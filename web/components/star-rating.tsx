"use client";

import { useAuthGate } from "@/components/auth-gate";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import type { UUID } from "@/lib/types";
import { useState } from "react";

interface StarRatingProps {
  storyId: UUID;
  value: number | null;
  onChange: (value: number | null) => void;
  friendAvg?: number | null;
  friendCount?: number;
}

const STARS: readonly number[] = [1, 2, 3, 4, 5];

export function StarRating({
  storyId,
  value,
  onChange,
  friendAvg = null,
  friendCount = 0,
}: StarRatingProps) {
  const { requireAuth } = useAuthGate();
  const { notify } = useToast();
  const [hover, setHover] = useState<number>(0);
  const [busy, setBusy] = useState<boolean>(false);

  async function pick(n: number): Promise<void> {
    if (busy) return;
    if (!requireAuth("rate stories")) return;
    // Clicking your current rating clears it.
    const next: number | null = value === n ? null : n;
    const prev: number | null = value;
    onChange(next);
    setBusy(true);
    try {
      if (next === null) await api.clearRating(storyId);
      else await api.setRating(storyId, next);
    } catch (err) {
      onChange(prev);
      notify(err instanceof ApiError ? err.message : "Failed to rate", "error");
    } finally {
      setBusy(false);
    }
  }

  const active: number = hover || value || 0;

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center" onMouseLeave={() => setHover(0)}>
        {STARS.map((n) => (
          <button
            key={n}
            type="button"
            disabled={busy}
            aria-label={`Rate ${n} star${n > 1 ? "s" : ""}`}
            onMouseEnter={() => setHover(n)}
            onClick={() => void pick(n)}
            className={`px-0.5 text-lg leading-none transition ${
              n <= active
                ? "text-amber-500"
                : "text-zinc-300 hover:text-amber-300 dark:text-zinc-600"
            }`}
          >
            {n <= active ? "\u2605" : "\u2606"}
          </button>
        ))}
      </div>
      {value !== null ? (
        <span className="text-[11px] text-zinc-400">your rating</span>
      ) : friendCount > 0 && friendAvg !== null ? (
        <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {friendAvg.toFixed(1)} from {friendCount} friend
          {friendCount === 1 ? "" : "s"}
        </span>
      ) : null}
    </div>
  );
}
