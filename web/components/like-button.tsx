"use client";

import { REACTION_ACCENT, ReactionIcon } from "@/components/reaction-icon";
import { REACTIONS, type ReactionKind } from "@/lib/types";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

const LONG_PRESS_MS = 400;

interface LikeButtonProps {
  myReaction: ReactionKind | null;
  onToggle: (reaction: ReactionKind) => void;
  disabled?: boolean;
  className?: string;
  /** "toolbar" = padded pill button (post row, default). "link" = plain
   * inline text link sized/colored like a row's other Reply/Edit/Delete
   * links (comment row). Only trigger styling differs — the picker and all
   * pointer/long-press handling are identical in both. */
  variant?: "toolbar" | "link";
  /** Total reaction count across all kinds; shown as " · N" after the
   * label when variant is "link" and count > 0. Ignored by "toolbar" —
   * the post's total is already shown in PostEngagementRow. */
  reactionCount?: number;
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
  variant = "toolbar",
  reactionCount,
}: LikeButtonProps) {
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);
  const [openedByTouch, setOpenedByTouch] = useState<boolean>(false);
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
      setOpenedByTouch(true);
      setPickerOpen(true);
    }, LONG_PRESS_MS);
  }

  function handlePointerUpOrCancel(): void {
    clearLongPressTimer();
  }

  function handlePointerEnter(e: ReactPointerEvent<HTMLDivElement>): void {
    if (disabled || e.pointerType !== "mouse") return;
    setOpenedByTouch(false);
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
  const iconKind: ReactionKind = active ? active.kind : "like";
  const unreactedColorClass: string =
    variant === "link"
      ? "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
      : "text-zinc-600 dark:text-zinc-300";
  const colorClass: string = active ? REACTION_ACCENT[active.kind] : unreactedColorClass;
  const countSuffix: string =
    variant === "link" && reactionCount !== undefined && reactionCount > 0
      ? ` · ${reactionCount}`
      : "";

  return (
    <div
      className={`relative inline-flex ${variant === "toolbar" ? "flex-1" : ""} ${className}`}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      {pickerOpen ? (
        <>
          {openedByTouch ? (
            <div
              className="fixed inset-0 z-10"
              onClick={() => setPickerOpen(false)}
            />
          ) : null}
          <div className="absolute bottom-full left-0 z-20 pb-2">
            <div className="flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2 py-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              {REACTIONS.map((r) => (
                <button
                  key={r.kind}
                  type="button"
                  aria-label={r.label}
                  title={r.label}
                  onClick={() => choose(r.kind)}
                  className={`rounded-full p-1.5 leading-none transition-transform hover:scale-125 ${REACTION_ACCENT[r.kind]}`}
                >
                  <ReactionIcon kind={r.kind} className="h-6 w-6" />
                </button>
              ))}
            </div>
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
        className={
          variant === "toolbar"
            ? `flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800 ${colorClass} ${
                myReaction !== null ? "font-semibold" : "font-medium"
              }`
            : `inline-flex items-center gap-1 disabled:opacity-40 ${colorClass} ${
                myReaction !== null ? "font-semibold" : ""
              }`
        }
      >
        <ReactionIcon kind={iconKind} className="h-[1.1em] w-[1.1em]" />
        <span>
          {label}
          {countSuffix}
        </span>
      </button>
    </div>
  );
}
