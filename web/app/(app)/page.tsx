"use client";

import { useAuth } from "@/components/auth-provider";
import { PostCard } from "@/components/post-card";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import type { FeedCard, FeedPayload, Profile } from "@/lib/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const AWAY_RELOAD_MS: number = 10 * 60 * 1000;

export default function FeedPage() {
  const { notify } = useToast();
  const { session } = useAuth();
  const isSignedIn: boolean = session !== null;
  const [data, setData] = useState<FeedPayload | null>(null);
  const [me, setMe] = useState<Profile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    if (!isSignedIn) {
      setMe(null);
      return;
    }
    void api.getMe().then(setMe).catch(() => undefined);
  }, [isSignedIn]);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const payload: FeedPayload = await api.getFeed();
      setData(payload);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Failed to load feed", "error");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let hiddenAt: number | null = null;
    function onVisibilityChange(): void {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt !== null && Date.now() - hiddenAt >= AWAY_RELOAD_MS) {
        void load();
      }
      hiddenAt = null;
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [load]);

  function onCardChange(updated: FeedCard): void {
    setData((prev) => {
      if (!prev) return prev;
      const index: number = prev.items.findIndex(
        (c) => c.story_id === updated.story_id,
      );
      // A card with no posts left (last post deleted) is dropped entirely.
      const removed: boolean = updated.posts.length === 0;
      const items: FeedCard[] = prev.items
        .map((c) => (c.story_id === updated.story_id ? updated : c))
        .filter((c) => c.posts.length > 0);
      const caughtUp: number =
        removed && index !== -1 && index < prev.caught_up_after
          ? Math.max(0, prev.caught_up_after - 1)
          : prev.caught_up_after;
      return { ...prev, items, caught_up_after: caughtUp };
    });
  }

  if (loading) {
    return <p className="text-zinc-400">Loading feed…</p>;
  }

  if (!data) {
    return (
      <div className="border border-dashed border-zinc-300 p-10 text-center text-zinc-500">
        Could not load feed.{" "}
        <button onClick={() => void load()} className="text-brand-600 underline">
          Retry
        </button>
      </div>
    );
  }

  const inbox = data.items.slice(0, data.caught_up_after);
  const archive = data.items.slice(data.caught_up_after);

  return (
    <div className="mx-auto max-w-2xl space-y-2">
      {!isSignedIn && data.items.length === 0 ? (
        <div className="border border-dashed border-zinc-300 p-8 text-center">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {data.aggregate_readers > 0
              ? `${data.aggregate_readers} readers, ${data.aggregate_private_conversations} private conversations you can't see.`
              : "Public posts from contributors will show up here."}
          </p>
          <Link
            href="/signin"
            className="mt-4 inline-block bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Create free account
          </Link>
        </div>
      ) : null}

      {isSignedIn && data.items.length === 0 ? (
        <div className="border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">
          No posts yet. Share an article with the Add button, or wait for friends
          to post.
          {data.aggregate_private_conversations > 0 ? (
            <p className="mt-2 text-xs">
              {data.aggregate_private_conversations} private conversations
              elsewhere on the site.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-4">
        {inbox.map((card) => (
          <PostCard
            key={card.story_id}
            card={card}
            me={me}
            onCardChange={onCardChange}
          />
        ))}
      </div>

      {data.caught_up_after > 0 && archive.length >= 0 ? (
        <div className="my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
            You&apos;re all caught up
          </span>
          <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
        </div>
      ) : null}

      {archive.length > 0 ? (
        <div className="space-y-4 opacity-80">
          {archive.map((card) => (
            <PostCard
              key={card.story_id}
              card={card}
              me={me}
              onCardChange={onCardChange}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
