import type { UUID } from "@/lib/types";

/** Phrase a mutual-friend count the same way everywhere it is shown. */
export function mutualLabel(count: number): string {
  if (count <= 0) return "";
  return count === 1 ? "1 mutual friend" : `${count} mutual friends`;
}

const DISMISSED_KEY: string = "nwf:pymk-dismissed";

/**
 * Dismissals expire so someone hidden back when you shared one friend can
 * resurface once you share five — the recommendation is different by then.
 */
const DISMISSAL_TTL_MS: number = 90 * 24 * 60 * 60 * 1000;

/** userId -> when it was dismissed, epoch ms. */
type DismissalMap = Record<string, number>;

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

function parseDismissals(raw: string): DismissalMap {
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
  for (const [userId, at] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof at !== "number" || !Number.isFinite(at)) continue;
    if (at < cutoff) continue;
    fresh[userId] = at;
  }
  return fresh;
}

function readDismissals(): DismissalMap {
  const store: Storage | null = storage();
  if (store === null) return {};
  let raw: string | null;
  try {
    raw = store.getItem(DISMISSED_KEY);
  } catch {
    return {};
  }
  if (raw === null) return {};
  return parseDismissals(raw);
}

/**
 * Recommendations this browser has dismissed and not yet aged out. Reading
 * prunes expired entries, so the set never grows without bound.
 */
export function dismissedRecommendations(): ReadonlySet<UUID> {
  const fresh: DismissalMap = readDismissals();
  return new Set(Object.keys(fresh) as UUID[]);
}

/** Hide a recommendation on this browser. Silently a no-op without storage. */
export function dismissRecommendation(userId: UUID): void {
  const store: Storage | null = storage();
  if (store === null) return;
  const next: DismissalMap = { ...readDismissals(), [userId]: Date.now() };
  try {
    store.setItem(DISMISSED_KEY, JSON.stringify(next));
  } catch {
    // Quota exceeded or storage blocked — the dismissal just is not durable.
  }
}
