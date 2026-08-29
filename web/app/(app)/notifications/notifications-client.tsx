"use client";

import { Avatar } from "@/components/avatar";
import { useAuth } from "@/components/auth-provider";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { relativeTime } from "@/lib/time";
import type {
  ConversationItem,
  ConversationList,
  NotificationItem,
  NotificationKind,
  NotificationList,
} from "@/lib/types";
import { useAwayRefresh } from "@/lib/use-away-refresh";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

/**
 * One inbox for everything that involves the viewer: replies to threads they
 * are part of, plus the directed alerts (mentions, reactions, friend requests)
 * the notifications table records. The two come from separate endpoints and are
 * interleaved by recency here — a thread row stands for every reply since the
 * viewer last read it, so a busy thread stays one line instead of many.
 */
type ActivityRow =
  | { readonly type: "thread"; readonly at: number; readonly thread: ConversationItem }
  | { readonly type: "alert"; readonly at: number; readonly alert: NotificationItem };

function rowKey(row: ActivityRow): string {
  return row.type === "thread" ? `thread:${row.thread.post_id}` : `alert:${row.alert.id}`;
}

function timestamp(iso: string): number {
  const ms: number = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

function mergeActivity(
  alerts: NotificationList | null,
  conversations: ConversationList | null,
): ActivityRow[] {
  const rows: ActivityRow[] = [
    ...(conversations?.items ?? []).map(
      (thread): ActivityRow => ({
        type: "thread",
        at: timestamp(thread.latest_reply_at),
        thread,
      }),
    ),
    ...(alerts?.items ?? []).map(
      (alert): ActivityRow => ({
        type: "alert",
        at: timestamp(alert.created_at),
        alert,
      }),
    ),
  ];
  return rows.sort((a, b) => b.at - a.at);
}

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
    case "friend_connected":
      return "is now your friend";
    default:
      return "notified you";
  }
}

function hrefFor(item: NotificationItem): string {
  if (
    item.kind === "friend_request" ||
    item.kind === "friend_accepted" ||
    item.kind === "friend_connected"
  ) {
    return "/friends";
  }
  if (item.post_id) {
    // `comment_id` is always a comment on `post_id`, so anchor straight to it.
    return item.comment_id
      ? `/post/${item.post_id}?comment=${item.comment_id}`
      : `/post/${item.post_id}`;
  }
  return "/";
}

const ROW_CLASS: string =
  "flex gap-3 py-4 transition hover:bg-zinc-50 dark:hover:bg-zinc-900/50";
const UNREAD_CLASS: string = "bg-zinc-100/60 dark:bg-zinc-900/40";

export function NotificationsClient() {
  const { session, loading: authLoading } = useAuth();
  const { notify } = useToast();
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [initiallyUnread, setInitiallyUnread] = useState<Set<string>>(
    () => new Set(),
  );
  const [loaded, setLoaded] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [alerts, conversations] = await Promise.all([
        api.getNotifications(),
        api.getConversations(),
      ]);
      const unreadIds: Set<string> = new Set(
        alerts.items.filter((n) => n.read_at === null).map((n) => n.id),
      );
      setInitiallyUnread(unreadIds);
      setRows(mergeActivity(alerts, conversations));
      setLoaded(true);
      if (alerts.unread_count > 0) {
        await api.markNotificationsRead();
        // Keep local rows; badge clears via nav poll. Preserve highlight via
        // initiallyUnread for this visit. Thread rows clear their own unread
        // counts when the viewer opens the thread.
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
      setRows([]);
      setLoaded(false);
      return;
    }
    void load();
  }, [authLoading, session, load]);

  // Alerts and replies that arrived while the user was away should be waiting
  // for them.
  useAwayRefresh(() => {
    if (!session) return;
    void load();
  });

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
        <Link href="/signin" className="font-semibold text-zinc-900 underline dark:text-zinc-100">
          Sign in
        </Link>{" "}
        to see your alerts.
      </div>
    );
  }

  if (!loaded || rows.length === 0) {
    return (
      <div className="mx-auto max-w-2xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">
        No alerts yet. Replies, mentions, reactions, and friend requests show up
        here.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 font-serif text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Alerts
      </h1>
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {rows.map((row) => (
          <li key={rowKey(row)}>
            {row.type === "thread" ? (
              <ThreadRow item={row.thread} />
            ) : (
              <AlertRow
                item={row.alert}
                wasUnread={initiallyUnread.has(row.alert.id)}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ThreadRow({ item }: { item: ConversationItem }) {
  const previewAuthor: string =
    item.latest_reply_author_name ?? item.author_name;
  const previewImage: string | null =
    item.latest_reply_author_image_url ?? item.author_image_url;
  const snippet: string =
    item.latest_reply_text?.trim() || "joined the conversation";
  const unread: boolean = item.unread_count > 0;

  return (
    <Link
      href={`/post/${item.post_id}?focus=unread`}
      scroll={false}
      className={`${ROW_CLASS} ${unread ? UNREAD_CLASS : ""}`}
    >
      <Avatar name={previewAuthor} imageUrl={previewImage} size="lg" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="line-clamp-2 font-serif text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {item.full_headline}
          </p>
          {unread ? (
            <span className="shrink-0 rounded-[9999px] bg-zinc-900 px-2 py-0.5 text-[10px] font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">
              {item.unread_count} new
            </span>
          ) : null}
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-300">
          <span className="font-medium text-zinc-800 dark:text-zinc-200">
            {previewAuthor}
          </span>
          {": "}
          {snippet}
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          {relativeTime(item.latest_reply_at)}
          {item.source_name ? ` · ${item.source_name}` : ""}
          {` · ${item.reply_count} ${item.reply_count === 1 ? "reply" : "replies"}`}
        </p>
      </div>
    </Link>
  );
}

function AlertRow({
  item,
  wasUnread,
}: {
  item: NotificationItem;
  wasUnread: boolean;
}) {
  return (
    <Link
      href={hrefFor(item)}
      scroll={false}
      className={`${ROW_CLASS} ${wasUnread ? UNREAD_CLASS : ""}`}
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
  );
}
