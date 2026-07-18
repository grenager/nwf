"use client";

import { Avatar } from "@/components/post-thread";
import { useAuth } from "@/components/auth-provider";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { relativeTime } from "@/lib/time";
import type { NotificationItem, NotificationKind, NotificationList } from "@/lib/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

function actionText(kind: NotificationKind): string {
  switch (kind) {
    case "mention":
      return "mentioned you";
    case "post_reaction":
      return "reacted to your post";
    case "comment_reaction":
      return "reacted to your comment";
    case "friend_request":
      return "sent you a friend request";
    case "friend_accepted":
      return "accepted your friend request";
    default:
      return "notified you";
  }
}

function hrefFor(item: NotificationItem): string {
  if (
    item.kind === "friend_request" ||
    item.kind === "friend_accepted"
  ) {
    return "/friends";
  }
  if (item.post_id) return `/post/${item.post_id}`;
  return "/";
}

export function NotificationsClient() {
  const { session, loading: authLoading } = useAuth();
  const { notify } = useToast();
  const [data, setData] = useState<NotificationList | null>(null);
  const [initiallyUnread, setInitiallyUnread] = useState<Set<string>>(
    () => new Set(),
  );
  const [loading, setLoading] = useState<boolean>(true);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const payload: NotificationList = await api.getNotifications();
      const unreadIds: Set<string> = new Set(
        payload.items.filter((n) => n.read_at === null).map((n) => n.id),
      );
      setInitiallyUnread(unreadIds);
      setData(payload);
      if (payload.unread_count > 0) {
        await api.markNotificationsRead();
        // Keep local rows; badge clears via nav poll. Preserve highlight via
        // initiallyUnread for this visit.
      }
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Failed to load alerts",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    if (authLoading) return;
    if (!session) {
      setLoading(false);
      setData(null);
      return;
    }
    void load();
  }, [authLoading, session, load]);

  if (authLoading || loading) {
    return (
      <div className="mx-auto max-w-2xl space-y-3 py-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900"
          />
        ))}
      </div>
    );
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-2xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">
        <Link href="/signin" className="font-semibold text-brand-600 underline">
          Sign in
        </Link>{" "}
        to see your alerts.
      </div>
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">
        No alerts yet. Mentions, reactions, and friend requests show up here.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 font-serif text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Alerts
      </h1>
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {data.items.map((item) => {
          const wasUnread: boolean = initiallyUnread.has(item.id);
          return (
            <li key={item.id}>
              <Link
                href={hrefFor(item)}
                scroll={false}
                className={`flex gap-3 py-4 transition hover:bg-zinc-50 dark:hover:bg-zinc-900/50 ${
                  wasUnread ? "bg-brand-50/40 dark:bg-brand-950/20" : ""
                }`}
              >
                <Avatar
                  name={item.actor_name}
                  imageUrl={item.actor_image_url}
                  size="lg"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-zinc-800 dark:text-zinc-200">
                    <span className="font-semibold">{item.actor_name}</span>{" "}
                    {actionText(item.kind)}
                    {item.full_headline ? (
                      <>
                        {" "}
                        on{" "}
                        <span className="font-medium text-zinc-900 dark:text-zinc-50">
                          {item.full_headline}
                        </span>
                      </>
                    ) : null}
                  </p>
                  {item.comment_snippet ? (
                    <p className="mt-1 line-clamp-2 text-sm text-zinc-500">
                      {item.comment_snippet}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-zinc-400">
                    {relativeTime(item.created_at)}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
