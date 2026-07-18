"use client";

import { ArticleCard } from "@/components/article-card";
import { useAuth } from "@/components/auth-provider";
import { PostThread } from "@/components/post-thread";
import { ReaderBody } from "@/components/reader-body";
import { SharePostModal } from "@/components/share-post-modal";
import { StarsDisplay } from "@/components/star-rating";
import { api, ApiError } from "@/lib/api";
import type { Post, Profile, UUID } from "@/lib/types";
import { useEffect, useState, type ReactNode } from "react";

interface PostDetailProps {
  postId: UUID;
  /** Called when the underlying post is deleted (e.g. to close a modal). */
  onDeleted?: () => void;
}

/**
 * Canonical post view: the article (link back), the author's pasted reader text
 * when present, and the full conversation. Rendered both as a permalink page and
 * inside the intercepting-route modal.
 */
export function PostDetail({ postId, onDeleted }: PostDetailProps) {
  const { user } = useAuth();
  const [post, setPost] = useState<Post | null>(null);
  const [me, setMe] = useState<Profile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void api
      .getPost(postId)
      .then((data) => {
        if (!active) return;
        setPost(data);
        setError(null);
        if (user && !data.read) {
          void api.markRead(data.story_id, true).catch(() => undefined);
        }
      })
      .catch((err) => {
        if (!active) return;
        setError(
          err instanceof ApiError ? err.message : "Could not load this post",
        );
        setPost(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [postId, user]);

  useEffect(() => {
    if (!user) {
      setMe(null);
      return;
    }
    void api.getMe().then(setMe).catch(() => undefined);
  }, [user]);

  function handleRate(next: number | null): void {
    setPost((prev) => {
      if (!prev) return prev;
      const old: number | null = prev.my_rating;
      let count: number = prev.rating_count;
      let sum: number = (prev.rating_avg ?? 0) * count;
      if (old === null && next !== null) {
        count += 1;
        sum += next;
      } else if (old !== null && next === null) {
        count -= 1;
        sum -= old;
      } else if (old !== null && next !== null) {
        sum += next - old;
      }
      const isAuthor: boolean = user != null && user.id === prev.author_id;
      return {
        ...prev,
        my_rating: next,
        rating_avg: count > 0 ? sum / count : null,
        rating_count: count,
        author_rating: isAuthor ? next : prev.author_rating,
      };
    });
  }

  if (loading) {
    return <p className="py-10 text-sm text-zinc-500">Loading…</p>;
  }

  if (error || !post) {
    return (
      <p className="py-10 text-sm text-zinc-500">
        {error ?? "Post not found."}
      </p>
    );
  }

  const hasAggregate: boolean =
    post.rating_count > 0 && post.rating_avg !== null;

  const preview: ReactNode = (
    <>
      <ArticleCard
        articleUrl={post.article_url}
        headline={post.full_headline}
        summary={post.shared_text?.trim() ? null : post.summary}
        imageUrl={post.image_url}
        sourceName={post.source_name}
        sourceImageUrl={post.source_image_url}
      />

      {post.shared_text && post.shared_text.trim() ? (
        <div className="border-l-2 border-zinc-200 pl-4 dark:border-zinc-800">
          <ReaderBody
            sharedText={post.shared_text}
            articleUrl={post.article_url}
            sourceName={post.source_name}
            authorName={post.author_name}
          />
        </div>
      ) : null}

      {hasAggregate && post.rating_avg !== null ? (
        <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          <StarsDisplay value={post.rating_avg} size="sm" />
          <span>
            {post.rating_avg.toFixed(1)} · {post.rating_count} rating
            {post.rating_count === 1 ? "" : "s"}
          </span>
        </div>
      ) : null}
    </>
  );

  return (
    <>
      <PostThread
        post={post}
        me={me}
        preview={preview}
        storyId={post.story_id}
        myRating={post.my_rating}
        onRate={handleRate}
        onPostChange={setPost}
        onDelete={() => onDeleted?.()}
        onInvite={() => setInviteOpen(true)}
        markSeenOnMount
      />
      {inviteOpen ? (
        <SharePostModal
          postId={post.id}
          headline={post.full_headline}
          articleUrl={post.article_url}
          imageUrl={post.image_url}
          sourceName={post.source_name}
          take={post.take}
          onClose={() => setInviteOpen(false)}
        />
      ) : null}
    </>
  );
}
