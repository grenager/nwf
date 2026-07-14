"use client";

import { useAuthGate } from "@/components/auth-gate";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import type { UUID } from "@/lib/types";
import { useState } from "react";

const FULL_STAR = "\u2605";

/** One star cell filled 0–100% via a gold overlay clipped over a gray base. */
function StarGlyph({ fill }: { fill: number }) {
  const pct: number = Math.max(0, Math.min(1, fill)) * 100;
  return (
    <span className="relative inline-block">
      <span className="text-zinc-300 dark:text-zinc-600">{FULL_STAR}</span>
      <span
        className="absolute inset-y-0 left-0 overflow-hidden text-amber-500"
        style={{ width: `${pct}%` }}
      >
        {FULL_STAR}
      </span>
    </span>
  );
}

const SIZE_CLASS: Record<"xs" | "sm" | "lg", string> = {
  xs: "text-[11px]",
  sm: "text-sm",
  lg: "text-xl",
};

/** Read-only fractional star display (e.g. a friend's or the average rating). */
export function StarsDisplay({
  value,
  size = "sm",
}: {
  value: number;
  size?: "xs" | "sm" | "lg";
}) {
  return (
    <span
      className={`inline-flex leading-none ${SIZE_CLASS[size]}`}
      aria-label={`${value} out of 5 stars`}
      title={`${value} / 5`}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <StarGlyph key={i} fill={value - i} />
      ))}
    </span>
  );
}

const CELLS: readonly number[] = [1, 2, 3, 4, 5];

/**
 * Presentational half-star picker (Letterboxd-style): the left half of each
 * star picks x.5, the right half a whole star. Clicking your current rating
 * clears it (onChange(null)). No persistence — the caller decides what to do.
 */
export function StarPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState<number>(0);
  const shown: number = hover || value || 0;

  function choose(n: number): void {
    if (disabled) return;
    onChange(value === n ? null : n);
  }

  return (
    <span
      className="inline-flex text-xl leading-none"
      onMouseLeave={() => setHover(0)}
    >
      {CELLS.map((n) => (
        <span key={n} className="relative inline-block">
          <StarGlyph fill={shown - (n - 1)} />
          <button
            type="button"
            disabled={disabled}
            aria-label={`Rate ${n - 0.5} stars`}
            onMouseEnter={() => setHover(n - 0.5)}
            onClick={() => choose(n - 0.5)}
            className="absolute inset-y-0 left-0 z-10 w-1/2 cursor-pointer"
          />
          <button
            type="button"
            disabled={disabled}
            aria-label={`Rate ${n} star${n > 1 ? "s" : ""}`}
            onMouseEnter={() => setHover(n)}
            onClick={() => choose(n)}
            className="absolute inset-y-0 right-0 z-10 w-1/2 cursor-pointer"
          />
        </span>
      ))}
    </span>
  );
}

interface RatingInputProps {
  storyId: UUID;
  value: number | null;
  onChange: (value: number | null) => void;
}

/** Half-star input bound to a story: persists to the API, rolls back on error. */
export function RatingInput({ storyId, value, onChange }: RatingInputProps) {
  const { requireAuth } = useAuthGate();
  const { notify } = useToast();
  const [busy, setBusy] = useState<boolean>(false);

  async function commit(next: number | null): Promise<void> {
    if (busy) return;
    if (!requireAuth("rate stories")) return;
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

  return (
    <StarPicker
      value={value}
      disabled={busy}
      onChange={(next) => void commit(next)}
    />
  );
}
