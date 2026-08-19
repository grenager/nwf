import type { Comment } from "@/lib/types";

/** True when a comment was edited after creation (updated_at strictly later). */
export function commentWasEdited(comment: Comment): boolean {
  const createdMs: number = Date.parse(comment.created_at);
  const updatedMs: number = Date.parse(comment.updated_at);
  if (Number.isNaN(createdMs) || Number.isNaN(updatedMs)) return false;
  return updatedMs - createdMs > 500;
}
