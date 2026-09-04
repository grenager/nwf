"use client";

import { useAuthGate } from "@/components/auth-gate";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { shareInviteLink } from "@/lib/invite-share";
import { useStandards } from "@/lib/use-standards";
import type {
  InvitationCreateResult,
  Profile,
  StandardsNudge,
} from "@/lib/types";
import { useState } from "react";

/**
 * A single line pinned to the top of the feed, for the two asks a composer
 * cannot answer: too few friends, and an unpinned home screen.
 *
 * Inverted rather than coloured. The app has no accent hue at all — the
 * Tailwind config says so outright, and the whole thing reads as ink on paper
 * — so a coloured bar would be the only colour in the product and would land
 * as a cookie banner or an error. Black on white flips to white on black and
 * gets the same salience while still looking like it belongs.
 *
 * It stays one line at every width. Anything taller stops being a rule across
 * the top of the page and becomes another box to scroll past, which is the
 * thing this replaced.
 */
export function StandardsStrip({
  me,
  nudge,
}: {
  me: Profile | null;
  nudge: StandardsNudge | null;
}) {
  const { requireAuth } = useAuthGate();
  const { notify } = useToast();
  const [inviting, setInviting] = useState<boolean>(false);
  const {
    kind,
    nudge: shown,
    dismiss,
  } = useStandards(nudge, me?.is_admin === true);

  if (kind !== "invite" && kind !== "pin") return null;

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

  return (
    <div
      // Below `sm` the nav is a bottom bar, so the top of the viewport is
      // free; from `sm` a sticky header occupies it; at `lg` the main column
      // becomes its own scroll container and the offset resets to zero.
      className="sticky top-0 z-30 -mx-3 bg-zinc-900 text-white sm:top-[var(--nav-h)] lg:top-0 sm:mx-0 dark:bg-zinc-100 dark:text-zinc-900"
    >
      <div className="flex items-center gap-3 px-4 py-2">
        {/* Only the message may be clipped. The action sits outside it as its
            own flex child, because a strip that truncates away the one thing
            it is asking you to do is worse than no strip. */}
        <p className="min-w-0 flex-1 truncate text-xs sm:text-sm">
          {kind === "invite" ? (
            <>
              {/* The reason a thin circle matters does not fit beside the
                  action on a phone, and half a sentence followed by an
                  ellipsis reads worse than a short one that finishes. */}
              <span className="sm:hidden">
                {shortInviteLine(shown?.value ?? 0)}
              </span>
              <span className="hidden sm:inline">
                {inviteLine(shown?.value ?? 0)}
              </span>
            </>
          ) : (
            <>
              Tap <ShareGlyph /> then{" "}
              <span className="font-semibold">Add to Home Screen</span>.
            </>
          )}
        </p>
        {kind === "invite" ? (
          <button
            type="button"
            onClick={() => void invite()}
            disabled={inviting}
            className="shrink-0 text-xs font-semibold underline underline-offset-2 disabled:opacity-60 sm:text-sm"
          >
            {inviting ? "Creating…" : "Invite someone"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 px-1 text-xs leading-none opacity-70 transition hover:opacity-100"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

/** Why a thin circle matters, in terms of what they'll actually experience. */
function shortInviteLine(friends: number): string {
  if (friends <= 0) return "No friends yet.";
  if (friends === 1) return "Only 1 friend so far.";
  return `Only ${friends} friends so far.`;
}

function inviteLine(friends: number): string {
  if (friends <= 0) return "No friends yet, so there's nothing to read.";
  if (friends === 1) return "Only 1 friend, so your feed stays quiet.";
  return `Only ${friends} friends, so your feed stays quiet.`;
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
