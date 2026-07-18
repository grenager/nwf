"use client";

import { useAuth } from "@/components/auth-provider";
import { PostCard } from "@/components/post-card";
import { FeedSkeleton } from "@/components/skeleton";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import type { FeedCard, FeedPayload, Post, Profile } from "@/lib/types";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

const AWAY_RELOAD_MS: number = 10 * 60 * 1000;

interface FeedClientProps {
  // Server-rendered public feed, so guests (and the first paint for everyone)
  // have content without waiting on a client-side round-trip.
  initialGuestData: FeedPayload | null;
}

function formatNewSince(iso: string): string {
  const date: Date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "your last visit";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function FeedClient({ initialGuestData }: FeedClientProps) {
  const { notify } = useToast();
  const { session, loading: authLoading } = useAuth();
  const isSignedIn: boolean = session !== null;
  const [data, setData] = useState<FeedPayload | null>(initialGuestData);
  const [me, setMe] = useState<Profile | null>(null);
  const [loading, setLoading] = useState<boolean>(initialGuestData === null);

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

  // Guests are already served the SSR payload; only hit the API for a
  // personalized feed once auth resolves, or if the server render had no data.
  useEffect(() => {
    if (authLoading) return;
    if (isSignedIn) {
      void load({ silent: data !== null });
      return;
    }
    if (data === null) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isSignedIn, load]);

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
        posts: [
          {
            ...post,
            unread_reply_count: post.unread_reply_count ?? 0,
            last_seen_at: post.last_seen_at ?? null,
          },
        ],
        score: Number.MAX_SAFE_INTEGER,
        unread_reply_count: 0,
      };
      setData((prev) => {
        if (!prev) {
          return {
            items: [card],
            caught_up_after: 0,
            unread_count: 0,
            aggregate_readers: 0,
            aggregate_private_conversations: 0,
            new_since: null,
          };
        }
        const withoutDup: FeedCard[] = prev.items.filter(
          (c) => c.card_id !== card.card_id,
        );
        return {
          ...prev,
          items: [card, ...withoutDup],
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
      // A card with no posts left (last post deleted) is dropped entirely.
      const items: FeedCard[] = prev.items
        .map((c) => (c.card_id === updated.card_id ? updated : c))
        .filter((c) => c.posts.length > 0);
      return { ...prev, items };
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

  const dividerBeforeIndex: number = useMemo(() => {
    if (data.new_since === null) return -1;
    const newSinceMs: number = Date.parse(data.new_since);
    if (Number.isNaN(newSinceMs)) return -1;
    return data.items.findIndex((card) => {
      const createdMs: number = Date.parse(card.posts[0]?.created_at ?? "");
      return !Number.isNaN(createdMs) && createdMs <= newSinceMs;
    });
  }, [data]);

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
        {data.items.map((card, index) => (
          <Fragment key={card.card_id}>
            {index === dividerBeforeIndex &&
            dividerBeforeIndex > 0 &&
            data.new_since !== null ? (
              <div className="my-6 flex items-center gap-3">
                <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                  New since {formatNewSince(data.new_since)}
                </span>
                <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
              </div>
            ) : null}
            <PostCard
              card={card}
              me={me}
              onCardChange={onCardChange}
            />
          </Fragment>
        ))}
      </div>
    </div>
  );
}
