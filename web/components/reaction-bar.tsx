import { ReactionIcon } from "@/components/reaction-icon";
import { REACTIONS, type ReactionKind, type ReactionSummary } from "@/lib/types";

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

const SIZE_CLASS: Record<"xs" | "sm", string> = {
  xs: "text-xs",
  sm: "text-sm",
};

/**
 * Row of like/love/sad/angry buttons; clicking toggles that reaction (a
 * second click on your current pick clears it). Used both as a live,
 * persisted reaction bar on posts/comments (pass their `reactions` +
 * `my_reaction`) and as a bare picker in the composer (pass `[]` and track
 * the selection yourself — no counts to show yet).
 */
export function ReactionBar({
  reactions,
  myReaction,
  onToggle,
  disabled = false,
  size = "sm",
}: {
  reactions: ReactionSummary[];
  myReaction: ReactionKind | null;
  onToggle: (reaction: ReactionKind) => void;
  disabled?: boolean;
  size?: "xs" | "sm";
}) {
  const counts: Map<ReactionKind, number> = new Map(
    reactions.map((r) => [r.reaction, r.count]),
  );
  return (
    <span className={`inline-flex items-center gap-1 ${SIZE_CLASS[size]}`}>
      {REACTIONS.map(({ kind, label }) => {
        const count: number = counts.get(kind) ?? 0;
        const mine: boolean = myReaction === kind;
        return (
          <button
            key={kind}
            type="button"
            disabled={disabled}
            aria-label={label}
            aria-pressed={mine}
            title={label}
            onClick={() => onToggle(kind)}
            className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 leading-none disabled:opacity-40 ${
              mine
                ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100"
                : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }`}
          >
            <ReactionIcon kind={kind} />
            {count > 0 ? (
              <span className="text-zinc-500 dark:text-zinc-400">{count}</span>
            ) : null}
          </button>
        );
      })}
    </span>
  );
}
