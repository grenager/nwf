"use client";

import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { REACTIONS, reactionEmoji, reactionLabel } from "@/lib/reactions";
import type { ReactionKind, UUID } from "@/lib/types";
import { useState } from "react";

interface ReactionPickerProps {
  storyId: UUID;
  value: ReactionKind | null;
  onChange: (value: ReactionKind | null) => void;
  size?: "sm" | "md";
  variant?: "pill" | "bar";
}

export function ReactionPicker({
  storyId,
  value,
  onChange,
  size = "sm",
  variant = "pill",
}: ReactionPickerProps) {
  const { notify } = useToast();
  const [open, setOpen] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);

  async function pick(kind: ReactionKind): Promise<void> {
    if (busy) return;
    setOpen(false);
    const next: ReactionKind | null = value === kind ? null : kind;
    const prev: ReactionKind | null = value;
    onChange(next);
    setBusy(true);
    try {
      if (next) await api.setReaction(storyId, next);
      else await api.clearReaction(storyId);
    } catch (err) {
      onChange(prev);
      notify(err instanceof ApiError ? err.message : "Failed to react", "error");
    } finally {
      setBusy(false);
    }
  }

  const md: boolean = size === "md";
  const bar: boolean = variant === "bar";
  let triggerClass: string;
  if (bar) {
    triggerClass = `flex flex-1 items-center justify-center gap-1.5 py-2 text-sm font-semibold transition hover:bg-slate-100 dark:hover:bg-slate-800 ${
      value
        ? "text-slate-900 dark:text-slate-100"
        : "text-slate-600 dark:text-slate-300"
    }`;
  } else if (value) {
    triggerClass = `flex items-center gap-1.5 border border-slate-400 bg-slate-100 font-semibold text-slate-800 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-100 ${
      md ? "px-3 py-1.5 text-sm" : "px-2 py-1 text-xs"
    }`;
  } else {
    triggerClass = `flex items-center gap-1.5 border border-slate-300 text-slate-500 hover:border-slate-400 dark:border-slate-700 dark:text-slate-400 ${
      md ? "px-3 py-1.5 text-sm" : "px-2 py-1 text-xs"
    }`;
  }

  return (
    <div className={bar ? "relative flex flex-1" : "relative inline-flex"}>
      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((o) => !o);
        }}
        className={triggerClass}
      >
        {value ? (
          <>
            <span className={md || bar ? "text-base" : "text-sm"}>
              {reactionEmoji(value)}
            </span>
            <span>{reactionLabel(value)}</span>
          </>
        ) : (
          <>
            <span className={md || bar ? "text-base" : "text-sm"}>🙂</span>
            <span>React</span>
          </>
        )}
      </button>

      {open ? (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setOpen(false);
            }}
          />
          <div
            className={`absolute bottom-full z-50 mb-1 flex gap-0.5 border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900 ${
              bar ? "left-1/2 -translate-x-1/2" : "left-0"
            }`}
          >
            {REACTIONS.map((r) => (
              <button
                key={r.kind}
                type="button"
                title={r.label}
                aria-label={r.label}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  void pick(r.kind);
                }}
                className={`flex h-8 w-8 items-center justify-center text-lg transition hover:scale-125 ${
                  value === r.kind ? "bg-slate-100 dark:bg-slate-800" : ""
                }`}
              >
                {r.emoji}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
