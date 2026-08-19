import type { UUID } from "@/lib/types";

const STORAGE_PREFIX: string = "nwf:draft:";

/** Drafts older than this are dropped on read so abandoned text never lingers. */
const DRAFT_TTL_MS: number = 30 * 24 * 60 * 60 * 1000;

/** What a composer is attached to. Determines the storage key. */
export type DraftScope =
  | { readonly kind: "post"; readonly postId: UUID }
  | { readonly kind: "story"; readonly storyId: UUID }
  | { readonly kind: "invite"; readonly token: string };

/**
 * A composer's in-progress content. ``parentCommentId`` is persisted alongside
 * the text so returning to a thread restores *what* you were replying to, not
 * just the words.
 */
export interface DraftValue {
  readonly text: string;
  readonly parentCommentId: UUID | null;
}

interface StoredDraft extends DraftValue {
  readonly updatedAt: number;
}

export const EMPTY_DRAFT: DraftValue = { text: "", parentCommentId: null };

export function draftScopeKey(
  scope: DraftScope,
  userId: UUID | null,
): string {
  const owner: string = userId ?? "guest";
  switch (scope.kind) {
    case "post":
      return `${STORAGE_PREFIX}${owner}:post:${scope.postId}`;
    case "story":
      return `${STORAGE_PREFIX}${owner}:story:${scope.storyId}`;
    case "invite":
      // Invite links are single-recipient, so the token alone keys the draft.
      // That way it survives the sign-in round trip the invite flow often needs.
      return `${STORAGE_PREFIX}invite:${scope.token}`;
  }
}

export function isDraftEmpty(draft: DraftValue): boolean {
  return draft.text.trim().length === 0;
}

export function draftsEqual(a: DraftValue, b: DraftValue): boolean {
  return a.text === b.text && a.parentCommentId === b.parentCommentId;
}

/**
 * localStorage is unavailable in SSR and throws in some privacy modes, so every
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

function parseStoredDraft(raw: string): StoredDraft | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record: Record<string, unknown> = parsed as Record<string, unknown>;
  const text: unknown = record.text;
  const parentCommentId: unknown = record.parentCommentId;
  const updatedAt: unknown = record.updatedAt;
  if (typeof text !== "string") return null;
  if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) return null;
  if (parentCommentId !== null && typeof parentCommentId !== "string") {
    return null;
  }
  return { text, parentCommentId, updatedAt };
}

type DraftListener = (draft: DraftValue) => void;

/**
 * Latest value per key, updated synchronously on every keystroke. The feed card
 * and the intercepting `/post/[id]` modal mount the same composer at once, so
 * they need a shared source of truth that does not wait on the debounced write.
 */
const latestDrafts: Map<string, DraftValue> = new Map();
const listeners: Map<string, Set<DraftListener>> = new Map();

/** The in-memory value for this key, if a composer has touched it this session. */
export function peekDraft(key: string): DraftValue | null {
  return latestDrafts.get(key) ?? null;
}

export function subscribeToDraft(
  key: string,
  listener: DraftListener,
): () => void {
  const forKey: Set<DraftListener> = listeners.get(key) ?? new Set();
  forKey.add(listener);
  listeners.set(key, forKey);
  return () => {
    forKey.delete(listener);
    if (forKey.size === 0) listeners.delete(key);
  };
}

/** Share a draft with every other composer on the same key, right away. */
export function publishDraft(key: string, draft: DraftValue): void {
  latestDrafts.set(key, draft);
  const forKey: Set<DraftListener> | undefined = listeners.get(key);
  if (forKey === undefined) return;
  for (const listener of forKey) listener(draft);
}

export function readDraft(key: string): DraftValue | null {
  const store: Storage | null = storage();
  if (store === null) return null;
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;
  const stored: StoredDraft | null = parseStoredDraft(raw);
  if (stored === null || Date.now() - stored.updatedAt > DRAFT_TTL_MS) {
    clearDraft(key);
    return null;
  }
  return { text: stored.text, parentCommentId: stored.parentCommentId };
}

/** Persist a draft, or remove the entry entirely once the text is empty. */
export function writeDraft(key: string, draft: DraftValue): void {
  const store: Storage | null = storage();
  if (store === null) return;
  if (isDraftEmpty(draft)) {
    clearDraft(key);
    return;
  }
  const stored: StoredDraft = {
    text: draft.text,
    parentCommentId: draft.parentCommentId,
    updatedAt: Date.now(),
  };
  try {
    store.setItem(key, JSON.stringify(stored));
  } catch {
    // Quota exceeded or storage blocked — the draft simply is not durable.
  }
}

export function clearDraft(key: string): void {
  latestDrafts.delete(key);
  const store: Storage | null = storage();
  if (store === null) return;
  try {
    store.removeItem(key);
  } catch {
    // Nothing to do; the draft stays until the browser clears it.
  }
}

/**
 * Sweep expired drafts across every scope. Reads only ever prune the key being
 * read, so this keeps storage from accumulating threads the user never revisits.
 */
export function pruneExpiredDrafts(): void {
  const store: Storage | null = storage();
  if (store === null) return;
  const expired: string[] = [];
  try {
    for (let i = 0; i < store.length; i += 1) {
      const key: string | null = store.key(i);
      if (key === null || !key.startsWith(STORAGE_PREFIX)) continue;
      const raw: string | null = store.getItem(key);
      if (raw === null) continue;
      const stored: StoredDraft | null = parseStoredDraft(raw);
      if (stored === null || Date.now() - stored.updatedAt > DRAFT_TTL_MS) {
        expired.push(key);
      }
    }
  } catch {
    return;
  }
  for (const key of expired) clearDraft(key);
}
