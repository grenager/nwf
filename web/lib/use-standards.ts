"use client";

import { isPinnable } from "@/lib/home-screen";
import type { RibbonKind } from "@/lib/standards";
import { dismissStandard, isStandardDismissed } from "@/lib/standards";
import type { StandardsNudge } from "@/lib/types";
import { useCallback, useEffect, useState } from "react";

/** Every kind `?ribbon=` accepts, so a typo shows nothing rather than guessing. */
const PREVIEWABLE: readonly RibbonKind[] = [
  "first_post",
  "invite",
  "share",
  "pin",
];

export interface ResolvedStandards {
  /** The one ask that applies, or null. */
  kind: RibbonKind | null;
  /** The nudge whose numbers and names the copy should use. */
  nudge: StandardsNudge | null;
  /** True while an admin is forcing a kind with `?ribbon=`. */
  previewing: boolean;
  /** Hide the current ask, recording it unless this is a preview. */
  dismiss: () => void;
}

/**
 * Works out which ask applies to this viewer, on the client.
 *
 * Three of the inputs are things the server cannot know — whether a dismissal
 * is on record, whether the device can pin a site to a home screen, and
 * whether an admin is previewing — so the answer is resolved in an effect and
 * starts as "nothing", keeping the first client render identical to the
 * server's.
 */
export function useStandards(
  nudge: StandardsNudge | null,
  isAdmin: boolean,
): ResolvedStandards {
  const [kind, setKind] = useState<RibbonKind | null>(null);
  const [forced, setForced] = useState<StandardsNudge | null>(null);
  const [previewing, setPreviewing] = useState<boolean>(false);
  const [hidden, setHidden] = useState<boolean>(true);

  useEffect(() => {
    const preview: RibbonKind | null = isAdmin ? previewKind() : null;
    if (preview !== null) {
      setKind(preview);
      setForced(preview === "pin" ? null : sampleNudge(preview, nudge));
      setPreviewing(true);
      setHidden(false);
      return;
    }
    const candidate: RibbonKind | null =
      nudge !== null ? nudge.kind : isPinnable() ? "pin" : null;
    setForced(null);
    setPreviewing(false);
    setHidden(candidate === null || isStandardDismissed(candidate));
    setKind(candidate);
  }, [nudge, isAdmin]);

  const dismiss = useCallback((): void => {
    setKind((current) => {
      // A dismissal from a preview must not be recorded: dismissing "pin" is
      // permanent, so trying the button out would cost this browser the real
      // ribbon forever.
      if (current !== null && !previewing) dismissStandard(current);
      return current;
    });
    setHidden(true);
  }, [previewing]);

  return {
    kind: hidden ? null : kind,
    nudge: forced ?? nudge,
    previewing,
    dismiss,
  };
}

/**
 * An admin-only `?ribbon=<kind>` override, for reviewing the copy.
 *
 * Each ask depends on a state that is slow to arrange and, in one case,
 * impossible to undo — you cannot un-post your first article — so without
 * this, checking what the variants look like means several throwaway
 * accounts. Reading the query string directly rather than through
 * `useSearchParams` keeps it inside the effect that already resolves the
 * other client-only facts, and avoids forcing a Suspense boundary on the feed
 * for a debugging affordance.
 */
function previewKind(): RibbonKind | null {
  if (typeof window === "undefined") return null;
  let requested: string | null;
  try {
    requested = new URLSearchParams(window.location.search).get("ribbon");
  } catch {
    return null;
  }
  if (requested === null) return null;
  return PREVIEWABLE.find((kind) => kind === requested) ?? null;
}

/**
 * Plausible numbers for an ask the viewer does not actually qualify for.
 *
 * Real values are preferred wherever the server sent them, so the preview
 * shows the copy this account would really get; the fallbacks only fill in
 * what it cannot know. `friend_name` is deliberately left null when there is
 * no real friend to name — inventing one would hide the fallback wording,
 * which is the branch most worth looking at.
 */
function sampleNudge(
  kind: RibbonKind,
  real: StandardsNudge | null,
): StandardsNudge {
  if (real !== null && real.kind === kind) return real;
  const friend_name: string | null = real?.friend_name ?? null;
  if (kind === "share") return { kind, value: 3, friend_name };
  if (kind === "pin") return { kind: "share", value: 3, friend_name };
  return { kind, value: real?.value ?? 1, friend_name };
}
