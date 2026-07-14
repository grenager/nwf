"use client";

import { useAuth } from "@/components/auth-provider";
import { UserListSkeleton } from "@/components/skeleton";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import type { Connection } from "@/lib/types";
import { useCallback, useEffect, useState } from "react";

export default function FriendsPage() {
  const { user } = useAuth();
  const { notify } = useToast();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [targetId, setTargetId] = useState<string>("");

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setConnections(await api.listConnections());
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Failed to load friends", "error");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  async function sendRequest(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!targetId.trim()) return;
    try {
      await api.createConnection(targetId.trim());
      setTargetId("");
      notify("Request sent", "success");
      void load();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Failed to send request", "error");
    }
  }

  function otherId(c: Connection): string {
    return c.first_id === user?.id ? c.second_id : c.first_id;
  }

  async function accept(c: Connection): Promise<void> {
    try {
      await api.updateConnection(otherId(c), "accepted");
      notify("Connection accepted", "success");
      void load();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Failed", "error");
    }
  }

  async function remove(c: Connection): Promise<void> {
    try {
      await api.deleteConnection(otherId(c));
      notify("Connection removed", "info");
      void load();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Failed", "error");
    }
  }

  const incoming: Connection[] = connections.filter(
    (c) => c.status === "pending" && c.second_id === user?.id,
  );
  const outgoing: Connection[] = connections.filter(
    (c) => c.status === "pending" && c.first_id === user?.id,
  );
  const accepted: Connection[] = connections.filter((c) => c.status === "accepted");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Friends</h1>
        <form onSubmit={sendRequest} className="mt-4 flex gap-2">
          <input
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            placeholder="Friend's user ID (UUID)"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-800"
          />
          <button
            type="submit"
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Add friend
          </button>
        </form>
        <p className="mt-1 text-xs text-slate-400">
          Your ID: <code>{user?.id}</code>
        </p>
      </div>

      {loading ? (
        <UserListSkeleton count={4} />
      ) : (
        <>
          <ConnectionSection
            title="Incoming requests"
            items={incoming}
            otherId={otherId}
            actionLabel="Accept"
            onAction={accept}
            onRemove={remove}
          />
          <ConnectionSection
            title="Sent requests"
            items={outgoing}
            otherId={otherId}
            onRemove={remove}
          />
          <ConnectionSection
            title="Friends"
            items={accepted}
            otherId={otherId}
            onRemove={remove}
          />
        </>
      )}
    </div>
  );
}

interface SectionProps {
  title: string;
  items: Connection[];
  otherId: (c: Connection) => string;
  actionLabel?: string;
  onAction?: (c: Connection) => void;
  onRemove: (c: Connection) => void;
}

function ConnectionSection({
  title,
  items,
  otherId,
  actionLabel,
  onAction,
  onRemove,
}: SectionProps) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
        {title} ({items.length})
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400">None</p>
      ) : (
        <ul className="space-y-2">
          {items.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
            >
              <code className="truncate text-xs text-slate-500">{otherId(c)}</code>
              <div className="flex gap-2">
                {actionLabel && onAction ? (
                  <button
                    onClick={() => onAction(c)}
                    className="bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
                  >
                    {actionLabel}
                  </button>
                ) : null}
                <button
                  onClick={() => onRemove(c)}
                  className="rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
