"use client";

import { ArticleCard } from "@/components/article-card";
import { PostThread } from "@/components/post-thread";
import { SharePostModal } from "@/components/share-post-modal";
import { useAuth } from "@/components/auth-provider";
import { UserLink } from "@/components/user-link";
import { stripHtml } from "@/lib/html";
import { api } from "@/lib/api";
import { useStoryReaders } from "@/lib/use-story-readers";
import type { FeedCard, FofActionKind, Post, Profile } from "@/lib/types";
import Link from "next/link";
import { useState, type ReactNode } from "react";

const FOF_ACTION_LABEL: Record<FofActionKind, string> = {
  commented: "commented on this",
  reacted: "reacted to this",
  read: "read this",
};

/** Why a post from someone the viewer has no direct connection to is
 * showing up: named via the friend whose engagement unlocked it, never as
 * an unexplained stranger's post. */
function FofReasonTag({ card }: { card: FeedCard }) {
  const reason = card.fof_reason;
  if (!reason) return null;
  return (
    <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
      <UserLink userId={reason.friend_id} title={reason.friend_name}>
        {reason.friend_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={reason.friend_image_url}
            alt=""
            className="h-4 w-4 rounded-[9999px] object-cover"
          />
        ) : (
          <span className="flex h-4 w-4 items-center justify-center rounded-[9999px] bg-slate-300 text-[8px] font-bold text-slate-700 dark:bg-slate-600 dark:text-slate-100">
            {reason.friend_name.charAt(0).toUpperCase()}
          </span>
        )}
      </UserLink>
      <span>
        <UserLink userId={reason.friend_id} className="hover:underline">
          {reason.friend_name}
        </UserLink>{" "}
        {FOF_ACTION_LABEL[reason.action]}
      </span>
    </div>
  );
}

interface PostCardProps {
  card: FeedCard;
  me: Profile | null;
  onCardChange: (card: FeedCard) => void;
  /** Top border between feed items (suppressed when a section divider sits above). */
  showTopBorder?: boolean;
}

export function PostCard({
  card,
  me,
  onCardChange,
  showTopBorder = false,
}: PostCardProps) {
  const { user } = useAuth();
  const [inviteOpen, setInviteOpen] = useState<boolean>(false);

  const { readers: liveReaders, ping } = useStoryReaders(
    card.story_id,
    card.engagement.readers,
  );
  const post: Post | undefined = card.posts[0];

  function markReadOnOpen(): void {
    if (!user) return;
    if (!card.read) {
      onCardChange({ ...card, read: true });
      void api.markRead(card.story_id, true).catch(() => undefined);
    }
    if (me) ping(me);
  }

  function onPostChange(updated: Post): void {
    onCardChange({
      ...card,
      unread_reply_count: updated.unread_reply_count,
      posts: card.posts.map((p) => (p.id === updated.id ? updated : p)),
    });
  }

  if (!post) return null;

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
          <p className="line-clamp-5 whitespace-pre-line font-serif text-sm leading-relaxed text-zinc-600 [overflow-wrap:anywhere] dark:text-zinc-300">
            {stripHtml(post.shared_text)}
          </p>
          <Link
            href={`/post/${post.id}`}
            scroll={false}
            className="mt-1 inline-block text-xs font-semibold text-zinc-900 hover:underline dark:text-zinc-100"
          >
            More →
          </Link>
        </div>
      ) : null}
    </>
  );

  const unreadN: number =
    card.unread_reply_count > 0
      ? card.unread_reply_count
      : (post.unread_reply_count ?? 0);

  return (
    <article
      className={`py-7 ${showTopBorder ? "border-t border-zinc-200 dark:border-zinc-800" : ""}`}
    >
      <FofReasonTag card={card} />
      {unreadN > 0 ? (
        <div className="mb-2">
          <Link
            href={`/post/${post.id}?focus=unread`}
            scroll={false}
            className="inline-flex items-center rounded-[9999px] bg-zinc-100 px-2.5 py-0.5 text-[11px] font-semibold text-zinc-800 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            {unreadN} new {unreadN === 1 ? "reply" : "replies"}
          </Link>
        </div>
      ) : null}
      <PostThread
        post={post}
        me={me}
        preview={preview}
        readers={liveReaders}
        onPostChange={onPostChange}
        onDelete={() => onCardChange({ ...card, posts: [] })}
        onInvite={() => setInviteOpen(true)}
        maxTopLevelComments={2}
        compact
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
