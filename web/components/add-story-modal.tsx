"use client";

import { useAuthGate } from "@/components/auth-gate";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import type { Story, StoryKind } from "@/lib/types";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface AddStoryModalProps {
  onClose: () => void;
  onAdded?: (story: Story) => void;
}

export function AddStoryModal({ onClose, onAdded }: AddStoryModalProps) {
  const { notify } = useToast();
  const { requireAuth } = useAuthGate();
  const [url, setUrl] = useState<string>("");
  const [kind, setKind] = useState<StoryKind>("news");
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!requireAuth("add stories")) return;
    const trimmed: string = url.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const story: Story = await api.addStory(trimmed, kind);
      notify("Story added and marked read", "success");
      onAdded?.(story);
      onClose();
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Failed to add story",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-24"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
            Add a story
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            ✕
          </button>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Article URL
            </span>
            <input
              type="url"
              required
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/article"
              className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Type
            </span>
            <div className="flex">
              {(["news", "analysis"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`flex-1 border px-3 py-2 text-sm font-medium capitalize transition ${
                    kind === k
                      ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                      : "border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  } ${k === "analysis" ? "-ml-px" : ""}`}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs text-slate-400 dark:text-slate-500">
            We&apos;ll fetch and parse the page later. For now it&apos;s added
            and marked as read for you.
          </p>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !url.trim()}
              className="bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
            >
              {saving ? "Adding…" : "Add story"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
