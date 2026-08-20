"use client";

import { useAuth } from "@/components/auth-provider";
import { PostCard } from "@/components/post-card";
import { FeedSkeleton } from "@/components/skeleton";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import type { FeedCard, FeedPayload, Post, Profile } from "@/lib/types";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useState } from "react";

const AWAY_RELOAD_MS: number = 10 * 60 * 1000;

function formatNewSince(iso: string): string {
  const date: Date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "your last visit";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function FeedClient() {
  const { notify } = useToast();
  const { session, loading: authLoading } = useAuth();
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
        if (isSignedIn) {
          const payload: FeedPayload = await api.getFeed();
          setData(payload);
        } else {
          setData(null);
        }
      } catch (err) {
        notify(
          err instanceof ApiError ? err.message : "Failed to load feed",
          "error",
        );
      } finally {
        setLoading(false);
      }
    },
    [isSignedIn, notify],
  );

  useEffect(() => {
    if (authLoading) return;
    void load({ silent: isSignedIn && data !== null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isSignedIn, load]);

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

  const postItems: FeedCard[] = data?.items ?? [];

  let dividerBeforeIndex: number = -1;
  if (data?.new_since !== null && data?.new_since !== undefined) {
    const newSinceMs: number = Date.parse(data.new_since);
    if (!Number.isNaN(newSinceMs)) {
      dividerBeforeIndex = postItems.findIndex((card) => {
        const createdMs: number = Date.parse(card.posts[0]?.created_at ?? "");
        return !Number.isNaN(createdMs) && createdMs <= newSinceMs;
      });
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-2">
      {!isSignedIn && postItems.length === 0 ? (
        <div className="border border-dashed border-zinc-300 p-8 text-center">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Private conversations with friends — sign up to start one.
          </p>
          <Link
            href="/signin"
            className="mt-4 inline-block bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Create free account
          </Link>
        </div>
      ) : null}

      {isSignedIn && postItems.length === 0 ? (
        <div className="border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">
          No posts yet. Share an article with the Add button to start a
          conversation.
          {data && data.aggregate_private_conversations > 0 ? (
            <p className="mt-2 text-xs">
              {data.aggregate_private_conversations} private conversations
              elsewhere on the site.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="[&>article:first-child]:pt-1">
        {postItems.map((card, index) => {
          const showNewSinceDivider: boolean =
            index === dividerBeforeIndex &&
            dividerBeforeIndex > 0 &&
            data?.new_since !== null &&
            data?.new_since !== undefined;
          const showTopBorder: boolean =
            index > 0 && !showNewSinceDivider;

          return (
            <Fragment key={card.card_id}>
              {showNewSinceDivider ? (
                <div
                  className="relative border-t border-zinc-200 py-7 dark:border-zinc-800"
                  role="separator"
                  aria-label={`New since ${formatNewSince(data!.new_since!)}`}
                >
                  <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 bg-white px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400 dark:bg-zinc-950">
                    New since {formatNewSince(data!.new_since!)}
                  </span>
                </div>
              ) : null}
              <PostCard
                card={card}
                me={me}
                onCardChange={onCardChange}
                showTopBorder={showTopBorder}
              />
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
