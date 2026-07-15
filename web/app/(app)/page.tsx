"use client";

import { useAuth } from "@/components/auth-provider";
import { PostCard } from "@/components/post-card";
import { FeedSkeleton } from "@/components/skeleton";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import type { FeedCard, FeedPayload, Post, Profile } from "@/lib/types";
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

  const load = useCallback(
    async (opts?: { silent?: boolean }): Promise<void> => {
      if (!opts?.silent) setLoading(true);
      try {
        const payload: FeedPayload = await api.getFeed();
        setData(payload);
      } catch (err) {
        notify(
          err instanceof ApiError ? err.message : "Failed to load feed",
          "error",
        );
      } finally {
        setLoading(false);
      }
    },
    [notify],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // A post created elsewhere (e.g. the nav "+ Post" modal) should appear at the
  // very top immediately — prepend from the event payload, no refetch.
  useEffect(() => {
    function onPostCreated(event: Event): void {
      const custom: CustomEvent = event as CustomEvent;
      const post: Post | undefined = custom.detail as Post | undefined;
      if (!post || typeof post.id !== "string") {
        void load({ silent: true });
        return;
      }
      const card: FeedCard = {
        card_id: post.id,
        story_id: post.story_id,
        full_headline: post.full_headline,
        article_url: post.article_url,
        summary: post.summary,
        image_url: post.image_url,
        source_name: post.source_name,
        source_image_url: post.source_image_url,
        kind: post.kind,
        read: true,
        starred: post.starred,
        my_rating: post.my_rating,
        rating_avg: post.rating_avg,
        rating_count: post.rating_count,
        my_take: post.take,
        engagement: post.engagement,
        posts: [post],
        score: Number.MAX_SAFE_INTEGER,
      };
      setData((prev) => {
        if (!prev) {
          return {
            items: [card],
            caught_up_after: 1,
            unread_count: 0,
            aggregate_readers: 0,
            aggregate_private_conversations: 0,
            new_since: null,
          };
        }
        const existingIndex: number = prev.items.findIndex(
          (c) => c.card_id === card.card_id,
        );
        const withoutDup: FeedCard[] =
          existingIndex === -1
            ? prev.items
            : prev.items.filter((c) => c.card_id !== card.card_id);
        let caughtUp: number = prev.caught_up_after;
        if (existingIndex !== -1 && existingIndex < prev.caught_up_after) {
          caughtUp = Math.max(0, caughtUp - 1);
        }
        return {
          ...prev,
          items: [card, ...withoutDup],
          caught_up_after: caughtUp + 1,
        };
      });
    }
    window.addEventListener("nwf:post-created", onPostCreated);
    return () =>
      window.removeEventListener("nwf:post-created", onPostCreated);
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
        (c) => c.card_id === updated.card_id,
      );
      // A card with no posts left (last post deleted) is dropped entirely.
      const removed: boolean = updated.posts.length === 0;
      const items: FeedCard[] = prev.items
        .map((c) => (c.card_id === updated.card_id ? updated : c))
        .filter((c) => c.posts.length > 0);
      const caughtUp: number =
        removed && index !== -1 && index < prev.caught_up_after
          ? Math.max(0, prev.caught_up_after - 1)
          : prev.caught_up_after;
      return { ...prev, items, caught_up_after: caughtUp };
    });
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl">
        <FeedSkeleton />
      </div>
    );
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

      <div className="divide-y divide-zinc-200 [&>article:first-child]:pt-1 dark:divide-zinc-800">
        {inbox.map((card) => (
          <PostCard
            key={card.card_id}
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
        <div className="divide-y divide-zinc-200 opacity-80 dark:divide-zinc-800">
          {archive.map((card) => (
            <PostCard
              key={card.card_id}
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
