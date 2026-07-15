import type { ReactionKind, ReactionSummary } from "@/lib/types";

/** Apply a toggle to a reaction summary list + my_reaction. */
export function applyReactionToggle(
  reactions: ReactionSummary[],
  myReaction: ReactionKind | null,
  next: ReactionKind,
): { reactions: ReactionSummary[]; my_reaction: ReactionKind | null } {
  const clearing: boolean = myReaction === next;
  const counts: Map<ReactionKind, number> = new Map(
    reactions.map((r) => [r.reaction, r.count]),
  );
  if (myReaction !== null) {
    const prev: number = counts.get(myReaction) ?? 0;
    if (prev <= 1) counts.delete(myReaction);
    else counts.set(myReaction, prev - 1);
  }
  if (!clearing) {
    counts.set(next, (counts.get(next) ?? 0) + 1);
  }
  const updated: ReactionSummary[] = Array.from(counts.entries())
    .map(([reaction, count]) => ({ reaction, count }))
    .sort((a, b) => b.count - a.count || a.reaction.localeCompare(b.reaction));
  return {
    reactions: updated,
    my_reaction: clearing ? null : next,
  };
}
