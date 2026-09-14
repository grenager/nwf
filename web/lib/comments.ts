import type { Comment, Post } from "@/lib/types";

/** True when a comment was edited after creation (updated_at strictly later). */
export function commentWasEdited(comment: Comment): boolean {
  const createdMs: number = Date.parse(comment.created_at);
  const updatedMs: number = Date.parse(comment.updated_at);
  if (Number.isNaN(createdMs) || Number.isNaN(updatedMs)) return false;
  return updatedMs - createdMs > 500;
}

/**
 * What a post says: the text of its first comment.
 *
 * A post carries no text of its own — whoever shares an article says what
 * they think in the first comment, like everyone else in the thread. Places
 * that need a one-line excerpt (summary rows, share sheets) ask for it here
 * so they all agree on the answer.
 *
 * Replies arrive oldest-first, so the first entry is the opening comment.
 * If the sharer deleted theirs, the next one speaks for the thread.
 */
export function openingCommentText(post: Post): string | null {
  return post.replies[0]?.text ?? null;
}
