"use client";

import { useAuth } from "@/components/auth-provider";
import { UserListSkeleton } from "@/components/skeleton";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { relativeTime } from "@/lib/time";
import type { AdminUser, UUID } from "@/lib/types";
import { useCallback, useEffect, useMemo, useState } from "react";

function displayName(user: AdminUser): string {
  if (user.first && user.last) return `${user.first} ${user.last}`;
  if (user.first) return user.first;
  return user.email ?? "User";
}

export default function AdminPage() {
  const { session } = useAuth();
  const { notify } = useToast();

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [userA, setUserA] = useState<UUID>("");
  const [userB, setUserB] = useState<UUID>("");
  const [creating, setCreating] = useState<boolean>(false);

  const load = useCallback(async (): Promise<void> => {
    if (!session) {
      setLoading(false);
      setIsAdmin(null);
      return;
    }
    setLoading(true);
    try {
      const me = await api.getMe();
      if (!me.is_admin) {
        setIsAdmin(false);
        setUsers([]);
        return;
      }
      setIsAdmin(true);
      const list = await api.getAdminUsers();
      setUsers(list);
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Failed to load admin users",
        "error",
      );
      setIsAdmin(false);
    } finally {
      setLoading(false);
    }
  }, [notify, session]);

  useEffect(() => {
    void load();
  }, [load]);

  const sortedUsers: AdminUser[] = useMemo(() => {
    return [...users].sort((a, b) =>
      displayName(a).localeCompare(displayName(b), undefined, {
        sensitivity: "base",
      }),
    );
  }, [users]);

  async function createFriendship(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!userA || !userB || creating) return;
    if (userA === userB) {
      notify("Pick two different users", "error");
      return;
    }
    setCreating(true);
    try {
      await api.createFriendship(userA, userB);
      notify("Friendship created", "success");
      setUserA("");
      setUserB("");
      void load();
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Failed to create friendship",
        "error",
      );
    } finally {
      setCreating(false);
    }
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Admin
        </h1>
        <p className="mt-3 text-sm text-zinc-500">Sign in to continue.</p>
      </div>
    );
  }

  if (loading && isAdmin === null) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Admin
        </h1>
        <div className="mt-8">
          <UserListSkeleton />
        </div>
      </div>
    );
  }

  if (isAdmin === false) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Admin
        </h1>
        <p className="mt-3 text-sm text-zinc-500">
          You do not have admin access.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-10 px-4 py-8">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Admin
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          View users and seed friendships.
        </p>
      </div>

      <section>
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
          Create friendship
        </h2>
        <form
          onSubmit={(e) => void createFriendship(e)}
          className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-zinc-500">User A</span>
            <select
              value={userA}
              onChange={(e) => setUserA(e.target.value)}
              className="border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
              required
            >
              <option value="">Select user…</option>
              {sortedUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {displayName(u)}
                  {u.email ? ` (${u.email})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-zinc-500">User B</span>
            <select
              value={userB}
              onChange={(e) => setUserB(e.target.value)}
              className="border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
              required
            >
              <option value="">Select user…</option>
              {sortedUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {displayName(u)}
                  {u.email ? ` (${u.email})` : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={creating || !userA || !userB}
            className="bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
          >
            {creating ? "Creating…" : "Friend"}
          </button>
        </form>
      </section>

      <section>
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
          Users ({users.length})
        </h2>
        {loading ? (
          <div className="mt-3">
            <UserListSkeleton />
          </div>
        ) : users.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No users yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
            {sortedUsers.map((user) => {
              const name: string = displayName(user);
              const friendsLabel: string =
                user.friends.length === 0
                  ? "No friends"
                  : user.friends.map((f) => f.display_name).join(", ");
              return (
                <li key={user.id} className="py-4">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                        {name}
                      </p>
                      <p className="text-sm text-zinc-500">
                        {user.email ?? "No email"}
                      </p>
                    </div>
                    <p className="text-xs text-zinc-500">
                      {user.last_active_at
                        ? `Active ${relativeTime(user.last_active_at)}`
                        : "Never active"}
                    </p>
                  </div>
                  <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">
                      Friends:
                    </span>{" "}
                    {friendsLabel}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
