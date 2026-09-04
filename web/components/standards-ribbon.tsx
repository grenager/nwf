"use client";

import { AddStoryModal } from "@/components/add-story-modal";
import { useAuthGate } from "@/components/auth-gate";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { shareInviteLink } from "@/lib/invite-share";
import { isPinnable } from "@/lib/home-screen";
import type { RibbonKind } from "@/lib/standards";
import { dismissStandard, isStandardDismissed } from "@/lib/standards";
import type { InvitationCreateResult, StandardsNudge } from "@/lib/types";
import { useEffect, useState } from "react";

/**
 * A standing expectation, stated once above the feed.
 *
 * The app has never said what it wants from people, which leaves everyone
 * guessing whether a week of silence is normal. This says it plainly and then
 * gets out of the way: one ask, and absent entirely for anyone already doing
 * it.
 *
 * Two things it deliberately never does. It quotes no statistic about other
 * members — with a circle this size any average would be invented, and a norm
 * pitched above what someone is managing tends to read as disqualification
 * rather than encouragement. And it names a friend rather than a population,
 * because "Sarah hasn't seen anything from you in nine days" is a cost a
 * person can feel, and it holds up when someone has only one friend, which is
 * exactly when an average would say nothing at all.
 *
 * The one ask that cannot be dismissed is the first post. Everything else is
 * a nudge about a habit; that one is about whether the habit ever starts, and
 * someone who reads for a month without sharing has learned the app is a
 * place you only consume — which is very hard to unlearn later.
 */
