"use client";

import type { StandardsKind } from "@/lib/types";

const STORAGE_KEY: string = "nwf:standards-dismissed";

/**
 * Everything the ribbon can ask for. "pin" is client-only — whether the site
 * is worth putting on a home screen is not something the server can know.
 */
export type RibbonKind = StandardsKind | "pin";

/**
 * How long a dismissal holds. Short enough that the expectation is still a
 * standing one, long enough that dismissing it means something — a ribbon
 * that reappears tomorrow is a nag, and a nag gets ignored on sight.
 */
const DISMISSAL_TTL_MS: number = 7 * 24 * 60 * 60 * 1000;

/**
 * Dismissing the home screen ask is permanent.
 *
 * The others describe situations a member moves in and out of, so they are
 * worth raising again in a week. This one describes a thing they either did
 * or decided against, and iOS gives the page no way to tell which — so asking
 * a second time is as likely to be wrong as right, and being told twice to do
 * something you already did is how a prompt loses its credibility.
 */
const PERMANENT: readonly RibbonKind[] = ["pin"];

function ttlFor(kind: RibbonKind): number {
  return PERMANENT.includes(kind) ? Number.POSITIVE_INFINITY : DISMISSAL_TTL_MS;
}

/** kind -> when it was dismissed, epoch ms. */
type DismissalMap = Partial<Record<RibbonKind, number>>;

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
  const now: number = Date.now();
  const fresh: DismissalMap = {};
  for (const [key, at] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof at !== "number" || !Number.isFinite(at)) continue;
    const kind = key as RibbonKind;
    if (at > now - ttlFor(kind)) fresh[kind] = at;
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
export function isStandardDismissed(kind: RibbonKind): boolean {
  return read()[kind] !== undefined;
}

export function dismissStandard(kind: RibbonKind): void {
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
