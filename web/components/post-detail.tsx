"use client";

import { ArticleCard } from "@/components/article-card";
import { useAuth } from "@/components/auth-provider";
import { PostThread } from "@/components/post-thread";
import { ReaderBody } from "@/components/reader-body";
import { SharePostModal } from "@/components/share-post-modal";
import { api, ApiError } from "@/lib/api";
import { useStoryReaders } from "@/lib/use-story-readers";
import type { Post, Profile, StoryReader, UUID } from "@/lib/types";
import { useEffect, useRef, useState, type ReactNode } from "react";

interface PostDetailProps {
  postId: UUID;
  /** Called when the underlying post is deleted (e.g. to close a modal). */
  onDeleted?: () => void;
  /** Scroll to the "New replies" divider when opened via ?focus=unread. */
  focusUnread?: boolean;
  /** Scroll to and highlight one comment, from ?comment=<id>. */
  focusCommentId?: UUID | null;
  /** Open the author's post editor on arrival, from ?edit=1. */
  startEditing?: boolean;
}

/**
 * Canonical post view: the article (link back), the author's pasted reader text
 * when present, and the full conversation. Rendered both as a permalink page and
 * inside the intercepting-route modal.
 */
export function PostDetail({
  postId,
  onDeleted,
  focusUnread = false,
  focusCommentId = null,
  startEditing = false,
}: PostDetailProps) {
  const { user } = useAuth();
  const [post, setPost] = useState<Post | null>(null);
  const [me, setMe] = useState<Profile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState<boolean>(false);

  // Key the fetches off the viewer's *identity*, never the `user` object.
  // supabase-js re-emits SIGNED_IN with a freshly parsed session on every
  // hidden->visible tab transition, so `user` changes identity constantly
  // while the signed-in person does not. Depending on the object refetched
  // the post on every tab return, which tore down PostThread and threw away
  // whatever the author was typing in the editor.
  const userId: string | null = user?.id ?? null;

  useEffect(() => {
    let active = true;
    setLoading(true);
    void api
      .getPost(postId)
      .then((data) => {
        if (!active) return;
        setPost(data);
        setError(null);
        if (userId !== null && !data.read) {
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
  }, [postId, userId]);

  useEffect(() => {
    if (userId === null) {
      setMe(null);
      return;
    }
    void api.getMe().then(setMe).catch(() => undefined);
  }, [userId]);

  const emptyReaders: StoryReader[] = [];
  const { readers: liveReaders, ping } = useStoryReaders(
    post?.story_id ?? "",
    post?.readers ?? emptyReaders,
  );

  // Landing on the detail page *is* opening the article, so ping once per
  // post regardless of prior read state (unlike the feed card's first-open guard).
  const pingedPostId = useRef<UUID | null>(null);
  useEffect(() => {
    if (!post || !me) return;
    if (pingedPostId.current === post.id) return;
    pingedPostId.current = post.id;
    ping(me);
  }, [post, me, ping]);

  // A placeholder only when there is nothing right to show: the first load,
  // or a load of a *different* post. Swapping one in for a refetch of the
  // post already on screen would unmount PostThread and lose an open editor.
  if (loading && post?.id !== postId) {
    return <p className="py-10 text-sm text-zinc-500">Loading…</p>;
  }

  if (error || !post) {
    return (
      <p className="py-10 text-sm text-zinc-500">
        {error ?? "Post not found."}
      </p>
    );
  }

  const preview: ReactNode = (
    <>
      <ArticleCard
        articleUrl={post.article_url}
        headline={post.full_headline}
        summary={post.shared_text?.trim() ? null : post.summary}
        quote={post.quote}
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
    </>
  );

  return (
    <>
      <PostThread
        post={post}
        me={me}
        preview={preview}
        readers={liveReaders}
        onPostChange={setPost}
        onDelete={() => onDeleted?.()}
        onInvite={() => setInviteOpen(true)}
        markSeenOnMount
        focusUnread={focusUnread}
        focusCommentId={focusCommentId}
        startEditing={startEditing}
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
