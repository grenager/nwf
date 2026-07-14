import type { ReactionKind } from "@/lib/types";

export interface ReactionMeta {
  kind: ReactionKind;
  label: string;
}

// Order drives the reaction picker layout.
export const REACTIONS: ReactionMeta[] = [
  { kind: "thumbsup", label: "Like" },
  { kind: "heart", label: "Love" },
  { kind: "laugh", label: "Haha" },
  { kind: "wow", label: "Wow" },
  { kind: "sad", label: "Sad" },
  { kind: "angry", label: "Angry" },
];

const BY_KIND: Record<ReactionKind, ReactionMeta> = REACTIONS.reduce(
  (acc, meta) => {
    acc[meta.kind] = meta;
    return acc;
  },
  {} as Record<ReactionKind, ReactionMeta>,
);

export function reactionLabel(kind: ReactionKind): string {
  return BY_KIND[kind]?.label ?? kind;
}
