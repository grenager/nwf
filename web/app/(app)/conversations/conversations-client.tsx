"use client";

import { Avatar } from "@/components/post-thread";
import { useAuth } from "@/components/auth-provider";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { relativeTime } from "@/lib/time";
import type { ConversationItem, ConversationList } from "@/lib/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

export function ConversationsClient() {
  const { session, loading: authLoading } = useAuth();
  const { notify } = useToast();
  const [data, setData] = useState<ConversationList | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const payload: ConversationList = await api.getConversations();
      setData(payload);
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Failed to load conversations",
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
            className="h-20 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900"
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
        to see conversations you&apos;re part of.
      </div>
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">
        No conversations yet. Reply to a post and it will show up here when
        someone responds.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 font-serif text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        Conversations
      </h1>
      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {data.items.map((item) => (
          <ConversationRow key={item.post_id} item={item} />
        ))}
      </ul>
    </div>
  );
}

function ConversationRow({ item }: { item: ConversationItem }) {
  const previewAuthor: string =
    item.latest_reply_author_name ?? item.author_name;
  const previewImage: string | null =
    item.latest_reply_author_image_url ?? item.author_image_url;
  const snippet: string =
    item.latest_reply_text?.trim() || "joined the conversation";

  return (
    <li>
      <Link
        href={`/post/${item.post_id}?focus=unread`}
        scroll={false}
        className="flex gap-3 py-4 transition hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
      >
        <Avatar name={previewAuthor} imageUrl={previewImage} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-2 font-serif text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {item.full_headline}
            </p>
            {item.unread_count > 0 ? (
              <span className="shrink-0 rounded-[9999px] bg-brand-600 px-2 py-0.5 text-[10px] font-bold text-white">
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
    </li>
  );
}
