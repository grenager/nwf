"use client";

import { AddStoryModal } from "@/components/add-story-modal";
import { ArticleCard } from "@/components/article-card";
import { useAuth } from "@/components/auth-provider";
import { useAuthGate } from "@/components/auth-gate";
import { StoryConversationRow } from "@/components/story-conversation-row";
import { ShareAfterPostModal } from "@/components/share-after-post-modal";
import { Skeleton } from "@/components/skeleton";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import type { Post, Story, StoryConversations, UUID } from "@/lib/types";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface StoryDetailProps {
  storyId: UUID;
  /** Rendered inside the modal shell, which supplies its own padding. */
  inModal?: boolean;
}

/**
 * A story, plus the conversations about it this viewer may read.
 *
 * This is where Discover hands off to the private half of the app. A trending
 * article is shown to everyone, but the threads under it are not: you see
 * your own and the ones your friends touched. When there are none — the
 * normal case for something just found on Discover — starting one is the
 * offer, and it creates a post of the viewer's own rather than joining
 * somebody else's thread.
 */
export function StoryDetail({ storyId, inModal = false }: StoryDetailProps) {
  const { session } = useAuth();
  const { requireAuth } = useAuthGate();
  const { notify } = useToast();
  const isSignedIn: boolean = session !== null;
  const [story, setStory] = useState<Story | null>(null);
  const [convos, setConvos] = useState<StoryConversations | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [composerOpen, setComposerOpen] = useState<boolean>(false);
  const [sharePostId, setSharePostId] = useState<UUID | null>(null);

  const load = useCallback(
    async (opts?: { silent?: boolean }): Promise<void> => {
      if (!opts?.silent) setLoading(true);
      try {
        const [s, c] = await Promise.all([
          api.getStory(storyId),
          api.getStoryConversations(storyId),
        ]);
        setStory(s);
        setConvos(c);
      } catch (err) {
        notify(
          err instanceof ApiError ? err.message : "Couldn't load this story",
          "error",
        );
      } finally {
        setLoading(false);
      }
    },
    [storyId, notify],
  );

  useEffect(() => {
    void load();
  }, [load]);

  function openComposer(): void {
    if (!requireAuth("start a conversation")) return;
    setComposerOpen(true);
  }

  if (loading && story === null) {
    return (
      <div className={inModal ? "space-y-4" : "mx-auto max-w-2xl space-y-4 py-4"}>
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (story === null) {
    return (
      <div className={inModal ? "" : "mx-auto max-w-2xl py-8"}>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          This story isn&apos;t available.
        </p>
      </div>
    );
  }

  const items = convos?.items ?? [];
  const hasOwnPost: boolean = convos?.viewer_has_post ?? false;

  return (
    <div className={inModal ? "space-y-5" : "mx-auto max-w-2xl space-y-5 py-4"}>
      <ArticleCard
        articleUrl={story.article_url}
        headline={story.full_headline}
        summary={story.summary}
        imageUrl={story.image_url}
        sourceName={story.source_name}
        sourceImageUrl={story.source_image_url}
        onOpen={() => {
          if (isSignedIn) void api.markRead(story.id, true).catch(() => undefined);
        }}
      />

      {isSignedIn ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {items.length === 0
                ? "No conversations you can see yet"
                : items.length === 1
                  ? "1 conversation you can join"
                  : `${items.length} separate conversations`}
            </h2>
            <button
              type="button"
              onClick={openComposer}
              className="shrink-0 bg-zinc-900 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {hasOwnPost ? "Post again" : "Start a conversation"}
            </button>
          </div>

          {items.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Share it with your take and only your friends will see the
              thread.
            </p>
          ) : (
            <div className="border-t border-zinc-200 dark:border-zinc-800">
              {items.map((card) => (
                <StoryConversationRow key={card.card_id} card={card} />
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="border border-zinc-200 p-5 text-center dark:border-zinc-800">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Conversations here are private to the people in them.
          </p>
          <Link
            href="/signin"
            className="mt-3 inline-block bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Sign in to start one
          </Link>
        </div>
      )}

      {composerOpen ? (
        <AddStoryModal
          initialStory={story}
          onClose={() => setComposerOpen(false)}
          onAdded={(post: Post) => {
            setComposerOpen(false);
            window.dispatchEvent(
              new CustomEvent("nwf:post-created", { detail: post }),
            );
            setSharePostId(post.id);
            void load({ silent: true });
          }}
        />
      ) : null}

      {sharePostId !== null ? (
        <ShareAfterPostModal
          postId={sharePostId}
          kind="post"
          onClose={() => setSharePostId(null)}
        />
      ) : null}
    </div>
  );
}
