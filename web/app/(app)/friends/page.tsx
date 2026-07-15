"use client";

import { useAuth } from "@/components/auth-provider";
import { useAuthGate } from "@/components/auth-gate";
import { FriendProfileModal } from "@/components/friend-profile-modal";
import { UserListSkeleton } from "@/components/skeleton";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import type {
  FriendRequest,
  FriendSummary,
  InvitationCreateResult,
  RecommendedFriend,
  UUID,
} from "@/lib/types";
import { useCallback, useEffect, useState } from "react";

function Avatar({
  name,
  imageUrl,
}: {
  name: string;
  imageUrl: string | null;
}) {
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={imageUrl}
        alt=""
        className="h-10 w-10 shrink-0 rounded-[9999px] object-cover"
      />
    );
  }
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[9999px] bg-zinc-200 text-sm font-bold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-200">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function mutualLabel(count: number): string {
  if (count <= 0) return "";
  return count === 1 ? "1 mutual friend" : `${count} mutual friends`;
}

export default function PeoplePage() {
  const { session } = useAuth();
  const { requireAuth } = useAuthGate();
  const { notify } = useToast();

  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [recommended, setRecommended] = useState<RecommendedFriend[]>([]);
  const [friends, setFriends] = useState<FriendSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [openId, setOpenId] = useState<UUID | null>(null);

  const [email, setEmail] = useState<string>("");
  const [sending, setSending] = useState<boolean>(false);
  const [lastInvite, setLastInvite] = useState<InvitationCreateResult | null>(
    null,
  );
  const [copied, setCopied] = useState<boolean>(false);

  const load = useCallback(async (): Promise<void> => {
    if (!session) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [requests, recs, overview] = await Promise.all([
        api.getConnectionRequests(),
        api.getRecommendedFriends(),
        api.getFriends(),
      ]);
      setIncoming(requests.incoming);
      setOutgoing(requests.outgoing);
      setRecommended(recs);
      setFriends(overview.friends);
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Failed to load people",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [notify, session]);

  useEffect(() => {
    void load();
  }, [load]);

  async function acceptRequest(userId: UUID): Promise<void> {
    try {
      await api.updateConnection(userId, "accepted");
      notify("Friend request accepted", "success");
      void load();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Failed to accept", "error");
    }
  }

  async function ignoreRequest(userId: UUID): Promise<void> {
    try {
      await api.deleteConnection(userId);
      notify("Request ignored", "info");
      void load();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Failed", "error");
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
      if (result.status !== "invited") {
        setEmail("");
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

  async function copyInviteLink(): Promise<void> {
    if (!lastInvite?.invite_url) return;
    try {
      await navigator.clipboard.writeText(
        lastInvite.share_message || lastInvite.invite_url,
      );
      setCopied(true);
      notify("Invitation copied", "success");
    } catch {
      notify("Could not copy — select the link manually", "error");
    }
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          People
        </h1>
        <p className="mt-3 text-sm text-zinc-500">
          Sign in to see friend requests and recommendations.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-10 px-4 py-8">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          People
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Accept requests, find friends of friends, and invite someone new.
        </p>
      </div>

      <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-zinc-400">
          Invite by email
        </h2>
        <form onSubmit={sendInvite} className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="friend@email.com"
            className="flex-1 border-b border-zinc-300 bg-transparent px-0 py-2 text-sm outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100"
          />
          <button
            type="submit"
            disabled={sending || email.trim().length === 0}
            className="bg-zinc-900 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {sending ? "Sending…" : "Send invite"}
          </button>
        </form>
        {lastInvite?.invite_url ? (
          <div className="mt-3 space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              {lastInvite.email_sent
                ? "Email sent. You can also copy a message to share:"
                : "Copy this invitation and send it yourself:"}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="flex-1 truncate rounded bg-zinc-50 px-2 py-1.5 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                {lastInvite.invite_url}
              </code>
              <button
                type="button"
                onClick={() => void copyInviteLink()}
                className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-900 dark:text-zinc-100"
              >
                {copied ? "Copied!" : "Copy invite"}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {loading ? (
        <UserListSkeleton count={5} />
      ) : (
        <>
          <section>
            <div className="mb-3 flex items-end justify-between border-b-2 border-zinc-900 pb-2 dark:border-zinc-100">
              <h2 className="font-serif text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                Friend requests
              </h2>
              {incoming.length > 0 ? (
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-emerald-600">
                  {incoming.length} new
                </span>
              ) : null}
            </div>
            {incoming.length === 0 ? (
              <p className="text-sm text-zinc-400">No pending requests.</p>
            ) : (
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {incoming.map((req) => (
                  <li
                    key={req.user_id}
                    className="flex items-center gap-3 py-3"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenId(req.user_id)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <Avatar
                        name={req.display_name}
                        imageUrl={req.image_url}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                          {req.display_name}
                        </p>
                        {req.mutual_count > 0 ? (
                          <p className="text-xs text-zinc-400">
                            {mutualLabel(req.mutual_count)}
                          </p>
                        ) : null}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => void acceptRequest(req.user_id)}
                      className="bg-zinc-900 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-white dark:bg-zinc-100 dark:text-zinc-900"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => void ignoreRequest(req.user_id)}
                      className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-400 hover:text-zinc-700"
                    >
                      Ignore
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {outgoing.length > 0 ? (
              <div className="mt-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-400">
                  Sent ({outgoing.length})
                </h3>
                <ul className="space-y-2">
                  {outgoing.map((req) => (
                    <li
                      key={req.user_id}
                      className="flex items-center justify-between gap-3 text-sm text-zinc-500"
                    >
                      <span className="truncate">{req.display_name}</span>
                      <button
                        type="button"
                        onClick={() => void ignoreRequest(req.user_id)}
                        className="text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-400 hover:text-zinc-700"
                      >
                        Cancel
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <section>
            <div className="mb-3 border-b-2 border-zinc-900 pb-2 dark:border-zinc-100">
              <h2 className="font-serif text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                Recommended
              </h2>
              <p className="mt-0.5 text-[11px] uppercase tracking-[0.08em] text-zinc-400">
                Friends of friends
              </p>
            </div>
            {recommended.length === 0 ? (
              <p className="text-sm text-zinc-400">
                No recommendations yet — invite a friend or accept a request to
                grow your circle.
              </p>
            ) : (
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {recommended.map((rec) => (
                  <li
                    key={rec.user_id}
                    className="flex items-center gap-3 py-3"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <Avatar
                        name={rec.display_name}
                        imageUrl={rec.image_url}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                          {rec.display_name}
                        </p>
                        <p className="text-xs text-zinc-400">
                          {mutualLabel(rec.mutual_count)}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void addRecommended(rec.user_id)}
                      className="border border-zinc-300 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                    >
                      Add
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <div className="mb-3 border-b-2 border-zinc-900 pb-2 dark:border-zinc-100">
              <h2 className="font-serif text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                Your friends
              </h2>
              <p className="mt-0.5 text-[11px] uppercase tracking-[0.08em] text-zinc-400">
                {friends.length} total
              </p>
            </div>
            {friends.length === 0 ? (
              <p className="text-sm text-zinc-400">
                No friends yet. Invite someone by email above.
              </p>
            ) : (
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {friends.map((friend) => (
                  <li key={friend.user_id}>
                    <button
                      type="button"
                      onClick={() => setOpenId(friend.user_id)}
                      className="flex w-full items-center gap-3 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900"
                    >
                      <Avatar
                        name={friend.display_name}
                        imageUrl={friend.image_url}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                          {friend.display_name}
                        </p>
                        <p className="truncate text-xs text-zinc-400">
                          {friend.last_activity ?? "No activity yet"}
                        </p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {openId ? (
        <FriendProfileModal friendId={openId} onClose={() => setOpenId(null)} />
      ) : null}
    </div>
  );
}
