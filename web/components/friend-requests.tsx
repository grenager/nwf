"use client";

import { Avatar } from "@/components/avatar";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import type { FriendRequest, UUID } from "@/lib/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

function mutualLabel(count: number): string {
  return count === 1 ? "1 mutual friend" : `${count} mutual friends`;
}

/**
 * Incoming friend requests, answerable where the viewer already is. A request
 * waiting behind a tab is a request that sits unanswered, so the profile shows
 * them inline and stays silent when there are none.
 */
export function FriendRequests({ onChanged }: { onChanged?: () => void }) {
  const { notify } = useToast();
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [busy, setBusy] = useState<UUID | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const reqs = await api.getConnectionRequests();
      setIncoming(reqs.incoming);
    } catch {
      // The profile is still useful without this section.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function respond(
    userId: UUID,
    action: "accept" | "ignore",
  ): Promise<void> {
    setBusy(userId);
    // Drop the row immediately; a failure puts it back with the reload.
    setIncoming((prev) => prev.filter((r) => r.user_id !== userId));
    try {
      if (action === "accept") {
        await api.updateConnection(userId, "accepted");
        notify("Friend request accepted", "success");
      } else {
        await api.deleteConnection(userId);
      }
      // The nav badges this count; tell them to recount.
      window.dispatchEvent(new CustomEvent("nwf:connections-changed"));
      onChanged?.();
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Could not update request",
        "error",
      );
      void load();
    } finally {
      setBusy(null);
    }
  }

  if (incoming.length === 0) return null;

  return (
    <section className="border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-900 dark:text-zinc-100">
          Friend requests
        </h2>
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-emerald-600">
          {incoming.length} new
        </span>
      </div>
      <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
        {incoming.map((req) => (
          <li key={req.user_id} className="flex items-center gap-3 py-3">
            <Avatar name={req.display_name} imageUrl={req.image_url} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {req.display_name}
              </p>
              {req.mutual_count > 0 ? (
                <p className="text-xs text-zinc-400">
                  {mutualLabel(req.mutual_count)}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              disabled={busy === req.user_id}
              onClick={() => void respond(req.user_id, "accept")}
              className="bg-zinc-900 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
            >
              Accept
            </button>
            <button
              type="button"
              disabled={busy === req.user_id}
              onClick={() => void respond(req.user_id, "ignore")}
              className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-400 hover:text-zinc-700 disabled:opacity-60"
            >
              Ignore
            </button>
          </li>
        ))}
      </ul>
      <Link
        href="/friends"
        className="mt-1 inline-block text-xs font-semibold text-zinc-900 hover:underline dark:text-zinc-100"
      >
        Find and invite friends →
      </Link>
    </section>
  );
}
