"use client";

import { REACTIONS, type ReactionKind } from "@/lib/types";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

const REACTION_ACCENT: Record<ReactionKind, string> = {
  like: "text-blue-600 dark:text-blue-400",
  love: "text-red-600 dark:text-red-400",
  care: "text-pink-600 dark:text-pink-400",
  haha: "text-yellow-600 dark:text-yellow-400",
  wow: "text-purple-600 dark:text-purple-400",
  sad: "text-amber-600 dark:text-amber-400",
  angry: "text-orange-600 dark:text-orange-400",
};

const LONG_PRESS_MS = 400;

interface LikeButtonProps {
  myReaction: ReactionKind | null;
  onToggle: (reaction: ReactionKind) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Facebook-style single Like button: a tap toggles your current reaction
 * (sets "like" when you have none, clears it when you already reacted); a
 * long-press (touch) or hover (desktop) reveals a floating picker for the
 * other reactions. `reactions` counts are shown elsewhere (the engagement
 * row) — this button only reflects the viewer's own pick.
 */
export function LikeButton({
  myReaction,
  onToggle,
  disabled = false,
  className = "",
}: LikeButtonProps) {
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef<boolean>(false);

  useEffect(() => {
    if (!pickerOpen) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setPickerOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pickerOpen]);

  useEffect(() => {
    return () => {
      if (longPressTimer.current !== null) clearTimeout(longPressTimer.current);
    };
  }, []);

  function clearLongPressTimer(): void {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLButtonElement>): void {
    if (disabled || e.pointerType === "mouse") return;
    clearLongPressTimer();
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true;
      setPickerOpen(true);
    }, LONG_PRESS_MS);
  }

  function handlePointerUpOrCancel(): void {
    clearLongPressTimer();
  }

  function handlePointerEnter(e: ReactPointerEvent<HTMLDivElement>): void {
    if (disabled || e.pointerType !== "mouse") return;
    setPickerOpen(true);
  }

  function handlePointerLeave(e: ReactPointerEvent<HTMLDivElement>): void {
    if (e.pointerType !== "mouse") return;
    setPickerOpen(false);
  }

  function handleClick(): void {
    if (didLongPress.current) {
      didLongPress.current = false;
      return;
    }
    onToggle(myReaction ?? "like");
  }

  function choose(reaction: ReactionKind): void {
    didLongPress.current = false;
    setPickerOpen(false);
    onToggle(reaction);
  }

  const active = myReaction !== null ? REACTIONS.find((r) => r.kind === myReaction) : null;
  const label: string = active ? active.label : "Like";
  const emoji: string = active ? active.emoji : "👍";
  const colorClass: string = active
    ? REACTION_ACCENT[active.kind]
    : "text-zinc-600 dark:text-zinc-300";

  return (
    <div
      className={`relative inline-flex flex-1 ${className}`}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      {pickerOpen ? (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setPickerOpen(false)}
          />
          <div className="absolute bottom-full left-0 z-20 mb-2 flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2 py-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {REACTIONS.map((r) => (
              <button
                key={r.kind}
                type="button"
                aria-label={r.label}
                title={r.label}
                onClick={() => choose(r.kind)}
                className="rounded-full p-1 text-2xl leading-none transition-transform hover:scale-125"
              >
                {r.emoji}
              </button>
            ))}
          </div>
        </>
      ) : null}
      <button
        type="button"
        disabled={disabled}
        aria-pressed={myReaction !== null}
        aria-label={label}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUpOrCancel}
        onPointerCancel={handlePointerUpOrCancel}
        onClick={handleClick}
        className={`flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800 ${colorClass} ${
          myReaction !== null ? "font-semibold" : "font-medium"
        }`}
      >
        <span>{emoji}</span>
        <span>{label}</span>
      </button>
    </div>
  );
}
