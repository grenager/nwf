"use client";

import { useAuth } from "@/components/auth-provider";
import { FriendProfileModal } from "@/components/friend-profile-modal";
import { UserListSkeleton } from "@/components/skeleton";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { relativeTime } from "@/lib/time";
import type { AdminFriendRef, AdminUser, UUID } from "@/lib/types";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

function displayName(user: AdminUser): string {
  if (user.first && user.last) return `${user.first} ${user.last}`;
  if (user.first) return user.first;
  return user.email ?? "User";
}

function FriendPill({
  friend,
  onRemove,
  busy,
}: {
  friend: AdminFriendRef;
  onRemove: () => void;
  busy: boolean;
}) {
  return (
    <span className="group relative inline-flex items-center gap-1 border border-zinc-300 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
      <span>{friend.display_name}</span>
      <button
        type="button"
        aria-label={`Remove ${friend.display_name}`}
        disabled={busy}
        onClick={onRemove}
        className="ml-0.5 inline-flex h-4 w-4 items-center justify-center text-zinc-400 opacity-0 transition hover:text-zinc-800 group-hover:opacity-100 disabled:opacity-40 dark:hover:text-zinc-100"
      >
        ×
      </button>
    </span>
  );
}

function AddFriendControl({
  userId,
  candidates,
  onAdd,
  busy,
}: {
  userId: UUID;
  candidates: AdminUser[];
  onAdd: (friendId: UUID) => Promise<void>;
  busy: boolean;
}) {
  const [open, setOpen] = useState<boolean>(false);
  const [query, setQuery] = useState<string>("");
  const containerRef: RefObject<HTMLDivElement | null> = useRef(null);
  const inputRef: RefObject<HTMLInputElement | null> = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent): void {
      const el: HTMLDivElement | null = containerRef.current;
      if (el && !el.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const filtered: AdminUser[] = useMemo(() => {
    const q: string = query.trim().toLowerCase();
    if (!q) return candidates.slice(0, 20);
    return candidates
      .filter((u) => {
        const name: string = displayName(u).toLowerCase();
        const email: string = (u.email ?? "").toLowerCase();
        return name.includes(q) || email.includes(q);
      })
      .slice(0, 20);
  }, [candidates, query]);

  async function pick(friendId: UUID): Promise<void> {
    await onAdd(friendId);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center border border-dashed border-zinc-400 px-2 py-0.5 text-xs font-medium text-zinc-600 hover:border-zinc-600 hover:text-zinc-900 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-300 dark:hover:border-zinc-400 dark:hover:text-zinc-50"
      >
        + friend
      </button>
      {open ? (
        <div className="absolute left-0 z-20 mt-1 w-64 border border-zinc-300 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-950">
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or email…"
            className="w-full border-b border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
          />
          <ul className="max-h-48 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-zinc-500">No matches</li>
            ) : (
              filtered.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    disabled={busy || u.id === userId}
                    onClick={() => void pick(u.id)}
                    className="flex w-full flex-col px-3 py-1.5 text-left hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-900"
                  >
                    <span className="text-sm text-zinc-900 dark:text-zinc-50">
                      {displayName(u)}
                    </span>
                    {u.email ? (
                      <span className="text-xs text-zinc-500">{u.email}</span>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default function AdminPage() {
  const { session } = useAuth();
  const { notify } = useToast();

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [editUserId, setEditUserId] = useState<UUID | null>(null);
  const [newEmail, setNewEmail] = useState<string>("");
  const [newFirst, setNewFirst] = useState<string>("");
  const [newLast, setNewLast] = useState<string>("");
  const [creatingUser, setCreatingUser] = useState<boolean>(false);

  const load = useCallback(
    async (opts?: { quiet?: boolean }): Promise<void> => {
      if (!session) {
        setLoading(false);
        setIsAdmin(null);
        return;
      }
      const quiet: boolean = opts?.quiet === true;
      if (!quiet) setLoading(true);
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
        if (!quiet) setLoading(false);
      }
    },
    [notify, session],
  );

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

  async function addFriend(userId: UUID, friendId: UUID): Promise<void> {
    const key = `${userId}:${friendId}:add`;
    setBusyKey(key);
    try {
      await api.createFriendship(userId, friendId);
      notify("Friendship created", "success");
      await load({ quiet: true });
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Failed to create friendship",
        "error",
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function removeFriend(userId: UUID, friendId: UUID): Promise<void> {
    const key = `${userId}:${friendId}:remove`;
    setBusyKey(key);
    try {
      await api.deleteFriendship(userId, friendId);
      notify("Friendship removed", "info");
      await load({ quiet: true });
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Failed to remove friendship",
        "error",
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function createUser(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const email: string = newEmail.trim();
    if (!email || creatingUser) return;
    setCreatingUser(true);
    try {
      const created = await api.createAdminUser({
        email,
        first: newFirst.trim() || null,
        last: newLast.trim() || null,
      });
      notify(
        `Created ${displayName(created)} — they can claim via magic link at /signin`,
        "success",
      );
      setNewEmail("");
      setNewFirst("");
      setNewLast("");
      await load({ quiet: true });
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Failed to create user",
        "error",
      );
    } finally {
      setCreatingUser(false);
    }
  }

  async function deleteUser(user: AdminUser): Promise<void> {
    const name: string = displayName(user);
    const emailBit: string = user.email ? ` (${user.email})` : "";
    const confirmed: boolean = window.confirm(
      `Delete ${name}${emailBit}?\n\nThis permanently removes their account and cannot be undone.`,
    );
    if (!confirmed) return;
    const key = `${user.id}:delete`;
    setBusyKey(key);
    try {
      await api.deleteAdminUser(user.id);
      notify(`Deleted ${name}`, "info");
      if (editUserId === user.id) setEditUserId(null);
      await load({ quiet: true });
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Failed to delete user",
        "error",
      );
    } finally {
      setBusyKey(null);
    }
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Admin
        </h1>
        <p className="mt-3 text-sm text-zinc-500">Sign in to continue.</p>
      </div>
    );
  }

  if (loading && isAdmin === null) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
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
      <div className="mx-auto max-w-4xl px-4 py-10">
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
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Admin
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          View users, seed friendships, and pre-create accounts.
        </p>
      </div>

      <section>
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
          Create user
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Creates a full account. They claim it later by signing in with a magic
          link using this email.
        </p>
        <form
          onSubmit={(e) => void createUser(e)}
          className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
        >
          <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-sm">
            <span className="text-zinc-500">Email</span>
            <input
              type="email"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="friend@example.com"
              className="border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
            />
          </label>
          <label className="flex min-w-[8rem] flex-1 flex-col gap-1 text-sm">
            <span className="text-zinc-500">First</span>
            <input
              type="text"
              value={newFirst}
              onChange={(e) => setNewFirst(e.target.value)}
              placeholder="First"
              className="border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
            />
          </label>
          <label className="flex min-w-[8rem] flex-1 flex-col gap-1 text-sm">
            <span className="text-zinc-500">Last</span>
            <input
              type="text"
              value={newLast}
              onChange={(e) => setNewLast(e.target.value)}
              placeholder="Last"
              className="border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
            />
          </label>
          <button
            type="submit"
            disabled={creatingUser || !newEmail.trim()}
            className="bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
          >
            {creatingUser ? "Creating…" : "Create user"}
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
              const friendIds: Set<UUID> = new Set(
                user.friends.map((f) => f.user_id),
              );
              const candidates: AdminUser[] = sortedUsers.filter(
                (u) => u.id !== user.id && !friendIds.has(u.id),
              );
              const rowBusy: boolean =
                busyKey !== null && busyKey.startsWith(`${user.id}:`);
              return (
                <li key={user.id} className="py-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => setEditUserId(user.id)}
                        className="text-left text-sm font-semibold text-zinc-900 hover:underline dark:text-zinc-50"
                      >
                        {name}
                      </button>
                      <p className="text-sm text-zinc-500">
                        {user.email ?? "No email"}
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {user.last_active_at
                          ? `Active ${relativeTime(user.last_active_at)}`
                          : "Never active"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setEditUserId(user.id)}
                        className="border border-zinc-300 px-2.5 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={busyKey === `${user.id}:delete`}
                        onClick={() => void deleteUser(user)}
                        className="border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-40 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {user.friends.map((friend) => (
                      <FriendPill
                        key={friend.user_id}
                        friend={friend}
                        busy={
                          busyKey === `${user.id}:${friend.user_id}:remove`
                        }
                        onRemove={() =>
                          void removeFriend(user.id, friend.user_id)
                        }
                      />
                    ))}
                    <AddFriendControl
                      userId={user.id}
                      candidates={candidates}
                      busy={rowBusy}
                      onAdd={(friendId) => addFriend(user.id, friendId)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {editUserId ? (
        <FriendProfileModal
          friendId={editUserId}
          onClose={() => setEditUserId(null)}
          onUpdated={() => void load({ quiet: true })}
        />
      ) : null}
    </div>
  );
}
