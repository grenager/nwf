"use client";

import { ArticleCard } from "@/components/article-card";
import { EngagementSummary } from "@/components/engagement-summary";
import { PostThread } from "@/components/post-thread";
import { SharePostModal } from "@/components/share-post-modal";
import { StarsDisplay } from "@/components/star-rating";
import { useAuth } from "@/components/auth-provider";
import { stripHtml } from "@/lib/html";
import { api } from "@/lib/api";
import type { FeedCard, Post, Profile } from "@/lib/types";
import Link from "next/link";
import { useState, type ReactNode } from "react";

interface PostCardProps {
  card: FeedCard;
  me: Profile | null;
  onCardChange: (card: FeedCard) => void;
}

export function PostCard({ card, me, onCardChange }: PostCardProps) {
  const { user } = useAuth();
  const [inviteOpen, setInviteOpen] = useState<boolean>(false);

  const engagement = card.engagement;
  const hasEngagement: boolean =
    engagement.read > 0 || engagement.commented > 0;
  const post: Post | undefined = card.posts[0];

  function markReadOnOpen(): void {
    if (!user || card.read) return;
    onCardChange({ ...card, read: true });
    void api.markRead(card.story_id, true).catch(() => undefined);
  }

  function onPostChange(updated: Post): void {
    onCardChange({
      ...card,
      posts: card.posts.map((p) => (p.id === updated.id ? updated : p)),
    });
  }

  // Rating my own story updates my_rating + the visible aggregate, and (if I'm
  // the author) the stars shown beside my take. Recomputed from current card so
  // it works for both setting and clearing.
  function handleRate(next: number | null): void {
    if (!post) return;
    const old: number | null = card.my_rating;
    let count: number = card.rating_count;
    let sum: number = (card.rating_avg ?? 0) * count;
    if (old === null && next !== null) {
      count += 1;
      sum += next;
    } else if (old !== null && next === null) {
      count -= 1;
      sum -= old;
    } else if (old !== null && next !== null) {
      sum += next - old;
    }
    const isAuthor: boolean = user != null && user.id === post.author_id;
    onCardChange({
      ...card,
      my_rating: next,
      rating_avg: count > 0 ? sum / count : null,
      rating_count: count,
      posts: card.posts.map((p) =>
        p.id === post.id
          ? {
              ...p,
              my_rating: next,
              author_rating: isAuthor ? next : p.author_rating,
            }
          : p,
      ),
    });
  }

  if (!post) return null;

  const hasAggregate: boolean =
    card.rating_count > 0 && card.rating_avg !== null;

  const preview: ReactNode = (
    <>
      <ArticleCard
        articleUrl={card.article_url}
        headline={card.full_headline}
        summary={post.shared_text?.trim() ? null : card.summary}
        imageUrl={card.image_url}
        sourceName={card.source_name}
        sourceImageUrl={card.source_image_url}
        onOpen={markReadOnOpen}
      />

      {/* Reader text the author pasted from the source (e.g. paywalled). Show a
          short teaser; "More" opens the post's reader/details view. */}
      {post.shared_text && post.shared_text.trim() ? (
        <div className="border-l-2 border-zinc-200 pl-3 dark:border-zinc-800">
          <p className="line-clamp-5 whitespace-pre-line font-serif text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
            {stripHtml(post.shared_text)}
          </p>
          <Link
            href={`/post/${post.id}`}
            scroll={false}
            className="mt-1 inline-block text-xs font-semibold text-brand-600 hover:underline dark:text-brand-400"
          >
            More →
          </Link>
        </div>
      ) : null}

      {/* Aggregate rating + friend engagement. */}
      {hasAggregate || hasEngagement ? (
        <div className="flex items-center justify-between gap-3">
          {hasAggregate && card.rating_avg !== null ? (
            <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              <StarsDisplay value={card.rating_avg} size="sm" />
              <span>
                {card.rating_avg.toFixed(1)} · {card.rating_count} rating
                {card.rating_count === 1 ? "" : "s"}
              </span>
            </div>
          ) : (
            <span />
          )}
          {hasEngagement ? (
            <EngagementSummary engagement={engagement} variant="inline" />
          ) : null}
        </div>
      ) : null}
    </>
  );

  const unreadN: number =
    card.unread_reply_count > 0
      ? card.unread_reply_count
      : (post.unread_reply_count ?? 0);

  return (
    <article className="py-7">
      {unreadN > 0 ? (
        <div className="mb-2">
          <Link
            href={`/post/${post.id}?focus=unread`}
            scroll={false}
            className="inline-flex items-center rounded-[9999px] bg-brand-50 px-2.5 py-0.5 text-[11px] font-semibold text-brand-700 hover:bg-brand-100 dark:bg-brand-950 dark:text-brand-300 dark:hover:bg-brand-900"
          >
            {unreadN} new {unreadN === 1 ? "reply" : "replies"}
          </Link>
        </div>
      ) : null}
      <PostThread
        post={post}
        me={me}
        preview={preview}
        storyId={card.story_id}
        myRating={card.my_rating}
        onRate={handleRate}
        onPostChange={onPostChange}
        onDelete={() => onCardChange({ ...card, posts: [] })}
        onInvite={() => setInviteOpen(true)}
      />
      {inviteOpen ? (
        <SharePostModal
          postId={post.id}
          headline={card.full_headline}
          articleUrl={card.article_url}
          imageUrl={card.image_url}
          sourceName={card.source_name}
          take={post.take}
          onClose={() => setInviteOpen(false)}
        />
      ) : null}
    </article>
  );
}
