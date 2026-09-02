import { REACTIONS, type ReactionKind } from "@/lib/types";

const STORAGE_PREFIX: string = "nwf:intent:";

/** Matches the draft TTL — a held reaction and its draft expire together. */
const INTENT_TTL_MS: number = 30 * 24 * 60 * 60 * 1000;

interface StoredIntent {
  readonly reaction: ReactionKind | null;
  readonly updatedAt: number;
}

/**
 * The reaction a visitor chose before they had an account.
 *
 * `drafts.ts` already carries un-posted *text* across the sign-in round trip;
 * this is its counterpart for the one-tap action, so a guest can react on an
 * invite landing page and have it applied for real once they join. Keyed by
 * invite token alone (not by user id) for the same reason drafts are: the
 * whole point is to survive going from signed-out to signed-in.
 */
export function inviteIntentKey(token: string): string {
  return `${STORAGE_PREFIX}invite:${token}`;
}

/**
 * localStorage is absent in SSR and throws in some privacy modes, so every
 * access funnels through here and degrades to "no persistence".
 */
function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isReactionKind(value: unknown): value is ReactionKind {
  return REACTIONS.some((r) => r.kind === value);
}

/** The held reaction for this key, or null if there is none (or it expired). */
export function readPendingReaction(key: string): ReactionKind | null {
  const store: Storage | null = storage();
  if (store === null) return null;
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record: Record<string, unknown> = parsed as Record<string, unknown>;
  const updatedAt: unknown = record.updatedAt;
  if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) return null;
  if (Date.now() - updatedAt > INTENT_TTL_MS) {
    clearPendingReaction(key);
    return null;
  }
  return isReactionKind(record.reaction) ? record.reaction : null;
}

/** Persist a held reaction, or drop the entry entirely once it is cleared. */
export function writePendingReaction(
  key: string,
  reaction: ReactionKind | null,
): void {
  if (reaction === null) {
    clearPendingReaction(key);
    return;
  }
  const store: Storage | null = storage();
  if (store === null) return;
  const stored: StoredIntent = { reaction, updatedAt: Date.now() };
  try {
    store.setItem(key, JSON.stringify(stored));
  } catch {
    // Quota exceeded or storage blocked — the choice simply is not durable.
  }
}

export function clearPendingReaction(key: string): void {
  const store: Storage | null = storage();
  if (store === null) return;
  try {
    store.removeItem(key);
  } catch {
    // Nothing to do; it stays until the browser clears it.
  }
}
