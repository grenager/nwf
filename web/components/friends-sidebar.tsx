"use client";

import { useAuth } from "@/components/auth-provider";
import { useAuthGate } from "@/components/auth-gate";
import { FriendProfileModal } from "@/components/friend-profile-modal";
import { UserListSkeleton } from "@/components/skeleton";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { relativeTime } from "@/lib/time";
import type {
  FriendSummary,
  InvitationCreateResult,
  RecommendedFriend,
  UUID,
} from "@/lib/types";
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
  const subtitle: string = friend.last_activity
    ? friend.last_activity
    : "No activity yet";
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
  const [incomingCount, setIncomingCount] = useState<number>(0);
  const [recommended, setRecommended] = useState<RecommendedFriend[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [openId, setOpenId] = useState<UUID | null>(null);

  const [inviting, setInviting] = useState<boolean>(false);
  const [email, setEmail] = useState<string>("");
  const [sending, setSending] = useState<boolean>(false);
  const [lastInvite, setLastInvite] = useState<InvitationCreateResult | null>(
    null,
  );
  const [copied, setCopied] = useState<boolean>(false);

  const isGuest: boolean = !session;

  const load = useCallback(async (): Promise<void> => {
    if (isGuest) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [data, requests, recs] = await Promise.all([
        api.getFriends(),
        api.getConnectionRequests(),
        api.getRecommendedFriends(),
      ]);
      setFriends(data.friends);
      setTotal(data.total);
      setOnline(data.online);
      setIncomingCount(requests.incoming.length);
      setRecommended(recs.slice(0, 3));
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
    setLastInvite(null);
    setCopied(false);
  }

  async function sendInvite(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!requireAuth("invite friends")) return;
    const value: string = email.trim();
    if (!value || sending) return;
    setSending(true);
    setCopied(false);
    try {
      const result = await api.createInvitation({ email: value });
      setLastInvite(result);
      notify(result.message, "success");
      if (result.status === "invited") {
        // Keep form open so they can copy the link.
      } else {
        setEmail("");
        setInviting(false);
        void load();
      }
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Failed to send invite",
        "error",
      );
    } finally {
      setSending(false);
    }
  }

  async function copyInvite(): Promise<void> {
    if (!lastInvite?.invite_url) return;
    try {
      await navigator.clipboard.writeText(
        lastInvite.share_message || lastInvite.invite_url,
      );
      setCopied(true);
      notify("Invitation copied", "success");
    } catch {
      notify("Could not copy", "error");
    }
  }

  async function addRecommended(userId: UUID): Promise<void> {
    try {
      await api.createConnection(userId);
      notify("Friend request sent", "success");
      void load();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Failed to add", "error");
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

      {incomingCount > 0 ? (
        <Link
          href="/friends"
          className="mt-3 flex items-center justify-between border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm dark:border-emerald-900 dark:bg-emerald-950/40"
        >
          <span className="font-semibold text-emerald-800 dark:text-emerald-300">
            {incomingCount === 1
              ? "1 friend request"
              : `${incomingCount} friend requests`}
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-emerald-700 dark:text-emerald-400">
            View
          </span>
        </Link>
      ) : null}

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
          {lastInvite?.invite_url ? (
            <div className="mt-3 space-y-1.5">
              <p className="text-xs text-zinc-500">
                {lastInvite.email_sent
                  ? "Email sent. Copy a shareable link too:"
                  : "Copy this link to share:"}
              </p>
              <button
                type="button"
                onClick={() => void copyInvite()}
                className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-400"
              >
                {copied ? "Copied!" : "Copy invite"}
              </button>
            </div>
          ) : null}
        </form>
      ) : null}

      {loading ? (
        <UserListSkeleton />
      ) : friends.length === 0 ? (
        <p className="py-4 text-sm text-zinc-400">
          No friends yet. Invite someone by email to compare coverage.
        </p>
      ) : (
        <div className="max-h-[50vh] divide-y divide-zinc-200 overflow-y-auto dark:divide-zinc-800">
          {friends.map((friend) => (
            <FriendRow key={friend.user_id} friend={friend} onOpen={setOpenId} />
          ))}
        </div>
      )}

      {!loading && recommended.length > 0 ? (
        <div className="mt-6 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <div className="mb-2 flex items-end justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-400">
              Recommended
            </h3>
            <Link
              href="/friends"
              className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              See all
            </Link>
          </div>
          <ul className="space-y-2">
            {recommended.map((rec) => (
              <li
                key={rec.user_id}
                className="flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                    {rec.display_name}
                  </p>
                  <p className="text-[11px] text-zinc-400">
                    {rec.mutual_count} mutual
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void addRecommended(rec.user_id)}
                  className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-900 dark:text-zinc-100"
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {openId ? (
        <FriendProfileModal friendId={openId} onClose={() => setOpenId(null)} />
      ) : null}
    </div>
  );
}
