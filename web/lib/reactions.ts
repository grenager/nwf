import type { ReactionKind } from "@/lib/types";

export interface ReactionMeta {
  kind: ReactionKind;
  emoji: string;
  label: string;
}

// Order drives the reaction picker layout.
export const REACTIONS: ReactionMeta[] = [
  { kind: "thumbsup", emoji: "👍", label: "Like" },
  { kind: "heart", emoji: "❤️", label: "Love" },
  { kind: "laugh", emoji: "😂", label: "Haha" },
  { kind: "wow", emoji: "😮", label: "Wow" },
  { kind: "sad", emoji: "😢", label: "Sad" },
  { kind: "angry", emoji: "😠", label: "Angry" },
];

const BY_KIND: Record<ReactionKind, ReactionMeta> = REACTIONS.reduce(
  (acc, meta) => {
    acc[meta.kind] = meta;
    return acc;
  },
  {} as Record<ReactionKind, ReactionMeta>,
);

export function reactionEmoji(kind: ReactionKind): string {
  return BY_KIND[kind]?.emoji ?? "";
}

export function reactionLabel(kind: ReactionKind): string {
  return BY_KIND[kind]?.label ?? kind;
}