export function StandardsRibbon({
  nudge,
  isAdmin = false,
  onPosted,
}: {
  nudge: StandardsNudge | null;
  /** Unlocks the ?ribbon= preview switch. See `previewKind`. */
  isAdmin?: boolean;
  onPosted?: () => void;
}) {
  const { requireAuth } = useAuthGate();
  const { notify } = useToast();
  // Dismissals live in localStorage, so they can only be applied on the
  // client — resolving in an effect keeps the first client render identical
  // to the server's.
  const [hidden, setHidden] = useState<boolean>(true);
  const [addOpen, setAddOpen] = useState<boolean>(false);
  const [inviting, setInviting] = useState<boolean>(false);
  const [acted, setActed] = useState<boolean>(false);

  // The pin ask only applies when the server has nothing to ask for, and only
  // on a platform that can do it. Both facts are client-only, so like the
  // dismissals they are resolved in an effect rather than during render.
  const [kind, setKind] = useState<RibbonKind | null>(null);
  const [forced, setForced] = useState<StandardsNudge | null>(null);
  const [previewing, setPreviewing] = useState<boolean>(false);

  useEffect(() => {
    const preview: RibbonKind | null = isAdmin ? previewKind() : null;
    if (preview !== null) {
      // Reviewing the copy shouldn't require finding an account in the right
      // state, or clearing a dismissal to see the ribbon a second time.
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

  const shown: StandardsNudge | null = forced ?? nudge;

  if (kind === null || hidden || acted) return null;

  function dismiss(): void {
    if (kind === null) return;
    // A dismissal from a preview must not be recorded: dismissing "pin" is
    // permanent, so trying the button out would cost this browser the real
    // ribbon forever.
    if (!previewing) dismissStandard(kind);
    setHidden(true);
  }

  async function invite(): Promise<void> {
    if (!requireAuth("invite friends")) return;
    if (inviting) return;
    setInviting(true);
    try {
      const created: InvitationCreateResult = await api.createInvitation({
        become_friend: true,
      });
      if (!created.invite_url) {
        notify(created.message, "success");
        return;
      }
      const result = await shareInviteLink(created);
      if (result === "copied") notify("Invite link copied", "success");
      if (result === "failed")
        notify("Could not copy the invite link", "error");
    } catch (err) {
      notify(
        err instanceof ApiError ? err.message : "Could not create an invite",
        "error",
      );
    } finally {
      setInviting(false);
    }
  }

  function openAddStory(): void {
    if (!requireAuth("add stories")) return;
    setAddOpen(true);
  }

  if (kind === "pin") {
    return <PinRibbon onDismiss={dismiss} />;
  }
  if (shown === null) return null;

  const isInvite: boolean = shown.kind === "invite";
  const isFirstPost: boolean = shown.kind === "first_post";
  const standard: string = isInvite
    ? "NewsWithFriends works best with a few friends."
    : isFirstPost
      ? "On NewsWithFriends, everyone shares what they're reading."
      : "NewsWithFriends works best when everyone shares something most days.";
  const consequence: string = isInvite
    ? friendConsequence(shown.value)
    : isFirstPost
      ? firstPostConsequence(shown.friend_name)
      : shareConsequence(shown.value, shown.friend_name);
  const action: string = isInvite
    ? inviting
      ? "Creating invite…"
      : "Invite a friend"
    : isFirstPost
      ? "Post your first article"
      : "Share an article";

  return (
    <>
      <section
        aria-label="Getting the most from NewsWithFriends"
        className={
          isFirstPost
            ? "mb-4 flex items-start gap-3 border border-zinc-900 bg-white px-4 py-3 dark:border-zinc-100 dark:bg-zinc-950"
            : "mb-4 flex items-start gap-3 border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
        }
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm text-zinc-800 dark:text-zinc-100">{standard}</p>
          <p className="mt-0.5 text-sm text-zinc-500">{consequence}</p>
          <button
            type="button"
            onClick={isInvite ? () => void invite() : openAddStory}
            disabled={inviting}
            className="mt-2.5 bg-zinc-900 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {action}
          </button>
        </div>
        {/* No dismiss on the first-post ask. It comes back every visit until
            they post, because that is the whole point of it. */}
        {isFirstPost ? null : (
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="shrink-0 px-1 text-xs leading-none text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            ✕
          </button>
        )}
      </section>

      {addOpen ? (
        <AddStoryModal
          onClose={() => setAddOpen(false)}
          onAdded={() => {
            // They just did the thing being asked for; the ribbon has no
            // business still being there while the feed catches up.
            setActed(true);
            setAddOpen(false);
            onPosted?.();
          }}
        />
      ) : null}
    </>
  );
}

/** Why a thin circle matters, in terms of what they'll actually experience. */
function friendConsequence(friends: number): string {
  if (friends <= 0) return "With nobody added yet, there's nothing to read.";
  if (friends === 1) {
    return "With one friend, your feed only moves when they post.";
  }
  return `With ${friends} friends, your feed only moves when they post.`;
}

/**
 * The first ask, stated as what a friend is missing rather than what the
 * member has failed to do. There is no day count to quote here — they have
 * never posted — so the copy says it in words instead of inventing a number.
 */
function firstPostConsequence(friendName: string | null): string {
  return friendName
    ? `${friendName} hasn't seen an article from you yet. It takes a link and a sentence.`
    : "You haven't shared an article yet. It takes a link and a sentence.";
}

/** The cost of silence, as a person where possible. */
function shareConsequence(days: number, friendName: string | null): string {
  const span: string = days <= 1 ? "a day" : `${days} days`;
  return friendName
    ? `${friendName} hasn't seen anything from you in ${span}.`
    : `You haven't shared anything in ${span}.`;
}

/**
 * The one ask with no button to press.
 *
 * iOS exposes no install prompt to a web page, so there is nothing to wire an
 * action to — the whole job is telling someone which menu to open. The
 * sticking point in practice is the Share button itself, which people don't
 * think of as the place apps get installed, so it's drawn inline rather than
 * named and left to be hunted for.
 */
function PinRibbon({ onDismiss }: { onDismiss: () => void }) {
  return (
    <section
      aria-label="Add NewsWithFriends to your home screen"
      className="mb-4 flex items-start gap-3 border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm text-zinc-800 dark:text-zinc-100">
          Keep NewsWithFriends on your home screen.
        </p>
        <p className="mt-0.5 text-sm text-zinc-500">
          Tap <ShareGlyph /> in the browser bar, then “Add to Home Screen”. It
          opens like an app, with no address bar in the way.
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="mt-2.5 bg-zinc-900 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Got it
        </button>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 px-1 text-xs leading-none text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
      >
        ✕
      </button>
    </section>
  );
}

/** iOS's share control: a box with an arrow leaving the top of it. */
function ShareGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-label="the Share button"
      role="img"
      className="inline-block h-[1.05em] w-[1.05em] -translate-y-px align-text-bottom"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v12" />
      <path d="M8.5 6.5 12 3l3.5 3.5" />
      <path d="M7 10H5.5A1.5 1.5 0 0 0 4 11.5v8A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 18.5 10H17" />
    </svg>
  );
}

/** The kinds `?ribbon=` accepts, so a typo shows nothing rather than guessing. */
const PREVIEWABLE: readonly RibbonKind[] = [
  "first_post",
  "invite",
  "share",
  "pin",
];

/**
 * An admin-only `?ribbon=<kind>` override, for reviewing the copy.
 *
 * Each ribbon depends on a state that is slow to arrange and destructive to
 * undo — you cannot un-post your first article — so without this, checking
 * what four variants look like means four throwaway accounts. Reading the
 * query string directly rather than through `useSearchParams` keeps this
 * inside the effect that already resolves the other client-only facts, and
 * avoids forcing a Suspense boundary on the feed for a debugging affordance.
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
  const match = PREVIEWABLE.find((kind) => kind === requested);
  return match ?? null;
}

/**
 * Plausible numbers for a ribbon the viewer does not actually qualify for.
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
  if (kind === "invite") return { kind, value: real?.value ?? 1, friend_name };
  if (kind === "first_post") {
    return { kind, value: real?.value ?? 1, friend_name };
  }
  return { kind: "share", value: 3, friend_name };
}
