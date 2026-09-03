"use client";

import { ModalShell } from "@/components/modal-shell";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import type { UUID } from "@/lib/types";
import { useState } from "react";

/**
 * Flags someone else's post for a content violation. The reason is optional —
 * the report is worth sending either way — but it is the only context a
 * moderator gets, so the field is the body of the modal rather than an
 * afterthought.
 */
export function ReportPostModal({
  postId,
  authorName,
  onClose,
}: {
  postId: UUID;
  authorName: string;
  onClose: () => void;
}) {
  const { notify } = useToast();
  const [reason, setReason] = useState<string>("");
  const [sending, setSending] = useState<boolean>(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    try {
      await api.reportPost(postId, reason.trim() || null);
      notify("Report sent to the moderators", "success");
      onClose();
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Could not send the report",
        "error",
      );
      setSending(false);
    }
  }

  return (
    <ModalShell onClose={onClose} label="Report this post" padded={false}>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-200 p-5 pb-4 dark:border-zinc-800">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
              Content violation
            </p>
            <h2 className="mt-1 font-serif text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              Report this post
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-700"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
            {authorName}&apos;s post will be sent to the moderators right away,
            along with whatever you tell them here.
          </p>
          <label className="mt-4 flex flex-col gap-1">
            <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              What&apos;s wrong with it? (optional)
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              maxLength={2000}
              autoFocus
              placeholder="Harassment, spam, something else…"
              className="w-full resize-y border border-zinc-300 bg-white p-2 text-sm leading-relaxed outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-zinc-200 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] dark:border-zinc-800 sm:pb-5">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={sending}
            className="bg-red-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
          >
            {sending ? "Sending…" : "Report post"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
