"use client";

import { useAuth } from "@/components/auth-provider";
import { useAuthGate } from "@/components/auth-gate";
import { FriendProfileModal } from "@/components/friend-profile-modal";
import { UserListSkeleton } from "@/components/skeleton";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { mutualLabel } from "@/lib/people";
import { shareInviteLink } from "@/lib/invite-share";
import { relativeTime } from "@/lib/time";
import type {
  FriendRequest,
  FriendSummary,
  RecommendedFriend,
  UUID,
} from "@/lib/types";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";


function SidebarAvatar({
  name,
  imageUrl,
}: {
  name: string;
  imageUrl: string | null;
}) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt=""
        className="h-7 w-7 shrink-0 rounded-[9999px] object-cover"
      />
    );
  }
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9999px] bg-zinc-200 text-xs font-bold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-200">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

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
  const [discussingCount, setDiscussingCount] = useState<number | null>(null);

  useEffect(() => {
    void api
      .getCommunityStats()
      .then((stats) => {
        if (stats.discussing_count > 0) {
          setDiscussingCount(stats.discussing_count);
        }
      })
      .catch(() => undefined);
  }, []);

  return (
    <div className="py-1">
      <h2 className="font-serif text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Friends
      </h2>
      <div className="mt-2 border-b-2 border-zinc-900 dark:border-zinc-100" />
      <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
        See what your friends are reading and compare coverage across outlets.
      </p>
      {discussingCount !== null ? (
        <p className="mt-3 text-sm font-medium text-zinc-700 dark:text-zinc-200">
          {discussingCount.toLocaleString()}{" "}
          {discussingCount === 1 ? "person" : "people"} discussing articles with
          their friends.
        </p>
      ) : null}
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
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [recommended, setRecommended] = useState<RecommendedFriend[]>([]);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<UUID>>(
    () => new Set<UUID>(),
  );
  const pendingRef = useRef<Set<UUID>>(new Set());
  const [loading, setLoading] = useState<boolean>(true);
  const [openId, setOpenId] = useState<UUID | null>(null);

  const [inviting, setInviting] = useState<boolean>(false);

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
      setIncoming(requests.incoming);
      setRecommended(recs.slice(0, 5));
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

  function beginPending(userId: UUID): boolean {
    if (pendingRef.current.has(userId)) return false;
    const next: Set<UUID> = new Set(pendingRef.current);
    next.add(userId);
    pendingRef.current = next;
    setPendingIds(next);
    return true;
  }

  function endPending(userId: UUID): void {
    const next: Set<UUID> = new Set(pendingRef.current);
    next.delete(userId);
    pendingRef.current = next;
    setPendingIds(next);
  }

  async function startInvite(): Promise<void> {
    if (!requireAuth("invite friends")) return;
    if (inviting) return;
    setInviting(true);
    try {
      const created = await api.createInvitation({ become_friend: true });
      const url: string = created.invite_url ?? "";
      if (!url) {
        notify(created.message, "success");
        return;
      }
      const outcome = await shareInviteLink(created);
      if (outcome === "copied") notify("Invite link copied", "success");
      if (outcome === "failed") notify("Could not copy the invite link", "error");
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Could not create an invite",
        "error",
      );
    } finally {
      setInviting(false);
    }
  }

  async function acceptInvitation(userId: UUID): Promise<void> {
    if (!beginPending(userId)) return;
    try {
      await api.updateConnection(userId, "accepted");
      notify("Friend added", "success");
      void load();
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Failed to accept",
        "error",
      );
    } finally {
      endPending(userId);
    }
  }

  async function ignoreInvitation(userId: UUID): Promise<void> {
    if (!beginPending(userId)) return;
    try {
      await api.deleteConnection(userId);
      notify("Request ignored", "info");
      void load();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Failed", "error");
    } finally {
      endPending(userId);
    }
  }

  async function connect(userId: UUID): Promise<void> {
    if (!beginPending(userId)) return;
    try {
      await api.createConnection(userId);
      notify("Friend request sent", "success");
      void load();
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Failed to add",
        "error",
      );
    } finally {
      endPending(userId);
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
          onClick={() => void startInvite()}
          disabled={inviting}
          className="pb-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500 hover:text-zinc-900 disabled:opacity-40 dark:hover:text-zinc-100"
        >
          {inviting ? "Inviting…" : "Invite"}
        </button>
      </div>

      {loading ? (
        <UserListSkeleton />
      ) : friends.length === 0 ? (
        <p className="py-4 text-sm text-zinc-400">
          No friends yet. Invite someone to compare coverage.
        </p>
      ) : (
        // No height cap or inner scroller here: the <aside> in (app)/layout.tsx
        // is the sidebar's single full-height scroll area, so the list runs to
        // the bottom of the screen instead of stopping halfway down it.
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {friends.map((friend) => (
            <FriendRow key={friend.user_id} friend={friend} onOpen={setOpenId} />
          ))}
        </div>
      )}

      {!loading && incoming.length > 0 ? (
        <div className="mt-6 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <div className="mb-2 flex items-end justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-400">
              Invitations
            </h3>
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-emerald-600">
              {incoming.length} new
            </span>
          </div>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {incoming.map((req) => {
              const busy: boolean = pendingIds.has(req.user_id);
              const mutual: string = mutualLabel(req.mutual_count);
              return (
                <li
                  key={req.user_id}
                  className="flex items-center gap-2 py-2.5"
                >
                  <button
                    type="button"
                    onClick={() => setOpenId(req.user_id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <SidebarAvatar
                      name={req.display_name}
                      imageUrl={req.image_url}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                        {req.display_name}
                      </p>
                      {mutual ? (
                        <p className="truncate text-[11px] text-zinc-400">
                          {mutual}
                        </p>
                      ) : null}
                    </div>
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void acceptInvitation(req.user_id)}
                    className="shrink-0 bg-zinc-900 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void ignoreInvitation(req.user_id)}
                    className="shrink-0 px-1 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-400 hover:text-zinc-700 disabled:opacity-40"
                  >
                    Ignore
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {!loading && recommended.length > 0 ? (
        <div className="mt-6 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <div className="mb-2 flex items-end justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-400">
              People you may know
            </h3>
            <Link
              href="/friends"
              className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              See all
            </Link>
          </div>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {recommended.map((rec) => {
              const busy: boolean = pendingIds.has(rec.user_id);
              const mutual: string = mutualLabel(rec.mutual_count);
              return (
                <li
                  key={rec.user_id}
                  className="flex items-center gap-2 py-2.5"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <SidebarAvatar
                      name={rec.display_name}
                      imageUrl={rec.image_url}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
                        {rec.display_name}
                      </p>
                      {mutual ? (
                        <p className="truncate text-[11px] text-zinc-400">
                          {mutual}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void connect(rec.user_id)}
                    className="shrink-0 border border-zinc-300 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                  >
                    Connect
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {openId ? (
        <FriendProfileModal
          friendId={openId}
          onClose={() => setOpenId(null)}
          onUpdated={load}
        />
      ) : null}
    </div>
  );
}
