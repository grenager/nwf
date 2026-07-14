"use client";

import { useAuth } from "@/components/auth-provider";
import { useAuthGate } from "@/components/auth-gate";
import { FriendProfileModal } from "@/components/friend-profile-modal";
import { UserListSkeleton } from "@/components/skeleton";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { relativeTime } from "@/lib/time";
import type { FriendSummary, UUID } from "@/lib/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

function FriendAvatar({ friend }: { friend: FriendSummary }) {
  return (
    <span className="relative shrink-0">
      {friend.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={friend.image_url}
          alt=""
          className="h-9 w-9 rounded-[9999px] object-cover"
        />
      ) : (
        <span className="flex h-9 w-9 items-center justify-center rounded-[9999px] bg-slate-200 text-sm font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-200">
          {friend.display_name.charAt(0).toUpperCase()}
        </span>
      )}
      {friend.online ? (
        <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-[9999px] border-2 border-white bg-emerald-500 dark:border-slate-900" />
      ) : null}
    </span>
  );
}

function FriendRow({
  friend,
  onOpen,
}: {
  friend: FriendSummary;
  onOpen: (id: UUID) => void;
}) {
  const subtitle: string = friend.last_source_name
    ? friend.last_source_name
    : "No reading yet";
  const meta: string = friend.online
    ? "Online"
    : friend.last_active_at
      ? relativeTime(friend.last_active_at)
      : "";

  return (
    <button
      type="button"
      onClick={() => onOpen(friend.user_id)}
      className="flex w-full items-center gap-3 py-2.5 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-900"
    >
      <FriendAvatar friend={friend} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
            {friend.display_name}
          </span>
          {meta ? (
            <span
              className={`shrink-0 text-[11px] ${
                friend.online
                  ? "font-semibold text-emerald-600 dark:text-emerald-400"
                  : "text-slate-400"
              }`}
            >
              {meta}
            </span>
          ) : null}
        </div>
        <p className="truncate text-xs text-slate-400">{subtitle}</p>
      </div>
    </button>
  );
}

function GuestFriendsCta() {
  return (
    <div className="py-1">
      <h2 className="font-serif text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Friends
      </h2>
      <div className="mt-2 border-b-2 border-zinc-900 dark:border-zinc-100" />
      <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
        See what your friends are reading and compare coverage across outlets.
      </p>
      <p className="mt-2 text-xs text-zinc-400">
        Your friends list is empty until you sign up.
      </p>
      <Link
        href="/signin"
        className="mt-4 inline-block text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-900 underline underline-offset-4 dark:text-zinc-100"
      >
        Create free account
      </Link>
    </div>
  );
}

export function FriendsSidebar() {
  const { session } = useAuth();
  const { requireAuth } = useAuthGate();
  const { notify } = useToast();
  const [friends, setFriends] = useState<FriendSummary[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [online, setOnline] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [openId, setOpenId] = useState<UUID | null>(null);

  const [inviting, setInviting] = useState<boolean>(false);
  const [email, setEmail] = useState<string>("");
  const [sending, setSending] = useState<boolean>(false);

  const isGuest: boolean = !session;

  const load = useCallback(async (): Promise<void> => {
    if (isGuest) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await api.getFriends();
      setFriends(data.friends);
      setTotal(data.total);
      setOnline(data.online);
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Failed to load friends",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [isGuest, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  function startInvite(): void {
    if (!requireAuth("invite friends")) return;
    setInviting((v) => !v);
  }

  async function sendInvite(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!requireAuth("invite friends")) return;
    const value: string = email.trim();
    if (!value || sending) return;
    setSending(true);
    try {
      const result = await api.inviteFriend(value);
      notify(result.message, "success");
      setEmail("");
      setInviting(false);
      void load();
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Failed to send invite",
        "error",
      );
    } finally {
      setSending(false);
    }
  }

  if (isGuest) {
    return <GuestFriendsCta />;
  }

  return (
    <div>
      <div className="flex items-end justify-between gap-3 border-b-2 border-zinc-900 pb-2 dark:border-zinc-100">
        <div>
          <h2 className="font-serif text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Friends
          </h2>
          <p className="mt-0.5 text-[11px] uppercase tracking-[0.08em] text-zinc-400">
            {online > 0 ? `${online} online · ` : ""}
            {total} total
          </p>
        </div>
        <button
          onClick={startInvite}
          className="pb-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          {inviting ? "Cancel" : "Invite"}
        </button>
      </div>

      {inviting ? (
        <form
          onSubmit={sendInvite}
          className="border-b border-zinc-200 py-3 dark:border-zinc-800"
        >
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="friend@email.com"
            autoFocus
            className="w-full border-b border-zinc-300 bg-transparent px-0 py-1.5 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:text-zinc-100 dark:focus:border-zinc-100"
          />
          <button
            type="submit"
            disabled={sending || email.trim().length === 0}
            className="mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-900 disabled:opacity-40 dark:text-zinc-100"
          >
            {sending ? "Sending…" : "Send invite"}
          </button>
        </form>
      ) : null}

      {loading ? (
        <UserListSkeleton />
      ) : friends.length === 0 ? (
        <p className="py-4 text-sm text-zinc-400">
          No friends yet. Invite someone by email to compare coverage.
        </p>
      ) : (
        <div className="max-h-[70vh] divide-y divide-zinc-200 overflow-y-auto dark:divide-zinc-800">
          {friends.map((friend) => (
            <FriendRow key={friend.user_id} friend={friend} onOpen={setOpenId} />
          ))}
        </div>
      )}

      {openId ? (
        <FriendProfileModal friendId={openId} onClose={() => setOpenId(null)} />
      ) : null}
    </div>
  );
}
