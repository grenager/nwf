"use client";

import type { StandardsKind } from "@/lib/types";

const STORAGE_KEY: string = "nwf:standards-dismissed";

/**
 * How long a dismissal holds. Short enough that the expectation is still a
 * standing one, long enough that dismissing it means something — a ribbon
 * that reappears tomorrow is a nag, and a nag gets ignored on sight.
 */
const DISMISSAL_TTL_MS: number = 7 * 24 * 60 * 60 * 1000;

/** kind -> when it was dismissed, epoch ms. */
type DismissalMap = Partial<Record<StandardsKind, number>>;

/**
 * localStorage is absent in SSR and throws outright in some privacy modes, so
 * every access funnels through here and degrades to "nothing is dismissed".
 */
function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function read(): DismissalMap {
  const store: Storage | null = storage();
  if (store === null) return {};
  let raw: string | null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return {};
  }
  if (raw === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  const cutoff: number = Date.now() - DISMISSAL_TTL_MS;
  const fresh: DismissalMap = {};
  for (const [kind, at] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof at === "number" && Number.isFinite(at) && at > cutoff) {
      fresh[kind as StandardsKind] = at;
    }
  }
  return fresh;
}

/**
 * Whether this ask is currently dismissed.
 *
 * Kept per kind on purpose: dismissing "invite" should not also silence the
 * unrelated nudge to share something, and the two describe different
 * situations a member can move between.
 */
export function isStandardDismissed(kind: StandardsKind): boolean {
  return read()[kind] !== undefined;
}

export function dismissStandard(kind: StandardsKind): void {
  const store: Storage | null = storage();
  if (store === null) return;
  const next: DismissalMap = { ...read(), [kind]: Date.now() };
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota exceeded or storage blocked — the dismissal is not durable, and
    // the ribbon comes back next visit. Annoying, never broken.
  }
}
